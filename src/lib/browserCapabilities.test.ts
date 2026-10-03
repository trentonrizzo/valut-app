import { describe, expect, it } from 'vitest'
import { detectBrowserCapabilities, type CapabilityProbe } from './browserCapabilities'

const modern: CapabilityProbe = {
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile Safari/604.1',
  platform: 'iPhone',
  maxTouchPoints: 5,
  deviceMemory: 8,
  hasIntersectionObserver: true,
  hasResizeObserver: true,
  hasPointerEvent: true,
  hasWebCrypto: true,
  hasBlobSlice: true,
  canPlayMp4: true,
  canPlayQuickTime: true,
}

describe('browser capability detection', () => {
  it('keeps the full experience on modern iPhone Safari', () => {
    const result = detectBrowserCapabilities(modern)
    expect(result.isLegacyMode).toBe(false)
    expect(result.supportsAdvancedViewer).toBe(true)
    expect(result.shouldRenderAnimatedMediaInGrid).toBe(true)
    expect(result.preferredPartConcurrency).toBe(2)
  })

  it('selects bounded legacy behavior for an iPhone 6 on iOS 12', () => {
    const result = detectBrowserCapabilities({
      ...modern,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 12_5 like Mac OS X) Version/12.0 Mobile Safari/604.1',
      deviceMemory: null,
      hasResizeObserver: false,
      hasPointerEvent: false,
    })
    expect(result.isLegacySafari).toBe(true)
    expect(result.isLegacyMode).toBe(true)
    expect(result.supportsAdvancedViewer).toBe(false)
    expect(result.preferredUploadConcurrency).toBe(1)
    expect(result.preferredPartConcurrency).toBe(1)
    expect(result.shouldRenderAnimatedMediaInGrid).toBe(false)
  })

  it('uses capabilities as a conservative fallback instead of relying only on user agent', () => {
    const result = detectBrowserCapabilities({
      ...modern,
      userAgent: 'Unknown mobile browser',
      platform: 'unknown',
      deviceMemory: null,
      hasResizeObserver: false,
      hasPointerEvent: false,
    })
    expect(result.isLegacyMode).toBe(true)
  })
})
