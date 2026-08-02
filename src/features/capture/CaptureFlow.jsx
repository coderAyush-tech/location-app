import { useCallback, useEffect, useRef, useState } from 'react'
import { uploadCapture } from './captureApi'

const initialCameraState = {
  status: 'idle',
  message: 'Camera permission has not been requested yet.',
}

const initialLocationState = {
  status: 'idle',
  message: 'Optional location starts after the camera is ready.',
}

const cameraPermissionTimeoutMs = 15_000

function stopTracks(stream) {
  stream?.getTracks().forEach((track) => track.stop())
}

function locationFailureState(error) {
  if (error?.code === 1) {
    return {
      status: 'denied',
      message: 'Location denied — IP fallback will be used.',
    }
  }

  if (error?.code === 3) {
    return {
      status: 'timedout',
      message: 'Location timed out — IP fallback will be used.',
    }
  }

  return {
    status: 'unavailable',
    message: 'Location unavailable — IP fallback will be used.',
  }
}

export default function CaptureFlow({ open, onClose, onStatusChange }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const locationRef = useRef(null)
  const uploadControllerRef = useRef(null)
  const permissionRequestRef = useRef(0)
  const cameraTimeoutRef = useRef(null)
  const cameraWaitCancelRef = useRef(null)
  const openRef = useRef(open)

  const [phase, setPhase] = useState('consent')
  const [stream, setStream] = useState(null)
  const [cameraState, setCameraState] = useState(initialCameraState)
  const [locationState, setLocationState] = useState(initialLocationState)
  const [capturedFile, setCapturedFile] = useState(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [savedResult, setSavedResult] = useState(null)

  useEffect(() => {
    openRef.current = open
  }, [open])

  const stopCamera = useCallback(() => {
    stopTracks(streamRef.current)
    streamRef.current = null
    setStream(null)

    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
  }, [])

  const resetFlow = useCallback(() => {
    locationRef.current = null
    setCameraState(initialCameraState)
    setLocationState(initialLocationState)
    setCapturedFile(null)
    setErrorMessage('')
    setSavedResult(null)
    setPhase('consent')
  }, [])

  const cancelPendingCameraWait = useCallback(() => {
    window.clearTimeout(cameraTimeoutRef.current)
    cameraTimeoutRef.current = null

    const cancelWait = cameraWaitCancelRef.current
    cameraWaitCancelRef.current = null
    cancelWait?.()
  }, [])

  const invalidateActiveRun = useCallback(() => {
    permissionRequestRef.current += 1
    cancelPendingCameraWait()
    uploadControllerRef.current?.abort()
    uploadControllerRef.current = null
  }, [cancelPendingCameraWait])

  const closeFlow = useCallback(() => {
    invalidateActiveRun()
    stopCamera()
    resetFlow()
    onClose()
  }, [invalidateActiveRun, onClose, resetFlow, stopCamera])

  useEffect(() => {
    if (!open) {
      invalidateActiveRun()
      stopCamera()
      resetFlow()
    }
  }, [invalidateActiveRun, open, resetFlow, stopCamera])

  useEffect(() => () => {
    permissionRequestRef.current += 1
    cancelPendingCameraWait()
    uploadControllerRef.current?.abort()
    stopTracks(streamRef.current)
  }, [cancelPendingCameraWait])

  useEffect(() => {
    if (!stream || !videoRef.current) return

    videoRef.current.srcObject = stream
    videoRef.current.play().catch(() => {
      permissionRequestRef.current += 1
      setErrorMessage('Camera preview could not start. Please try again.')
      setCameraState({
        status: 'unavailable',
        message: 'Camera preview unavailable.',
      })
      setPhase('error')
      stopCamera()
    })
  }, [phase, stopCamera, stream])

  useEffect(() => {
    if (!open) return undefined

    const handleEscape = (event) => {
      if (event.key === 'Escape') closeFlow()
    }

    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [closeFlow, open])

  const requestOptionalLocation = useCallback(async (requestId) => {
    const isCurrentRun = () => (
      permissionRequestRef.current === requestId && openRef.current
    )

    if (!navigator.geolocation) {
      if (!isCurrentRun()) return

      locationRef.current = null
      setLocationState({
        status: 'unavailable',
        message: 'Location unavailable — IP fallback will be used.',
      })
      return
    }

    setLocationState({
      status: 'requesting',
      message: 'Requesting optional location…',
    })

    if (navigator.permissions?.query) {
      try {
        const permission = await navigator.permissions.query({ name: 'geolocation' })

        if (!isCurrentRun()) return

        if (permission.state === 'denied') {
          locationRef.current = null
          setLocationState({
            status: 'blocked',
            message: 'Location is blocked for this website. Open browser Site settings → Location and select Allow/Ask. The backend will use IP fallback.',
          })
          return
        }
      } catch {
        // Some browsers expose Permissions API without geolocation query support.
      }
    }

    if (!isCurrentRun()) return

    try {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          if (!isCurrentRun()) return

          const latitude = position.coords.latitude
          const longitude = position.coords.longitude
          const accuracy = position.coords.accuracy

          if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
            locationRef.current = null
            setLocationState({
              status: 'unavailable',
              message: 'Location unavailable — IP fallback will be used.',
            })
            return
          }

          locationRef.current = { latitude, longitude, accuracy }
          setLocationState({
            status: 'ready',
            message: Number.isFinite(accuracy)
              ? `GPS ready (approximately ${Math.round(accuracy)} metres).`
              : 'GPS ready.',
          })
        },
        (error) => {
          if (!isCurrentRun()) return

          locationRef.current = null
          setLocationState(locationFailureState(error))
        },
        {
          enableHighAccuracy: true,
          timeout: 15_000,
          maximumAge: 0,
        },
      )
    } catch {
      if (!isCurrentRun()) return

      locationRef.current = null
      setLocationState({
        status: 'unavailable',
        message: 'Location unavailable — IP fallback will be used.',
      })
    }
  }, [])

  const openCamera = async () => {
    const requestId = permissionRequestRef.current + 1
    permissionRequestRef.current = requestId
    cancelPendingCameraWait()
    uploadControllerRef.current?.abort()
    uploadControllerRef.current = null
    stopCamera()
    locationRef.current = null
    setCameraState({
      status: 'requesting',
      message: 'Requesting camera permission…',
    })
    setLocationState(initialLocationState)
    setCapturedFile(null)
    setSavedResult(null)
    setErrorMessage('')
    setPhase('opening')
    onStatusChange('Requesting camera permission')

    if (!window.isSecureContext) {
      setErrorMessage('Camera and location require HTTPS or localhost.')
      setCameraState({
        status: 'unavailable',
        message: 'Camera requires a secure connection.',
      })
      setPhase('error')
      onStatusChange('Secure connection required')
      return
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setErrorMessage('This browser does not support camera access.')
      setCameraState({
        status: 'unavailable',
        message: 'Camera unavailable in this browser.',
      })
      setPhase('error')
      onStatusChange('Camera unavailable')
      return
    }

    const cameraPromise = navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user' },
      audio: false,
    })

    let cameraTimedOut = false
    cameraPromise.then((lateStream) => {
      if (cameraTimedOut || permissionRequestRef.current !== requestId || !openRef.current) {
        stopTracks(lateStream)
      }
    }).catch(() => {})

    try {
      const timeoutPromise = new Promise((_, reject) => {
        cameraWaitCancelRef.current = () => {
          const cancelledError = new Error('Camera request cancelled')
          cancelledError.name = 'CameraRequestCancelled'
          reject(cancelledError)
        }

        cameraTimeoutRef.current = window.setTimeout(() => {
          cameraTimedOut = true
          cameraTimeoutRef.current = null
          cameraWaitCancelRef.current = null
          const timeoutError = new Error('Camera permission timed out')
          timeoutError.name = 'CameraTimeoutError'
          reject(timeoutError)
        }, cameraPermissionTimeoutMs)
      })

      const nextStream = await Promise.race([cameraPromise, timeoutPromise])
      window.clearTimeout(cameraTimeoutRef.current)
      cameraTimeoutRef.current = null
      cameraWaitCancelRef.current = null

      if (permissionRequestRef.current !== requestId || !openRef.current) {
        stopTracks(nextStream)
        return
      }

      streamRef.current = nextStream
      setStream(nextStream)
      setCameraState({
        status: 'ready',
        message: 'Camera ready',
      })
      setPhase('camera')
      onStatusChange('Camera ready — capture when you are ready')
      void requestOptionalLocation(requestId)
    } catch (error) {
      if (permissionRequestRef.current !== requestId || !openRef.current) return

      window.clearTimeout(cameraTimeoutRef.current)
      cameraTimeoutRef.current = null
      cameraWaitCancelRef.current = null

      if (error?.name === 'CameraTimeoutError') {
        permissionRequestRef.current += 1
        setErrorMessage('Camera permission did not respond within 15 seconds. Open browser Site settings → Camera and select Allow/Ask, then try again.')
        setCameraState({
          status: 'timedout',
          message: 'Camera permission timed out.',
        })
        setPhase('error')
        onStatusChange('Camera permission timed out')
        return
      }

      const cameraDenied = error?.name === 'NotAllowedError' || error?.name === 'SecurityError'
      setErrorMessage(cameraDenied
        ? 'Camera permission was denied or blocked. Open browser Site settings → Camera and select Allow/Ask, then try again.'
        : 'Camera could not be opened. Check that it is not being used by another app.')
      setCameraState({
        status: cameraDenied ? 'denied' : 'unavailable',
        message: cameraDenied ? 'Camera permission denied.' : 'Camera unavailable.',
      })
      setPhase('error')
      onStatusChange('Camera permission failed')
    }
  }

  const performUpload = async (photoFile) => {
    const requestId = permissionRequestRef.current
    const controller = new AbortController()
    uploadControllerRef.current = controller
    setErrorMessage('')
    setPhase('uploading')
    onStatusChange('Uploading photo securely')

    try {
      const result = await uploadCapture({
        photoFile,
        location: locationRef.current,
        signal: controller.signal,
      })

      if (
        permissionRequestRef.current !== requestId
        || !openRef.current
        || controller.signal.aborted
      ) return

      setSavedResult(result)
      setPhase('success')
      onStatusChange('Photo saved successfully')
    } catch (error) {
      if (
        permissionRequestRef.current !== requestId
        || !openRef.current
        || controller.signal.aborted
      ) return

      setErrorMessage(error.message || 'Upload failed. Please try again.')
      setPhase('error')
      onStatusChange('Upload failed')
    } finally {
      if (uploadControllerRef.current === controller) {
        uploadControllerRef.current = null
      }
    }
  }

  const captureAndUpload = async () => {
    const requestId = permissionRequestRef.current
    const video = videoRef.current

    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
      setErrorMessage('The camera is still loading. Wait a moment and try again.')
      return
    }

    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const context = canvas.getContext('2d')

    if (!context) {
      setErrorMessage('Your browser could not capture the camera frame.')
      return
    }

    context.translate(canvas.width, 0)
    context.scale(-1, 1)
    context.drawImage(video, 0, 0, canvas.width, canvas.height)

    const photoBlob = await new Promise((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.92)
    })

    if (permissionRequestRef.current !== requestId || !openRef.current) return

    if (!photoBlob) {
      setErrorMessage('Photo capture failed. Please try again.')
      return
    }

    const photoFile = new File(
      [photoBlob],
      `camera-${Date.now()}.jpg`,
      { type: 'image/jpeg' },
    )

    setCapturedFile(photoFile)
    stopCamera()
    await performUpload(photoFile)
  }

  const startAgain = () => {
    invalidateActiveRun()
    stopCamera()
    resetFlow()
    onStatusChange('Ready to open camera')
  }

  if (!open) return null

  const locationTone = locationState.status === 'ready'
    ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100'
    : ['blocked', 'denied', 'timedout', 'unavailable'].includes(locationState.status)
      ? 'border-amber-400/30 bg-amber-400/10 text-amber-100'
      : 'border-cyan-400/30 bg-cyan-400/10 text-cyan-100'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/90 p-3 backdrop-blur-md sm:p-6">
      <section
        aria-labelledby="capture-title"
        aria-modal="true"
        className="my-auto w-full max-w-2xl overflow-hidden rounded-3xl border border-white/10 bg-[#11131d] shadow-2xl"
        role="dialog"
      >
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4 sm:px-7">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-rose-300">Photo capture</p>
            <h2 className="mt-1 text-xl font-semibold text-white" id="capture-title">
              Capture and save your photo
            </h2>
          </div>
          <button
            aria-label="Cancel and close camera"
            className="grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-white/5 text-xl text-white/80 transition hover:bg-white/10"
            onClick={closeFlow}
            type="button"
          >
            ×
          </button>
        </div>

        <div className="p-5 sm:p-7">
          {phase === 'consent' && (
            <div className="space-y-5 text-center">
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-rose-500/15 text-3xl">📷</div>
              <div>
                <h3 className="text-2xl font-semibold text-white">Your permission comes first</h3>
                <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-300 sm:text-base">
                  The photo you choose to capture and your GPS location, when allowed, will be
                  sent to the backend and saved in the database. If GPS is denied or times out,
                  no GPS fields are sent and the backend can use its Geo-IP/raw-IP fallback.
                </p>
              </div>
              <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/5 p-4 text-left text-sm leading-6 text-cyan-100">
                Nothing is captured or uploaded automatically. Camera and location permissions
                start only after you press <strong>Open Camera</strong>, and uploading starts only
                after you press <strong>Capture &amp; Upload</strong>.
              </div>
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-center">
                <button className="capture-button-secondary" onClick={closeFlow} type="button">Cancel</button>
                <button className="capture-button-primary" onClick={openCamera} type="button">Open Camera</button>
              </div>
            </div>
          )}

          {phase === 'opening' && (
            <div className="py-10 text-center">
              <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-white/10 border-t-rose-400" />
              <h3 className="mt-5 text-xl font-semibold">Requesting camera permission…</h3>
              <p className="mt-2 text-sm text-slate-300">Allow camera access in your browser to start the preview.</p>
              <div className="mx-auto mt-5 max-w-md rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-4 py-3 text-left text-sm text-cyan-100">
                <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200/70">Camera</span>
                <span className="mt-1 block">{cameraState.message}</span>
              </div>
              <button className="capture-button-secondary mt-6" onClick={closeFlow} type="button">Cancel</button>
            </div>
          )}

          {phase === 'camera' && (
            <div className="space-y-4">
              <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-black">
                <video
                  aria-label="Live front camera preview"
                  autoPlay
                  className="h-full w-full -scale-x-100 object-cover"
                  muted
                  playsInline
                  ref={videoRef}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">
                  <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-200/70">Camera</span>
                  <span className="mt-1 block">{cameraState.message}</span>
                </div>
                <div className={`rounded-xl border px-4 py-3 text-sm ${locationTone}`}>
                  <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] opacity-70">Optional GPS</span>
                  <span className="mt-1 block">{locationState.message}</span>
                </div>
              </div>
              {errorMessage && (
                <p className="rounded-xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
                  {errorMessage}
                </p>
              )}
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button className="capture-button-secondary" onClick={closeFlow} type="button">Cancel</button>
                <button className="capture-button-primary" onClick={captureAndUpload} type="button">Capture &amp; Upload</button>
              </div>
            </div>
          )}

          {phase === 'uploading' && (
            <div className="py-10 text-center">
              <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-white/10 border-t-rose-400" />
              <h3 className="mt-5 text-xl font-semibold">Saving your photo…</h3>
              <p className="mt-2 text-sm text-slate-300">Please keep this window open while the backend stores it.</p>
              <button className="capture-button-secondary mt-6" onClick={closeFlow} type="button">Cancel upload</button>
            </div>
          )}

          {phase === 'success' && (
            <div className="space-y-5 py-5 text-center">
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-400/15 text-3xl text-emerald-300">✓</div>
              <div>
                <h3 className="text-2xl font-semibold">Photo saved successfully</h3>
                <p className="mt-2 text-sm leading-6 text-slate-300">
                  The server returned status 201 and confirmed <code>saved: true</code>.
                </p>
                {savedResult?.id && <p className="mt-2 text-xs text-slate-400">Capture ID: {savedResult.id}</p>}
              </div>
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-center">
                <button className="capture-button-secondary" onClick={closeFlow} type="button">Close</button>
                <button className="capture-button-primary" onClick={startAgain} type="button">Capture another</button>
              </div>
            </div>
          )}

          {phase === 'error' && (
            <div className="space-y-5 py-5 text-center">
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-rose-400/15 text-3xl text-rose-300">!</div>
              <div>
                <h3 className="text-2xl font-semibold">Could not complete the capture</h3>
                <p className="mt-3 text-sm leading-6 text-rose-100">{errorMessage}</p>
              </div>
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:flex-wrap sm:justify-center">
                <button className="capture-button-secondary" onClick={closeFlow} type="button">Close</button>
                <button className="capture-button-secondary" onClick={startAgain} type="button">Start over</button>
                {capturedFile && (
                  <button className="capture-button-primary" onClick={() => performUpload(capturedFile)} type="button">
                    Retry upload
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
