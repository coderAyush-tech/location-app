const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim()
  || 'https://locationfinder-pdzb.onrender.com'

export const apiConfig = {
  baseUrl: configuredBaseUrl.replace(/\/$/, ''),
  timeoutMs: Number(import.meta.env.VITE_API_TIMEOUT_MS) || 20_000,
  photoSessionsPath: import.meta.env.VITE_PHOTO_SESSIONS_PATH?.trim() || '/api/v1/photo-sessions',
}

export function apiUrl(path) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${apiConfig.baseUrl}${normalizedPath}`
}
