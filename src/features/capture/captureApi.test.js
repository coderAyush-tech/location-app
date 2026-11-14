import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { uploadCapture } from './captureApi'

function jsonResponse({ body, status = 201 }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  }
}

describe('live video capture upload API contract', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('sends photo, current-session credentials, explicit consent, and valid GPS without setting multipart Content-Type', async () => {
    fetch.mockResolvedValue(jsonResponse({ body: { id: 'one', saved: true, videoSaved: true, videoReady: false } }))
    const photoFile = new File(['photo'], 'camera.jpg', { type: 'image/jpeg' })

    await uploadCapture({
      photoFile,
      recordingSessionId: 'room-1',
      publishToken: 'temporary-token',
      location: { accuracy: 9.5, latitude: 28.6, longitude: 77.2 },
    })

    const [url, options] = fetch.mock.calls[0]
    expect(url).toBe('https://locationfinder-pdzb.onrender.com/api/v1/captures')
    expect(options.method).toBe('POST')
    expect(options.headers).toBeUndefined()
    expect(Array.from(options.body.keys())).toEqual([
      'photo', 'recordingSessionId', 'publishToken', 'cameraConsentConfirmed',
      'microphoneConsentConfirmed', 'latitude', 'longitude', 'accuracy',
    ])
    expect(options.body.get('photo')).toBe(photoFile)
    expect(options.body.get('recordingSessionId')).toBe('room-1')
    expect(options.body.get('publishToken')).toBe('temporary-token')
    expect(options.body.get('cameraConsentConfirmed')).toBe('true')
    expect(options.body.get('microphoneConsentConfirmed')).toBe('true')
    expect(options.body.get('accuracy')).toBe('9.5')
    expect(options.body.has('video')).toBe(false)
    expect(options.body.has('audio')).toBe(false)
  })

  it('omits every GPS field if location is missing or invalid', async () => {
    fetch.mockResolvedValue(jsonResponse({ body: { saved: true, videoSaved: true, videoReady: false } }))
    const photoFile = new File(['photo'], 'camera.jpg', { type: 'image/jpeg' })

    await uploadCapture({ photoFile, recordingSessionId: 'room-1', publishToken: 'token', location: null })
    expect(Array.from(fetch.mock.calls[0][1].body.keys())).toEqual([
      'photo', 'recordingSessionId', 'publishToken', 'cameraConsentConfirmed', 'microphoneConsentConfirmed',
    ])

    await uploadCapture({
      photoFile,
      recordingSessionId: 'room-1',
      publishToken: 'token',
      location: { accuracy: 4 },
    })
    expect(Array.from(fetch.mock.calls[1][1].body.keys())).toEqual([
      'photo', 'recordingSessionId', 'publishToken', 'cameraConsentConfirmed', 'microphoneConsentConfirmed',
    ])
  })

  it('requires a session and publish token and never sends accumulated video/audio blobs', async () => {
    const photoFile = new File(['photo'], 'camera.jpg', { type: 'image/jpeg' })
    await expect(uploadCapture({ photoFile })).rejects.toThrow('Start the consented live recording')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('accepts success only when HTTP 201, saved, and videoSaved are confirmed', async () => {
    const photoFile = new File(['photo'], 'camera.jpg', { type: 'image/jpeg' })
    const credentials = { recordingSessionId: 'room-1', publishToken: 'token' }
    fetch.mockResolvedValueOnce(jsonResponse({ body: { saved: true, videoSaved: true }, status: 200 }))
    await expect(uploadCapture({ photoFile, ...credentials })).rejects.toThrow('did not confirm')

    fetch.mockResolvedValueOnce(jsonResponse({ body: { saved: true, videoSaved: false }, status: 201 }))
    await expect(uploadCapture({ photoFile, ...credentials })).rejects.toThrow('did not confirm')

    fetch.mockResolvedValueOnce(jsonResponse({ body: { saved: true, videoSaved: true, videoReady: false }, status: 201 }))
    await expect(uploadCapture({ photoFile, ...credentials })).resolves.toEqual({ saved: true, videoSaved: true, videoReady: false })
  })
})
