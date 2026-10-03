export type CapabilityProbe = {
  userAgent: string
  platform: string
  maxTouchPoints: number
  deviceMemory: number | null
  hasIntersectionObserver: boolean
  hasResizeObserver: boolean
  hasPointerEvent: boolean
  hasWebCrypto: boolean
  hasBlobSlice: boolean
  canPlayMp4: boolean
  canPlayQuickTime: boolean
}

export type BrowserCapabilities = CapabilityProbe & {
  isIos: boolean
  isLegacySafari: boolean
  isLegacyMode: boolean
  supportsAdvancedViewer: boolean
  supportsVideoPreview: boolean
  preferredUploadConcurrency: number
  preferredPartConcurrency: number
  preferredChunkSize: number
  shouldRenderAnimatedMediaInGrid: boolean
  diagnostics: string
}

function iosMajorVersion(userAgent: string): number | null {
  const match = userAgent.match(/(?:CPU (?:iPhone )?OS|iPhone OS) (\d+)[_.]/i)
  return match ? Number(match[1]) : null
}

function safariMajorVersion(userAgent: string): number | null {
  if (!/Safari/i.test(userAgent) || /CriOS|FxiOS|EdgiOS/i.test(userAgent)) return null
  const match = userAgent.match(/Version\/(\d+)/i)
  return match ? Number(match[1]) : null
}

export function detectBrowserCapabilities(probe: CapabilityProbe): BrowserCapabilities {
  const iosMajor = iosMajorVersion(probe.userAgent)
  const safariMajor = safariMajorVersion(probe.userAgent)
  const isIos = iosMajor != null || /iP(?:hone|ad|od)/i.test(probe.platform)
  const isLegacySafari = (iosMajor != null && iosMajor <= 12) || (safariMajor != null && safariMajor <= 12)
  const lowMemory = probe.deviceMemory != null && probe.deviceMemory <= 2
  const touchConstrained = (isIos || probe.maxTouchPoints > 0) && !probe.hasResizeObserver
  const isLegacyMode = isLegacySafari || lowMemory || touchConstrained
  const supportsAdvancedViewer = !isLegacyMode && probe.hasResizeObserver && probe.hasPointerEvent
  const supportsVideoPreview =
    !isLegacyMode && probe.hasIntersectionObserver && (probe.canPlayMp4 || probe.canPlayQuickTime)

  return {
    ...probe,
    isIos,
    isLegacySafari,
    isLegacyMode,
    supportsAdvancedViewer,
    supportsVideoPreview,
    preferredUploadConcurrency: isLegacyMode ? 1 : isIos ? 1 : 2,
    preferredPartConcurrency: isLegacyMode ? 1 : isIos ? 2 : 4,
    // Keep the established encryption/multipart format. R2 multipart parts remain >= 5 MiB.
    preferredChunkSize: 8 * 1024 * 1024,
    shouldRenderAnimatedMediaInGrid: !isLegacyMode && probe.hasIntersectionObserver,
    diagnostics: [
      isLegacyMode ? 'legacy' : 'modern',
      isIos ? 'ios' : 'non-ios',
      probe.hasResizeObserver ? 'resize-observer' : 'no-resize-observer',
      probe.hasPointerEvent ? 'pointer-events' : 'no-pointer-events',
      probe.hasWebCrypto ? 'webcrypto' : 'no-webcrypto',
    ].join(' · '),
  }
}

function currentProbe(): CapabilityProbe {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {
      userAgent: '',
      platform: '',
      maxTouchPoints: 0,
      deviceMemory: null,
      hasIntersectionObserver: false,
      hasResizeObserver: false,
      hasPointerEvent: false,
      hasWebCrypto: false,
      hasBlobSlice: true,
      canPlayMp4: false,
      canPlayQuickTime: false,
    }
  }
  const video = document.createElement('video')
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  return {
    userAgent: navigator.userAgent || '',
    platform: navigator.platform || '',
    maxTouchPoints: navigator.maxTouchPoints || 0,
    deviceMemory: typeof memory === 'number' ? memory : null,
    hasIntersectionObserver: typeof window.IntersectionObserver !== 'undefined',
    hasResizeObserver: typeof window.ResizeObserver !== 'undefined',
    hasPointerEvent: typeof window.PointerEvent !== 'undefined',
    hasWebCrypto: Boolean(window.crypto?.subtle && window.crypto.getRandomValues),
    hasBlobSlice: typeof Blob !== 'undefined' && typeof Blob.prototype.slice === 'function',
    canPlayMp4: Boolean(video.canPlayType('video/mp4')),
    canPlayQuickTime: Boolean(video.canPlayType('video/quicktime')),
  }
}

export const browserCapabilities = detectBrowserCapabilities(currentProbe())
