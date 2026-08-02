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

function setNavigatorPermissions({ cameraPromise, permissionState = 'prompt' } = {}) {
  const getUserMedia = vi.fn(() => cameraPromise ?? Promise.resolve(createStream().stream))
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

  fireEvent.click(screen.getByRole('button', { name: 'Open Camera' }))
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
    const { getCurrentPosition, getUserMedia } = setNavigatorPermissions()

    render(<App />)

    expect(getUserMedia).not.toHaveBeenCalled()
    expect(getCurrentPosition).not.toHaveBeenCalled()

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

    fireEvent.click(screen.getByRole('button', { name: 'Open Camera' }))

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

    fireEvent.click(screen.getByRole('button', { name: 'Open Camera' }))

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

    fireEvent.click(screen.getByRole('button', { name: 'Open Camera' }))
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

    fireEvent.click(screen.getByRole('button', { name: 'Open Camera' }))
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
})
