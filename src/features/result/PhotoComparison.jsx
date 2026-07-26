import { useState } from 'react'

export default function PhotoComparison({ originalUrl, enhancedUrl }) {
  const [position, setPosition] = useState(50)
  const [imageError, setImageError] = useState('')

  if (imageError) {
    return (
      <div className="grid min-h-72 place-items-center rounded-2xl border border-amber-300/20 bg-amber-300/5 p-8 text-center text-sm text-amber-100" role="alert">
        {imageError}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="relative aspect-[4/5] max-h-[68dvh] overflow-hidden rounded-2xl bg-slate-950 sm:aspect-[4/3]">
        <img
          src={originalUrl}
          alt="Original captured photo"
          className="absolute inset-0 h-full w-full object-contain"
          onError={() => setImageError('The original photo could not be loaded.')}
        />
        <div className="absolute inset-0 overflow-hidden" style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}>
          <img
            src={enhancedUrl}
            alt="AI enhanced photo"
            className="absolute inset-0 h-full w-full object-contain"
            onError={() => setImageError('The enhanced photo could not be loaded.')}
          />
        </div>
        <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow-lg" style={{ left: `${position}%` }}>
          <span className="absolute left-1/2 top-1/2 grid h-10 w-10 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-sm font-bold text-slate-900 shadow-xl">↔</span>
        </div>
        <span className="absolute left-3 top-3 rounded-full bg-black/65 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-white">AI Enhanced</span>
        <span className="absolute right-3 top-3 rounded-full bg-black/65 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-white">Original</span>
      </div>
      <label className="block">
        <span className="sr-only">Move the before and after comparison slider</span>
        <input
          className="comparison-range w-full"
          type="range"
          min="0"
          max="100"
          value={position}
          onChange={(event) => setPosition(Number(event.target.value))}
          aria-label="Before and after comparison"
        />
      </label>
    </div>
  )
}

