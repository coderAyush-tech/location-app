import { useEffect, useRef } from 'react'
import { captureFrame } from './useCamera'

export default function CameraPreview({
  stream,
  facingMode,
  canSwitch,
  isSwitching,
  onSwitch,
  onCapture,
  onError,
}) {
  const videoRef = useRef(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video || !stream) return undefined
    video.srcObject = stream
    video.play().catch(() => onError?.('The camera preview could not be started.'))
    return () => {
      video.srcObject = null
    }
  }, [onError, stream])

  const takePhoto = async () => {
    try {
      const file = await captureFrame(videoRef.current, { mirror: facingMode === 'user' })
      onCapture(file)
    } catch (error) {
      onError(error.message)
    }
  }

  return (
    <div className="relative aspect-[3/4] max-h-[72dvh] w-full overflow-hidden rounded-[1.75rem] bg-slate-950 sm:aspect-[4/3]">
      <video
        ref={videoRef}
        className={`h-full w-full object-cover ${facingMode === 'user' ? '-scale-x-100' : ''}`}
        playsInline
        muted
        aria-label="Live camera preview"
      />
      <div className="pointer-events-none absolute inset-0 border-[1px] border-white/10 shadow-[inset_0_0_80px_rgba(0,0,0,.38)]" />
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-6 bg-gradient-to-t from-black/80 via-black/30 to-transparent px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-14">
        <button
          type="button"
          className="grid h-12 w-12 place-items-center rounded-full border border-white/25 bg-black/45 text-xl text-white backdrop-blur disabled:cursor-not-allowed disabled:opacity-40"
          onClick={onSwitch}
          disabled={!canSwitch || isSwitching}
          aria-label={canSwitch ? 'Switch camera' : 'Only one camera is available'}
        >
          ↻
        </button>
        <button
          type="button"
          className="grid h-[4.5rem] w-[4.5rem] place-items-center rounded-full border-[5px] border-white bg-rose-500 shadow-[0_8px_25px_rgba(244,63,94,.38)] transition active:scale-95"
          onClick={takePhoto}
          aria-label="Capture photo"
        >
          <span className="h-10 w-10 rounded-full border-2 border-white/70" />
        </button>
        <span className="grid h-12 w-12 place-items-center text-center text-[10px] font-medium uppercase tracking-wider text-white/70">
          {facingMode === 'user' ? 'Front' : 'Back'}
        </span>
      </div>
    </div>
  )
}

