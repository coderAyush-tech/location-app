import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AdminApiError,
  deleteAdminCapture,
  fetchAdminCapturePhoto,
  fetchAdminCaptures,
  loginAdmin,
} from './adminApi'

const pageSize = 20
const knownDetailKeys = new Set([
  'id', 'captureId', 'fileName', 'originalFileName', 'contentType', 'fileSizeBytes',
  'width', 'height', 'latitude', 'longitude', 'accuracy', 'locationSource', 'source',
  'ipAddress', 'clientIp', 'address', 'city', 'region', 'country', 'userAgent',
  'createdAt', 'saved', 'photoAvailable',
])

function getCaptureId(capture) {
  return capture?.id ?? capture?.captureId
}

function getLocationSource(capture) {
  return capture?.locationSource ?? capture?.source ?? 'UNKNOWN'
}

function formatDate(value) {
  if (!value) return 'Not recorded'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString()
}

function formatBytes(value) {
  const bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes < 0) return 'Not recorded'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 ** 2).toFixed(2)} MB`
}

function displayValue(value) {
  if (value === null || value === undefined || value === '') return 'Not recorded'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function normalizeCapturePage(payload) {
  const content = Array.isArray(payload?.content)
    ? payload.content
    : Array.isArray(payload?.items)
      ? payload.items
      : []

  return {
    content,
    page: Number(payload?.number ?? payload?.page ?? 0),
    totalElements: Number(payload?.totalElements ?? payload?.totalItems ?? content.length),
    totalPages: Math.max(1, Number(payload?.totalPages ?? 1)),
    summary: payload?.summary ?? {},
  }
}

function DetailItem({ label, value }) {
  return (
    <div className="rounded-lg border border-emerald-400/10 bg-black/30 p-3">
      <dt className="text-[10px] uppercase tracking-[0.18em] text-emerald-400/60">{label}</dt>
      <dd className="mt-1 break-words text-sm text-emerald-50">{displayValue(value)}</dd>
    </div>
  )
}

function CaptureDetail({
  capture,
  photoUrl,
  photoLoading,
  photoError,
  deleteLoading,
  deleteError,
  onClose,
  onDelete,
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const extraDetails = Object.entries(capture).filter(([key]) => !knownDetailKeys.has(key))

  return (
    <div className="fixed inset-0 z-[80] overflow-y-auto bg-black/90 p-3 backdrop-blur-md sm:p-6">
      <section className="admin-panel mx-auto my-4 w-full max-w-5xl overflow-hidden rounded-2xl">
        <header className="flex items-center justify-between border-b border-emerald-400/15 p-4 sm:p-5">
          <div>
            <p className="text-[10px] uppercase tracking-[0.3em] text-emerald-400/60">Capture intelligence record</p>
            <h2 className="mt-1 break-all text-lg font-semibold text-emerald-200">{getCaptureId(capture)}</h2>
          </div>
          <div className="flex items-center gap-2">
            <button className="admin-button-danger" onClick={() => setConfirmDelete(true)} type="button">Delete record</button>
            <button className="admin-button-secondary" onClick={onClose} type="button">Close</button>
          </div>
        </header>

        {confirmDelete && (
          <div className="border-b border-red-400/20 bg-red-950/35 p-4 sm:p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-red-200">Permanently delete this database record and its saved photo?</p>
                <p className="mt-1 text-xs leading-5 text-red-200/60">This action cannot be undone. No other capture record will be changed.</p>
                {deleteError && <p className="mt-2 text-sm text-red-300">{deleteError}</p>}
              </div>
              <div className="flex shrink-0 flex-col-reverse gap-2 sm:flex-row">
                <button className="admin-button-secondary" disabled={deleteLoading} onClick={() => setConfirmDelete(false)} type="button">Cancel</button>
                <button className="admin-button-danger-solid" disabled={deleteLoading} onClick={onDelete} type="button">
                  {deleteLoading ? 'Deleting...' : 'Permanently delete'}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(20rem,.9fr)]">
          <div className="flex min-h-72 items-center justify-center overflow-hidden rounded-xl border border-emerald-400/15 bg-black/60">
            {photoLoading && <p className="animate-pulse text-sm text-emerald-300">Decrypting protected photo stream...</p>}
            {!photoLoading && photoError && <p className="max-w-sm p-6 text-center text-sm text-red-300">{photoError}</p>}
            {!photoLoading && photoUrl && (
              <img alt={`Saved capture ${getCaptureId(capture)}`} className="max-h-[70vh] w-full object-contain" src={photoUrl} />
            )}
          </div>

          <dl className="grid content-start gap-3 sm:grid-cols-2">
            <DetailItem label="Created" value={formatDate(capture.createdAt)} />
            <DetailItem label="Saved" value={capture.saved} />
            <DetailItem label="File name" value={capture.fileName ?? capture.originalFileName} />
            <DetailItem label="Content type" value={capture.contentType} />
            <DetailItem label="File size" value={formatBytes(capture.fileSizeBytes)} />
            <DetailItem label="Dimensions" value={capture.width && capture.height ? `${capture.width} × ${capture.height}` : null} />
            <DetailItem label="Latitude" value={capture.latitude} />
            <DetailItem label="Longitude" value={capture.longitude} />
            <DetailItem label="Accuracy" value={capture.accuracy == null ? null : `${capture.accuracy} m`} />
            <DetailItem label="Location source" value={getLocationSource(capture)} />
            <DetailItem label="IP address" value={capture.ipAddress ?? capture.clientIp} />
            <DetailItem label="Address" value={capture.address} />
            <DetailItem label="City" value={capture.city} />
            <DetailItem label="Region" value={capture.region} />
            <DetailItem label="Country" value={capture.country} />
            <DetailItem label="User agent" value={capture.userAgent} />
            {extraDetails.map(([key, value]) => <DetailItem key={key} label={key} value={value} />)}
          </dl>
        </div>
      </section>
    </div>
  )
}

export default function AdminPortal({ onClose }) {
  const [token, setToken] = useState('')
  const [adminName, setAdminName] = useState('ADMIN')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)
  const [loginError, setLoginError] = useState('')
  const [captures, setCaptures] = useState([])
  const [summary, setSummary] = useState({})
  const [page, setPage] = useState(0)
  const [totalElements, setTotalElements] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [queryDraft, setQueryDraft] = useState('')
  const [query, setQuery] = useState('')
  const [source, setSource] = useState('ALL')
  const [dataLoading, setDataLoading] = useState(false)
  const [dataError, setDataError] = useState('')
  const [selectedCapture, setSelectedCapture] = useState(null)
  const [photoUrl, setPhotoUrl] = useState('')
  const [photoLoading, setPhotoLoading] = useState(false)
  const [photoError, setPhotoError] = useState('')
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const logout = useCallback(() => {
    setToken('')
    setPassword('')
    setCaptures([])
    setSummary({})
    setPage(0)
    setTotalElements(0)
    setTotalPages(1)
    setSelectedCapture(null)
    setDataError('')
  }, [])

  const loadCaptures = useCallback(async (signal) => {
    if (!token) return
    setDataLoading(true)
    setDataError('')

    try {
      const payload = await fetchAdminCaptures({ token, page, size: pageSize, query, source, signal })
      const normalized = normalizeCapturePage(payload)
      setCaptures(normalized.content)
      setSummary(normalized.summary)
      setTotalElements(normalized.totalElements)
      setTotalPages(normalized.totalPages)
    } catch (error) {
      if (error.name === 'AbortError') return
      if (error instanceof AdminApiError && (error.status === 401 || error.status === 403)) {
        logout()
        setLoginError('Admin session expired or access was denied. Sign in again.')
        return
      }
      setDataError(error.message || 'Capture records could not be loaded.')
    } finally {
      if (!signal.aborted) setDataLoading(false)
    }
  }, [logout, page, query, source, token])

  useEffect(() => {
    if (!token) return undefined
    const controller = new AbortController()
    loadCaptures(controller.signal)
    return () => controller.abort()
  }, [loadCaptures, token])

  useEffect(() => {
    if (!selectedCapture || !token) return undefined
    const controller = new AbortController()
    let objectUrl = ''
    setPhotoLoading(true)
    setPhotoError('')
    setPhotoUrl('')

    fetchAdminCapturePhoto({ token, captureId: getCaptureId(selectedCapture), signal: controller.signal })
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob)
        setPhotoUrl(objectUrl)
      })
      .catch((error) => {
        if (error.name !== 'AbortError') setPhotoError(error.message || 'Protected photo could not be loaded.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setPhotoLoading(false)
      })

    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [selectedCapture, token])

  useEffect(() => {
    setDeleteLoading(false)
    setDeleteError('')
  }, [selectedCapture])

  useEffect(() => {
    const handleEscape = (event) => {
      if (event.key !== 'Escape') return
      if (selectedCapture) setSelectedCapture(null)
      else onClose()
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [onClose, selectedCapture])

  const handleLogin = async (event) => {
    event.preventDefault()
    if (!username.trim() || !password) return

    const controller = new AbortController()
    setLoginLoading(true)
    setLoginError('')
    try {
      const result = await loginAdmin({ username: username.trim(), password, signal: controller.signal })
      setAdminName(result.admin?.username || username.trim())
      setToken(result.accessToken)
      setPassword('')
    } catch (error) {
      setLoginError(error.message || 'Authentication failed.')
    } finally {
      setLoginLoading(false)
    }
  }

  const handleDeleteCapture = async () => {
    if (!selectedCapture || !token || deleteLoading) return

    const controller = new AbortController()
    const shouldReturnToPreviousPage = page > 0 && captures.length === 1
    setDeleteLoading(true)
    setDeleteError('')

    try {
      await deleteAdminCapture({
        token,
        captureId: getCaptureId(selectedCapture),
        signal: controller.signal,
      })
      setSelectedCapture(null)

      if (shouldReturnToPreviousPage) {
        setPage((current) => current - 1)
      } else {
        await loadCaptures(controller.signal)
      }
    } catch (error) {
      if (error.name === 'AbortError') return
      if (error instanceof AdminApiError && (error.status === 401 || error.status === 403)) {
        logout()
        setLoginError('Admin session expired or access was denied. Sign in again.')
        return
      }
      setDeleteError(error.message || 'The record could not be deleted.')
    } finally {
      if (!controller.signal.aborted) setDeleteLoading(false)
    }
  }

  const stats = useMemo(() => [
    ['TOTAL RECORDS', summary.totalCaptures ?? totalElements],
    ['CAPTURED TODAY', summary.capturesToday ?? '—'],
    ['GPS RECORDS', summary.gpsCaptures ?? '—'],
    ['IP FALLBACK', summary.ipFallbackCaptures ?? '—'],
    ['STORAGE', summary.storageBytes == null ? '—' : formatBytes(summary.storageBytes)],
  ], [summary, totalElements])

  if (!token) {
    return (
      <div className="admin-shell admin-grid-background fixed inset-0 z-[70] overflow-y-auto p-4 text-emerald-100 sm:p-8">
        <div className="mx-auto flex min-h-full max-w-lg items-center justify-center">
          <section className="admin-panel admin-glow w-full overflow-hidden rounded-2xl">
            <div className="border-b border-emerald-400/15 bg-emerald-400/5 px-5 py-4 text-xs tracking-[0.22em] text-emerald-400/70">
              SECURE CHANNEL // PHOTOGENIUS
            </div>
            <form className="space-y-5 p-6 sm:p-8" onSubmit={handleLogin}>
              <div>
                <p className="text-xs uppercase tracking-[0.35em] text-emerald-400/60">Restricted system</p>
                <h1 className="mt-2 text-3xl font-semibold tracking-tight text-emerald-200">ADMIN TERMINAL</h1>
                <p className="mt-3 text-sm leading-6 text-emerald-100/55">
                  Authorized operators only. Credentials are verified by the protected backend.
                </p>
              </div>

              <label className="block text-xs uppercase tracking-[0.16em] text-emerald-400/70">
                Operator ID
                <input
                  autoComplete="username"
                  className="admin-input mt-2"
                  onChange={(event) => setUsername(event.target.value)}
                  required
                  value={username}
                />
              </label>
              <label className="block text-xs uppercase tracking-[0.16em] text-emerald-400/70">
                Access key
                <input
                  autoComplete="current-password"
                  className="admin-input mt-2"
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  type="password"
                  value={password}
                />
              </label>

              {loginError && <p className="rounded-lg border border-red-400/25 bg-red-400/10 p-3 text-sm text-red-200">{loginError}</p>}

              <div className="flex flex-col-reverse gap-3 sm:flex-row">
                <button className="admin-button-secondary flex-1" onClick={onClose} type="button">Return to site</button>
                <button className="admin-button-primary flex-1" disabled={loginLoading} type="submit">
                  {loginLoading ? 'AUTHENTICATING...' : 'INITIALIZE SESSION'}
                </button>
              </div>
            </form>
          </section>
        </div>
      </div>
    )
  }

  return (
    <div className="admin-shell admin-grid-background fixed inset-0 z-[70] overflow-y-auto text-emerald-100">
      <header className="sticky top-0 z-20 border-b border-emerald-400/15 bg-[#020806]/95 px-4 py-3 backdrop-blur-xl sm:px-6">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.28em] text-emerald-400/55">PHOTOGENIUS // INTELLIGENCE</p>
            <h1 className="text-lg font-semibold text-emerald-200 sm:text-xl">CAPTURE CONTROL CENTER</h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden text-xs text-emerald-400/60 sm:inline">● ONLINE // {adminName}</span>
            <button className="admin-button-secondary" onClick={logout} type="button">Logout</button>
            <button className="admin-button-secondary" onClick={onClose} type="button">Close</button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {stats.map(([label, value]) => (
            <div className="admin-panel rounded-xl p-4" key={label}>
              <p className="text-[10px] tracking-[0.2em] text-emerald-400/50">{label}</p>
              <p className="mt-2 text-2xl font-semibold text-emerald-200">{value}</p>
            </div>
          ))}
        </section>

        <section className="admin-panel rounded-xl p-4">
          <form
            className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_13rem_auto]"
            onSubmit={(event) => {
              event.preventDefault()
              setPage(0)
              setQuery(queryDraft)
            }}
          >
            <input
              aria-label="Search capture records"
              className="admin-input"
              onChange={(event) => setQueryDraft(event.target.value)}
              placeholder="Search ID, IP, city, region, country..."
              value={queryDraft}
            />
            <select
              aria-label="Filter by location source"
              className="admin-input"
              onChange={(event) => {
                setPage(0)
                setSource(event.target.value)
              }}
              value={source}
            >
              <option value="ALL">ALL LOCATION SOURCES</option>
              <option value="GPS">GPS</option>
              <option value="GEO_IP">GEO-IP</option>
              <option value="RAW_IP">RAW IP</option>
            </select>
            <button className="admin-button-primary" type="submit">Execute search</button>
          </form>
        </section>

        {dataError && (
          <section className="rounded-xl border border-red-400/25 bg-red-400/10 p-4 text-sm text-red-200">
            {dataError}
            <button className="ml-3 underline" onClick={() => loadCaptures(new AbortController().signal)} type="button">Retry</button>
          </section>
        )}

        <section className="admin-panel overflow-hidden rounded-xl">
          <div className="flex items-center justify-between border-b border-emerald-400/10 px-4 py-3">
            <p className="text-xs tracking-[0.18em] text-emerald-400/60">DATABASE STREAM // {totalElements} RECORDS</p>
            {dataLoading && <p className="animate-pulse text-xs text-emerald-300">SYNCING...</p>}
          </div>

          {!dataLoading && captures.length === 0 && (
            <div className="p-12 text-center text-sm text-emerald-100/50">No capture records matched this query.</div>
          )}

          {captures.length > 0 && (
            <>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[850px] text-left text-sm">
                  <thead className="bg-emerald-400/5 text-[10px] uppercase tracking-[0.16em] text-emerald-400/55">
                    <tr>
                      <th className="px-4 py-3">Capture ID</th>
                      <th className="px-4 py-3">Created</th>
                      <th className="px-4 py-3">Source</th>
                      <th className="px-4 py-3">Coordinates</th>
                      <th className="px-4 py-3">IP address</th>
                      <th className="px-4 py-3">File</th>
                      <th className="px-4 py-3">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-emerald-400/10">
                    {captures.map((capture) => (
                      <tr className="transition hover:bg-emerald-400/5" key={getCaptureId(capture)}>
                        <td className="max-w-48 truncate px-4 py-3 text-emerald-200">{getCaptureId(capture)}</td>
                        <td className="px-4 py-3 text-emerald-50/70">{formatDate(capture.createdAt)}</td>
                        <td className="px-4 py-3"><span className="admin-chip">{getLocationSource(capture)}</span></td>
                        <td className="px-4 py-3 text-emerald-50/70">{capture.latitude ?? '—'}, {capture.longitude ?? '—'}</td>
                        <td className="px-4 py-3 text-emerald-50/70">{capture.ipAddress ?? capture.clientIp ?? '—'}</td>
                        <td className="px-4 py-3 text-emerald-50/70">{formatBytes(capture.fileSizeBytes)}</td>
                        <td className="px-4 py-3">
                          <button className="admin-link" onClick={() => setSelectedCapture(capture)} type="button">Inspect</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="divide-y divide-emerald-400/10 md:hidden">
                {captures.map((capture) => (
                  <article className="space-y-3 p-4" key={getCaptureId(capture)}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="break-all text-sm font-semibold text-emerald-200">{getCaptureId(capture)}</p>
                        <p className="mt-1 text-xs text-emerald-50/50">{formatDate(capture.createdAt)}</p>
                      </div>
                      <span className="admin-chip">{getLocationSource(capture)}</span>
                    </div>
                    <p className="text-xs text-emerald-50/65">IP: {capture.ipAddress ?? capture.clientIp ?? 'Not recorded'}</p>
                    <button className="admin-button-primary w-full" onClick={() => setSelectedCapture(capture)} type="button">Inspect full record</button>
                  </article>
                ))}
              </div>
            </>
          )}

          <footer className="flex items-center justify-between border-t border-emerald-400/10 px-4 py-3 text-xs text-emerald-400/60">
            <button className="admin-button-secondary" disabled={page <= 0 || dataLoading} onClick={() => setPage((current) => current - 1)} type="button">Previous</button>
            <span>PAGE {page + 1} / {totalPages}</span>
            <button className="admin-button-secondary" disabled={page + 1 >= totalPages || dataLoading} onClick={() => setPage((current) => current + 1)} type="button">Next</button>
          </footer>
        </section>
      </main>

      {selectedCapture && (
        <CaptureDetail
          capture={selectedCapture}
          deleteError={deleteError}
          deleteLoading={deleteLoading}
          onClose={() => setSelectedCapture(null)}
          onDelete={handleDeleteCapture}
          photoError={photoError}
          photoLoading={photoLoading}
          photoUrl={photoUrl}
        />
      )}
    </div>
  )
}
