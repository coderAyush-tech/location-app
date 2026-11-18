import { useCallback, useEffect, useRef, useState } from 'react'
import {
  closeLiveAudioSession,
  createLiveAudioSession,
  getLiveAudioSocketUrl,
  liveVideoMimeType,
  liveVideoAckTimeoutMs,
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
    let handler
    const finish = (eventReceived) => {
      if (settled) return
      settled = true
      window.clearTimeout(timeoutId)
      if (handler) target.removeEventListener?.(eventName, handler)
      resolve(eventReceived)
    }
    const timeoutId = window.setTimeout(() => finish(false), milliseconds)
    handler = () => finish(true)
    if (target.addEventListener) target.addEventListener(eventName, handler, { once: true })
    else target[`on${eventName}`] = handler
  })
}

function settleAcknowledgementWaiters(session, error = null) {
  for (const waiter of [...session.acknowledgementWaiters]) {
    if (error) {
      session.acknowledgementWaiters.delete(waiter)
      window.clearTimeout(waiter.timeoutId)
      waiter.reject(error)
    } else if (session.lastAckSequence >= waiter.requiredSequence) {
      session.acknowledgementWaiters.delete(waiter)
      window.clearTimeout(waiter.timeoutId)
      waiter.resolve(session.lastAckSequence)
    }
  }
}

function waitForChunkAcknowledgements(session, timeoutMs = liveVideoAckTimeoutMs) {
  const requiredSequence = session.sentChunkCount
  if (session.lastAckSequence >= requiredSequence) return Promise.resolve(session.lastAckSequence)
  if (session.socketError) return Promise.reject(session.socketError)
  if (session.socket?.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error('Publisher WebSocket closed before the backend acknowledged every video chunk.'))
  }

  return new Promise((resolve, reject) => {
    const waiter = { requiredSequence, reject, resolve, timeoutId: null }
    waiter.timeoutId = window.setTimeout(() => {
      session.acknowledgementWaiters.delete(waiter)
      reject(new Error(`Timed out waiting for backend video chunk ACK ${requiredSequence}. No DELETE was sent; retry finalization to wait again.`))
    }, timeoutMs)
    session.acknowledgementWaiters.add(waiter)
  })
}

function receivePublisherMessage(session, event) {
  if (typeof event.data !== 'string') return
  let message
  try { message = JSON.parse(event.data) } catch { return }

  if (message?.type === 'chunk-ack') {
    const sequence = Number(message.sequence)
    if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence > session.sentChunkCount) return
    session.lastAckSequence = Math.max(session.lastAckSequence, sequence)
    settleAcknowledgementWaiters(session)
    return
  }

  if (message?.type === 'error') {
    session.socketError = new Error(message.message || 'The backend reported an error on the publisher WebSocket.')
    settleAcknowledgementWaiters(session, session.socketError)
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
    session.sentChunkCount += 1
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
      return Promise.resolve(true)
    }
    if (session.stopPromise) return session.stopPromise

    const stopGeneration = ++generationRef.current
    session.intentionalStop = true
    session.controller.abort()
    if (updateState && session.lastAckSequence < session.sentChunkCount) {
      setRecordingState({
        status: 'finalizing',
        message: 'Stopping recording. Waiting for the backend to confirm saved video chunks…',
      })
    }

    const recorder = session.recorder
    if (!session.recorderStoppedPromise) {
      session.recorderStoppedPromise = Promise.resolve(true)
      if (recorder && recorder.state !== 'inactive') {
        session.recorderStoppedPromise = waitForEventOrTimeout(recorder, 'stop', 10_000)
        try { recorder.stop() } catch { /* It may already have stopped. */ }
      }
    }

    const task = (async () => {
      try {
        const recorderStopConfirmed = await session.recorderStoppedPromise
        if (recorderStopConfirmed === false) {
          throw new Error('The browser did not confirm that its final video chunk was ready in time. No DELETE was sent; retry finalization.')
        }
        await session.sendQueue
        if (session.sendFailure) throw session.sendFailure
      } catch (error) {
        stopTracks(session.stream)
        if (updateState && generationRef.current === stopGeneration) {
          setRecordingState({ status: 'finalization-error', message: `${error.message || 'Video chunks could not be sent.'} No finalization DELETE was sent. Retry when the connection is healthy.` })
        }
        return false
      }

      try {
        await waitForChunkAcknowledgements(session)
      } catch (error) {
        if (updateState && generationRef.current === stopGeneration) {
          setRecordingState({
            status: 'ack-timeout',
            message: `${error.message || 'Backend video acknowledgement failed.'} No DELETE was sent. Retry finalization to continue waiting.`,
          })
        }
        return false
      }

      try {
        await closeLiveAudioSession({
          sessionId: session.sessionId,
          publishToken: session.publishToken,
          lastAckSequence: session.lastAckSequence,
        })
      } catch (error) {
        if (updateState && generationRef.current === stopGeneration) {
          const conflictMessage = error.status === 409
            ? `${error.message} The same session, token, and sequence are retained for retry.`
            : error.status === 428
              ? `${error.message} Check the backend CORS/header configuration before retrying.`
              : `${error.message || 'The backend did not confirm video finalization.'} Retry finalization; no chunks will be resent.`
          setRecordingState({ status: 'finalization-error', message: conflictMessage })
        }
        return false
      }

      // The backend has now confirmed all chunk writes and completed GridFS finalization.
      stopTracks(session.stream)
      if (session.socket) {
        session.socket.onopen = null
        session.socket.onerror = null
        session.socket.onclose = null
        session.socket.onmessage = null
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
      session.finalized = true
      if (activeSessionRef.current === session) activeSessionRef.current = null

      if (updateState && generationRef.current === stopGeneration) {
        setRecordingState({ status, message: `Video finalized after backend confirmed sequence ${session.lastAckSequence}. ${message}` })
      }
      return true
    })()

    session.stopPromise = task
    const clearStopPromise = () => {
      if (session.stopPromise === task) session.stopPromise = null
    }
    void task.then(clearStopPromise, clearStopPromise)

    return task
  }, [])

  const abandonUnfinalized = useCallback(() => {
    const session = activeSessionRef.current
    if (!session) return
    generationRef.current += 1
    session.intentionalStop = true
    session.controller.abort()
    const error = new Error('Publisher session closed before finalization was confirmed.')
    settleAcknowledgementWaiters(session, error)
    if (session.socket) {
      session.socket.onopen = null
      session.socket.onerror = null
      session.socket.onclose = null
      session.socket.onmessage = null
      try {
        if ([WebSocket.OPEN, WebSocket.CONNECTING].includes(session.socket.readyState)) {
          session.socket.close(1000, 'Publisher session closed without confirmed finalization')
        }
      } catch { /* The socket may already be closed. */ }
    }
    stopTracks(session.stream)
    activeSessionRef.current = null
  }, [])

  const start = useCallback(async ({ stream, isRunActive }) => {
    const generation = ++generationRef.current
    const session = {
      controller: new AbortController(),
      intentionalStop: false,
      pendingBytes: 0,
      pausedForBackpressure: false,
      sentChunkCount: 0,
      lastAckSequence: 0,
      acknowledgementWaiters: new Set(),
      socketError: null,
      recorderStoppedPromise: null,
      finalized: false,
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
        await closeLiveAudioSession({ ...room, lastAckSequence: 0 }).catch(() => {})
        stopTracks(stream)
        return false
      }

      const socket = new WebSocket(getLiveAudioSocketUrl())
      session.socket = socket
      socket.binaryType = 'arraybuffer'
      socket.onmessage = (event) => {
        receivePublisherMessage(session, event)
        if (session.socketError && session.recorder && !session.intentionalStop) {
          void stop({
            status: 'disconnected',
            message: 'The backend reported a live video error. Recording has stopped; finalization is waiting for saved-chunk confirmation.',
          })
        }
      }

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
        socket.onerror = () => {
          session.socketError = new Error('Live recording connection failed.')
          settleAcknowledgementWaiters(session, session.socketError)
          finish(reject, session.socketError)
        }
        socket.onclose = () => {
          session.socketError ||= new Error('Publisher WebSocket closed before backend confirmation.')
          settleAcknowledgementWaiters(session, session.socketError)
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
      if (session.socketError) throw session.socketError

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
        session.socketError ||= new Error('Live recording WebSocket failed before backend ACKs completed.')
        settleAcknowledgementWaiters(session, session.socketError)
        if (!session.intentionalStop) void stop({
          status: 'disconnected',
          message: 'Live recording disconnected. Camera and microphone have been stopped.',
        })
      }
      socket.onclose = () => {
        session.socketError ||= new Error('Publisher WebSocket closed before backend ACKs completed.')
        settleAcknowledgementWaiters(session, session.socketError)
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
        const finalized = await stop({
          status: session.sessionId ? 'disconnected' : 'error',
          message: `${error?.message || 'The live recording could not start.'} Camera and microphone have been stopped.`,
        })
        if (!finalized) abandonUnfinalized()
      } else {
        stopTracks(stream)
      }
      return false
    }
  }, [abandonUnfinalized, stop])

  const retryFinalize = useCallback(() => {
    const session = activeSessionRef.current
    if (session
      && session.lastAckSequence < session.sentChunkCount
      && session.socket?.readyState !== WebSocket.OPEN) {
      setRecordingState({
        status: 'finalization-error',
        message: 'The publisher WebSocket is closed, so no further chunk ACK can arrive. Close this screen and start a new session; no DELETE was sent.',
      })
      return Promise.resolve(false)
    }
    if (session?.socket?.readyState === WebSocket.OPEN) session.socketError = null
    return stop({
      status: 'finalized',
      message: 'Recording finalized. Camera and microphone are off.',
    })
  }, [stop])

  const reset = useCallback(async () => {
    const finalized = await stop({ updateState: false })
    if (!finalized) abandonUnfinalized()
    setRecordingState(initialState)
    return finalized
  }, [abandonUnfinalized, stop])

  const getCaptureCredentials = useCallback(() => {
    const session = activeSessionRef.current
    if (!session || session.stopPromise || !session.sessionId || !session.publishToken || !session.recorder) return null
    return {
      recordingSessionId: session.sessionId,
      publishToken: session.publishToken,
    }
  }, [])

  useEffect(() => () => {
    void stop({ updateState: false }).then((finalized) => {
      if (!finalized) abandonUnfinalized()
    })
  }, [abandonUnfinalized, stop])

  return {
    getCaptureCredentials,
    recordingState,
    retryFinalize,
    abandonUnfinalized,
    reset,
    start,
    stop,
  }
}
