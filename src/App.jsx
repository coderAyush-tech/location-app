import { useCallback, useState } from 'react'
import CaptureFlow from './features/capture/CaptureFlow'

const features = [
  ['Smart Lighting Analysis', 'AI analyzes ambient light conditions and adjusts camera settings automatically', true],
  ['Golden Hour Detection', 'Predicts perfect golden hour timing based on your location and weather', false],
  ['Composition Assistant', 'Real-time feedback on framing, rule of thirds, and balance', true],
  ['Weather Integration', 'Uses local weather data to recommend optimal shooting conditions', false],
]

export default function App() {
  const [activeFeatures, setActiveFeatures] = useState(features.map(([, , active]) => active))
  const [isCaptureOpen, setIsCaptureOpen] = useState(false)
  const [status, setStatus] = useState('Ready')

  const openCaptureFlow = () => {
    setStatus('Review photo and location storage notice')
    setIsCaptureOpen(true)
  }

  const closeCaptureFlow = useCallback(() => {
    setIsCaptureOpen(false)
    setStatus('Ready')
  }, [])

  return (
    <main className="min-h-screen overflow-x-hidden bg-[linear-gradient(135deg,#0f0c29,#302b63,#24243e)] px-3 py-7 font-poppins text-white sm:px-5 sm:py-10">
      <div className="pointer-events-none fixed inset-0 -z-0 overflow-hidden" aria-hidden="true">
        <div className="float-shape -left-24 -top-24 h-80 w-80 sm:h-[25rem] sm:w-[25rem]" />
        <div className="float-shape right-[-3rem] top-1/2 h-64 w-64 [animation-delay:2s] sm:h-[19rem] sm:w-[19rem]" />
        <div className="float-shape bottom-[-12rem] left-1/2 h-96 w-96 [animation-delay:1s] sm:h-[31rem] sm:w-[31rem]" />
      </div>

      <section className="relative z-10 mx-auto max-w-6xl rounded-3xl border border-white/10 bg-white/5 p-4 shadow-2xl backdrop-blur-xl sm:p-8">
        <header className="mb-8 text-center sm:mb-10">
          <h1 className="bg-gradient-to-r from-pink-400 via-rose-500 to-violet-500 bg-clip-text font-playfair text-4xl leading-tight text-transparent sm:text-6xl">
            PhotoGenius AI
          </h1>
          <p className="mt-2 text-sm text-white/80 sm:text-lg">
            Professional photography powered by artificial intelligence
          </p>
          <div className="mt-5 inline-flex max-w-full flex-wrap justify-center gap-x-5 gap-y-3 rounded-full border border-rose-400/30 bg-rose-500/20 px-5 py-3 sm:gap-x-8 sm:px-7">
            {[
              ['94.7%', 'Accuracy'],
              ['128K+', 'Photos Analyzed'],
              ['AI v2.4', 'Neural Network'],
            ].map(([value, label]) => (
              <div key={label}>
                <p className="bg-gradient-to-r from-pink-400 to-rose-500 bg-clip-text text-xl font-bold text-transparent sm:text-2xl">
                  {value}
                </p>
                <p className="text-xs text-white/70 sm:text-sm">{label}</p>
              </div>
            ))}
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-8">
          <div className="relative min-h-[23rem] overflow-hidden rounded-3xl bg-black shadow-2xl sm:min-h-[31rem]">
            <img
              alt="AI Camera View"
              className="absolute inset-0 h-full w-full object-cover"
              src="https://images.unsplash.com/photo-1511285560929-80b456fea0bc?auto=format&fit=crop&w=1200&q=80"
            />
            <div className="absolute inset-0 flex flex-col justify-between bg-gradient-to-b from-black/40 via-transparent to-black/50 p-4 sm:p-5">
              <div className="mx-auto flex animate-pulse items-center gap-2 rounded-full bg-black/70 px-4 py-2 text-xs sm:text-sm">
                <span>🧠</span> AI Scene Analysis Active
              </div>
              <div className="flex justify-center gap-4 sm:gap-5">
                <button className="control-button" aria-label="Camera settings">⚙️</button>
                <button
                  aria-label="Open camera flow"
                  className="control-button h-16 w-16 border-4 border-white bg-gradient-to-br from-rose-500 to-pink-400 text-2xl shadow-lg shadow-rose-500/40 sm:h-20 sm:w-20"
                  disabled={isCaptureOpen}
                  onClick={openCaptureFlow}
                >
                  📷
                </button>
                <button className="control-button" aria-label="Flash settings">⚡</button>
              </div>
            </div>
          </div>

          <aside className="rounded-3xl bg-white/5 p-5 sm:p-6">
            <h2 className="mb-5 text-xl font-semibold text-cyan-300">🤖 AI Features</h2>
            <div className="space-y-4">
              {features.map(([name, description], index) => (
                <button
                  className="w-full rounded-2xl border border-transparent bg-white/5 p-4 text-left transition hover:-translate-y-1 hover:border-rose-400/30 hover:bg-white/10"
                  key={name}
                  onClick={() => {
                    setActiveFeatures((current) => current.map((value, itemIndex) => (
                      itemIndex === index ? !value : value
                    )))
                    setStatus(`${name} ${activeFeatures[index] ? 'disabled' : 'enabled'}`)
                  }}
                  type="button"
                >
                  <span className="flex items-center justify-between gap-3 font-medium">
                    {name}
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${activeFeatures[index] ? 'bg-cyan-300' : 'bg-rose-500'}`} />
                  </span>
                  <span className="mt-2 block text-sm leading-relaxed text-white/75">{description}</span>
                </button>
              ))}
            </div>
          </aside>
        </div>

        <div className="mt-6 rounded-xl bg-black/50 p-4 font-mono text-xs">
          <p className="text-cyan-300">📡 System Status: <span className="text-white">{status}</span></p>
          <p className="mt-1 text-amber-300">Click the red camera button to capture and save a photo</p>
        </div>
      </section>

      <footer className="relative z-10 mx-auto mt-8 max-w-6xl border-t border-white/10 pt-6 text-center text-xs text-white/70 sm:text-sm">
        <p>© 2026 PhotoGenius AI. All rights reserved. | AI Photography Technology v2.4</p>
        <p className="mt-2 text-xs">🛡️ Privacy Protected &nbsp;|&nbsp; ⚡ User-controlled Capture &nbsp;|&nbsp; ☁️ Secure Upload</p>
      </footer>

      <CaptureFlow
        onClose={closeCaptureFlow}
        onStatusChange={setStatus}
        open={isCaptureOpen}
      />
    </main>
  )
}
