import { useCallback, useEffect, useRef, useState } from 'react'
import { uploadCapture } from './captureApi'

const initialLocationState = {
  status: 'idle',
  message: 'Location permission has not been requested yet.',
}

function stopTracks(stream) {
  stream?.getTracks().forEach((track) => track.stop())
}

function locationFailureMessage(error) {
  if (error?.code === 1) return 'Location permission denied. The backend will use its IP fallback.'
  if (error?.code === 3) return 'Location request timed out. The backend will use its IP fallback.'
  return 'Location is unavailable. The backend will use its IP fallback.'
}

export default function CaptureFlow({ open, onClose, onStatusChange }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const locationRef = useRef(null)
  const uploadControllerRef = useRef(null)
  const permissionRequestRef = useRef(0)
  const openRef = useRef(open)

  const [phase, setPhase] = useState('consent')
  const [stream, setStream] = useState(null)
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
    setLocationState(initialLocationState)
    setCapturedFile(null)
    setErrorMessage('')
    setSavedResult(null)
    setPhase('consent')
  }, [])

  const closeFlow = useCallback(() => {
    permissionRequestRef.current += 1
    uploadControllerRef.current?.abort()
    uploadControllerRef.current = null
    stopCamera()
    resetFlow()
    onClose()
  }, [onClose, resetFlow, stopCamera])

  useEffect(() => {
    if (!open) {
      permissionRequestRef.current += 1
      uploadControllerRef.current?.abort()
      uploadControllerRef.current = null
      stopCamera()
      resetFlow()
    }
  }, [open, resetFlow, stopCamera])

  useEffect(() => () => {
    permissionRequestRef.current += 1
    uploadControllerRef.current?.abort()
    stopTracks(streamRef.current)
  }, [])

  useEffect(() => {
    if (!stream || !videoRef.current) return

    videoRef.current.srcObject = stream
    videoRef.current.play().catch(() => {
      setErrorMessage('Camera preview could not start. Please try again.')
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

  const openCamera = async () => {
    const requestId = permissionRequestRef.current + 1
    permissionRequestRef.current = requestId
    locationRef.current = null
    setCapturedFile(null)
    setSavedResult(null)
    setErrorMessage('')
    setPhase('opening')
    onStatusChange('Requesting camera and location permissions')

    if (!window.isSecureContext) {
      setErrorMessage('Camera and location require HTTPS or localhost.')
      setPhase('error')
      onStatusChange('Secure connection required')
      return
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setErrorMessage('This browser does not support camera access.')
      setPhase('error')
      onStatusChange('Camera unavailable')
      return
    }

    // Both permission requests deliberately start in this same visible button click.
    const cameraPromise = navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user' },
      audio: false,
    })

    if (navigator.geolocation) {
      setLocationState({
        status: 'requesting',
        message: 'Waiting for optional GPS location…',
      })
      navigator.geolocation.getCurrentPosition(
        (position) => {
          if (permissionRequestRef.current !== requestId || !openRef.current) return

          const nextLocation = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
          }
          locationRef.current = nextLocation
          setLocationState({
            status: 'ready',
            message: `GPS ready (about ${Math.round(position.coords.accuracy)} m accuracy).`,
          })
        },
        (error) => {
          if (permissionRequestRef.current !== requestId || !openRef.current) return

          locationRef.current = null
          setLocationState({
            status: 'unavailable',
            message: locationFailureMessage(error),
          })
        },
        {
          enableHighAccuracy: true,
          timeout: 10_000,
          maximumAge: 0,
        },
      )
    } else {
      setLocationState({
        status: 'unavailable',
        message: 'This browser has no GPS support. The backend will use its IP fallback.',
      })
    }

    try {
      const nextStream = await cameraPromise

      if (permissionRequestRef.current !== requestId || !openRef.current) {
        stopTracks(nextStream)
        return
      }

      streamRef.current = nextStream
      setStream(nextStream)
      setPhase('camera')
      onStatusChange('Camera ready — capture when you are ready')
    } catch (error) {
      if (permissionRequestRef.current !== requestId || !openRef.current) return

      const message = error?.name === 'NotAllowedError'
        ? 'Camera permission was denied. Allow camera access and try again.'
        : 'Camera could not be opened. Check that it is not being used by another app.'
      setErrorMessage(message)
      setPhase('error')
      onStatusChange('Camera permission failed')
    }
  }

  const performUpload = async (photoFile) => {
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

      if (!openRef.current || controller.signal.aborted) return

      setSavedResult(result)
      setPhase('success')
      onStatusChange('Photo saved successfully')
    } catch (error) {
      if (!openRef.current || controller.signal.aborted) return

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
    locationRef.current = null
    setLocationState(initialLocationState)
    setCapturedFile(null)
    setErrorMessage('')
    setSavedResult(null)
    setPhase('consent')
    onStatusChange('Ready to open camera')
  }

  if (!open) return null

  const locationTone = locationState.status === 'ready'
    ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100'
    : locationState.status === 'unavailable'
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
              <h3 className="mt-5 text-xl font-semibold">Waiting for your permissions</h3>
              <p className="mt-2 text-sm text-slate-300">Approve the camera and optional location prompts in your browser.</p>
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
              <div className={`rounded-xl border px-4 py-3 text-sm ${locationTone}`}>
                {locationState.message}
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
