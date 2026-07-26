import { useState } from 'react'

export default function ResultActions({ enhancedUrl, canEnhanceAgain, onEnhanceAgain, onRetake }) {
  const [downloadError, setDownloadError] = useState('')
  const [isDownloading, setIsDownloading] = useState(false)

  const downloadPhoto = async () => {
    setIsDownloading(true)
    setDownloadError('')
    try {
      const response = await fetch(enhancedUrl)
      if (!response.ok) throw new Error('Download failed')
      const blob = await response.blob()
      const objectUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = `photogenius-enhanced-${Date.now()}.${blob.type.includes('png') ? 'png' : 'jpg'}`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(objectUrl)
    } catch {
      setDownloadError('The enhanced photo could not be downloaded. Please try again.')
    } finally {
      setIsDownloading(false)
    }
  }

  return (
    <div className="mt-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
        <button type="button" className="session-button-primary" onClick={downloadPhoto} disabled={isDownloading}>
          {isDownloading ? 'Preparing download…' : 'Download Photo'}
        </button>
        {canEnhanceAgain && (
          <button type="button" className="session-button-secondary" onClick={onEnhanceAgain}>Enhance Again</button>
        )}
        <button type="button" className="session-button-secondary" onClick={onRetake}>Retake Photo</button>
      </div>
      {downloadError && <p className="mt-3 text-center text-sm text-amber-200" role="alert">{downloadError}</p>}
    </div>
  )
}

