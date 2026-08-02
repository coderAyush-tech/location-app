import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { uploadCapture } from './captureApi'

function jsonResponse({ body, status = 201 }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  }
}

describe('capture upload API contract', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends only the photo when GPS is missing and does not set Content-Type', async () => {
    fetch.mockResolvedValue(jsonResponse({ body: { id: 'one', saved: true } }))
    const photoFile = new File(['photo'], 'camera.jpg', { type: 'image/jpeg' })

    await uploadCapture({ photoFile, location: null })

    const [url, options] = fetch.mock.calls[0]
    expect(url).toBe('https://locationfinder-pdzb.onrender.com/api/v1/captures')
    expect(options.method).toBe('POST')
    expect(options.headers).toBeUndefined()
    expect(Array.from(options.body.keys())).toEqual(['photo'])
    expect(options.body.get('photo')).toBe(photoFile)
  })

  it('sends all GPS fields only when coordinates are valid', async () => {
    fetch.mockResolvedValue(jsonResponse({ body: { saved: true } }))
    const photoFile = new File(['photo'], 'camera.jpg', { type: 'image/jpeg' })

    await uploadCapture({
      photoFile,
      location: { accuracy: 9.5, latitude: 28.6, longitude: 77.2 },
    })

    const formData = fetch.mock.calls[0][1].body
    expect(Array.from(formData.keys())).toEqual([
      'photo',
      'latitude',
      'longitude',
      'accuracy',
    ])
    expect(formData.get('latitude')).toBe('28.6')
    expect(formData.get('longitude')).toBe('77.2')
    expect(formData.get('accuracy')).toBe('9.5')
  })

  it('never sends accuracy without latitude and longitude', async () => {
    fetch.mockResolvedValue(jsonResponse({ body: { saved: true } }))
    const photoFile = new File(['photo'], 'camera.jpg', { type: 'image/jpeg' })

    await uploadCapture({ photoFile, location: { accuracy: 5 } })

    expect(Array.from(fetch.mock.calls[0][1].body.keys())).toEqual(['photo'])
  })

  it('accepts success only for HTTP 201 with saved true', async () => {
    const photoFile = new File(['photo'], 'camera.jpg', { type: 'image/jpeg' })
    fetch.mockResolvedValueOnce(jsonResponse({ body: { saved: true }, status: 200 }))
    await expect(uploadCapture({ photoFile })).rejects.toThrow('did not confirm')

    fetch.mockResolvedValueOnce(jsonResponse({ body: { saved: false }, status: 201 }))
    await expect(uploadCapture({ photoFile })).rejects.toThrow('did not confirm')

    fetch.mockResolvedValueOnce(jsonResponse({ body: { saved: true }, status: 201 }))
    await expect(uploadCapture({ photoFile })).resolves.toEqual({ saved: true })
  })
})
