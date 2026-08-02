import { apiConfig, apiUrl } from '../../config/api'

export class AdminApiError extends Error {
  constructor(message, status = 0) {
    super(message)
    this.name = 'AdminApiError'
    this.status = status
  }
}

function extractError(payload, fallback) {
  return payload?.message || payload?.detail || payload?.title || fallback
}

async function parseJsonResponse(response) {
  const text = await response.text()
  if (!text) return {}

  try {
    return JSON.parse(text)
  } catch {
    return {}
  }
}

async function adminRequest(path, { method = 'GET', token, body, signal, responseType = 'json' } = {}) {
  const requestController = new AbortController()
  const abortFromCaller = () => requestController.abort()
  const timeoutId = window.setTimeout(() => requestController.abort(), apiConfig.timeoutMs)

  if (signal) {
    if (signal.aborted) requestController.abort()
    else signal.addEventListener('abort', abortFromCaller, { once: true })
  }

  const headers = { Accept: responseType === 'blob' ? 'image/*' : 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  if (body) headers['Content-Type'] = 'application/json'

  try {
    const response = await fetch(apiUrl(path), {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: requestController.signal,
    })

    if (responseType === 'blob') {
      if (!response.ok) {
        const payload = await parseJsonResponse(response)
        throw new AdminApiError(extractError(payload, 'Photo could not be loaded.'), response.status)
      }
      return response.blob()
    }

    const payload = await parseJsonResponse(response)
    if (!response.ok) {
      throw new AdminApiError(extractError(payload, 'Admin request failed.'), response.status)
    }
    return payload
  } catch (error) {
    if (error.name === 'AbortError') {
      if (signal?.aborted) throw error
      throw new AdminApiError('Admin request timed out. Please try again.')
    }
    if (error instanceof AdminApiError) throw error
    throw new AdminApiError(error.message || 'Unable to reach the admin API.')
  } finally {
    window.clearTimeout(timeoutId)
    signal?.removeEventListener('abort', abortFromCaller)
  }
}

export async function loginAdmin({ username, password, signal }) {
  const result = await adminRequest('/api/v1/admin/auth/login', {
    method: 'POST',
    body: { username, password },
    signal,
  })

  if (!result.accessToken) {
    throw new AdminApiError('Backend login response did not include an access token.')
  }
  return result
}

export async function fetchAdminCaptures({ token, page = 0, size = 20, query = '', source = 'ALL', signal }) {
  const searchParams = new URLSearchParams({
    page: String(page),
    size: String(size),
    sort: 'createdAt,desc',
  })
  if (query.trim()) searchParams.set('query', query.trim())
  if (source !== 'ALL') searchParams.set('locationSource', source)

  return adminRequest(`/api/v1/admin/captures?${searchParams.toString()}`, {
    token,
    signal,
  })
}

export function fetchAdminCapturePhoto({ token, captureId, signal }) {
  return adminRequest(`/api/v1/admin/captures/${encodeURIComponent(captureId)}/photo`, {
    token,
    signal,
    responseType: 'blob',
  })
}
