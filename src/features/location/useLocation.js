import { useCallback, useState } from 'react'

function locationErrorMessage(error) {
  if (error.code === error.PERMISSION_DENIED) {
    return { code: 'PERMISSION_DENIED', message: 'Location access was denied. You can retry, use an approximate location, or continue without it.' }
  }
  if (error.code === error.POSITION_UNAVAILABLE) {
    return { code: 'POSITION_UNAVAILABLE', message: 'Your location is currently unavailable. Check device location settings and try again.' }
  }
  if (error.code === error.TIMEOUT) {
    return { code: 'TIMEOUT', message: 'Location lookup timed out. Move somewhere with a clearer signal and retry.' }
  }
  return { code: 'LOCATION_FAILED', message: 'Your location could not be determined.' }
}

export function useLocation() {
  const [isLocating, setIsLocating] = useState(false)
  const [location, setLocation] = useState(null)
  const [error, setError] = useState(null)

  const requestLocation = useCallback(() => {
    if (!window.isSecureContext) {
      const nextError = { code: 'INSECURE_CONTEXT', message: 'Location access requires HTTPS or localhost.' }
      setError(nextError)
      return Promise.reject(nextError)
    }
    if (!navigator.geolocation) {
      const nextError = { code: 'UNSUPPORTED', message: 'This browser does not support location access.' }
      setError(nextError)
      return Promise.reject(nextError)
    }

    setIsLocating(true)
    setError(null)

    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => {
          const nextLocation = {
            latitude: coords.latitude,
            longitude: coords.longitude,
            accuracy: coords.accuracy,
            source: 'gps',
          }
          setLocation(nextLocation)
          setIsLocating(false)
          resolve(nextLocation)
        },
        (caughtError) => {
          const nextError = locationErrorMessage(caughtError)
          setError(nextError)
          setIsLocating(false)
          reject(nextError)
        },
        { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
      )
    })
  }, [])

  const clearLocation = useCallback(() => {
    setLocation(null)
    setError(null)
    setIsLocating(false)
  }, [])

  return { location, error, isLocating, requestLocation, clearLocation }
}

