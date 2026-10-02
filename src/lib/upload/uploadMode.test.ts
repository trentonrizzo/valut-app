import { afterEach, describe, expect, it, vi } from 'vitest'
import { fileConcurrency, partConcurrency, partGapMs } from './multipartConfig'
import { getPreferredUploadMode, normalizeUploadMode, setPreferredUploadMode } from './uploadMode'

describe('upload modes', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('keeps legacy jobs on the original fast behavior', () => {
    expect(normalizeUploadMode(undefined)).toBe('fast')
    expect(partGapMs()).toBe(0)
    expect(fileConcurrency()).toBeGreaterThanOrEqual(1)
    expect(partConcurrency()).toBeGreaterThanOrEqual(1)
  })

  it('bounds low-bandwidth work to one file and one part with a gap', () => {
    expect(fileConcurrency('low-bandwidth')).toBe(1)
    expect(partConcurrency('low-bandwidth')).toBe(1)
    expect(partGapMs('low-bandwidth')).toBeGreaterThanOrEqual(1_000)
  })

  it('persists the preference without rewriting queued jobs', () => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) })
    setPreferredUploadMode('low-bandwidth')
    expect(getPreferredUploadMode()).toBe('low-bandwidth')
  })
})
