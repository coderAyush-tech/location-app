const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim()
  || 'https://locationfinder-pdzb.onrender.com'

export const apiConfig = {
  baseUrl: configuredBaseUrl.replace(/\/$/, ''),
  timeoutMs: Number(import.meta.env.VITE_API_TIMEOUT_MS) || 45_000,
}

export function apiUrl(path) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${apiConfig.baseUrl}${normalizedPath}`
}
