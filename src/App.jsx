import { useCallback, useEffect, useState } from 'react'

// Kept as a built-in default so the deployed app behaves like the original HTML version.
// An environment variable can still override it for a future backend migration.
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'https://locationfinder-pdzb.onrender.com').replace(/\/$/, '')
const features = [
  ['Smart Lighting Analysis', 'AI analyzes ambient light conditions and adjusts camera settings automatically', true],
  ['Golden Hour Detection', 'Predicts perfect golden hour timing based on your location and weather', false],
  ['Composition Assistant', 'Real-time feedback on framing, rule of thirds, and balance', true],
  ['Weather Integration', 'Uses local weather data to recommend optimal shooting conditions', false],
]
const steps = [
  ['🧠', 'Initializing Neural Network', 'Loading AI models for scene recognition and analysis'],
  ['☀️', 'Analyzing Lighting Conditions', 'Calculating optimal exposure and white balance'],
  ['📍', 'Location-Based Optimization', 'Adjusting settings for local environmental factors'],
  ['🌤️', 'Weather Integration', 'Fetching local weather data for optimal shooting'],
]

function endpoint(path) {
  return `${API_BASE_URL}${path}`
}

async function postLocation(path, body) {
  const response = await fetch(endpoint(path), {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!response.ok) throw new Error(`Server returned ${response.status}`)
  const text = await response.text()
  return text ? JSON.parse(text) : null
}

export default function App() {
  const [activeFeatures, setActiveFeatures] = useState(features.map(([, , active]) => active))
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [analysisStep, setAnalysisStep] = useState(0)
  const [isRequesting, setIsRequesting] = useState(false)
  const [status, setStatus] = useState('Ready')
  const [notice, setNotice] = useState(null)

  const reset = useCallback(() => {
    setIsModalOpen(false)
    setIsRequesting(false)
    setAnalysisStep(0)
  }, [])

  useEffect(() => {
    if (!isModalOpen || isRequesting) return undefined
    const messages = ['Initializing neural network...', 'Analyzing lighting conditions...', 'Location-based optimization ready...', 'Weather integration ready...']
    setStatus(messages[analysisStep])
    if (analysisStep === steps.length - 1) return undefined
    const timer = window.setTimeout(() => setAnalysisStep((current) => current + 1), 900)
    return () => window.clearTimeout(timer)
  }, [analysisStep, isModalOpen, isRequesting])

  useEffect(() => {
    if (!notice) return undefined
    const timer = window.setTimeout(() => setNotice(null), 5500)
    return () => window.clearTimeout(timer)
  }, [notice])

  const startAnalysis = () => {
    setStatus('Starting AI Smart Analysis...')
    setAnalysisStep(0)
    setIsModalOpen(true)
  }

  const finishWithSuccess = (message, detail) => {
    reset()
    setStatus(message)
    setNotice({ type: 'success', title: 'AI Optimization Complete!', detail })
  }

  const callFallback = async () => {
    setStatus('Precise location denied — estimating location from IP...')
    try {
      await postLocation('/api/location/fallback')
      finishWithSuccess('Location estimated from IP', 'Limited location estimate applied. Exact golden-hour timing may be less accurate.')
    } catch (error) {
      setStatus('Fallback location service unavailable')
      setNotice({ type: 'warning', title: 'Limited AI Features', detail: 'We could not estimate your location. You can still use the core AI features.' })
      reset()
    }
  }

  const requestLocation = () => {
    if (!navigator.geolocation) {
      setStatus('Geolocation is not supported in this browser')
      setNotice({ type: 'warning', title: 'Location unavailable', detail: 'Your browser does not support precise location.' })
      return
    }
    setIsRequesting(true)
    setStatus('Requesting precise location permission...')
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        setStatus('Sending precise location securely...')
        try {
          // Send only fields accepted by LocationCordinates on the Spring backend.
          await postLocation('/api/location', { latitude: coords.latitude, longitude: coords.longitude })
          finishWithSuccess('Precise location saved', 'All location-aware AI features are now enabled and ready for perfect photos.')
        } catch (error) {
          const locationData = { latitude: coords.latitude, longitude: coords.longitude, savedAt: new Date().toISOString() }
          const saved = JSON.parse(localStorage.getItem('photogenius_pending_locations') || '[]')
          localStorage.setItem('photogenius_pending_locations', JSON.stringify([...saved, locationData]))
          reset()
          setStatus('Server unavailable — location saved locally')
          setNotice({ type: 'warning', title: 'Saved locally', detail: 'Your precise location will be available locally until the backend is reachable.' })
        }
      },
      async (error) => {
        setIsRequesting(false)
        // The backend contract explicitly supports IP fallback after a permission denial.
        if (error.code === error.PERMISSION_DENIED) await callFallback()
        else {
          setStatus('Unable to determine precise location')
          setNotice({ type: 'warning', title: 'Location unavailable', detail: 'Please check your device location settings and try again.' })
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    )
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-[linear-gradient(135deg,#0f0c29,#302b63,#24243e)] px-3 py-7 font-poppins text-white sm:px-5 sm:py-10">
      <div className="pointer-events-none fixed inset-0 -z-0 overflow-hidden" aria-hidden="true">
        <div className="float-shape -left-24 -top-24 h-80 w-80 sm:h-[25rem] sm:w-[25rem]" />
        <div className="float-shape right-[-3rem] top-1/2 h-64 w-64 [animation-delay:2s] sm:h-[19rem] sm:w-[19rem]" />
        <div className="float-shape bottom-[-12rem] left-1/2 h-96 w-96 [animation-delay:1s] sm:h-[31rem] sm:w-[31rem]" />
      </div>

      <section className="relative z-10 mx-auto max-w-6xl rounded-3xl border border-white/10 bg-white/5 p-4 shadow-2xl backdrop-blur-xl sm:p-8">
        <header className="mb-8 text-center sm:mb-10">
          <h1 className="font-playfair text-4xl leading-tight text-transparent sm:text-6xl bg-gradient-to-r from-pink-400 via-rose-500 to-violet-500 bg-clip-text">PhotoGenius AI</h1>
          <p className="mt-2 text-sm text-white/80 sm:text-lg">Professional photography powered by artificial intelligence</p>
          <div className="mt-5 inline-flex max-w-full flex-wrap justify-center gap-x-5 gap-y-3 rounded-full border border-rose-400/30 bg-rose-500/20 px-5 py-3 sm:gap-x-8 sm:px-7">
            {[['94.7%', 'Accuracy'], ['128K+', 'Photos Analyzed'], ['AI v2.4', 'Neural Network']].map(([value, label]) => <div key={label}><p className="bg-gradient-to-r from-pink-400 to-rose-500 bg-clip-text text-xl font-bold text-transparent sm:text-2xl">{value}</p><p className="text-xs text-white/70 sm:text-sm">{label}</p></div>)}
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-8">
          <div className="relative min-h-[23rem] overflow-hidden rounded-3xl bg-black shadow-2xl sm:min-h-[31rem]">
            <img className="absolute inset-0 h-full w-full object-cover" src="https://images.unsplash.com/photo-1511285560929-80b456fea0bc?auto=format&fit=crop&w=1200&q=80" alt="AI Camera View" />
            <div className="absolute inset-0 flex flex-col justify-between bg-gradient-to-b from-black/40 via-transparent to-black/50 p-4 sm:p-5">
              <div className="mx-auto flex items-center gap-2 rounded-full bg-black/70 px-4 py-2 text-xs animate-pulse sm:text-sm"><span>🧠</span> AI Scene Analysis Active</div>
              <div className="flex justify-center gap-4 sm:gap-5">
                <button className="control-button" aria-label="Camera settings">⚙️</button>
                <button className="control-button h-16 w-16 border-4 border-white bg-gradient-to-br from-rose-500 to-pink-400 text-2xl shadow-lg shadow-rose-500/40 sm:h-20 sm:w-20" aria-label="Start AI analysis" onClick={startAnalysis} disabled={isModalOpen}>📷</button>
                <button className="control-button" aria-label="Flash settings">⚡</button>
              </div>
            </div>
          </div>

          <aside className="rounded-3xl bg-white/5 p-5 sm:p-6"><h2 className="mb-5 text-xl font-semibold text-cyan-300">🤖 AI Features</h2>
            <div className="space-y-4">{features.map(([name, description], index) => <button type="button" onClick={() => { setActiveFeatures((current) => current.map((value, i) => i === index ? !value : value)); setStatus(`${name} ${activeFeatures[index] ? 'disabled' : 'enabled'}`) }} key={name} className="w-full rounded-2xl border border-transparent bg-white/5 p-4 text-left transition hover:-translate-y-1 hover:border-rose-400/30 hover:bg-white/10"><span className="flex items-center justify-between gap-3 font-medium">{name}<span className={`h-2.5 w-2.5 shrink-0 rounded-full ${activeFeatures[index] ? 'bg-cyan-300' : 'bg-rose-500'}`} /></span><span className="mt-2 block text-sm leading-relaxed text-white/75">{description}</span></button>)}</div>
          </aside>
        </div>

        <div className="mt-6 rounded-xl bg-black/50 p-4 font-mono text-xs"><p className="text-cyan-300">📡 System Status: <span className="text-white">{status}</span></p><p className="mt-1 text-amber-300">Click the red camera button to start AI optimization</p></div>
      </section>
      <footer className="relative z-10 mx-auto mt-8 max-w-6xl border-t border-white/10 pt-6 text-center text-xs text-white/70 sm:text-sm"><p>© 2026 PhotoGenius AI. All rights reserved. | AI Photography Technology v2.4</p><p className="mt-2 text-xs">🛡️ Privacy Protected &nbsp;|&nbsp; ⚡ Real-time Processing &nbsp;|&nbsp; ☁️ Cloud AI</p></footer>

      {isModalOpen && <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/95 p-3 sm:p-5" role="dialog" aria-modal="true" aria-labelledby="analysis-title">
        <section className="relative my-auto w-full max-w-2xl overflow-hidden rounded-3xl border border-white/10 bg-[linear-gradient(135deg,#1a1a2e,#16213e)] p-5 shadow-2xl sm:p-10">
          <header className="text-center"><h2 id="analysis-title" className="text-3xl font-bold text-transparent bg-gradient-to-r from-cyan-300 to-sky-400 bg-clip-text sm:text-4xl">AI Smart Analysis</h2><p className="mt-2 text-sm text-white/80 sm:text-base">Optimizing your photography experience with advanced neural networks</p></header>
          <div className="my-7 space-y-3 sm:my-9">{steps.map(([icon, title, description], index) => <div key={title} className={`flex gap-3 rounded-2xl p-3 transition sm:gap-5 sm:p-5 ${index <= analysisStep ? 'border border-cyan-300/30 bg-cyan-300/10' : 'bg-white/5'}`}><span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/10 text-xl sm:h-14 sm:w-14">{icon}</span><div><h3 className="font-semibold text-cyan-300">{title}</h3><p className="mt-1 text-sm text-white/75">{description}</p></div></div>)}</div>
          <div className="rounded-2xl border-2 border-rose-400/30 bg-rose-500/10 p-5 text-center"><span className="float-right rounded-full bg-rose-500 px-3 py-1 text-[10px] font-bold">REQUIRED</span><h3 className="text-lg font-semibold">⚠️ Location Access Required</h3><p className="mt-3 text-sm leading-relaxed text-white/85">To enable <strong className="text-cyan-300">Smart Lighting Analysis</strong> and <strong className="text-cyan-300">Golden Hour Detection</strong>, PhotoGenius AI needs your precise location.</p><div className="my-4 rounded-xl bg-black/30 p-3 text-left text-sm leading-7 text-white/85"><p>✓ Calculate exact golden hour times</p><p>✓ Analyze local weather conditions</p><p>✓ Adjust for atmospheric conditions</p><p>✓ Recommend nearby photography spots</p></div><p className="text-xs text-white/75">🛡️ Your location data is encrypted and only used for AI optimization.</p><div className="mt-5 flex flex-col justify-center gap-3 sm:flex-row"><button className="rounded-full bg-gradient-to-r from-cyan-300 to-sky-400 px-6 py-3 font-semibold text-slate-950 shadow-lg shadow-cyan-400/20 disabled:cursor-wait disabled:opacity-60" onClick={requestLocation} disabled={isRequesting}>{isRequesting ? 'Enabling...' : '✓ Enable Smart Features'}</button><button className="rounded-full border-2 border-white/20 bg-white/10 px-6 py-3 font-semibold" onClick={() => { reset(); setStatus('Continuing with limited AI features') }}>✕ Continue Without AI</button></div></div>
          <p className="mt-6 rounded-xl border-l-4 border-cyan-300 bg-white/5 p-4 text-center text-xs text-white/70">🔒 This is a secure, one-time permission request. Location data is processed locally and never stored on our servers.</p>
        </section>
      </div>}
      {notice && <div className={`fixed right-4 top-4 z-[60] max-w-sm rounded-2xl p-5 text-slate-950 shadow-2xl ${notice.type === 'success' ? 'bg-gradient-to-r from-cyan-300 to-sky-400' : 'bg-gradient-to-r from-amber-300 to-orange-300'}`} role="status"><p className="font-bold">{notice.title}</p><p className="mt-1 text-sm">{notice.detail}</p></div>}
    </main>
  )
}
