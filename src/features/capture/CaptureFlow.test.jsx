import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import CaptureFlow from './CaptureFlow'
import { uploadCapture } from './captureApi'

vi.mock('./captureApi', () => ({ uploadCapture: vi.fn() }))

function createDeferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function createStream(events = []) {
  const videoTrack = new EventTarget()
  const audioTrack = new EventTarget()
  videoTrack.kind = 'video'
  audioTrack.kind = 'audio'
  videoTrack.readyState = 'live'
  audioTrack.readyState = 'live'
  const videoStop = vi.fn(() => { events.push('video-track-stop'); videoTrack.readyState = 'ended' })
  const audioStop = vi.fn(() => { events.push('audio-track-stop'); audioTrack.readyState = 'ended' })
  videoTrack.stop = videoStop
  audioTrack.stop = audioStop
  return {
    stop: vi.fn(),
    tracks: [videoTrack, audioTrack],
    videoStop,
    audioStop,
    stream: {
      getTracks: () => [videoTrack, audioTrack],
      getVideoTracks: () => [videoTrack],
      getAudioTracks: () => [audioTrack],
    },
  }
}

function installLiveVideoRuntime(events = []) {
  const sockets = []
  const recorders = []

  class MockWebSocket {
    static CONNECTING = 0
    static OPEN = 1
    static CLOSING = 2
    static CLOSED = 3

    constructor(url) {
      this.url = url
      this.readyState = MockWebSocket.CONNECTING
      this.bufferedAmount = 0
      this.sent = []
      sockets.push(this)
      queueMicrotask(() => {
        if (this.readyState !== MockWebSocket.CONNECTING) return
        this.readyState = MockWebSocket.OPEN
        this.onopen?.(new Event('open'))
      })
    }

    send(value) {
      this.sent.push(value)
      if (value instanceof ArrayBuffer) events.push('video-frame')
    }

    close() {
      if (this.readyState === MockWebSocket.CLOSED) return
      this.readyState = MockWebSocket.CLOSED
      this.onclose?.(new Event('close'))
    }

    disconnect() {
      this.readyState = MockWebSocket.CLOSED
      this.onerror?.(new Event('error'))
      this.onclose?.(new Event('close'))
    }
  }

  class MockMediaRecorder extends EventTarget {
    static isTypeSupported = (type) => type === 'video/webm;codecs=vp8,opus'

    constructor(stream, options = {}) {
      super()
      this.stream = stream
      this.mimeType = options.mimeType || ''
      this.state = 'inactive'
      this.timeslice = 0
      this.finalChunk = null
      recorders.push(this)
    }

    start(timeslice) {
      this.state = 'recording'
      this.timeslice = timeslice
    }

    stop() {
      if (this.state === 'inactive') return
      if (this.finalChunk) this.emitChunk(this.finalChunk)
      this.state = 'inactive'
      const event = new Event('stop')
      this.onstop?.(event)
      this.dispatchEvent(event)
    }

    pause() { this.state = 'paused' }
    resume() { this.state = 'recording' }

    emitChunk(blob) {
      const event = { data: blob }
      this.ondataavailable?.(event)
      this.dispatchEvent(Object.assign(new Event('dataavailable'), { data: blob }))
    }
  }

  vi.stubGlobal('WebSocket', MockWebSocket)
  vi.stubGlobal('MediaRecorder', MockMediaRecorder)
  return { recorders, sockets }
}

function mockLiveVideoRequests(events = []) {
  const requests = []
  vi.stubGlobal('fetch', vi.fn(async (url, options) => {
    requests.push({ url, options })
    if (options.method === 'POST') {
      return {
        ok: true,
        status: 201,
        text: async () => JSON.stringify({ publishToken: 'publisher-secret', sessionId: 'room-1' }),
      }
    }
    if (options.method === 'DELETE') events.push('room-delete')
    return { ok: true, status: 204, text: async () => '' }
  }))
  return requests
}

function setBrowserMedia({ mediaPromise, permissionState = 'prompt' } = {}) {
  const getUserMedia = vi.fn(() => mediaPromise ?? Promise.resolve(createStream().stream))
  const getCurrentPosition = vi.fn()
  const query = vi.fn().mockResolvedValue({ state: permissionState })
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition } })
  Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query } })
  return { getCurrentPosition, getUserMedia, query }
}

function renderFlow(overrides = {}) {
  const props = { onClose: vi.fn(), onStatusChange: vi.fn(), open: true, ...overrides }
  return { ...render(<CaptureFlow {...props} />), props }
}

async function startLiveSession({ permissionState = 'prompt', events = [] } = {}) {
  const runtime = installLiveVideoRuntime(events)
  const requests = mockLiveVideoRequests(events)
  const media = createStream(events)
  const browser = setBrowserMedia({ mediaPromise: Promise.resolve(media.stream), permissionState })
  const rendered = renderFlow()
  fireEvent.click(screen.getByRole('button', { name: 'I agree / Start camera and mic' }))
  await screen.findByText('REC LIVE')
  return { ...media, ...browser, ...rendered, requests, runtime, events }
}

function prepareVideoCapture() {
  const video = screen.getByLabelText('Live front camera preview')
  Object.defineProperties(video, {
    readyState: { configurable: true, value: 4 },
    videoHeight: { configurable: true, value: 480 },
    videoWidth: { configurable: true, value: 640 },
  })
  const originalCreateElement = document.createElement.bind(document)
  const context = { drawImage: vi.fn(), scale: vi.fn(), translate: vi.fn() }
  const canvas = {
    getContext: () => context,
    height: 0,
    toBlob: (callback) => callback(new Blob(['photo'], { type: 'image/jpeg' })),
    width: 0,
  }
  vi.spyOn(document, 'createElement').mockImplementation((tagName, options) => (
    tagName === 'canvas' ? canvas : originalCreateElement(tagName, options)
  ))
}

describe('consented unlimited live camera and microphone flow', () => {
  beforeEach(() => {
    uploadCapture.mockReset()
    uploadCapture.mockResolvedValue({ id: 'capture-1', saved: true, videoSaved: true, videoReady: false })
  })

  it('requests no permission on page load and the main shutter only opens consent', () => {
    const browser = setBrowserMedia()
    vi.stubGlobal('fetch', vi.fn())
    render(<App />)

    expect(browser.getUserMedia).not.toHaveBeenCalled()
    expect(browser.getCurrentPosition).not.toHaveBeenCalled()
    expect(browser.query).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Open camera flow' }))
    expect(screen.getByText('Your permission comes first')).toBeTruthy()
    expect(browser.getUserMedia).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('requests camera and microphone together only after consent; starts no backend session before they are granted', async () => {
    const mediaRequest = createDeferred()
    const browser = setBrowserMedia({ mediaPromise: mediaRequest.promise })
    const requests = mockLiveVideoRequests()
    installLiveVideoRuntime()
    renderFlow()

    fireEvent.click(screen.getByRole('button', { name: 'I agree / Start camera and mic' }))
    expect(browser.getUserMedia).toHaveBeenCalledTimes(1)
    expect(browser.getUserMedia).toHaveBeenCalledWith({ video: true, audio: true })
    expect(requests).toHaveLength(0)

    const media = createStream()
    await act(async () => mediaRequest.resolve(media.stream))
    expect(await screen.findByText('REC LIVE')).toBeTruthy()
    expect(requests[0].options.body).toBe('{"cameraConsentConfirmed":true,"microphoneConsentConfirmed":true}')
  })

  it('opens the publisher room, sends 500ms WebM video frames in ordered <=256KiB pieces, and does not upload until Capture', async () => {
    const flow = await startLiveSession()
    expect(flow.runtime.sockets[0].url).toBe('wss://locationfinder-pdzb.onrender.com/ws/live-audio')
    expect(JSON.parse(flow.runtime.sockets[0].sent[0])).toEqual({
      credential: 'publisher-secret',
      role: 'publisher',
      sessionId: 'room-1',
    })
    expect(flow.runtime.recorders[0].mimeType).toBe('video/webm;codecs=vp8,opus')
    expect(flow.runtime.recorders[0].timeslice).toBe(500)
    expect(uploadCapture).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Live front camera preview')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Stop recording' })).toBeTruthy()

    const data = new Uint8Array(600 * 1024)
    data.forEach((_, index) => { data[index] = index % 251 })
    act(() => flow.runtime.recorders[0].emitChunk(new Blob([data], { type: 'video/webm;codecs=vp8,opus' })))
    await waitFor(() => expect(flow.runtime.sockets[0].sent.filter((frame) => frame instanceof ArrayBuffer)).toHaveLength(3))
    const frames = flow.runtime.sockets[0].sent.filter((frame) => frame instanceof ArrayBuffer).map((frame) => new Uint8Array(frame))
    expect(frames.map((frame) => frame.byteLength)).toEqual([256 * 1024, 256 * 1024, 88 * 1024])
    expect(frames[0][0]).toBe(0)
    expect(frames[1][0]).toBe((256 * 1024) % 251)
    expect(frames[2][0]).toBe((512 * 1024) % 251)
    expect(flow.runtime.recorders[0].chunks).toBeUndefined()
  })

  it('pauses and resumes the recorder to bound temporary memory while the WebSocket is backpressured', async () => {
    const flow = await startLiveSession()
    const socket = flow.runtime.sockets[0]
    socket.bufferedAmount = 1024 * 1024 + 1
    const delayedBlob = new Blob([new Uint8Array(3 * 1024 * 1024)], { type: 'video/webm;codecs=vp8,opus' })
    act(() => flow.runtime.recorders[0].emitChunk(delayedBlob))
    await waitFor(() => expect(flow.runtime.recorders[0].state).toBe('paused'))

    socket.bufferedAmount = 0
    await waitFor(() => expect(flow.runtime.recorders[0].state).toBe('recording'))
    expect(socket.sent.filter((frame) => frame instanceof ArrayBuffer)).toHaveLength(12)
    expect(screen.getByLabelText('Live front camera preview')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Stop recording' })).toBeTruthy()
  })

  it('keeps GPS optional and links the user-captured photo to the active live session', async () => {
    const flow = await startLiveSession()
    await waitFor(() => expect(flow.getCurrentPosition).toHaveBeenCalledTimes(1))
    const [locationSuccess] = flow.getCurrentPosition.mock.calls[0]
    act(() => locationSuccess({ coords: { accuracy: 12.4, latitude: 28.6139, longitude: 77.209 } }))
    prepareVideoCapture()
    fireEvent.click(screen.getByRole('button', { name: 'Capture & Upload' }))

    await waitFor(() => expect(uploadCapture).toHaveBeenCalledTimes(1))
    const upload = uploadCapture.mock.calls[0][0]
    expect(upload.recordingSessionId).toBe('room-1')
    expect(upload.publishToken).toBe('publisher-secret')
    expect(upload.location).toEqual({ accuracy: 12.4, latitude: 28.6139, longitude: 77.209 })
    expect(upload.photoFile.type).toBe('image/jpeg')
    expect(await screen.findByText(/Live video is still processing/)).toBeTruthy()
    expect(screen.getByText('REC LIVE')).toBeTruthy()
    expect(flow.videoStop).not.toHaveBeenCalled()
    expect(flow.audioStop).not.toHaveBeenCalled()
    expect(flow.requests.some(({ options }) => options.method === 'DELETE')).toBe(false)
  })

  it('location denial does not stop recording and upload receives no GPS location', async () => {
    const flow = await startLiveSession()
    await waitFor(() => expect(flow.getCurrentPosition).toHaveBeenCalledTimes(1))
    const [, denyLocation] = flow.getCurrentPosition.mock.calls[0]
    act(() => denyLocation({ code: 1 }))
    expect(screen.getByText('Location denied — IP fallback will be used.')).toBeTruthy()
    expect(screen.getByText('REC LIVE')).toBeTruthy()
    prepareVideoCapture()
    fireEvent.click(screen.getByRole('button', { name: 'Capture & Upload' }))
    await waitFor(() => expect(uploadCapture).toHaveBeenCalledTimes(1))
    expect(uploadCapture.mock.calls[0][0].location).toBeNull()
  })

  it('does not request GPS again after the site setting says location is blocked', async () => {
    const flow = await startLiveSession({ permissionState: 'denied' })
    expect(await screen.findByText(/Location is blocked for this website/)).toBeTruthy()
    expect(screen.getByText(/Site settings → Location and select Allow\/Ask/)).toBeTruthy()
    expect(flow.getCurrentPosition).not.toHaveBeenCalled()
    expect(screen.getByText('REC LIVE')).toBeTruthy()
  })

  it('does not start a backend session if camera or microphone permission is denied', async () => {
    const denied = new Error('blocked')
    denied.name = 'NotAllowedError'
    const requests = mockLiveVideoRequests()
    installLiveVideoRuntime()
    const browser = setBrowserMedia({ mediaPromise: Promise.reject(denied) })
    renderFlow()
    fireEvent.click(screen.getByRole('button', { name: 'I agree / Start camera and mic' }))
    expect(await screen.findByText(/Camera or microphone permission was denied or blocked/)).toBeTruthy()
    expect(browser.getUserMedia).toHaveBeenCalledWith({ video: true, audio: true })
    expect(requests).toHaveLength(0)
    expect(screen.queryByRole('button', { name: 'Capture & Upload' })).toBeNull()
  })

  it('recovers from a stalled camera/microphone prompt and stops any stream that arrives after timeout', async () => {
    vi.useFakeTimers()
    const mediaRequest = createDeferred()
    const browser = setBrowserMedia({ mediaPromise: mediaRequest.promise })
    const requests = mockLiveVideoRequests()
    installLiveVideoRuntime()
    renderFlow()
    fireEvent.click(screen.getByRole('button', { name: 'I agree / Start camera and mic' }))

    await act(async () => vi.advanceTimersByTimeAsync(15_000))
    expect(screen.getByText(/permission did not respond within 15 seconds/)).toBeTruthy()
    const lateMedia = createStream()
    await act(async () => mediaRequest.resolve(lateMedia.stream))
    expect(lateMedia.videoStop).toHaveBeenCalledTimes(1)
    expect(lateMedia.audioStop).toHaveBeenCalledTimes(1)
    expect(browser.getCurrentPosition).not.toHaveBeenCalled()
    expect(requests).toHaveLength(0)
  })

  it('uploads photo without GPS when location permission times out', async () => {
    const flow = await startLiveSession()
    await waitFor(() => expect(flow.getCurrentPosition).toHaveBeenCalledTimes(1))
    const [, locationError] = flow.getCurrentPosition.mock.calls[0]
    act(() => locationError({ code: 3 }))
    expect(screen.getByText('Location timed out — IP fallback will be used.')).toBeTruthy()
    prepareVideoCapture()
    fireEvent.click(screen.getByRole('button', { name: 'Capture & Upload' }))
    await waitFor(() => expect(uploadCapture).toHaveBeenCalledTimes(1))
    expect(uploadCapture.mock.calls[0][0].location).toBeNull()
  })

  it('Stop sends the final recorder chunk, flushes the WebSocket queue, finalizes the backend, then stops both tracks', async () => {
    const events = []
    const flow = await startLiveSession({ events })
    prepareVideoCapture()
    fireEvent.click(screen.getByRole('button', { name: 'Capture & Upload' }))
    await screen.findByText(/Live video is still processing/)
    flow.runtime.recorders[0].finalChunk = new Blob(['last-frame'], { type: 'video/webm;codecs=vp8,opus' })
    fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }))
    expect(await screen.findByText('Photo saved; video finalized')).toBeTruthy()
    expect(events.indexOf('video-frame')).toBeLessThan(events.indexOf('room-delete'))
    expect(events.indexOf('room-delete')).toBeLessThan(events.indexOf('video-track-stop'))
    expect(events.indexOf('room-delete')).toBeLessThan(events.indexOf('audio-track-stop'))
    expect(flow.requests.find(({ options }) => options.method === 'DELETE').options.headers['X-Audio-Publish-Token']).toBe('publisher-secret')
    expect(flow.runtime.sockets[0].readyState).toBe(WebSocket.CLOSED)
  })

  it('cancel finalizes the publisher session and stops all local tracks', async () => {
    const flow = await startLiveSession()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(flow.props.onClose).toHaveBeenCalledTimes(1))
    expect(flow.videoStop).toHaveBeenCalledTimes(1)
    expect(flow.audioStop).toHaveBeenCalledTimes(1)
    expect(flow.requests.some(({ options }) => options.method === 'DELETE')).toBe(true)
    expect(flow.runtime.sockets[0].readyState).toBe(WebSocket.CLOSED)
  })

  it('cleans up the live session if its WebSocket disconnects', async () => {
    const flow = await startLiveSession()
    act(() => flow.runtime.sockets[0].disconnect())
    expect(await screen.findByText(/Live recording disconnected/)).toBeTruthy()
    expect(flow.videoStop).toHaveBeenCalledTimes(1)
    expect(flow.audioStop).toHaveBeenCalledTimes(1)
    expect(flow.requests.some(({ options }) => options.method === 'DELETE')).toBe(true)
  })

  it('stops a media stream returned after the permission prompt was cancelled', async () => {
    const mediaRequest = createDeferred()
    const browser = setBrowserMedia({ mediaPromise: mediaRequest.promise })
    const requests = mockLiveVideoRequests()
    installLiveVideoRuntime()
    const { props } = renderFlow()
    fireEvent.click(screen.getByRole('button', { name: 'I agree / Start camera and mic' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    const lateMedia = createStream()
    await act(async () => mediaRequest.resolve(lateMedia.stream))
    expect(lateMedia.videoStop).toHaveBeenCalledTimes(1)
    expect(lateMedia.audioStop).toHaveBeenCalledTimes(1)
    expect(browser.getCurrentPosition).not.toHaveBeenCalled()
    expect(requests).toHaveLength(0)
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })
})
