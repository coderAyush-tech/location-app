import { useCallback, useEffect, useRef, useState } from 'react'
import { AdminApiError, fetchAdminLiveAudioSessions } from './adminApi'
import { getLiveAudioSocketUrl } from '../capture/liveAudioApi'

const liveAudioMimeType = 'audio/webm;codecs="opus"'

function normalizeSessions(payload) {
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload?.sessions)) return payload.sessions
  if (Array.isArray(payload?.activeSessions)) return payload.activeSessions
  if (Array.isArray(payload?.content)) return payload.content
  return []
}

function stopSocket(socket) {
  if (!socket) return
  socket.onopen = null
  socket.onerror = null
  socket.onclose = null
  socket.onmessage = null
  try {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close(1000, 'Admin stopped listening')
    }
  } catch {
    // The remote publisher may have already closed this listener.
  }
}

export default function AdminAudioMonitor({ token, onAuthError }) {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [listeningSessionId, setListeningSessionId] = useState('')
  const [listenStatus, setListenStatus] = useState('Choose an active room to listen.')
  const audioElementRef = useRef(null)
  const monitorRef = useRef(null)

  const stopListening = useCallback(({ message = 'Listening stopped. The publisher microphone remains live.', updateState = true } = {}) => {
    const monitor = monitorRef.current
    monitorRef.current = null
    if (monitor) {
      stopSocket(monitor.socket)
      monitor.queue.length = 0
      monitor.sourceBuffer = null
      monitor.mediaSource = null
      if (monitor.objectUrl) URL.revokeObjectURL(monitor.objectUrl)
    }

    const audio = audioElementRef.current
    if (audio) {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    }

    setListeningSessionId('')
    if (updateState) setListenStatus(message)
  }, [])

  useEffect(() => {
    let mounted = true
    let activeController = null

    const loadSessions = async () => {
      activeController?.abort()
      const controller = new AbortController()
      activeController = controller

      try {
        const payload = await fetchAdminLiveAudioSessions({ token, signal: controller.signal })
        if (!mounted || controller.signal.aborted) return
        setSessions(normalizeSessions(payload))
        setError('')
      } catch (requestError) {
        if (!mounted || controller.signal.aborted || requestError.name === 'AbortError') return
        if (requestError instanceof AdminApiError && [401, 403].includes(requestError.status)) {
          onAuthError()
          return
        }
        setError(requestError.message || 'Active audio rooms could not be loaded.')
      } finally {
        if (mounted && !controller.signal.aborted) setLoading(false)
      }
    }

    void loadSessions()
    const intervalId = window.setInterval(() => { void loadSessions() }, 5_000)

    return () => {
      mounted = false
      window.clearInterval(intervalId)
      activeController?.abort()
    }
  }, [onAuthError, token])

  useEffect(() => () => stopListening({ updateState: false }), [stopListening])

  const startListening = (session) => {
    const sessionId = session?.sessionId
    if (!sessionId || !token) return

    stopListening({ updateState: false })
    if (typeof MediaSource === 'undefined' || !MediaSource.isTypeSupported(liveAudioMimeType)) {
      setListenStatus('This browser cannot play the live WebM audio stream.')
      return
    }

    const audio = audioElementRef.current
    if (!audio) {
      setListenStatus('Audio playback is unavailable in this browser.')
      return
    }

    const mediaSource = new MediaSource()
    const objectUrl = URL.createObjectURL(mediaSource)
    const monitor = {
      mediaSource,
      objectUrl,
      queue: [],
      sessionId,
      socket: null,
      sourceBuffer: null,
      hasReceivedAudio: false,
    }
    monitorRef.current = monitor
    audio.src = objectUrl
    setListeningSessionId(sessionId)
    setListenStatus('Connecting to the live audio room…')

    const appendQueuedChunk = () => {
      if (monitorRef.current !== monitor || !monitor.sourceBuffer || monitor.sourceBuffer.updating) return
      const nextChunk = monitor.queue.shift()
      if (!nextChunk) return

      try {
        monitor.sourceBuffer.appendBuffer(nextChunk)
      } catch {
        stopListening({ message: 'Live audio playback failed. The publisher is still live.' })
      }
    }

    mediaSource.addEventListener('sourceopen', () => {
      if (monitorRef.current !== monitor) return
      try {
        monitor.sourceBuffer = mediaSource.addSourceBuffer(liveAudioMimeType)
        monitor.sourceBuffer.addEventListener('updateend', appendQueuedChunk)
        monitor.socket = new WebSocket(getLiveAudioSocketUrl())
        monitor.socket.binaryType = 'arraybuffer'
        monitor.socket.onopen = () => {
          if (monitorRef.current !== monitor) return
          try {
            monitor.socket.send(JSON.stringify({
              role: 'admin',
              sessionId,
              credential: token,
            }))
            setListenStatus('Connected. Waiting for live audio…')
          } catch {
            stopListening({ message: 'Live audio disconnected. The publisher is still live.' })
          }
        }
        monitor.socket.onmessage = (event) => {
          if (monitorRef.current !== monitor || typeof event.data === 'string') return
          const queueChunk = (buffer) => {
            if (!buffer.byteLength || monitorRef.current !== monitor) return
            monitor.queue.push(buffer)
            if (!monitor.hasReceivedAudio) {
              monitor.hasReceivedAudio = true
              setListenStatus('Live audio is playing from the consented room.')
            }
            appendQueuedChunk()
            void audio.play().catch(() => {
              setListenStatus('Connected. Press Play in the audio player to hear the live stream.')
            })
          }

          if (event.data instanceof ArrayBuffer) queueChunk(event.data)
          else if (event.data instanceof Blob) void event.data.arrayBuffer().then(queueChunk)
        }
        monitor.socket.onerror = () => {
          stopListening({ message: 'Live audio disconnected. The publisher is still live.' })
        }
        monitor.socket.onclose = () => {
          if (monitorRef.current === monitor) {
            stopListening({ message: 'Live audio disconnected. The publisher is still live.' })
          }
        }
      } catch {
        stopListening({ message: 'Live audio could not connect. The publisher is still live.' })
      }
    }, { once: true })
  }

  return (
    <section className="admin-panel space-y-4 rounded-xl p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] tracking-[0.2em] text-emerald-400/55">CONSENTED LIVE MICROPHONE ROOMS</p>
          <h2 className="mt-1 text-lg font-semibold text-emerald-200">Live audio monitor</h2>
          <p className="mt-1 text-xs leading-5 text-emerald-100/55">Listening uses only this admin socket. Stop Listening does not stop the user’s microphone.</p>
        </div>
        <span aria-live="polite" className="text-xs text-emerald-300">{loading ? 'SYNCING…' : `${sessions.length} ACTIVE`}</span>
      </div>

      {error && <p className="rounded-lg border border-amber-400/25 bg-amber-400/10 p-3 text-sm text-amber-100">{error}</p>}
      {sessions.length === 0 && !loading && !error && <p className="rounded-lg border border-emerald-400/10 bg-black/20 p-3 text-sm text-emerald-100/50">No consented live audio rooms are active.</p>}

      {sessions.length > 0 && (
        <ul className="grid gap-3 md:grid-cols-2">
          {sessions.map((session) => {
            const sessionId = session.sessionId
            const isListening = listeningSessionId === sessionId
            return (
              <li className="flex flex-col gap-3 rounded-lg border border-emerald-400/15 bg-black/25 p-3 sm:flex-row sm:items-center sm:justify-between" key={sessionId}>
                <div className="min-w-0">
                  <p className="break-all font-mono text-xs text-emerald-200">{sessionId}</p>
                  <p className="mt-1 text-[10px] text-emerald-100/45">{session.createdAt ? new Date(session.createdAt).toLocaleString() : 'Active now'}</p>
                  {isListening && <p aria-live="polite" className="mt-2 text-xs font-semibold text-rose-300">● ADMIN LISTENING</p>}
                </div>
                {isListening
                  ? <button className="admin-button-danger shrink-0" onClick={() => stopListening()} type="button">Stop Listening</button>
                  : <button className="admin-button-primary shrink-0" onClick={() => startListening(session)} type="button">Listen live</button>}
              </li>
            )
          })}
        </ul>
      )}

      <audio aria-label="Live microphone audio player" className="w-full" controls hidden={!listeningSessionId} ref={audioElementRef} />
      {listeningSessionId && <p aria-live="polite" className="text-xs text-emerald-100/65">{listenStatus}</p>}
      {!listeningSessionId && <p aria-live="polite" className="text-xs text-emerald-100/50">{listenStatus}</p>}
    </section>
  )
}
