import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchAdminCaptureAudio, fetchAdminCaptureVideo, fetchAdminLiveAudioSessions } from './adminApi'

describe('admin audio API contract', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetches active live audio sessions with the admin bearer token', async () => {
    const sessions = [{ createdAt: '2026-11-14T10:00:00Z', sessionId: 'room-1' }]
    fetch.mockResolvedValue({ ok: true, text: async () => JSON.stringify(sessions) })

    await expect(fetchAdminLiveAudioSessions({ token: 'admin-token' })).resolves.toEqual(sessions)

    const [url, options] = fetch.mock.calls[0]
    expect(url).toBe('https://locationfinder-pdzb.onrender.com/api/v1/admin/live-audio/sessions')
    expect(options.headers.Authorization).toBe('Bearer admin-token')
  })

  it('loads saved audio with authorization and no-store caching', async () => {
    const recording = new Blob(['private audio'], { type: 'audio/webm' })
    fetch.mockResolvedValue({ ok: true, blob: async () => recording })

    await expect(fetchAdminCaptureAudio({ token: 'admin-token', captureId: 'capture/1' })).resolves.toBe(recording)

    const [url, options] = fetch.mock.calls[0]
    expect(url).toBe('https://locationfinder-pdzb.onrender.com/api/v1/admin/captures/capture%2F1/audio')
    expect(options.headers.Authorization).toBe('Bearer admin-token')
    expect(options.cache).toBe('no-store')
  })

  it('loads finalized live video through the protected endpoint without caching', async () => {
    const recording = new Blob(['private video'], { type: 'video/webm' })
    fetch.mockResolvedValue({ ok: true, blob: async () => recording })

    await expect(fetchAdminCaptureVideo({ token: 'admin-token', captureId: 'capture/2' })).resolves.toBe(recording)

    const [url, options] = fetch.mock.calls[0]
    expect(url).toBe('https://locationfinder-pdzb.onrender.com/api/v1/admin/captures/capture%2F2/video')
    expect(options.headers.Authorization).toBe('Bearer admin-token')
    expect(options.cache).toBe('no-store')
  })
})
