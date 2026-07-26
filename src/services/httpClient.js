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
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), options.timeoutMs || apiConfig.timeoutMs)

  try {
    const response = await fetch(apiUrl(path), {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...options.headers,
      },
    })
    const text = await response.text()
    const data = readResponse(response, text)

    if (!response.ok) {
      const serverMessage = typeof data === 'object'
        ? data?.message || data?.error
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
  }
}

export function userMessageFor(error, fallback = 'Something went wrong. Please try again.') {
  if (!error) return fallback
  if (error.code === 'TIMEOUT') return 'The service is taking too long to respond. Please try again.'
  if (error.status === 401 || error.status === 403) return 'This request is not authorized. Please refresh and try again.'
  if (error.status === 404) return 'The photo processing service is not available yet.'
  if (error.status >= 500) return 'The photo service is temporarily unavailable. Please try again shortly.'
  if (error.code === 'INVALID_RESPONSE') return 'The photo service returned an unexpected response.'
  return fallback
}

