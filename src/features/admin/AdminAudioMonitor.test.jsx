import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AdminAudioMonitor from './AdminAudioMonitor'
import { fetchAdminLiveAudioSessions } from './adminApi'

vi.mock('./adminApi', () => ({
  AdminApiError: class AdminApiError extends Error {
    constructor(message, status = 0) { super(message); this.status = status }
  },
  fetchAdminLiveAudioSessions: vi.fn(),
}))

function installAdminAudioRuntime() {
  const sockets = []
  const mediaSources = []

  class MockSourceBuffer extends EventTarget {
    constructor() {
      super()
      this.appended = []
      this.updating = false
    }

    appendBuffer(buffer) {
      this.appended.push(buffer)
      this.updating = false
      this.dispatchEvent(new Event('updateend'))
    }
  }

  class MockMediaSource extends EventTarget {
    static isTypeSupported = (type) => type.includes('video/webm') && type.includes('vp8,opus')

    constructor() {
      super()
      this.buffer = new MockSourceBuffer()
      mediaSources.push(this)
      queueMicrotask(() => this.dispatchEvent(new Event('sourceopen')))
    }

    addSourceBuffer() { return this.buffer }
  }

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
        this.readyState = MockWebSocket.OPEN
        this.onopen?.(new Event('open'))
      })
    }

    send(value) { this.sent.push(value) }
    close() { this.readyState = MockWebSocket.CLOSED; this.closeCalled = true }
  }

  vi.stubGlobal('MediaSource', MockMediaSource)
  vi.stubGlobal('WebSocket', MockWebSocket)
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:live-room')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  return { mediaSources, sockets }
}

describe('admin live video monitor', () => {
  beforeEach(() => {
    fetchAdminLiveAudioSessions.mockReset()
    fetchAdminLiveAudioSessions.mockResolvedValue([
      { createdAt: '2026-11-14T10:00:00Z', sessionId: 'room-1' },
    ])
  })

  it('plays publisher binary video frames and Stop Listening closes only the admin socket', async () => {
    const runtime = installAdminAudioRuntime()
    const onAuthError = vi.fn()
    render(<AdminAudioMonitor onAuthError={onAuthError} token="admin-token" />)

    expect(await screen.findByText('room-1')).toBeTruthy()
    expect(fetchAdminLiveAudioSessions).toHaveBeenCalledWith(expect.objectContaining({ token: 'admin-token' }))
    fireEvent.click(screen.getByRole('button', { name: 'View live' }))
    expect(await screen.findByText(/Connected\. Waiting for live camera and microphone data/)).toBeTruthy()

    expect(runtime.sockets[0].url).toBe('wss://locationfinder-pdzb.onrender.com/ws/live-audio')
    expect(JSON.parse(runtime.sockets[0].sent[0])).toEqual({
      credential: 'admin-token',
      role: 'admin',
      sessionId: 'room-1',
    })

    const videoFrame = new Uint8Array([1, 2, 3, 4]).buffer
    act(() => runtime.sockets[0].onmessage({ data: videoFrame }))
    await waitFor(() => expect(runtime.mediaSources[0].buffer.appended).toHaveLength(1))
    expect(screen.getByText('Live camera video and microphone audio are playing.')).toBeTruthy()
    expect(screen.getByLabelText('Live camera and microphone player')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Stop Listening' }))
    expect(runtime.sockets[0].closeCalled).toBe(true)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:live-room')
    expect(screen.getByText(/publisher recording remains active/)).toBeTruthy()
    expect(onAuthError).not.toHaveBeenCalled()
  })
})
