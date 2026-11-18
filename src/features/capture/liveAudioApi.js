import { apiUrl, apiConfig } from '../../config/api'

export const liveVideoMimeType = 'video/webm;codecs=vp8,opus'
export const liveVideoTimesliceMs = 500
export const maximumWebSocketFrameBytes = 256 * 1024
export const maximumBufferedBytes = 1024 * 1024
export const liveVideoAckTimeoutMs = 15_000

function responseMessage(payload, fallback) {
  return payload?.message || payload?.detail || payload?.title || fallback
}

export function getLiveAudioSocketUrl() {
  const url = new URL(apiConfig.baseUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = '/ws/live-audio'
  url.search = ''
  url.hash = ''
  return url.toString()
}

export function preferredRecorderOptions() {
  if (typeof MediaRecorder === 'undefined') return null
  if (!MediaRecorder.isTypeSupported?.(liveVideoMimeType)) return null
  return { mimeType: liveVideoMimeType }
}

export async function createLiveAudioSession({ signal } = {}) {
  const controller = new AbortController()
  const abortFromCaller = () => controller.abort()
  const timeoutId = window.setTimeout(() => controller.abort(), 15_000)
  if (signal?.aborted) controller.abort()
  else signal?.addEventListener('abort', abortFromCaller, { once: true })

  try {
    const response = await fetch(apiUrl('/api/v1/live-audio/sessions'), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ cameraConsentConfirmed: true, microphoneConsentConfirmed: true }),
      cache: 'no-store',
      signal: controller.signal,
    })
    const responseText = await response.text()
    let result = {}
    try { result = responseText ? JSON.parse(responseText) : {} } catch { result = {} }

    if (!response.ok) throw new Error(responseMessage(result, 'The live recording session could not be started.'))
    if (!result.sessionId || !result.publishToken) {
      throw new Error('The backend did not return a live recording session and publisher token.')
    }
    return result
  } catch (error) {
    if (error.name === 'AbortError' && !signal?.aborted) throw new Error('Creating the live recording session timed out.')
    throw error
  } finally {
    window.clearTimeout(timeoutId)
    signal?.removeEventListener('abort', abortFromCaller)
  }
}

export async function closeLiveAudioSession({ sessionId, publishToken, lastAckSequence }) {
  if (!sessionId || !publishToken) return
  if (!Number.isSafeInteger(lastAckSequence) || lastAckSequence < 0) {
    throw new Error('A valid last acknowledged video sequence is required to finalize this recording.')
  }

  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), 15_000)
  try {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetch(apiUrl(`/api/v1/live-audio/sessions/${encodeURIComponent(sessionId)}`), {
        method: 'DELETE',
        headers: {
          Accept: 'application/json',
          'X-Audio-Publish-Token': publishToken,
          'X-Audio-Last-Chunk-Sequence': String(lastAckSequence),
        },
        cache: 'no-store',
        keepalive: true,
        signal: controller.signal,
      })

      if (response.ok) return
      if (response.status === 409 && attempt < 3) {
        await new Promise((resolve) => window.setTimeout(resolve, 250 * (attempt + 1)))
        continue
      }

      const error = new Error(response.status === 428
        ? 'The backend rejected finalization because X-Audio-Last-Chunk-Sequence was missing (428).'
        : response.status === 409
          ? 'The backend still reports a chunk-sequence conflict (409). Retry finalization with the same session and sequence.'
          : `The live recording session could not be finalized (HTTP ${response.status}).`)
      error.status = response.status
      throw error
    }
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Finalizing the live recording timed out.')
    throw error
  } finally {
    window.clearTimeout(timeoutId)
  }
}
