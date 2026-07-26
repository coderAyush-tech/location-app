export default function PermissionIntro({ error, isStarting, onContinue, onCancel }) {
  return (
    <div className="mx-auto max-w-lg px-1 py-3 sm:px-4 sm:py-6">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-rose-300">Photo Session</p>
      <h2 id="photo-session-title" className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
        Before we open your camera
      </h2>
      <p className="mt-3 text-sm leading-6 text-slate-300">
        You stay in control. We ask for each permission only when it is needed.
      </p>

      <div className="mt-7 space-y-3">
        <div className="flex gap-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-rose-400/10 text-xl" aria-hidden="true">⌁</span>
          <div>
            <h3 className="font-semibold text-white">Camera</h3>
            <p className="mt-1 text-sm leading-5 text-slate-400">Required to preview and capture your photo.</p>
          </div>
          <span className="ml-auto text-xs font-medium text-rose-300">Required</span>
        </div>
        <div className="flex gap-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-sky-400/10 text-xl" aria-hidden="true">⌖</span>
          <div>
            <h3 className="font-semibold text-white">Location</h3>
            <p className="mt-1 text-sm leading-5 text-slate-400">Requested after capture to associate the photo session with its location.</p>
          </div>
          <span className="ml-auto text-xs font-medium text-slate-400">Later</span>
        </div>
      </div>

      {error && (
        <div className="mt-5 rounded-xl border border-amber-300/25 bg-amber-300/10 p-4 text-sm leading-6 text-amber-100" role="alert">
          {error}
        </div>
      )}

      <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <button type="button" className="session-button-secondary" onClick={onCancel}>Cancel</button>
        <button type="button" className="session-button-primary" onClick={onContinue} disabled={isStarting} autoFocus>
          {isStarting ? 'Opening camera…' : error ? 'Try camera again' : 'Continue'}
        </button>
      </div>
      <p className="mt-4 text-center text-xs leading-5 text-slate-500">
        Camera access works only over HTTPS or on localhost.
      </p>
    </div>
  )
}

