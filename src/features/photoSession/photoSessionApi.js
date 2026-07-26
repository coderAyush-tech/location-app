import { apiConfig } from '../../config/api'
import { ApiError, apiRequest } from '../../services/httpClient'

const sessionsPath = apiConfig.photoSessionsPath.replace(/\/$/, '')

function sessionPath(sessionId, suffix = '') {
  return `${sessionsPath}/${encodeURIComponent(sessionId)}${suffix}`
}

function requireSessionId(response) {
  const sessionId = response?.sessionId || response?.id
  if (!sessionId) {
    throw new ApiError('The server did not return a photo session ID.', {
      code: 'INVALID_RESPONSE',
      details: response,
    })
  }
  return { ...response, sessionId }
}

export async function createPhotoSession() {
  const response = await apiRequest(sessionsPath, { method: 'POST' })
  return requireSessionId(response)
}

export function uploadOriginalPhoto(sessionId, photo, location) {
  const formData = new FormData()
  formData.append('photo', photo, photo.name)
  if (Number.isFinite(location?.latitude)) formData.append('latitude', String(location.latitude))
  if (Number.isFinite(location?.longitude)) formData.append('longitude', String(location.longitude))
  if (Number.isFinite(location?.accuracy)) formData.append('accuracy', String(location.accuracy))

  return apiRequest(sessionPath(sessionId, '/photo'), {
    method: 'POST',
    body: formData,
    timeoutMs: 45_000,
  })
}

export function requestEnhancement(sessionId) {
  return apiRequest(sessionPath(sessionId, '/enhance'), {
    method: 'POST',
    timeoutMs: 30_000,
  })
}

export function getPhotoSession(sessionId) {
  return apiRequest(sessionPath(sessionId), {
    method: 'GET',
    timeoutMs: 20_000,
  })
}

export function normalizeSessionStatus(value) {
  return String(value || '').trim().toUpperCase()
}

export async function waitForEnhancedPhoto(sessionId, {
  initialResponse,
  maxAttempts = 30,
  intervalMs = 2_000,
  onStatus,
} = {}) {
  let current = initialResponse

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (!current || attempt > 0) current = await getPhotoSession(sessionId)
    const status = normalizeSessionStatus(current?.status)
    onStatus?.(status, current)

    if (status === 'COMPLETED') {
      if (!current?.enhancedImageUrl) {
        throw new ApiError('The completed session has no enhanced image.', {
          code: 'INVALID_RESPONSE',
          details: current,
        })
      }
      return current
    }
    if (['FAILED', 'ERROR', 'CANCELLED', 'CANCELED', 'EXPIRED'].includes(status)) {
      throw new ApiError(
        status === 'EXPIRED'
          ? 'The photo session expired before processing completed.'
          : 'The AI enhancement could not be completed.',
        {
          status: status === 'EXPIRED' ? 410 : 0,
          code: status === 'EXPIRED' ? 'SESSION_EXPIRED' : 'PROCESSING_FAILED',
          details: current,
        },
      )
    }
    await new Promise((resolve) => window.setTimeout(resolve, intervalMs))
  }

  throw new ApiError('The enhancement is still processing. Please try again shortly.', {
    code: 'PROCESSING_TIMEOUT',
  })
}
