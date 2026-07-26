import { apiRequest } from './httpClient'

export function savePreciseLocation(coords) {
  return apiRequest('/api/location', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      latitude: coords.latitude,
      longitude: coords.longitude,
      photoStyleId: 1,
      source: 'PhotoGenius AI',
      timestamp: new Date().toISOString(),
      accuracy: coords.accuracy ?? null,
    }),
    timeoutMs: 15_000,
  })
}

export function getApproximateLocation() {
  return apiRequest('/api/location/fallback', {
    method: 'POST',
    timeoutMs: 15_000,
  })
}

