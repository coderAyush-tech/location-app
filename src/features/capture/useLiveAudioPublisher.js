import { useCallback, useEffect, useRef, useState } from 'react'
import {
  closeLiveAudioSession,
  createLiveAudioSession,
  getLiveAudioSocketUrl,
  liveAudioChunkMs,
  maximumAudioBytes,
  maximumLiveAudioMs,
  maximumWebSocketChunkBytes,
  preferredRecorderOptions,
} from './liveAudioApi'

const initialAudioState = {
  status: 'idle',
  message: 'Microphone starts only after your consent.',
}

function stopTracks(stream) {
  stream?.getTracks().forEach((track) => track.stop())
}

function audioBlobFor(session) {
  if (!session.chunks.length || !session.audioBytes) return null
  return new Blob(session.chunks, { type: session.mimeType || 'audio/webm' })
}

export default function useLiveAudioPublisher() {
  const [audioState, setAudioState] = useState(initialAudioState)
  const [recordedAudio, setRecordedAudio] = useState(null)
  const generationRef = useRef(0)
  const activeSessionRef = useRef(null)
  const pendingControllerRef = useRef(null)
  const recordedAudioRef = useRef(null)

  const finishSession = useCallback((session, {
    status = 'stopped',
    message = 'Microphone stopped. The recording will be included with your photo.',
    clearRecording = false,
    updateState = true,
  } = {}) => {
    if (session.stopPromise) return session.stopPromise

    const stopGeneration = ++generationRef.current
    session.intentionalClose = true
    if (activeSessionRef.current === session) activeSessionRef.current = null
    if (pendingControllerRef.current === session.controller) pendingControllerRef.current = null
    window.clearTimeout(session.durationTimer)
    session.controller?.abort()

    const recorder = session.recorder
    let recorderStopped = Promise.resolve()
    if (recorder && recorder.state !== 'inactive') {
      recorderStopped = new Promise((resolve) => {
        const fallbackTimer = window.setTimeout(resolve, 1_000)
        const handleStop = () => {
          window.clearTimeout(fallbackTimer)
          resolve()
        }
        recorder.addEventListener?.('stop', handleStop, { once: true })
        if (!recorder.addEventListener) recorder.onstop = handleStop
        try {
          recorder.stop()
        } catch {
          handleStop()
        }
      })
    }

    stopTracks(session.microphoneStream)

    session.stopPromise = (async () => {
      await recorderStopped
      const blob = audioBlobFor(session)
      session.collectRecording = false

      if (session.socket) {
        session.socket.onopen = null
        session.socket.onerror = null
        session.socket.onclose = null
        session.socket.onmessage = null
        session.socketConnected = false
        try {
          if (session.socket.readyState === WebSocket.OPEN || session.socket.readyState === WebSocket.CONNECTING) {
            session.socket.close(1000, 'Publisher stopped')
          }
        } catch {
          // The browser may already have closed the socket.
        }
      }

      if (clearRecording) {
        recordedAudioRef.current = null
        setRecordedAudio(null)
      } else if (blob) {
        recordedAudioRef.current = blob
        setRecordedAudio(blob)
      }

      if (session.sessionId && session.publishToken) {
        void closeLiveAudioSession({
          sessionId: session.sessionId,
          publishToken: session.publishToken,
        }).catch(() => {
          if (updateState && generationRef.current === stopGeneration) {
            setAudioState({
              status: 'cleanup-warning',
              message: 'Microphone and live audio are off, but the backend room close was not confirmed. It will expire automatically; check the backend CORS response.',
            })
          }
        })
      }

      if (updateState && generationRef.current === stopGeneration) {
        setAudioState({ status, message })
      }

      return clearRecording ? null : (blob || recordedAudioRef.current)
    })()

    return session.stopPromise
  }, [])

  const stop = useCallback((options = {}) => {
    const session = activeSessionRef.current
    if (session) return finishSession(session, options)

    const stopGeneration = ++generationRef.current
    pendingControllerRef.current?.abort()
    pendingControllerRef.current = null

    if (options.clearRecording) {
      recordedAudioRef.current = null
      setRecordedAudio(null)
    }
    if (options.updateState !== false) {
      setAudioState({
        status: options.status || 'stopped',
        message: options.message || 'Microphone is off.',
      })
    }
    return Promise.resolve(options.clearRecording ? null : recordedAudioRef.current)
  }, [finishSession])

  const start = useCallback(async ({ isRunActive, onMicrophonePermissionSettled }) => {
    const generation = ++generationRef.current
    pendingControllerRef.current?.abort()
    const controller = new AbortController()
    pendingControllerRef.current = controller
    recordedAudioRef.current = null
    setRecordedAudio(null)
    setAudioState({ status: 'requesting', message: 'Requesting microphone permission…' })

    let permissionSettled = false
    const notifyPermissionSettled = () => {
      if (permissionSettled) return
      permissionSettled = true
      onMicrophonePermissionSettled?.()
    }
    const isCurrent = () => generationRef.current === generation && isRunActive()

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      notifyPermissionSettled()
      if (isCurrent()) {
        setAudioState({
          status: 'unavailable',
          message: 'Live audio is unavailable in this browser. Camera capture can continue without audio.',
        })
      }
      return null
    }

    try {
      const recorderOptions = preferredRecorderOptions()
      if (recorderOptions === null) {
        notifyPermissionSettled()
        if (isCurrent()) {
          setAudioState({
            status: 'unavailable',
            message: 'Audio recording is unsupported in this browser. Camera capture can continue without audio.',
          })
        }
        return null
      }

      const microphoneStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      })
      notifyPermissionSettled()

      if (!isCurrent()) {
        stopTracks(microphoneStream)
        return null
      }

      const session = {
        audioBytes: 0,
        chunks: [],
        controller,
        durationTimer: null,
        intentionalClose: false,
        microphoneStream,
        mimeType: recorderOptions.mimeType || '',
        publishToken: '',
        recorder: null,
        sessionId: '',
        socket: null,
        socketConnected: false,
        collectRecording: true,
        stopPromise: null,
      }
      activeSessionRef.current = session
      setAudioState({ status: 'connecting', message: 'Microphone allowed. Connecting to the live audio room…' })

      const room = await createLiveAudioSession({ signal: controller.signal })
      if (!isCurrent() || session.intentionalClose) {
        void closeLiveAudioSession({ sessionId: room.sessionId, publishToken: room.publishToken }).catch(() => {})
        stopTracks(microphoneStream)
        return null
      }
      session.sessionId = room.sessionId
      session.publishToken = room.publishToken

      const socket = new WebSocket(getLiveAudioSocketUrl())
      session.socket = socket
      socket.binaryType = 'arraybuffer'

      await new Promise((resolve, reject) => {
        let settled = false
        const connectTimeout = window.setTimeout(() => {
          if (settled) return
          settled = true
          reject(new Error('Live audio connection timed out.'))
        }, 15_000)

        const failConnection = (error) => {
          if (!settled) {
            settled = true
            window.clearTimeout(connectTimeout)
            controller.signal.removeEventListener('abort', abortConnection)
            reject(error)
            return
          }
          void finishSession(session, {
            status: 'disconnected',
            message: 'Live audio disconnected. The microphone is off; you can still capture a photo.',
          })
        }

        socket.onopen = () => {
          if (!isCurrent() || session.intentionalClose) {
            socket.close()
            return
          }

          try {
            socket.send(JSON.stringify({
              role: 'publisher',
              sessionId: room.sessionId,
              credential: room.publishToken,
            }))
            session.socketConnected = true
            settled = true
            window.clearTimeout(connectTimeout)
            controller.signal.removeEventListener('abort', abortConnection)
            resolve()
          } catch {
            failConnection(new Error('Live audio could not authenticate with the server.'))
          }
        }
        const abortConnection = () => failConnection(new Error('Live audio connection cancelled.'))
        controller.signal.addEventListener('abort', abortConnection, { once: true })
        socket.onerror = () => failConnection(new Error('Live audio connection failed.'))
        socket.onclose = () => {
          if (!session.intentionalClose) failConnection(new Error('Live audio connection closed.'))
        }
      })

      if (!isCurrent() || session.intentionalClose) return null

      const recorder = recorderOptions.mimeType
        ? new MediaRecorder(microphoneStream, recorderOptions)
        : new MediaRecorder(microphoneStream)
      session.recorder = recorder
      session.mimeType = recorder.mimeType || recorderOptions.mimeType || 'audio/webm'
      recorder.ondataavailable = (event) => {
        const chunk = event.data
        if (!chunk?.size || !session.collectRecording) return

        if (chunk.size > maximumWebSocketChunkBytes) {
          if (!session.intentionalClose) {
            void finishSession(session, {
              status: 'disconnected',
              message: 'Live audio stopped because one audio chunk exceeded the server limit.',
            })
          }
          return
        }

        if (session.audioBytes + chunk.size > maximumAudioBytes) {
          if (!session.intentionalClose) {
            void finishSession(session, {
              status: 'limit',
              message: 'Live audio stopped at the 2 MiB recording limit. The saved recording will be attached to your photo.',
            })
          }
          return
        }

        session.chunks.push(chunk)
        session.audioBytes += chunk.size

        if (session.socketConnected && socket.readyState === WebSocket.OPEN) {
          try {
            socket.send(chunk)
          } catch {
            void finishSession(session, {
              status: 'disconnected',
              message: 'Live audio disconnected. The microphone is off; you can still capture a photo.',
            })
            return
          }
        }

        if (session.audioBytes >= maximumAudioBytes) {
          void finishSession(session, {
            status: 'limit',
            message: 'Live audio stopped at the 2 MiB recording limit. The saved recording will be attached to your photo.',
          })
        }
      }
      recorder.onerror = () => {
        void finishSession(session, {
          status: 'disconnected',
          message: 'Audio recording stopped unexpectedly. The camera is still available.',
        })
      }

      recorder.start(liveAudioChunkMs)
      session.durationTimer = window.setTimeout(() => {
        void finishSession(session, {
          status: 'limit',
          message: 'Live audio stopped after 60 seconds. The recording will be attached to your photo.',
        })
      }, maximumLiveAudioMs)
      setAudioState({
        status: 'live',
        message: 'MIC LIVE — admin can hear. Recording will be saved with your photo.',
      })
      return true
    } catch (error) {
      notifyPermissionSettled()
      if (!isCurrent()) return null

      const session = activeSessionRef.current
      const microphoneDenied = error?.name === 'NotAllowedError' || error?.name === 'SecurityError'
      if (session) {
        await finishSession(session, {
          status: microphoneDenied ? 'denied' : 'disconnected',
          message: microphoneDenied
            ? 'Microphone permission denied. Camera capture can continue without audio.'
            : `${error?.message || 'Live audio could not connect.'} The camera can continue without audio.`,
        })
      } else {
        pendingControllerRef.current = null
        setAudioState({
          status: microphoneDenied ? 'denied' : 'disconnected',
          message: microphoneDenied
            ? 'Microphone permission denied. Camera capture can continue without audio.'
            : `${error?.message || 'Live audio could not connect.'} The camera can continue without audio.`,
        })
      }
      return null
    }
  }, [finishSession])

  const reset = useCallback(() => stop({
    status: 'idle',
    message: initialAudioState.message,
    clearRecording: true,
  }), [stop])

  useEffect(() => () => {
    void stop({ updateState: false, clearRecording: true })
  }, [stop])

  return {
    audioState,
    recordedAudio,
    reset,
    start,
    stop,
  }
}
