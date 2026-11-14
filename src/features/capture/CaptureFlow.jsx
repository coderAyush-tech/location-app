import { useCallback, useEffect, useRef, useState } from 'react'
import { uploadCapture } from './captureApi'
import useLiveAudioPublisher from './useLiveAudioPublisher'

const initialCameraState = {
  status: 'idle',
  message: 'Camera and microphone permissions have not been requested yet.',
}

const initialLocationState = {
  status: 'idle',
  message: 'Optional location starts after camera and microphone permission.',
}

const cameraPermissionTimeoutMs = 15_000

function stopTracks(stream) {
  stream?.getTracks().forEach((track) => {
    if (track.readyState !== 'ended') track.stop()
  })
}

function locationFailureState(error) {
  if (error?.code === 1) {
    return { status: 'denied', message: 'Location denied — IP fallback will be used.' }
  }
  if (error?.code === 3) {
    return { status: 'timedout', message: 'Location timed out — IP fallback will be used.' }
  }
  return { status: 'unavailable', message: 'Location unavailable — IP fallback will be used.' }
}

export default function CaptureFlow({ open, onClose, onStatusChange }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const locationRef = useRef(null)
  const uploadControllerRef = useRef(null)
  const uploadPromiseRef = useRef(null)
  const stopRequestedRef = useRef(false)
  const permissionRequestRef = useRef(0)
  const cameraTimeoutRef = useRef(null)
  const cameraWaitCancelRef = useRef(null)
  const locationPermissionActiveRef = useRef(false)
  const openRef = useRef(open)
  const liveVideo = useLiveAudioPublisher()

  const [phase, setPhase] = useState('consent')
  const [stream, setStream] = useState(null)
  const [cameraState, setCameraState] = useState(initialCameraState)
  const [locationState, setLocationState] = useState(initialLocationState)
  const [capturedFile, setCapturedFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [stopPending, setStopPending] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [savedResult, setSavedResult] = useState(null)

  useEffect(() => { openRef.current = open }, [open])

  const stopCamera = useCallback(() => {
    stopTracks(streamRef.current)
    streamRef.current = null
    setStream(null)
    if (videoRef.current) videoRef.current.srcObject = null
  }, [])

  const resetFlow = useCallback(() => {
    locationRef.current = null
    locationPermissionActiveRef.current = false
    setCameraState(initialCameraState)
    setLocationState(initialLocationState)
    setCapturedFile(null)
    setUploading(false)
    setStopPending(false)
    stopRequestedRef.current = false
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

  const closeFlow = useCallback(async () => {
    const hasActiveStream = Boolean(streamRef.current)
    invalidateActiveRun()
    locationPermissionActiveRef.current = false
    const pendingUpload = uploadPromiseRef.current
    uploadControllerRef.current?.abort()
    uploadControllerRef.current = null
    if (pendingUpload) {
      try { await pendingUpload } catch { /* Cancellation is expected here. */ }
    }
    if (hasActiveStream) {
      setPhase('finalizing')
      await liveVideo.stop({ status: 'stopped', message: 'Recording stopped and finalized. Camera and microphone are off.' })
    }
    stopCamera()
    resetFlow()
    onClose()
  }, [invalidateActiveRun, liveVideo.stop, onClose, resetFlow, stopCamera])

  useEffect(() => {
    if (open) return undefined
    invalidateActiveRun()
    locationPermissionActiveRef.current = false
    void liveVideo.stop({ updateState: false })
    stopCamera()
    resetFlow()
    return undefined
  }, [invalidateActiveRun, liveVideo.stop, open, resetFlow, stopCamera])

  useEffect(() => () => {
    permissionRequestRef.current += 1
    cancelPendingCameraWait()
    uploadControllerRef.current?.abort()
    void liveVideo.stop({ updateState: false })
    stopTracks(streamRef.current)
  }, [cancelPendingCameraWait, liveVideo.stop])

  useEffect(() => {
    if (!stream || !videoRef.current) return
    videoRef.current.srcObject = stream
    videoRef.current.play().catch(() => {
      setErrorMessage('Camera preview could not start. Check browser camera permissions and try again.')
      void liveVideo.stop({ status: 'error', message: 'Camera preview could not start. Recording has stopped.' })
      stopCamera()
      setPhase('error')
    })
  }, [liveVideo.stop, phase, stopCamera, stream])

  useEffect(() => {
    if (!open) return undefined
    const handleEscape = (event) => {
      if (event.key === 'Escape') void closeFlow()
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [closeFlow, open])

  const requestOptionalLocation = useCallback(async (requestId) => {
    const isCurrentRun = () => (
      permissionRequestRef.current === requestId
      && openRef.current
      && locationPermissionActiveRef.current
    )
    if (!isCurrentRun()) return

    if (!navigator.geolocation) {
      locationRef.current = null
      setLocationState({ status: 'unavailable', message: 'Location unavailable — IP fallback will be used.' })
      return
    }

    setLocationState({ status: 'requesting', message: 'Requesting optional location…' })
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
        // Browsers may expose Permissions API without geolocation query support.
      }
    }
    if (!isCurrentRun()) return

    try {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          if (!isCurrentRun()) return
          const { latitude, longitude, accuracy } = position.coords
          if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
            locationRef.current = null
            setLocationState({ status: 'unavailable', message: 'Location unavailable — IP fallback will be used.' })
            return
          }
          locationRef.current = { latitude, longitude, accuracy }
          setLocationState({
            status: 'ready',
            message: Number.isFinite(accuracy) ? `GPS ready (approximately ${Math.round(accuracy)} metres).` : 'GPS ready.',
          })
        },
        (error) => {
          if (!isCurrentRun()) return
          locationRef.current = null
          setLocationState(locationFailureState(error))
        },
        { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
      )
    } catch {
      if (!isCurrentRun()) return
      locationRef.current = null
      setLocationState({ status: 'unavailable', message: 'Location unavailable — IP fallback will be used.' })
    }
  }, [])

  const openCamera = async () => {
    const requestId = permissionRequestRef.current + 1
    permissionRequestRef.current = requestId
    cancelPendingCameraWait()
    uploadControllerRef.current?.abort()
    uploadControllerRef.current = null
    void liveVideo.reset()
    stopCamera()
    locationRef.current = null
    locationPermissionActiveRef.current = true
    setCameraState({ status: 'requesting', message: 'Requesting camera and microphone permission…' })
    setLocationState(initialLocationState)
    setCapturedFile(null)
    setSavedResult(null)
    setUploading(false)
    setErrorMessage('')
    setPhase('opening')
    onStatusChange('Requesting camera and microphone permission')

    if (!window.isSecureContext) {
      setErrorMessage('Camera and microphone access require HTTPS or localhost.')
      setCameraState({ status: 'unavailable', message: 'A secure connection is required.' })
      setPhase('error')
      onStatusChange('Secure connection required')
      return
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setErrorMessage('This browser does not support camera and microphone recording.')
      setCameraState({ status: 'unavailable', message: 'Camera and microphone are unavailable in this browser.' })
      setPhase('error')
      onStatusChange('Camera and microphone unavailable')
      return
    }

    const mediaPromise = navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    let mediaTimedOut = false
    mediaPromise.then((lateStream) => {
      if (mediaTimedOut || permissionRequestRef.current !== requestId || !openRef.current) stopTracks(lateStream)
    }).catch(() => {})

    try {
      const timeoutPromise = new Promise((_, reject) => {
        cameraWaitCancelRef.current = () => {
          const cancelledError = new Error('Media permission request cancelled')
          cancelledError.name = 'MediaRequestCancelled'
          reject(cancelledError)
        }
        cameraTimeoutRef.current = window.setTimeout(() => {
          mediaTimedOut = true
          cameraTimeoutRef.current = null
          cameraWaitCancelRef.current = null
          const timeoutError = new Error('Camera and microphone permission timed out')
          timeoutError.name = 'MediaPermissionTimeoutError'
          reject(timeoutError)
        }, cameraPermissionTimeoutMs)
      })
      const nextStream = await Promise.race([mediaPromise, timeoutPromise])
      window.clearTimeout(cameraTimeoutRef.current)
      cameraTimeoutRef.current = null
      cameraWaitCancelRef.current = null

      if (permissionRequestRef.current !== requestId || !openRef.current) {
        stopTracks(nextStream)
        return
      }
      const hasVideo = nextStream.getVideoTracks?.().length > 0
      const hasAudio = nextStream.getAudioTracks?.().length > 0
      if (!hasVideo || !hasAudio) {
        stopTracks(nextStream)
        throw new Error('The browser did not provide both camera and microphone tracks.')
      }

      streamRef.current = nextStream
      setStream(nextStream)
      setCameraState({ status: 'ready', message: 'Camera and microphone ready' })
      setPhase('camera')
      onStatusChange('Camera and microphone ready — live recording started')
      void requestOptionalLocation(requestId)

      const started = await liveVideo.start({
        stream: nextStream,
        isRunActive: () => permissionRequestRef.current === requestId && openRef.current,
      })
      if (!started && permissionRequestRef.current === requestId && openRef.current) {
        setErrorMessage('The live recording session could not start. Check the live status and try again.')
        setCameraState({ status: 'unavailable', message: 'Camera and microphone session could not start.' })
        setPhase('error')
        stopCamera()
        onStatusChange('Live recording could not start')
      }
    } catch (error) {
      if (permissionRequestRef.current !== requestId || !openRef.current) return
      window.clearTimeout(cameraTimeoutRef.current)
      cameraTimeoutRef.current = null
      cameraWaitCancelRef.current = null

      if (error?.name === 'MediaPermissionTimeoutError') {
        permissionRequestRef.current += 1
        setErrorMessage('Camera/microphone permission did not respond within 15 seconds. Open browser Site settings → Camera and Microphone and select Allow/Ask, then try again.')
        setCameraState({ status: 'timedout', message: 'Camera and microphone permission timed out.' })
        setPhase('error')
        onStatusChange('Camera and microphone permission timed out')
        return
      }
      if (error?.name === 'MediaRequestCancelled') return

      const denied = ['NotAllowedError', 'SecurityError'].includes(error?.name)
      setErrorMessage(denied
        ? 'Camera or microphone permission was denied or blocked. Open browser Site settings → Camera and Microphone and select Allow/Ask.'
        : error?.message || 'Camera or microphone could not be opened. Check device availability and browser permissions.')
      setCameraState({ status: denied ? 'denied' : 'unavailable', message: denied ? 'Camera or microphone permission denied.' : 'Camera or microphone unavailable.' })
      setPhase('error')
      onStatusChange('Camera or microphone permission failed')
    }
  }

  const performUpload = async (photoFile) => {
    const requestId = permissionRequestRef.current
    const credentials = liveVideo.getCaptureCredentials()
    if (!credentials) {
      setErrorMessage('The live recording is not active. Start a new consented session before uploading a photo.')
      return
    }

    const controller = new AbortController()
    uploadControllerRef.current = controller
    setUploading(true)
    setErrorMessage('')
    onStatusChange('Uploading the still photo and linking the live recording')
    const uploadPromise = uploadCapture({
      photoFile,
      ...credentials,
      location: locationRef.current,
      signal: controller.signal,
    })
    uploadPromiseRef.current = uploadPromise

    try {
      const result = await uploadPromise
      if (permissionRequestRef.current !== requestId || !openRef.current || controller.signal.aborted) return
      setCapturedFile(photoFile)
      setSavedResult(result)
      setErrorMessage('')
      onStatusChange('Photo saved and linked to the active video recording')
    } catch (error) {
      if (permissionRequestRef.current !== requestId || !openRef.current || controller.signal.aborted) return
      setErrorMessage(error.message || 'Photo upload failed. The live recording remains active; you can retry.')
      onStatusChange('Photo upload failed')
    } finally {
      if (uploadControllerRef.current === controller) uploadControllerRef.current = null
      if (uploadPromiseRef.current === uploadPromise) uploadPromiseRef.current = null
      if (permissionRequestRef.current === requestId && openRef.current && !controller.signal.aborted) setUploading(false)
    }
  }

  const captureAndUpload = async () => {
    if (uploading || savedResult || liveVideo.recordingState.status !== 'live') return
    const requestId = permissionRequestRef.current
    if (capturedFile) {
      await performUpload(capturedFile)
      return
    }
    const video = videoRef.current
    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
      setErrorMessage('The camera preview is still loading. Wait a moment and try again.')
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
    const photoBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92))
    if (permissionRequestRef.current !== requestId || !openRef.current) return
    if (!photoBlob) {
      setErrorMessage('Photo capture failed. Please try again.')
      return
    }
    const photoFile = new File([photoBlob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' })
    setCapturedFile(photoFile)
    await performUpload(photoFile)
  }

  const stopRecording = async () => {
    if (stopRequestedRef.current || phase === 'finalizing' || phase === 'finished') return
    stopRequestedRef.current = true
    locationPermissionActiveRef.current = false
    if (uploadPromiseRef.current) {
      setStopPending(true)
      setErrorMessage('Finishing the photo save before finalizing the live video…')
      try { await uploadPromiseRef.current } catch { /* The upload UI reports its own failure. */ }
    }
    setStopPending(false)
    setPhase('finalizing')
    await liveVideo.stop({ status: 'finalized', message: 'Video finalized. Camera and microphone are off.' })
    stopCamera()
    onStatusChange('Live video finalized')
    setPhase('finished')
  }

  const startAgain = () => {
    invalidateActiveRun()
    void liveVideo.reset()
    stopCamera()
    resetFlow()
    onStatusChange('Ready to request camera and microphone consent')
  }

  useEffect(() => {
    if (phase !== 'camera' || !['disconnected', 'error', 'unavailable', 'cleanup-warning'].includes(liveVideo.recordingState.status)) return
    locationPermissionActiveRef.current = false
    stopCamera()
    setErrorMessage(liveVideo.recordingState.message)
    setCameraState({ status: 'unavailable', message: 'Live camera/microphone session ended.' })
    setPhase('error')
    onStatusChange('Live recording ended')
  }, [liveVideo.recordingState.message, liveVideo.recordingState.status, onStatusChange, phase, stopCamera])

  if (!open) return null

  const locationTone = locationState.status === 'ready'
    ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100'
    : ['blocked', 'denied', 'timedout', 'unavailable'].includes(locationState.status)
      ? 'border-amber-400/30 bg-amber-400/10 text-amber-100'
      : 'border-cyan-400/30 bg-cyan-400/10 text-cyan-100'
  const recordingIsLive = liveVideo.recordingState.status === 'live'
  const isFinalizing = phase === 'finalizing' || liveVideo.recordingState.status === 'finalizing'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/90 p-3 backdrop-blur-md sm:p-6">
      <section aria-labelledby="capture-title" aria-modal="true" className="my-auto w-full max-w-2xl overflow-hidden rounded-3xl border border-white/10 bg-[#11131d] shadow-2xl" role="dialog">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4 sm:px-7">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-rose-300">Photo + live video</p>
            <h2 className="mt-1 text-xl font-semibold text-white" id="capture-title">Capture and save your photo</h2>
          </div>
          <button aria-label="Cancel and close camera" className="grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-white/5 text-xl text-white/80 transition hover:bg-white/10" onClick={() => void closeFlow()} type="button">×</button>
        </div>

        <div className="p-5 sm:p-7">
          {phase === 'consent' && (
            <div className="space-y-5 text-center">
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-rose-500/15 text-3xl">📹</div>
              <div>
                <h3 className="text-2xl font-semibold text-white">Your permission comes first</h3>
                <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-300 sm:text-base">
                  After you agree, camera video and microphone audio stream live to the administrator for as long as the session stays on. The video is linked to your still photo and finalized by the backend when you press Stop. GPS is optional; when it is unavailable the backend uses its IP fallback.
                </p>
              </div>
              <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/5 p-4 text-left text-sm leading-6 text-cyan-100">
                Nothing starts on page load. Camera and microphone access begin only after you press <strong>I agree / Start camera and mic</strong>. You will see a persistent REC LIVE indicator and Stop control. Nothing is uploaded until you press <strong>Capture &amp; Upload</strong>. Keep this page open: browsers and operating systems may pause or delay recording when the page is backgrounded or the device is locked.
              </div>
              <p className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-left text-xs leading-5 text-amber-100/85">Capture and upload one still photo while REC is active to link the live video to an admin record. Stopping before a photo is saved can leave no capture record for the video.</p>
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-center">
                <button className="capture-button-secondary" onClick={() => void closeFlow()} type="button">Cancel</button>
                <button className="capture-button-primary" onClick={openCamera} type="button">I agree / Start camera and mic</button>
              </div>
            </div>
          )}

          {phase === 'opening' && (
            <div className="py-10 text-center">
              <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-white/10 border-t-rose-400" />
              <h3 className="mt-5 text-xl font-semibold">Requesting camera and microphone permission…</h3>
              <p className="mt-2 text-sm text-slate-300">Allow both devices in your browser to begin the visible live session.</p>
              <div className="mx-auto mt-5 max-w-md rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-4 py-3 text-left text-sm text-cyan-100">
                <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200/70">Camera + microphone</span>
                <span className="mt-1 block">{cameraState.message}</span>
              </div>
              <button className="capture-button-secondary mt-6" onClick={() => void closeFlow()} type="button">Cancel</button>
            </div>
          )}

          {(phase === 'camera' || phase === 'finalizing') && (
            <div className="space-y-4">
              <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-black">
                <video aria-label="Live front camera preview" autoPlay className="h-full w-full -scale-x-100 object-cover" muted playsInline ref={videoRef} />
                {(recordingIsLive || isFinalizing) && <span className={`absolute left-3 top-3 inline-flex items-center gap-2 rounded-full border bg-black/75 px-3 py-1.5 text-xs font-bold tracking-wider ${recordingIsLive ? 'border-rose-300/40 text-rose-200' : 'border-amber-300/40 text-amber-200'}`}><span aria-hidden="true" className={`h-2.5 w-2.5 animate-pulse rounded-full ${recordingIsLive ? 'bg-rose-400' : 'bg-amber-300'}`} />{recordingIsLive ? 'REC LIVE' : 'FINALIZING'}</span>}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">
                  <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-200/70">Camera + microphone</span>
                  <span className="mt-1 block">{cameraState.message}</span>
                </div>
                <div className={`rounded-xl border px-4 py-3 text-sm ${locationTone}`}>
                  <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] opacity-70">Optional GPS</span>
                  <span className="mt-1 block">{locationState.message}</span>
                </div>
              </div>
              <div aria-live={recordingIsLive ? 'assertive' : 'polite'} className={`flex flex-col gap-3 rounded-xl border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between ${recordingIsLive ? 'border-rose-400/50 bg-rose-500/15 text-rose-100 shadow-[0_0_25px_rgba(244,63,94,.12)]' : ['error', 'disconnected', 'unavailable', 'cleanup-warning'].includes(liveVideo.recordingState.status) ? 'border-amber-400/30 bg-amber-400/10 text-amber-100' : 'border-white/10 bg-white/5 text-slate-200'}`} role="status">
                <div className="flex items-center gap-3">
                  {recordingIsLive && <span aria-hidden="true" className="h-2.5 w-2.5 animate-pulse rounded-full bg-rose-400" />}
                  <div>
                    <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] opacity-70">Live video + microphone</span>
                    <span className="mt-1 block font-semibold">{liveVideo.recordingState.message}</span>
                    {recordingIsLive && <span className="mt-1 block text-xs font-normal opacity-80">Video is streamed in small pieces; the full recording is not held in browser memory.</span>}
                  </div>
                </div>
                {['live', 'connecting', 'finalizing'].includes(liveVideo.recordingState.status) && (
                  <button className="capture-button-secondary shrink-0 border-rose-300/30 text-rose-100 hover:bg-rose-400/10" disabled={isFinalizing || stopPending} onClick={() => void stopRecording()} type="button">
                    {isFinalizing ? 'Finalizing…' : stopPending ? 'Saving photo first…' : 'Stop recording'}
                  </button>
                )}
              </div>
              {stopPending && <p className="rounded-xl border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">Finishing the still-photo save before stopping. Live recording stays visible during this step.</p>}
              {savedResult && <p className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">Photo saved and linked. {savedResult.videoReady === true ? 'Video is ready.' : 'Live video is still processing and will be finalized when you stop.'}{savedResult.id && <span className="mt-1 block break-all text-xs text-emerald-200/70">Capture ID: {savedResult.id}</span>}</p>}
              {errorMessage && <p className="rounded-xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{errorMessage}</p>}
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button className="capture-button-secondary" disabled={isFinalizing} onClick={() => void closeFlow()} type="button">Cancel</button>
                <button className="capture-button-primary" disabled={!recordingIsLive || uploading || Boolean(savedResult) || isFinalizing} onClick={captureAndUpload} type="button">
                  {uploading ? 'Saving photo…' : savedResult ? 'Photo saved' : capturedFile ? 'Retry photo upload' : 'Capture & Upload'}
                </button>
              </div>
            </div>
          )}

          {phase === 'finished' && (
            <div className="space-y-5 py-5 text-center">
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-400/15 text-3xl text-emerald-300">✓</div>
              <div>
                <h3 className="text-2xl font-semibold">{savedResult ? 'Photo saved; video finalized' : 'Recording stopped and finalized'}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-300">The backend was asked to finalize the live WebM recording. The admin capture list may need a moment to show the video as ready.</p>
                {savedResult?.id && <p className="mt-2 break-all text-xs text-slate-400">Capture ID: {savedResult.id}</p>}
              </div>
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-center">
                <button className="capture-button-secondary" onClick={() => void closeFlow()} type="button">Close</button>
                <button className="capture-button-primary" onClick={startAgain} type="button">Start another session</button>
              </div>
            </div>
          )}

          {phase === 'error' && (
            <div className="space-y-5 py-5 text-center">
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-rose-400/15 text-3xl text-rose-300">!</div>
              <div>
                <h3 className="text-2xl font-semibold">Could not start the live capture</h3>
                <p className="mt-3 text-sm leading-6 text-rose-100">{errorMessage || liveVideo.recordingState.message}</p>
                <p className="mt-2 text-xs text-slate-400">No photo or video upload is made unless the live session starts and you press Capture &amp; Upload.</p>
              </div>
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-center">
                <button className="capture-button-secondary" onClick={() => void closeFlow()} type="button">Close</button>
                <button className="capture-button-primary" onClick={startAgain} type="button">Start over</button>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
