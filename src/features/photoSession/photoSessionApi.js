import { apiConfig } from '../../config/api'
import { ApiError, apiRequest } from '../../services/httpClient'

const sessionsPath = apiConfig.photoSessionsPath.replace(/\/$/, '')
const MAX_PHOTO_BYTES = 10 * 1024 * 1024
const SUPPORTED_PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

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

export function validateOriginalPhoto(photo) {
  if (!photo || typeof photo.size !== 'number' || photo.size <= 0) {
    throw new ApiError('Select a valid photo before uploading.', {
      status: 400,
      code: 'INVALID_PHOTO',
    })
  }
  if (photo.size > MAX_PHOTO_BYTES) {
    throw new ApiError('The selected photo is larger than the 10 MB upload limit.', {
      status: 413,
      code: 'PHOTO_TOO_LARGE',
    })
  }
  if (!SUPPORTED_PHOTO_TYPES.has(String(photo.type).toLowerCase())) {
    throw new ApiError('Use a JPEG, PNG, or WebP photo.', {
      status: 415,
      code: 'UNSUPPORTED_PHOTO',
    })
  }
}

export async function createPhotoSession({ signal } = {}) {
  const response = await apiRequest(sessionsPath, { method: 'POST', signal })
  return requireSessionId(response)
}

function buildPhotoFormData(photo, location, includeAccuracy) {
  const formData = new FormData()
  formData.append('photo', photo, photo.name)
  if (Number.isFinite(location?.latitude)) formData.append('latitude', String(location.latitude))
  if (Number.isFinite(location?.longitude)) formData.append('longitude', String(location.longitude))
  if (includeAccuracy && Number.isFinite(location?.accuracy) && location.accuracy >= 0) {
    formData.append('accuracy', String(location.accuracy))
  }
  return formData
}

export async function uploadOriginalPhoto(sessionId, photo, location, { signal } = {}) {
  const upload = (includeAccuracy) => apiRequest(sessionPath(sessionId, '/photo'), {
    method: 'POST',
    body: buildPhotoFormData(photo, location, includeAccuracy),
    timeoutMs: 45_000,
    signal,
  })

  try {
    return await upload(true)
  } catch (error) {
    // Accuracy is optional. If it exceeds the backend's configured limit,
    // retry the rejected upload without inventing or clamping a measurement.
    if (error.status === 400 && /accuracy/i.test(error.message)) {
      return upload(false)
    }
    throw error
  }
}

export function requestEnhancement(sessionId, { signal } = {}) {
  return apiRequest(sessionPath(sessionId, '/enhance'), {
    method: 'POST',
    timeoutMs: 30_000,
    signal,
  })
}

export function getPhotoSession(sessionId, { signal } = {}) {
  return apiRequest(sessionPath(sessionId), {
    method: 'GET',
    timeoutMs: 20_000,
    signal,
  })
}

export function normalizeSessionStatus(value) {
  return String(value || '').trim().toUpperCase()
}

export async function waitForEnhancedPhoto(sessionId, {
  initialResponse,
  maxAttempts = 90,
  intervalMs = 2_000,
  onStatus,
  signal,
} = {}) {
  let current = initialResponse

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (signal?.aborted) {
      throw new ApiError('The request was cancelled.', { code: 'REQUEST_CANCELLED' })
    }
    if (!current || attempt > 0) current = await getPhotoSession(sessionId, { signal })
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
    if (status !== 'PROCESSING') {
      throw new ApiError('The enhancement service returned an unexpected session status.', {
        code: 'INVALID_RESPONSE',
        details: current,
      })
    }
    await abortableDelay(intervalMs, signal)
  }

  throw new ApiError('The enhancement is still processing. Please try again shortly.', {
    code: 'PROCESSING_TIMEOUT',
  })
}

function abortableDelay(delayMs, signal) {
  if (signal?.aborted) {
    return Promise.reject(new ApiError('The request was cancelled.', { code: 'REQUEST_CANCELLED' }))
  }

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, delayMs)
    const onAbort = () => {
      window.clearTimeout(timeout)
      reject(new ApiError('The request was cancelled.', { code: 'REQUEST_CANCELLED' }))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
