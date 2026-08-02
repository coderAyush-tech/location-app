import { useCallback, useEffect, useRef, useState } from 'react'
import AdminPortal from './features/admin/AdminPortal'
import CaptureFlow from './features/capture/CaptureFlow'

const features = [
  ['Smart Lighting Analysis', 'Reviews ambient light and helps balance exposure before you capture.', true],
  ['Golden Hour Detection', 'Uses your optional location to identify naturally flattering light windows.', false],
  ['Composition Assistant', 'Keeps framing, subject balance, and rule-of-thirds guidance in view.', true],
  ['Weather Integration', 'Adds local shooting context when location and weather data are available.', false],
]

function SettingsIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="20" viewBox="0 0 24 24" width="20">
      <path d="M12 15.25A3.25 3.25 0 1 0 12 8.75a3.25 3.25 0 0 0 0 6.5Z" stroke="currentColor" strokeWidth="1.6" />
      <path d="M19.4 13.5a7.8 7.8 0 0 0 0-3l2-1.55-2-3.45-2.46 1a8 8 0 0 0-2.58-1.5L14 2.4h-4L9.64 5a8 8 0 0 0-2.58 1.5l-2.46-1-2 3.45 2 1.55a7.8 7.8 0 0 0 0 3l-2 1.55 2 3.45 2.46-1A8 8 0 0 0 9.64 19l.36 2.6h4l.36-2.6a8 8 0 0 0 2.58-1.5l2.46 1 2-3.45-2-1.55Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.4" />
    </svg>
  )
}

function FlashIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="21" viewBox="0 0 24 24" width="21">
      <path d="m13.2 2-7 11h5.2L10.8 22l7-12h-5.2l.6-8Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.7" />
    </svg>
  )
}

function CameraIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="28" viewBox="0 0 24 24" width="28">
      <path d="M4.5 7.5h3l1.3-2h6.4l1.3 2h3A1.5 1.5 0 0 1 21 9v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18V9a1.5 1.5 0 0 1 1.5-1.5Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" />
      <circle cx="12" cy="13.5" r="3.6" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

export default function App() {
  const [activeFeatures, setActiveFeatures] = useState(features.map(([, , active]) => active))
  const [isCaptureOpen, setIsCaptureOpen] = useState(false)
  const [isAdminOpen, setIsAdminOpen] = useState(false)
  const [status, setStatus] = useState('Camera standby')
  const adminTapRef = useRef({ count: 0, firstTapAt: 0, resetTimer: null })

  useEffect(() => () => {
    window.clearTimeout(adminTapRef.current.resetTimer)
  }, [])

  const handleLogoTap = () => {
    const now = Date.now()
    const tapState = adminTapRef.current

    if (!tapState.firstTapAt || now - tapState.firstTapAt > 3_000) {
      tapState.count = 0
      tapState.firstTapAt = now
    }

    tapState.count += 1
    window.clearTimeout(tapState.resetTimer)
    tapState.resetTimer = window.setTimeout(() => {
      tapState.count = 0
      tapState.firstTapAt = 0
    }, 3_000)

    if (tapState.count >= 5) {
      window.clearTimeout(tapState.resetTimer)
      tapState.count = 0
      tapState.firstTapAt = 0
      setIsAdminOpen(true)
    }
  }

  const openCaptureFlow = () => {
    setStatus('Review photo and location storage notice')
    setIsCaptureOpen(true)
  }

  const closeCaptureFlow = useCallback(() => {
    setIsCaptureOpen(false)
    setStatus('Camera standby')
  }, [])

  return (
    <main className="studio-page min-h-screen overflow-x-hidden px-4 py-5 font-poppins text-[#20231f] sm:px-6 sm:py-8">
      <section className="relative z-10 mx-auto max-w-7xl">
        <header className="flex flex-col gap-5 border-b border-black/10 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-[#8b4c3b]">AI-assisted photography studio</p>
            <h1
              className="mt-2 select-none font-playfair text-4xl leading-none tracking-[-0.035em] text-[#1d241f] sm:text-6xl"
              onClick={handleLogoTap}
            >
              PhotoGenius <span className="italic text-[#a34835]">AI</span>
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[#5f645f] sm:text-base">
              A private, user-controlled camera experience for thoughtful portraits and natural moments.
            </p>
          </div>
          <div className="inline-flex w-fit items-center gap-3 rounded-full border border-[#294a3d]/15 bg-white/70 px-4 py-2 text-xs font-semibold text-[#294a3d] shadow-sm backdrop-blur">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#587c68] opacity-40" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#426b56]" />
            </span>
            Ready when you are
          </div>
        </header>

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section className="overflow-hidden rounded-[1.75rem] border border-black/10 bg-[#171a18] shadow-[0_24px_70px_rgba(39,38,31,.18)]">
            <div className="relative min-h-[31rem] overflow-hidden sm:min-h-[39rem]">
              <img
                alt="Professional portrait photography reference"
                className="absolute inset-0 h-full w-full object-cover"
                src="https://images.unsplash.com/photo-1511285560929-80b456fea0bc?auto=format&fit=crop&w=1600&q=88"
              />
              <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(7,9,8,.52)_0%,transparent_35%,transparent_58%,rgba(7,9,8,.8)_100%)]" />
              <div className="camera-grid absolute inset-0 opacity-45" aria-hidden="true" />
              <div className="focus-frame absolute left-1/2 top-[45%] h-36 w-28 -translate-x-1/2 -translate-y-1/2 rounded-sm sm:h-48 sm:w-40" aria-hidden="true" />

              <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-3 p-4 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/80 sm:p-6">
                <span className="rounded-full border border-white/20 bg-black/35 px-3 py-2 backdrop-blur-md">Reference frame</span>
                <span className="rounded-full border border-white/20 bg-black/35 px-3 py-2 backdrop-blur-md">Natural light · Auto</span>
              </div>

              <div className="absolute inset-x-0 bottom-0 p-4 sm:p-6">
                <div className="mb-5 flex items-end justify-between gap-4 text-white">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.22em] text-white/55">Portrait reference</p>
                    <p className="mt-1 font-playfair text-2xl">Warm light, honest detail</p>
                  </div>
                  <div className="hidden text-right font-mono text-[10px] leading-5 text-white/55 sm:block">
                    <p>35 MM · AUTO ISO</p>
                    <p>GRID · FACE PRIORITY</p>
                  </div>
                </div>

                <div className="flex items-center justify-center gap-5 rounded-2xl border border-white/10 bg-black/35 px-4 py-4 backdrop-blur-xl sm:gap-8">
                  <button className="studio-control-button" aria-label="Camera settings" type="button"><SettingsIcon /></button>
                  <button
                    aria-label="Open camera flow"
                    className="studio-shutter-button"
                    disabled={isCaptureOpen}
                    onClick={openCaptureFlow}
                    type="button"
                  >
                    <CameraIcon />
                  </button>
                  <button className="studio-control-button" aria-label="Flash settings" type="button"><FlashIcon /></button>
                </div>
              </div>
            </div>
          </section>

          <aside className="rounded-[1.75rem] border border-black/10 bg-white/75 p-5 shadow-[0_18px_55px_rgba(45,43,36,.1)] backdrop-blur-sm sm:p-6">
            <div className="border-b border-black/10 pb-5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#a34835]">Photography assistant</p>
              <h2 className="mt-2 font-playfair text-3xl text-[#20231f]">Shape the moment.</h2>
              <p className="mt-2 text-sm leading-6 text-[#6b6f69]">Choose the guidance you want. Your camera still opens only after your visible action.</p>
            </div>

            <div className="mt-4 space-y-2.5">
              {features.map(([name, description], index) => (
                <button
                  aria-pressed={activeFeatures[index]}
                  className={`w-full rounded-xl border p-3.5 text-left transition sm:p-4 ${activeFeatures[index] ? 'border-[#466b58]/20 bg-[#eaf0eb]' : 'border-black/8 bg-white/55 hover:border-black/15'}`}
                  key={name}
                  onClick={() => {
                    setActiveFeatures((current) => current.map((value, itemIndex) => (
                      itemIndex === index ? !value : value
                    )))
                    setStatus(`${name} ${activeFeatures[index] ? 'disabled' : 'enabled'}`)
                  }}
                  type="button"
                >
                  <span className="flex items-start justify-between gap-3">
                    <span>
                      <span className="block text-sm font-semibold text-[#2f342f]">{name}</span>
                      <span className="mt-1.5 block text-xs leading-5 text-[#737770]">{description}</span>
                    </span>
                    <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${activeFeatures[index] ? 'bg-[#426b56] shadow-[0_0_0_4px_rgba(66,107,86,.12)]' : 'bg-[#c6c5be]'}`} />
                  </span>
                </button>
              ))}
            </div>

            <div className="mt-5 rounded-xl border border-[#a34835]/15 bg-[#f4ebe6] p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#8b4c3b]">Privacy by design</p>
              <p className="mt-2 text-xs leading-5 text-[#6b5b53]">No hidden capture or automatic upload. GPS remains optional, and every upload needs your confirmation.</p>
            </div>
          </aside>
        </div>

        <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-black/10 bg-white/65 px-4 py-3.5 text-xs shadow-sm sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <p className="flex items-center gap-2 font-semibold text-[#32473a]">
            <span className="h-2 w-2 rounded-full bg-[#426b56]" />
            System status: <span className="font-normal text-[#5f645f]">{status}</span>
          </p>
          <p className="text-[#777b74]">Photo and optional GPS are sent only after Capture &amp; Upload.</p>
        </div>
      </section>

      <footer className="relative z-10 mx-auto mt-8 flex max-w-7xl flex-col gap-2 border-t border-black/10 pt-5 text-xs text-[#747970] sm:flex-row sm:items-center sm:justify-between">
        <p>© 2026 PhotoGenius AI. Thoughtful photography, controlled by you.</p>
        <p>Private capture · Optional location · Secure upload</p>
      </footer>

      <CaptureFlow
        onClose={closeCaptureFlow}
        onStatusChange={setStatus}
        open={isCaptureOpen}
      />
      {isAdminOpen && <AdminPortal onClose={() => setIsAdminOpen(false)} />}
    </main>
  )
}
