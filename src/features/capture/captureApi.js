import { apiConfig, apiUrl } from '../../config/api'
import { audioFilename } from './liveAudioApi'

const supportedPhotoTypes = new Set(['image/jpeg', 'image/png', 'image/webp'])
const supportedAudioTypes = new Set(['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg'])

function parseResponse(responseText) {
  if (!responseText) return {}

  try {
    return JSON.parse(responseText)
  } catch {
    return {}
  }
}

function uploadError(result, fallback) {
  return result.message || result.detail || result.title || fallback
}

export async function uploadCapture({ photoFile, audioBlob, location, signal }) {
  if (!(photoFile instanceof File) || !supportedPhotoTypes.has(photoFile.type)) {
    throw new Error('Please capture a valid JPEG, PNG, or WebP photo.')
  }

  const formData = new FormData()
  formData.append('photo', photoFile)

  if (audioBlob?.size) {
    const audioType = audioBlob.type?.split(';', 1)[0].trim().toLowerCase()
    if (!(audioBlob instanceof Blob) || !supportedAudioTypes.has(audioType)) {
      throw new Error('The recording format is not supported by the capture backend.')
    }
    formData.append('audio', audioBlob, audioFilename(audioBlob.type))
  }

  const hasCoordinates = location
    && Number.isFinite(location.latitude)
    && Number.isFinite(location.longitude)

  if (hasCoordinates) {
    formData.append('latitude', String(location.latitude))
    formData.append('longitude', String(location.longitude))

    if (Number.isFinite(location.accuracy) && location.accuracy >= 0) {
      formData.append('accuracy', String(location.accuracy))
    }
  }

  const timeoutController = new AbortController()
  const abortOnCallerSignal = () => timeoutController.abort()
  const timeoutId = window.setTimeout(() => timeoutController.abort(), apiConfig.timeoutMs)

  if (signal) {
    if (signal.aborted) {
      timeoutController.abort()
    } else {
      signal.addEventListener('abort', abortOnCallerSignal, { once: true })
    }
  }

  try {
    const response = await fetch(apiUrl('/api/v1/captures'), {
      method: 'POST',
      body: formData,
      signal: timeoutController.signal,
    })
    const result = parseResponse(await response.text())

    if (!response.ok) {
      throw new Error(uploadError(result, 'Upload failed'))
    }

    if (response.status !== 201 || result.saved !== true) {
      throw new Error('The server did not confirm that the photo was saved.')
    }

    return result
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(signal?.aborted ? 'Upload cancelled.' : 'Upload timed out. Please try again.')
    }
    throw error
  } finally {
    window.clearTimeout(timeoutId)
    signal?.removeEventListener('abort', abortOnCallerSignal)
  }
}
