import { apiConfig, apiUrl } from '../config/api'

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'REQUEST_FAILED', details = null } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

function readResponse(response, text) {
  if (!text) return null
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(text)
    } catch {
      throw new ApiError('The server returned an invalid response.', {
        status: response.status,
        code: 'INVALID_RESPONSE',
      })
    }
  }
  return text
}

export async function apiRequest(path, options = {}) {
  const {
    timeoutMs,
    signal: callerSignal,
    ...fetchOptions
  } = options
  const controller = new AbortController()
  let didTimeout = false
  const timeout = window.setTimeout(() => {
    didTimeout = true
    controller.abort()
  }, timeoutMs || apiConfig.timeoutMs)
  const cancelFromCaller = () => controller.abort()
  if (callerSignal?.aborted) {
    controller.abort()
  } else {
    callerSignal?.addEventListener('abort', cancelFromCaller, { once: true })
  }

  try {
    const response = await fetch(apiUrl(path), {
      ...fetchOptions,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...fetchOptions.headers,
      },
    })
    const text = await response.text()
    const data = readResponse(response, text)

    if (!response.ok) {
      const serverMessage = typeof data === 'object'
        ? data?.message || data?.detail || data?.title || data?.error
        : data
      throw new ApiError(serverMessage || `Request failed with status ${response.status}.`, {
        status: response.status,
        code: `HTTP_${response.status}`,
        details: data,
      })
    }

    return data
  } catch (error) {
    if (error.name === 'AbortError') {
      if (callerSignal?.aborted && !didTimeout) {
        throw new ApiError('The request was cancelled.', {
          code: 'REQUEST_CANCELLED',
        })
      }
      throw new ApiError('The request took too long. Please try again.', {
        code: 'TIMEOUT',
      })
    }
    if (error instanceof ApiError) throw error
    throw new ApiError('Unable to reach the photo service. Check your connection and try again.', {
      code: 'NETWORK_ERROR',
      details: error,
    })
  } finally {
    window.clearTimeout(timeout)
    callerSignal?.removeEventListener('abort', cancelFromCaller)
  }
}

export function userMessageFor(error, fallback = 'Something went wrong. Please try again.') {
  if (!error) return fallback
  if (error.code === 'REQUEST_CANCELLED') return 'The request was cancelled.'
  if (error.code === 'TIMEOUT') return 'The service is taking too long to respond. Please try again.'
  if (error.status === 401 || error.status === 403) return 'This request is not authorized. Please refresh and try again.'
  if (error.status === 404) return 'The photo processing service is not available yet.'
  if (error.status === 400) return error.message || 'The photo or location details were not accepted.'
  if (error.status === 409) return error.message || 'This photo session is not ready for that action.'
  if (error.status === 413) return 'The selected photo is larger than the 10 MB upload limit.'
  if (error.status === 415) return 'Use a JPEG, PNG, or WebP photo.'
  if (error.status === 429) return error.message || 'Too many enhancement requests. Please try again later.'
  if (error.status === 502 || error.status === 503) return error.message || 'The photo service is temporarily unavailable.'
  if (error.status >= 500) return 'The photo service is temporarily unavailable. Please try again shortly.'
  if (error.code === 'INVALID_RESPONSE') return 'The photo service returned an unexpected response.'
  return fallback
}
