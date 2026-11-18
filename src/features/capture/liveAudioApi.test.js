import { afterEach, describe, expect, it, vi } from 'vitest'
import { closeLiveAudioSession } from './liveAudioApi'

function response(status) {
  return { ok: status >= 200 && status < 300, status, text: async () => '' }
}

describe('closeLiveAudioSession', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('sends the required publish-token and last-acknowledged-sequence headers', async () => {
    const fetch = vi.fn().mockResolvedValue(response(204))
    vi.stubGlobal('fetch', fetch)

    await closeLiveAudioSession({ sessionId: 'room/one', publishToken: 'private-token', lastAckSequence: 7 })

    expect(fetch).toHaveBeenCalledWith(
      'https://locationfinder-pdzb.onrender.com/api/v1/live-audio/sessions/room%2Fone',
      expect.objectContaining({
        method: 'DELETE',
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          'X-Audio-Publish-Token': 'private-token',
          'X-Audio-Last-Chunk-Sequence': '7',
        },
      }),
    )
  })

  it('retries HTTP 409 with the exact same session, token, and sequence', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn()
      .mockResolvedValueOnce(response(409))
      .mockResolvedValueOnce(response(204))
    vi.stubGlobal('fetch', fetch)

    const finalization = closeLiveAudioSession({ sessionId: 'room-2', publishToken: 'token-2', lastAckSequence: 3 })
    await vi.advanceTimersByTimeAsync(250)
    await expect(finalization).resolves.toBeUndefined()

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls[1][0]).toBe(fetch.mock.calls[0][0])
    expect(fetch.mock.calls[1][1].headers).toEqual(fetch.mock.calls[0][1].headers)
  })

  it('explains HTTP 428 and refuses to issue DELETE without a valid sequence', async () => {
    const fetch = vi.fn().mockResolvedValue(response(428))
    vi.stubGlobal('fetch', fetch)

    await expect(closeLiveAudioSession({ sessionId: 'room-3', publishToken: 'token-3', lastAckSequence: 0 }))
      .rejects.toMatchObject({ status: 428, message: expect.stringContaining('X-Audio-Last-Chunk-Sequence') })
    await expect(closeLiveAudioSession({ sessionId: 'room-3', publishToken: 'token-3', lastAckSequence: -1 }))
      .rejects.toThrow('valid last acknowledged video sequence')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
