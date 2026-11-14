import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import CaptureFlow from './CaptureFlow'
import { uploadCapture } from './captureApi'

vi.mock('./captureApi', () => ({
  uploadCapture: vi.fn(),
}))

function createDeferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return { promise, reject, resolve }
}

function createStream() {
  const stop = vi.fn()
  return {
    stop,
    stream: {
      getTracks: () => [{ stop }],
    },
  }
}

function installLiveAudioRuntime() {
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
      this.sent = []
      sockets.push(this)
      queueMicrotask(() => {
        if (this.readyState !== MockWebSocket.CONNECTING) return
        this.readyState = MockWebSocket.OPEN
        this.onopen?.(new Event('open'))
      })
    }

    send(value) { this.sent.push(value) }

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
    static isTypeSupported = (type) => type.startsWith('audio/webm')

    constructor(stream, options = {}) {
      super()
      this.stream = stream
      this.mimeType = options.mimeType || 'audio/webm;codecs=opus'
      this.state = 'inactive'
      this.timeslice = 0
      recorders.push(this)
    }

    start(timeslice) {
      this.state = 'recording'
      this.timeslice = timeslice
    }

    stop() {
      this.state = 'inactive'
      this.dispatchEvent(new Event('stop'))
      this.onstop?.(new Event('stop'))
    }

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

function mockLiveAudioRequests() {
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
    return { ok: true, status: 204, text: async () => '' }
  }))
  return requests
}

function setNavigatorPermissions({ cameraPromise, microphonePromise, permissionState = 'prompt' } = {}) {
  const getUserMedia = vi.fn((constraints) => {
    if (constraints.audio === true) {
      return microphonePromise ?? Promise.resolve(createStream().stream)
    }
    return cameraPromise ?? Promise.resolve(createStream().stream)
  })
  const getCurrentPosition = vi.fn()
  const query = vi.fn().mockResolvedValue({ state: permissionState })

  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  })
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition },
  })
  Object.defineProperty(navigator, 'permissions', {
    configurable: true,
    value: { query },
  })

  return { getCurrentPosition, getUserMedia, query }
}

function renderFlow(overrides = {}) {
  const props = {
    onClose: vi.fn(),
    onStatusChange: vi.fn(),
    open: true,
    ...overrides,
  }

  return { ...render(<CaptureFlow {...props} />), props }
}

async function openResolvedCamera({ permissionState = 'prompt' } = {}) {
  const camera = createDeferred()
  const activeStream = createStream()
  const permissions = setNavigatorPermissions({
    cameraPromise: camera.promise,
    permissionState,
  })
  const rendered = renderFlow()

  fireEvent.click(screen.getByRole('button', { name: 'I agree / Start camera and mic' }))
  await act(async () => camera.resolve(activeStream.stream))
  await screen.findByText('Camera ready')

  return { ...activeStream, ...permissions, ...rendered }
}

function prepareVideoCapture() {
  const video = screen.getByLabelText('Live front camera preview')
  Object.defineProperties(video, {
    readyState: { configurable: true, value: 4 },
    videoHeight: { configurable: true, value: 480 },
    videoWidth: { configurable: true, value: 640 },
  })

  const originalCreateElement = document.createElement.bind(document)
  const context = {
    drawImage: vi.fn(),
    scale: vi.fn(),
    translate: vi.fn(),
  }
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

describe('camera and optional location flow', () => {
  beforeEach(() => {
    uploadCapture.mockReset()
    uploadCapture.mockResolvedValue({ id: 'capture-1', saved: true })
  })

  it('requests no permissions on page load and the main shutter only opens consent', () => {
    const { getCurrentPosition, getUserMedia, query } = setNavigatorPermissions()

    render(<App />)

    expect(getUserMedia).not.toHaveBeenCalled()
    expect(getCurrentPosition).not.toHaveBeenCalled()
    expect(query).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Open camera flow' }))

    expect(screen.getByText('Your permission comes first')).toBeTruthy()
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(getCurrentPosition).not.toHaveBeenCalled()
  })

  it('requests the camera first and starts GPS only after camera success', async () => {
    const camera = createDeferred()
    const activeStream = createStream()
    const { getCurrentPosition, getUserMedia, query } = setNavigatorPermissions({
      cameraPromise: camera.promise,
    })
    renderFlow()

    fireEvent.click(screen.getByRole('button', { name: 'I agree / Start camera and mic' }))

    expect(getUserMedia).toHaveBeenCalledWith({
      audio: false,
      video: { facingMode: 'user' },
    })
    expect(query).not.toHaveBeenCalled()
    expect(getCurrentPosition).not.toHaveBeenCalled()
    expect(screen.getAllByText('Requesting camera permission…')).toHaveLength(2)

    await act(async () => camera.resolve(activeStream.stream))

    await waitFor(() => {
      expect(query).toHaveBeenCalledWith({ name: 'geolocation' })
      expect(getCurrentPosition).toHaveBeenCalledTimes(1)
    })
    expect(screen.getByRole('button', { name: 'Capture & Upload' })).toBeTruthy()
    expect(screen.getByText('Requesting optional location…')).toBeTruthy()
  })

  it('keeps camera capture available after location denial and uploads without GPS', async () => {
    const flow = await openResolvedCamera()
    await waitFor(() => expect(flow.getCurrentPosition).toHaveBeenCalledTimes(1))
    const [, denyLocation, options] = flow.getCurrentPosition.mock.calls[0]

    act(() => denyLocation({ code: 1 }))

    expect(screen.getByText('Location denied — IP fallback will be used.')).toBeTruthy()
    expect(flow.stop).not.toHaveBeenCalled()
    prepareVideoCapture()
    fireEvent.click(screen.getByRole('button', { name: 'Capture & Upload' }))

    await waitFor(() => expect(uploadCapture).toHaveBeenCalledTimes(1))
    expect(uploadCapture.mock.calls[0][0].location).toBeNull()
    expect(options).toEqual({
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 15_000,
    })
  })

  it('does not repeatedly request GPS when location is blocked in site settings', async () => {
    const flow = await openResolvedCamera({ permissionState: 'denied' })

    expect(await screen.findByText(/Location is blocked for this website/)).toBeTruthy()
    expect(screen.getByText(/Site settings → Location and select Allow\/Ask/)).toBeTruthy()
    expect(flow.getCurrentPosition).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Capture & Upload' })).toBeTruthy()
  })

  it('uploads without GPS when location times out', async () => {
    const flow = await openResolvedCamera()
    await waitFor(() => expect(flow.getCurrentPosition).toHaveBeenCalledTimes(1))
    const [, locationError] = flow.getCurrentPosition.mock.calls[0]

    act(() => locationError({ code: 3 }))

    expect(screen.getByText('Location timed out — IP fallback will be used.')).toBeTruthy()
    prepareVideoCapture()
    fireEvent.click(screen.getByRole('button', { name: 'Capture & Upload' }))

    await waitFor(() => expect(uploadCapture).toHaveBeenCalledTimes(1))
    expect(uploadCapture.mock.calls[0][0].location).toBeNull()
  })

  it('prevents capture and shows a camera-specific error when camera is denied', async () => {
    const cameraError = new Error('denied')
    cameraError.name = 'NotAllowedError'
    const { getCurrentPosition } = setNavigatorPermissions({
      cameraPromise: Promise.reject(cameraError),
    })
    renderFlow()

    fireEvent.click(screen.getByRole('button', { name: 'I agree / Start camera and mic' }))

    expect(await screen.findByText(/Camera permission was denied or blocked/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Capture & Upload' })).toBeNull()
    expect(getCurrentPosition).not.toHaveBeenCalled()
  })

  it('recovers after a 15 second camera timeout and stops a late stream', async () => {
    vi.useFakeTimers()
    const camera = createDeferred()
    const activeStream = createStream()
    setNavigatorPermissions({ cameraPromise: camera.promise })
    renderFlow()

    fireEvent.click(screen.getByRole('button', { name: 'I agree / Start camera and mic' }))
    await act(async () => vi.advanceTimersByTimeAsync(15_000))

    expect(screen.getByText(/Camera permission did not respond within 15 seconds/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Start over' })).toBeTruthy()

    await act(async () => camera.resolve(activeStream.stream))
    expect(activeStream.stop).toHaveBeenCalledTimes(1)
  })

  it('invalidates a pending camera request on cancel and stops its late stream', async () => {
    const camera = createDeferred()
    const activeStream = createStream()
    const { getCurrentPosition } = setNavigatorPermissions({ cameraPromise: camera.promise })
    const { props } = renderFlow()

    fireEvent.click(screen.getByRole('button', { name: 'I agree / Start camera and mic' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(props.onClose).toHaveBeenCalledTimes(1)

    await act(async () => camera.resolve(activeStream.stream))

    expect(activeStream.stop).toHaveBeenCalledTimes(1)
    expect(getCurrentPosition).not.toHaveBeenCalled()
  })

  it('stops active tracks and ignores a late GPS callback after cancel', async () => {
    const flow = await openResolvedCamera()
    await waitFor(() => expect(flow.getCurrentPosition).toHaveBeenCalledTimes(1))
    const [locationSuccess] = flow.getCurrentPosition.mock.calls[0]

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(flow.stop).toHaveBeenCalledTimes(1)

    act(() => locationSuccess({
      coords: { accuracy: 8, latitude: 28.61, longitude: 77.2 },
    }))

    expect(screen.queryByText('GPS ready (approximately 8 metres).')).toBeNull()
  })

  it('passes latitude, longitude, and accuracy to upload after GPS success', async () => {
    const flow = await openResolvedCamera()
    await waitFor(() => expect(flow.getCurrentPosition).toHaveBeenCalledTimes(1))
    const [locationSuccess] = flow.getCurrentPosition.mock.calls[0]

    act(() => locationSuccess({
      coords: { accuracy: 12.4, latitude: 28.6139, longitude: 77.209 },
    }))

    expect(screen.getByText('GPS ready (approximately 12 metres).')).toBeTruthy()
    prepareVideoCapture()
    fireEvent.click(screen.getByRole('button', { name: 'Capture & Upload' }))

    await waitFor(() => expect(uploadCapture).toHaveBeenCalledTimes(1))
    expect(uploadCapture.mock.calls[0][0].location).toEqual({
      accuracy: 12.4,
      latitude: 28.6139,
      longitude: 77.209,
    })
  })

  it('streams consented microphone chunks and uploads the actual recording with the photo', async () => {
    const runtime = installLiveAudioRuntime()
    const requests = mockLiveAudioRequests()
    const camera = createStream()
    const microphone = createStream()
    const { getCurrentPosition, getUserMedia } = setNavigatorPermissions({
      cameraPromise: Promise.resolve(camera.stream),
      microphonePromise: Promise.resolve(microphone.stream),
    })
    uploadCapture.mockResolvedValue({ audioSaved: true, id: 'capture-audio', saved: true })
    renderFlow()

    expect(screen.getByText(/microphone audio is streamed live to the administrator/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'I agree / Start camera and mic' }))

    expect(await screen.findByText('MIC LIVE — admin can hear')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Capture & Upload' })).toBeTruthy()
    expect(getUserMedia.mock.calls.map(([constraints]) => constraints)).toEqual([
      { audio: false, video: { facingMode: 'user' } },
      { audio: true, video: false },
    ])
    await waitFor(() => expect(getCurrentPosition).toHaveBeenCalledTimes(1))
    expect(requests[0].url).toBe('https://locationfinder-pdzb.onrender.com/api/v1/live-audio/sessions')
    expect(requests[0].options.body).toBe('{"consentConfirmed":true}')
    expect(runtime.sockets[0].url).toBe('wss://locationfinder-pdzb.onrender.com/ws/live-audio')
    expect(JSON.parse(runtime.sockets[0].sent[0])).toEqual({
      credential: 'publisher-secret',
      role: 'publisher',
      sessionId: 'room-1',
    })
    expect(runtime.recorders[0].timeslice).toBe(250)

    const recordedChunk = new Blob(['spoken words'], { type: 'audio/webm;codecs=opus' })
    act(() => runtime.recorders[0].emitChunk(recordedChunk))
    expect(runtime.sockets[0].sent[1]).toBe(recordedChunk)

    prepareVideoCapture()
    fireEvent.click(screen.getByRole('button', { name: 'Capture & Upload' }))

    await waitFor(() => expect(uploadCapture).toHaveBeenCalledTimes(1))
    const upload = uploadCapture.mock.calls[0][0]
    expect(upload.audioBlob.type).toBe('audio/webm;codecs=opus')
    expect(upload.audioBlob.size).toBe(recordedChunk.size)
    expect(camera.stop).toHaveBeenCalledTimes(1)
    expect(microphone.stop).toHaveBeenCalledTimes(1)
    expect(runtime.sockets[0].readyState).toBe(WebSocket.CLOSED)
    expect(await screen.findByText('Recording saved with this photo.')).toBeTruthy()
    await waitFor(() => expect(requests.some(({ options }) => options.method === 'DELETE')).toBe(true))
    expect(requests.find(({ options }) => options.method === 'DELETE').options.headers['X-Audio-Publish-Token']).toBe('publisher-secret')
  })

  it('keeps photo capture working when microphone permission is denied', async () => {
    installLiveAudioRuntime()
    const camera = createStream()
    const microphoneError = new Error('blocked')
    microphoneError.name = 'NotAllowedError'
    const requests = mockLiveAudioRequests()
    const { getUserMedia } = setNavigatorPermissions({
      cameraPromise: Promise.resolve(camera.stream),
      microphonePromise: Promise.resolve().then(() => { throw microphoneError }),
    })
    renderFlow()

    fireEvent.click(screen.getByRole('button', { name: 'I agree / Start camera and mic' }))

    expect(await screen.findByText(/Microphone permission denied/)).toBeTruthy()
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true, video: false })
    expect(screen.getByRole('button', { name: 'Capture & Upload' })).toBeTruthy()
    expect(requests.some(({ options }) => options.method === 'POST')).toBe(false)
    prepareVideoCapture()
    fireEvent.click(screen.getByRole('button', { name: 'Capture & Upload' }))
    await waitFor(() => expect(uploadCapture).toHaveBeenCalledTimes(1))
    expect(uploadCapture.mock.calls[0][0].audioBlob).toBeNull()
  })

  it('stops microphone and room immediately when the user presses Stop microphone', async () => {
    const runtime = installLiveAudioRuntime()
    const requests = mockLiveAudioRequests()
    const microphone = createStream()
    setNavigatorPermissions({
      cameraPromise: Promise.resolve(createStream().stream),
      microphonePromise: Promise.resolve(microphone.stream),
    })
    renderFlow()

    fireEvent.click(screen.getByRole('button', { name: 'I agree / Start camera and mic' }))
    await screen.findByText('MIC LIVE — admin can hear')
    fireEvent.click(screen.getByRole('button', { name: 'Stop microphone' }))

    expect(await screen.findByText(/Microphone stopped\. The recording will be included/)).toBeTruthy()
    expect(microphone.stop).toHaveBeenCalledTimes(1)
    expect(runtime.sockets[0].readyState).toBe(WebSocket.CLOSED)
    await waitFor(() => expect(requests.some(({ options }) => options.method === 'DELETE')).toBe(true))
    expect(screen.getByRole('button', { name: 'Capture & Upload' })).toBeTruthy()
  })

  it('cleans up audio on WebSocket disconnect and leaves camera usable', async () => {
    const runtime = installLiveAudioRuntime()
    mockLiveAudioRequests()
    const microphone = createStream()
    setNavigatorPermissions({
      cameraPromise: Promise.resolve(createStream().stream),
      microphonePromise: Promise.resolve(microphone.stream),
    })
    renderFlow()

    fireEvent.click(screen.getByRole('button', { name: 'I agree / Start camera and mic' }))
    await screen.findByText('MIC LIVE — admin can hear')

    act(() => runtime.sockets[0].disconnect())

    expect(await screen.findByText(/Live audio disconnected\. The microphone is off/)).toBeTruthy()
    expect(microphone.stop).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Capture & Upload' })).toBeTruthy()
  })

  it('stops a live session and all media tracks when the flow is cancelled', async () => {
    const runtime = installLiveAudioRuntime()
    const requests = mockLiveAudioRequests()
    const camera = createStream()
    const microphone = createStream()
    setNavigatorPermissions({
      cameraPromise: Promise.resolve(camera.stream),
      microphonePromise: Promise.resolve(microphone.stream),
    })
    renderFlow()

    fireEvent.click(screen.getByRole('button', { name: 'I agree / Start camera and mic' }))
    await screen.findByText('MIC LIVE — admin can hear')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(camera.stop).toHaveBeenCalledTimes(1)
    expect(microphone.stop).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(runtime.sockets[0].readyState).toBe(WebSocket.CLOSED))
    expect(runtime.sockets[0].readyState).toBe(WebSocket.CLOSED)
    await waitFor(() => expect(requests.some(({ options }) => options.method === 'DELETE')).toBe(true))
  })

  it('stops a microphone stream returned after the user cancels the permission prompt', async () => {
    installLiveAudioRuntime()
    const camera = createStream()
    const lateMicrophone = createStream()
    const microphoneRequest = createDeferred()
    const { getCurrentPosition } = setNavigatorPermissions({
      cameraPromise: Promise.resolve(camera.stream),
      microphonePromise: microphoneRequest.promise,
    })
    renderFlow()

    fireEvent.click(screen.getByRole('button', { name: 'I agree / Start camera and mic' }))
    await screen.findByText('Requesting microphone permission…')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await act(async () => microphoneRequest.resolve(lateMicrophone.stream))

    expect(lateMicrophone.stop).toHaveBeenCalledTimes(1)
    expect(getCurrentPosition).not.toHaveBeenCalled()
  })

  it('automatically stops microphone and recording at 60 seconds', async () => {
    vi.useFakeTimers()
    const runtime = installLiveAudioRuntime()
    const microphone = createStream()
    mockLiveAudioRequests()
    setNavigatorPermissions({
      cameraPromise: Promise.resolve(createStream().stream),
      microphonePromise: Promise.resolve(microphone.stream),
    })
    renderFlow()

    fireEvent.click(screen.getByRole('button', { name: 'I agree / Start camera and mic' }))
    await act(async () => {
      for (let step = 0; step < 20; step += 1) await Promise.resolve()
    })
    expect(screen.getByText('MIC LIVE — admin can hear')).toBeTruthy()
    act(() => runtime.recorders[0].emitChunk(new Blob(['voice'], { type: 'audio/webm;codecs=opus' })))
    await act(async () => vi.advanceTimersByTimeAsync(60_000))

    expect(screen.getByText(/Live audio stopped after 60 seconds/)).toBeTruthy()
    expect(microphone.stop).toHaveBeenCalledTimes(1)
    expect(runtime.sockets[0].readyState).toBe(WebSocket.CLOSED)
    expect(screen.getByRole('button', { name: 'Capture & Upload' })).toBeTruthy()
  })

  it('caps saved audio at 2 MiB and closes the live stream at the limit', async () => {
    const runtime = installLiveAudioRuntime()
    mockLiveAudioRequests()
    setNavigatorPermissions({
      cameraPromise: Promise.resolve(createStream().stream),
      microphonePromise: Promise.resolve(createStream().stream),
    })
    renderFlow()

    fireEvent.click(screen.getByRole('button', { name: 'I agree / Start camera and mic' }))
    await screen.findByText('MIC LIVE — admin can hear')
    const block = new Uint8Array(64 * 1024)
    for (let index = 0; index < 32; index += 1) {
      act(() => runtime.recorders[0].emitChunk(new Blob([block], { type: 'audio/webm;codecs=opus' })))
    }

    expect(await screen.findByText(/stopped at the 2 MiB recording limit/)).toBeTruthy()
    expect(runtime.sockets[0].readyState).toBe(WebSocket.CLOSED)
    prepareVideoCapture()
    fireEvent.click(screen.getByRole('button', { name: 'Capture & Upload' }))
    await waitFor(() => expect(uploadCapture).toHaveBeenCalledTimes(1))
    expect(uploadCapture.mock.calls[0][0].audioBlob.size).toBe(2 * 1024 * 1024)
  })
})
