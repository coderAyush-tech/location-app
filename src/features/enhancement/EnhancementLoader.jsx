const visualSteps = [
  'Improving lighting',
  'Refining clarity',
  'Balancing colors',
  'Preserving your natural look',
]

export default function EnhancementLoader({ status }) {
  return (
    <div className="mx-auto max-w-md py-8 text-center sm:py-14" role="status" aria-live="polite">
      <div className="relative mx-auto grid h-24 w-24 place-items-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-rose-400/15" />
        <span className="absolute inset-2 animate-spin rounded-full border-2 border-white/10 border-t-rose-400" />
        <span className="grid h-14 w-14 place-items-center rounded-full bg-white/[0.06] text-xl">AI</span>
      </div>
      <h2 className="mt-7 text-2xl font-semibold text-white">Enhancing your photo…</h2>
      <p className="mt-2 text-sm text-slate-400">
        {status ? `Session status: ${status.replaceAll('_', ' ').toLowerCase()}` : 'This can take a little while.'}
      </p>
      <div className="mt-7 grid grid-cols-2 gap-2 text-left">
        {visualSteps.map((step) => (
          <div key={step} className="rounded-xl border border-white/10 bg-white/[0.035] px-3 py-3 text-xs text-slate-300">
            <span className="mr-2 text-rose-300">•</span>{step}
          </div>
        ))}
      </div>
      <p className="mt-6 text-xs leading-5 text-slate-500">
        These messages describe the visual experience; actual processing is performed by the backend.
      </p>
    </div>
  )
}

