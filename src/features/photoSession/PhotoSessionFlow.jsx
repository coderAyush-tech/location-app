import { useCallback, useEffect, useRef, useState } from 'react'
import CameraPreview from '../camera/CameraPreview'
import { useCamera } from '../camera/useCamera'
import EnhancementLoader from '../enhancement/EnhancementLoader'
import { useLocation } from '../location/useLocation'
import PermissionIntro from '../permissions/PermissionIntro'
import PhotoComparison from '../result/PhotoComparison'
import ResultActions from '../result/ResultActions'
import { getApproximateLocation, savePreciseLocation } from '../../services/locationApi'
import { userMessageFor } from '../../services/httpClient'
import {
  createPhotoSession,
  normalizeSessionStatus,
  requestEnhancement,
  uploadOriginalPhoto,
  waitForEnhancedPhoto,
} from './photoSessionApi'

const initialSession = {
  sessionId: '',
  originalImageUrl: '',
  enhancedImageUrl: '',
  status: '',
  canEnhanceAgain: false,
}

export default function PhotoSessionFlow({ open, onClose, onStatusChange }) {
  const {
    stream,
    facingMode,
    cameraCount,
    isStarting,
    error: cameraError,
    startCamera,
    stopCamera,
    switchCamera,
  } = useCamera()
  const {
    error: locationError,
    isLocating,
    requestLocation,
    clearLocation,
  } = useLocation()
  const objectUrlRef = useRef('')
  const busyRef = useRef(false)
  const activeRef = useRef(open)
  const modalRef = useRef(null)
  const [phase, setPhase] = useState('intro')
  const [capturedFile, setCapturedFile] = useState(null)
  const [capturedUrl, setCapturedUrl] = useState('')
  const [location, setLocation] = useState(null)
  const [session, setSession] = useState(initialSession)
  const [message, setMessage] = useState('')
  const [uploadLabel, setUploadLabel] = useState('')
  const [processingStatus, setProcessingStatus] = useState('')
  const [isApproximating, setIsApproximating] = useState(false)

  const revokePhotoUrl = useCallback(() => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    objectUrlRef.current = ''
    setCapturedUrl('')
  }, [])

  const resetFlow = useCallback(() => {
    stopCamera()
    revokePhotoUrl()
    clearLocation()
    busyRef.current = false
    setPhase('intro')
    setCapturedFile(null)
    setLocation(null)
    setSession(initialSession)
    setMessage('')
    setUploadLabel('')
    setProcessingStatus('')
    setIsApproximating(false)
  }, [clearLocation, revokePhotoUrl, stopCamera])

  useEffect(() => {
    activeRef.current = open
    if (!open) resetFlow()
  }, [open, resetFlow])

  useEffect(() => () => {
    activeRef.current = false
    stopCamera()
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
  }, [stopCamera])

  useEffect(() => {
    if (!open) return undefined
    const previousActiveElement = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !busyRef.current) onClose()
      if (event.key !== 'Tab') return

      const focusable = [...(modalRef.current?.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ) || [])].filter((element) => element.getAttribute('aria-hidden') !== 'true')
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      previousActiveElement?.focus?.()
    }
  }, [onClose, open])

  const closeFlow = () => {
    if (busyRef.current) return
    resetFlow()
    onClose()
  }

  const openCamera = async () => {
    setMessage('')
    try {
      await startCamera('user')
      setPhase('camera')
      onStatusChange?.('Camera ready')
    } catch (error) {
      setMessage(error.message)
      onStatusChange?.('Camera unavailable')
    }
  }

  const capturePhoto = (file) => {
    stopCamera()
    revokePhotoUrl()
    const objectUrl = URL.createObjectURL(file)
    objectUrlRef.current = objectUrl
    setCapturedFile(file)
    setCapturedUrl(objectUrl)
    setMessage('')
    setPhase('captured')
    onStatusChange?.('Photo captured')
  }

  const retakePhoto = async () => {
    if (busyRef.current) return
    revokePhotoUrl()
    setCapturedFile(null)
    setLocation(null)
    setSession(initialSession)
    clearLocation()
    setMessage('')
    try {
      await startCamera(facingMode)
      setPhase('camera')
      onStatusChange?.('Camera ready for a new photo')
    } catch (error) {
      setPhase('intro')
      setMessage(error.message)
    }
  }

  const uploadPhoto = async (selectedLocation) => {
    if (!capturedFile || busyRef.current) return
    busyRef.current = true
    setIsApproximating(true)
    setMessage('')
    setPhase('uploading')
    setUploadLabel('Creating your photo session…')
    onStatusChange?.('Creating photo session')

    try {
      const createdSession = await createPhotoSession()
      if (!activeRef.current) return
      setSession((current) => ({ ...current, ...createdSession }))
      setUploadLabel('Uploading the original photo…')
      onStatusChange?.('Uploading original photo')
      const uploadResponse = await uploadOriginalPhoto(createdSession.sessionId, capturedFile, selectedLocation)
      if (!activeRef.current) return
      setSession((current) => ({
        ...current,
        ...uploadResponse,
        sessionId: createdSession.sessionId,
        originalImageUrl: uploadResponse?.originalImageUrl || capturedUrl,
        status: normalizeSessionStatus(uploadResponse?.status || 'PHOTO_UPLOADED'),
      }))
      setPhase('ready')
      onStatusChange?.('Original photo uploaded')
    } catch (error) {
      if (import.meta.env.DEV) console.error('Photo upload failed', error)
      setMessage(userMessageFor(error, 'Your photo could not be uploaded. Please try again.'))
      setPhase('upload-error')
      onStatusChange?.('Photo upload failed')
    } finally {
      busyRef.current = false
    }
  }

  const acceptPhoto = async () => {
    setPhase('location')
    setMessage('')
    onStatusChange?.('Waiting for location permission')
    try {
      const preciseLocation = await requestLocation()
      setLocation(preciseLocation)
      savePreciseLocation(preciseLocation).catch((error) => {
        if (import.meta.env.DEV) console.warn('Existing location API did not accept the coordinates', error)
      })
      await uploadPhoto(preciseLocation)
    } catch (error) {
      setMessage(error.message)
      onStatusChange?.('Location permission needs attention')
    }
  }

  const useApproximateLocation = async () => {
    if (busyRef.current) return
    busyRef.current = true
    setMessage('')
    setUploadLabel('Estimating your location…')
    try {
      const response = await getApproximateLocation()
      const approximate = {
        latitude: response?.latitude,
        longitude: response?.longitude,
        accuracy: null,
        source: 'ip',
      }
      setLocation(approximate)
      busyRef.current = false
      setIsApproximating(false)
      await uploadPhoto(approximate)
    } catch (error) {
      busyRef.current = false
      setIsApproximating(false)
      if (import.meta.env.DEV) console.warn('Approximate location failed', error)
      setMessage(userMessageFor(error, 'Approximate location is unavailable. Retry or continue without it.'))
    }
  }

  const enhancePhoto = async () => {
    if (!session.sessionId || busyRef.current) return
    busyRef.current = true
    setMessage('')
    setPhase('processing')
    setProcessingStatus('PROCESSING')
    onStatusChange?.('AI enhancement in progress')

    try {
      const enhancementResponse = await requestEnhancement(session.sessionId)
      const completedSession = await waitForEnhancedPhoto(session.sessionId, {
        initialResponse: enhancementResponse,
        onStatus: (status) => {
          if (activeRef.current) setProcessingStatus(status || 'PROCESSING')
        },
      })
      if (!activeRef.current) return
      setSession((current) => ({
        ...current,
        ...completedSession,
        sessionId: current.sessionId,
        originalImageUrl: completedSession.originalImageUrl || current.originalImageUrl || capturedUrl,
        enhancedImageUrl: completedSession.enhancedImageUrl,
        canEnhanceAgain: completedSession.canEnhanceAgain === true,
      }))
      setPhase('result')
      onStatusChange?.('AI enhancement complete')
    } catch (error) {
      if (import.meta.env.DEV) console.error('Enhancement failed', error)
      setMessage(
        error.code === 'SESSION_EXPIRED' || error.status === 404 || error.status === 410
          ? 'This photo session has expired. Retake the photo to begin a new session.'
          : userMessageFor(error, 'The AI enhancement could not be completed. Please try again.'),
      )
      setPhase('enhance-error')
      onStatusChange?.('AI enhancement failed')
    } finally {
      busyRef.current = false
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/95 p-2 backdrop-blur-md sm:p-5" role="dialog" aria-modal="true" aria-labelledby="photo-session-title">
      <div className="mx-auto flex min-h-full max-w-4xl items-center justify-center">
        <section ref={modalRef} className="relative w-full overflow-hidden rounded-[1.75rem] border border-white/10 bg-[#11131a] p-4 shadow-2xl sm:p-7">
          <button
            type="button"
            className="absolute right-4 top-4 z-20 grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-black/30 text-xl text-slate-300 transition hover:bg-white/10 hover:text-white disabled:opacity-30"
            onClick={closeFlow}
            disabled={busyRef.current}
            aria-label="Close photo session"
          >
            ×
          </button>

          {phase === 'intro' && <PermissionIntro error={message || cameraError?.message} isStarting={isStarting} onContinue={openCamera} onCancel={closeFlow} />}

          {phase === 'camera' && (
            <div>
              <div className="mb-4 pr-12">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-rose-300">Live Camera</p>
                <h2 id="photo-session-title" className="mt-2 text-xl font-semibold text-white sm:text-2xl">Frame your best shot</h2>
              </div>
              {message && <p className="mb-4 rounded-xl bg-amber-300/10 p-3 text-sm text-amber-100" role="alert">{message}</p>}
              <CameraPreview
                stream={stream}
                facingMode={facingMode}
                canSwitch={cameraCount > 1}
                isSwitching={isStarting}
                onSwitch={() => switchCamera().catch((error) => setMessage(error.message))}
                onCapture={capturePhoto}
                onError={setMessage}
              />
            </div>
          )}

          {phase === 'captured' && (
            <div className="mx-auto max-w-2xl">
              <div className="mb-4 pr-12">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-rose-300">Photo Preview</p>
                <h2 id="photo-session-title" className="mt-2 text-xl font-semibold text-white sm:text-2xl">Keep this photo?</h2>
              </div>
              <img src={capturedUrl} alt="Your captured photo preview" className="max-h-[65dvh] w-full rounded-2xl bg-black object-contain" />
              <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button type="button" className="session-button-secondary" onClick={retakePhoto}>Retake</button>
                <button type="button" className="session-button-primary" onClick={acceptPhoto}>Use Photo</button>
              </div>
            </div>
          )}

          {phase === 'location' && (
            <div className="mx-auto max-w-lg py-8 text-center sm:py-14">
              {isLocating || isApproximating ? (
                <>
                  <span className="mx-auto block h-12 w-12 animate-spin rounded-full border-2 border-white/10 border-t-rose-400" />
                  <h2 id="photo-session-title" className="mt-6 text-2xl font-semibold text-white">
                    {isApproximating ? 'Estimating your location…' : 'Getting your location…'}
                  </h2>
                  <p className="mt-2 text-sm text-slate-400">
                    {isApproximating
                      ? 'Using the backend to estimate a city or region from your public IP.'
                      : 'Approve the browser prompt to attach precise coordinates to this session.'}
                  </p>
                </>
              ) : (
                <>
                  <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-amber-300/10 text-2xl">⌖</span>
                  <h2 id="photo-session-title" className="mt-5 text-2xl font-semibold text-white">Location needs attention</h2>
                  <p className="mt-3 text-sm leading-6 text-slate-300" role="alert">{message}</p>
                  <div className="mt-7 flex flex-col gap-3">
                    <button type="button" className="session-button-primary" onClick={acceptPhoto}>Retry Precise Location</button>
                    {locationError?.code === 'PERMISSION_DENIED' && (
                      <button type="button" className="session-button-secondary" onClick={useApproximateLocation}>Use Approximate Location</button>
                    )}
                    <button type="button" className="session-button-secondary" onClick={() => uploadPhoto(null)}>Continue Without Location</button>
                  </div>
                </>
              )}
            </div>
          )}

          {phase === 'uploading' && (
            <div className="mx-auto max-w-md py-10 text-center sm:py-16" role="status" aria-live="polite">
              <span className="mx-auto block h-14 w-14 animate-spin rounded-full border-2 border-white/10 border-t-rose-400" />
              <h2 id="photo-session-title" className="mt-6 text-2xl font-semibold text-white">{uploadLabel}</h2>
              <p className="mt-2 text-sm text-slate-400">Keep this window open until the original photo is secure.</p>
            </div>
          )}

          {phase === 'upload-error' && (
            <div className="mx-auto max-w-lg py-10 text-center">
              <h2 id="photo-session-title" className="text-2xl font-semibold text-white">Upload needs another try</h2>
              <p className="mt-3 text-sm leading-6 text-slate-300" role="alert">{message}</p>
              <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:justify-center">
                <button type="button" className="session-button-primary" onClick={() => uploadPhoto(location)}>Retry Upload</button>
                <button type="button" className="session-button-secondary" onClick={retakePhoto}>Retake Photo</button>
              </div>
            </div>
          )}

          {phase === 'ready' && (
            <div className="mx-auto max-w-2xl">
              <div className="mb-4 pr-12">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300">Upload Complete</p>
                <h2 id="photo-session-title" className="mt-2 text-2xl font-semibold text-white">Ready for a professional finish</h2>
                <p className="mt-2 text-sm text-slate-400">Your original photo is secure. Start enhancement when you are ready.</p>
              </div>
              <img src={capturedUrl} alt="Original photo ready for enhancement" className="max-h-[58dvh] w-full rounded-2xl bg-black object-contain" />
              <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button type="button" className="session-button-secondary" onClick={retakePhoto}>Retake</button>
                <button type="button" className="session-button-primary" onClick={enhancePhoto}>Enhance With AI</button>
              </div>
            </div>
          )}

          {phase === 'processing' && <EnhancementLoader status={processingStatus} />}

          {phase === 'enhance-error' && (
            <div className="mx-auto max-w-lg py-10 text-center">
              <h2 id="photo-session-title" className="text-2xl font-semibold text-white">Enhancement did not finish</h2>
              <p className="mt-3 text-sm leading-6 text-slate-300" role="alert">{message}</p>
              <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:justify-center">
                <button type="button" className="session-button-primary" onClick={enhancePhoto}>Try Enhancement Again</button>
                <button type="button" className="session-button-secondary" onClick={retakePhoto}>Retake Photo</button>
              </div>
            </div>
          )}

          {phase === 'result' && (
            <div>
              <div className="mb-5 pr-12">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300">Enhancement Complete</p>
                <h2 id="photo-session-title" className="mt-2 text-2xl font-semibold text-white">Original vs AI Enhanced</h2>
                <p className="mt-2 text-sm text-slate-400">Drag the slider to compare every detail.</p>
              </div>
              <PhotoComparison originalUrl={session.originalImageUrl || capturedUrl} enhancedUrl={session.enhancedImageUrl} />
              <ResultActions
                enhancedUrl={session.enhancedImageUrl}
                canEnhanceAgain={session.canEnhanceAgain}
                onEnhanceAgain={enhancePhoto}
                onRetake={retakePhoto}
              />
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
