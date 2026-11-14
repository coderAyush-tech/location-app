import { useCallback, useEffect, useRef, useState } from 'react'
import {
  closeLiveAudioSession,
  createLiveAudioSession,
  getLiveAudioSocketUrl,
  liveVideoMimeType,
  liveVideoTimesliceMs,
  maximumBufferedBytes,
  maximumWebSocketFrameBytes,
  preferredRecorderOptions,
} from './liveAudioApi'

const initialState = {
  status: 'idle',
  message: 'Camera and microphone start only after your consent.',
}

function stopTracks(stream) {
  stream?.getTracks().forEach((track) => {
    if (track.readyState !== 'ended') track.stop()
  })
}

function delay(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

function waitForEventOrTimeout(target, eventName, milliseconds) {
  return new Promise((resolve) => {
    let settled = false
    const finish = (eventReceived) => {
      if (settled) return
      settled = true
      window.clearTimeout(timeoutId)
      target.removeEventListener?.(eventName, finish)
      if (target[`on${eventName}`] === finish) target[`on${eventName}`] = null
      resolve(eventReceived)
    }
    const timeoutId = window.setTimeout(() => finish(false), milliseconds)
    if (target.addEventListener) target.addEventListener(eventName, () => finish(true), { once: true })
    else target[`on${eventName}`] = () => finish(true)
  })
}

async function waitForSocketDrain(session, timeoutMs = 15_000) {
  const startedAt = Date.now()
  while (session.socket?.readyState === WebSocket.OPEN && session.socket.bufferedAmount > 0) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('The live connection did not finish sending its queued video data.')
    await delay(25)
  }
  if (session.sendFailure) throw session.sendFailure
  if (session.socket && session.socket.readyState !== WebSocket.OPEN && !session.intentionalStop) {
    throw new Error('The live recording connection closed before all video data was sent.')
  }
}

async function sendBlobInFrames(session, blob) {
  for (let offset = 0; offset < blob.size; offset += maximumWebSocketFrameBytes) {
    if (session.sendFailure) throw session.sendFailure
    const waitStartedAt = Date.now()
    while (session.socket?.readyState === WebSocket.OPEN
      && session.socket.bufferedAmount > maximumBufferedBytes) {
      if (Date.now() - waitStartedAt > 15_000) throw new Error('The live connection stayed backpressured for too long.')
      if (session.intentionalStop && session.socket.readyState !== WebSocket.OPEN) {
        throw new Error('The live recording connection closed before all video data was sent.')
      }
      await delay(25)
    }
    if (session.socket?.readyState !== WebSocket.OPEN) {
      throw new Error('The live recording connection is not available.')
    }

    const frameBlob = blob.slice(offset, offset + maximumWebSocketFrameBytes)
    const frame = await frameBlob.arrayBuffer()
    if (session.socket?.readyState !== WebSocket.OPEN) {
      throw new Error('The live recording connection closed while sending video.')
    }
    session.socket.send(frame)
  }
}

export default function useLiveAudioPublisher() {
  const [recordingState, setRecordingState] = useState(initialState)
  const generationRef = useRef(0)
  const activeSessionRef = useRef(null)

  const stop = useCallback(({
    status = 'finalized',
    message = 'Recording finalized. Camera and microphone are off.',
    updateState = true,
  } = {}) => {
    const session = activeSessionRef.current
    if (!session) {
      if (updateState) setRecordingState({ status, message })
      return Promise.resolve()
    }
    if (session.stopPromise) return session.stopPromise

    const stopGeneration = ++generationRef.current
    session.intentionalStop = true
    session.controller.abort()
    if (updateState) {
      setRecordingState({
        status: 'finalizing',
        message: 'Stopping recording and finalizing the video…',
      })
    }

    const recorder = session.recorder
    let recorderStopped = Promise.resolve()
    if (recorder && recorder.state !== 'inactive') {
      recorderStopped = waitForEventOrTimeout(recorder, 'stop', 10_000)
      try { recorder.stop() } catch { /* It may already have stopped. */ }
    }

    session.stopPromise = (async () => {
      let sendError = null
      try {
        const recorderStopConfirmed = await recorderStopped
        if (recorderStopConfirmed === false) {
          sendError = new Error('The browser did not confirm that its final video chunk was ready in time.')
        }
        await session.sendQueue
        if (session.socket?.readyState === WebSocket.OPEN) {
          try { await waitForSocketDrain(session) } catch (error) { sendError ||= error }
        }
        if (session.sendFailure) sendError ||= session.sendFailure
      } catch (error) {
        sendError ||= error
      }

      if (session.socket) {
        session.socket.onopen = null
        session.socket.onerror = null
        session.socket.onclose = null
        session.socket.onmessage = null
      }

      let closeError = null
      if (session.sessionId && session.publishToken) {
        try {
          await closeLiveAudioSession({
            sessionId: session.sessionId,
            publishToken: session.publishToken,
          })
        } catch (error) {
          closeError = error
        }
      }

      if (session.socket) {
        try {
          if ([WebSocket.OPEN, WebSocket.CONNECTING].includes(session.socket.readyState)) {
            session.socket.close(1000, 'Publisher finalized recording')
          }
        } catch { /* The server may already have closed it. */ }
      }
      session.stream?.getTracks().forEach((track) => {
        if (session.onTrackEnded) track.removeEventListener?.('ended', session.onTrackEnded)
      })
      stopTracks(session.stream)
      if (activeSessionRef.current === session) activeSessionRef.current = null

      if (updateState && generationRef.current === stopGeneration) {
        if (closeError) {
          setRecordingState({
            status: 'cleanup-warning',
            message: 'Camera and microphone are off, but the backend did not confirm finalization. Check the network/CORS response.',
          })
        } else if (sendError) {
          setRecordingState({
            status: 'disconnected',
            message: `Live recording stopped. Some queued video could not be confirmed: ${sendError.message}`,
          })
        } else {
          setRecordingState({ status, message })
        }
      }
    })()

    return session.stopPromise
  }, [])

  const start = useCallback(async ({ stream, isRunActive }) => {
    const generation = ++generationRef.current
    const session = {
      controller: new AbortController(),
      intentionalStop: false,
      pendingBytes: 0,
      pausedForBackpressure: false,
      publishToken: '',
      recorder: null,
      sendFailure: null,
      sendQueue: Promise.resolve(),
      sessionId: '',
      socket: null,
      stopPromise: null,
      stream,
    }
    activeSessionRef.current = session
    const isCurrent = () => (
      generationRef.current === generation
      && activeSessionRef.current === session
      && isRunActive()
    )

    const recorderOptions = preferredRecorderOptions()
    if (!recorderOptions) {
      activeSessionRef.current = null
      stopTracks(stream)
      setRecordingState({ status: 'unavailable', message: 'This browser cannot record video/webm;codecs=vp8,opus.' })
      return false
    }

    setRecordingState({ status: 'connecting', message: 'Camera and microphone ready. Connecting to the private live room…' })
    try {
      const room = await createLiveAudioSession({ signal: session.controller.signal })
      session.sessionId = room.sessionId
      session.publishToken = room.publishToken
      if (!isCurrent() || session.intentionalStop) {
        await closeLiveAudioSession(room).catch(() => {})
        stopTracks(stream)
        return false
      }

      const socket = new WebSocket(getLiveAudioSocketUrl())
      session.socket = socket
      socket.binaryType = 'arraybuffer'

      await new Promise((resolve, reject) => {
        let settled = false
        const finish = (callback, value) => {
          if (settled) return
          settled = true
          window.clearTimeout(timeoutId)
          session.controller.signal.removeEventListener('abort', abortConnection)
          callback(value)
        }
        const timeoutId = window.setTimeout(() => finish(reject, new Error('Live recording connection timed out.')), 15_000)
        const abortConnection = () => finish(reject, new Error('Live recording connection was cancelled.'))
        session.controller.signal.addEventListener('abort', abortConnection, { once: true })

        socket.onopen = () => {
          if (!isCurrent() || session.intentionalStop) {
            socket.close()
            finish(reject, new Error('Live recording connection was cancelled.'))
            return
          }
          try {
            socket.send(JSON.stringify({
              role: 'publisher',
              sessionId: room.sessionId,
              credential: room.publishToken,
            }))
            finish(resolve)
          } catch (error) {
            finish(reject, error)
          }
        }
        socket.onerror = () => finish(reject, new Error('Live recording connection failed.'))
        socket.onclose = () => {
          if (!session.intentionalStop) {
            if (settled) void stop({
              status: 'disconnected',
              message: 'Live recording disconnected. Camera and microphone have been stopped.',
            })
            else finish(reject, new Error('Live recording connection closed.'))
          }
        }
      })

      if (!isCurrent() || session.intentionalStop) return false

      const recorder = new MediaRecorder(stream, recorderOptions)
      session.recorder = recorder
      const stoppedPromise = new Promise((resolve) => { session.resolveRecorderStopped = resolve })
      session.sendQueue = Promise.resolve()
      recorder.ondataavailable = (event) => {
        if (!event.data?.size) return
        session.pendingBytes += event.data.size
        if (session.pendingBytes > 2 * 1024 * 1024 && recorder.state === 'recording' && typeof recorder.pause === 'function') {
          try {
            recorder.pause()
            session.pausedForBackpressure = true
            setRecordingState({
              status: 'live',
              message: 'REC LIVE — administrator connection is draining a temporary video backlog; recording will resume automatically.',
            })
          } catch { /* Some browsers cannot pause a recorder in its current state. */ }
        }
        session.sendQueue = session.sendQueue.then(async () => {
          if (session.sendFailure) throw session.sendFailure
          await sendBlobInFrames(session, event.data)
        }).catch((error) => {
          session.sendFailure = error
          if (!session.intentionalStop) void stop({
            status: 'disconnected',
            message: 'Live recording disconnected. Camera and microphone have been stopped.',
          })
        }).finally(() => {
          session.pendingBytes = Math.max(0, session.pendingBytes - event.data.size)
          if (session.pausedForBackpressure
            && session.pendingBytes < 512 * 1024
            && !session.intentionalStop
            && recorder.state === 'paused'
            && socket.readyState === WebSocket.OPEN) {
            try {
              recorder.resume()
              session.pausedForBackpressure = false
              setRecordingState({
                status: 'live',
                message: 'REC LIVE — camera and microphone are streaming to the administrator until you press Stop.',
              })
            } catch { /* The stream may have ended during recovery. */ }
          }
        })
      }
      recorder.onstop = () => session.resolveRecorderStopped?.()
      recorder.onerror = () => {
        void stop({
          status: 'disconnected',
          message: 'The browser stopped recording unexpectedly. Camera and microphone have been stopped.',
        })
      }
      session.recorderStopped = stoppedPromise

      session.onTrackEnded = () => {
        if (!session.intentionalStop) void stop({
          status: 'disconnected',
          message: 'Camera or microphone stopped unexpectedly. The live recording has ended.',
        })
      }
      stream.getTracks().forEach((track) => track.addEventListener?.('ended', session.onTrackEnded))
      socket.onerror = () => {
        if (!session.intentionalStop) void stop({
          status: 'disconnected',
          message: 'Live recording disconnected. Camera and microphone have been stopped.',
        })
      }
      socket.onclose = () => {
        if (!session.intentionalStop) {
          void stop({
            status: 'disconnected',
            message: 'Live recording disconnected. Camera and microphone have been stopped.',
          })
        }
      }

      recorder.start(liveVideoTimesliceMs)
      setRecordingState({
        status: 'live',
        message: 'REC LIVE — camera and microphone are streaming to the administrator until you press Stop.',
      })
      return true
    } catch (error) {
      if (activeSessionRef.current === session) {
        await stop({
          status: session.sessionId ? 'disconnected' : 'error',
          message: `${error?.message || 'The live recording could not start.'} Camera and microphone have been stopped.`,
        })
      } else {
        stopTracks(stream)
      }
      return false
    }
  }, [stop])

  const reset = useCallback(() => {
    const pending = stop({ updateState: false })
    setRecordingState(initialState)
    return pending
  }, [stop])

  const getCaptureCredentials = useCallback(() => {
    const session = activeSessionRef.current
    if (!session || session.stopPromise || !session.sessionId || !session.publishToken || !session.recorder) return null
    return {
      recordingSessionId: session.sessionId,
      publishToken: session.publishToken,
    }
  }, [])

  useEffect(() => () => {
    void stop({ updateState: false })
  }, [stop])

  return {
    getCaptureCredentials,
    recordingState,
    reset,
    start,
    stop,
  }
}
