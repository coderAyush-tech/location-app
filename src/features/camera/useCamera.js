import { useCallback, useEffect, useRef, useState } from 'react'

export class CameraError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'CameraError'
    this.code = code
  }
}

function friendlyCameraError(error) {
  if (error instanceof CameraError) return error
  if (error?.name === 'NotAllowedError') {
    return new CameraError('PERMISSION_DENIED', 'Camera access was blocked. Allow camera permission in your browser settings and try again.')
  }
  if (error?.name === 'NotFoundError' || error?.name === 'DevicesNotFoundError') {
    return new CameraError('DEVICE_UNAVAILABLE', 'No camera was found on this device.')
  }
  if (error?.name === 'NotReadableError' || error?.name === 'TrackStartError') {
    return new CameraError('DEVICE_BUSY', 'The camera is being used by another app. Close it there and try again.')
  }
  if (error?.name === 'OverconstrainedError') {
    return new CameraError('CONSTRAINTS_FAILED', 'This camera does not support the requested mode.')
  }
  return new CameraError('CAMERA_FAILED', 'The camera could not be started. Please try again.')
}

export function useCamera() {
  const streamRef = useRef(null)
  const [stream, setStream] = useState(null)
  const [facingMode, setFacingMode] = useState('user')
  const [cameraCount, setCameraCount] = useState(0)
  const [isStarting, setIsStarting] = useState(false)
  const [error, setError] = useState(null)

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setStream(null)
  }, [])

  const updateCameraCount = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      setCameraCount(devices.filter((device) => device.kind === 'videoinput').length)
    } catch {
      setCameraCount(0)
    }
  }, [])

  const startCamera = useCallback(async (preferredFacingMode = facingMode) => {
    if (!window.isSecureContext) {
      const nextError = new CameraError('INSECURE_CONTEXT', 'Camera access requires HTTPS or localhost.')
      setError(nextError)
      throw nextError
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      const nextError = new CameraError('UNSUPPORTED', 'This browser does not support camera capture.')
      setError(nextError)
      throw nextError
    }

    setIsStarting(true)
    setError(null)
    stopCamera()

    try {
      const nextStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: preferredFacingMode },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      })
      streamRef.current = nextStream
      setStream(nextStream)
      setFacingMode(preferredFacingMode)
      await updateCameraCount()
      return nextStream
    } catch (caughtError) {
      const nextError = friendlyCameraError(caughtError)
      setError(nextError)
      throw nextError
    } finally {
      setIsStarting(false)
    }
  }, [facingMode, stopCamera, updateCameraCount])

  const switchCamera = useCallback(async () => {
    const previousFacingMode = facingMode
    const nextFacingMode = previousFacingMode === 'user' ? 'environment' : 'user'
    try {
      await startCamera(nextFacingMode)
    } catch (switchError) {
      try {
        await startCamera(previousFacingMode)
      } catch {
        // The original error is more useful to the caller.
      }
      throw switchError
    }
  }, [facingMode, startCamera])

  useEffect(() => stopCamera, [stopCamera])

  return {
    stream,
    facingMode,
    cameraCount,
    isStarting,
    error,
    startCamera,
    stopCamera,
    switchCamera,
  }
}

export function captureFrame(video, { mirror = false } = {}) {
  if (!video?.videoWidth || !video?.videoHeight) {
    return Promise.reject(new CameraError('CAPTURE_FAILED', 'The camera is not ready yet. Please wait a moment.'))
  }

  const canvas = document.createElement('canvas')
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  const context = canvas.getContext('2d')

  if (mirror) {
    context.translate(canvas.width, 0)
    context.scale(-1, 1)
  }
  context.drawImage(video, 0, 0, canvas.width, canvas.height)

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new CameraError('CAPTURE_FAILED', 'The photo could not be captured. Please try again.'))
        return
      }
      resolve(new File([blob], `photogenius-${Date.now()}.jpg`, {
        type: 'image/jpeg',
        lastModified: Date.now(),
      }))
    }, 'image/jpeg', 0.92)
  })
}

