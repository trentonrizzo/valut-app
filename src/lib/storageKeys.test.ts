import { describe, expect, it } from 'vitest'
import { extractKeyFromStoredUrl, originalKey, userOwnsStorageKey } from './storageKeys'
import { normalizeTagName } from './tags'
import { backoffMs, MAX_PARTS, partConcurrency } from './upload/multipartConfig'

describe('storage keys', () => {
  it('rejects signing another user prefix', () => {
    const me = 'user-a'
    const other = originalKey('user-b', 'abc')
    expect(userOwnsStorageKey(me, other)).toBe(false)
    expect(userOwnsStorageKey(me, originalKey(me, 'abc'))).toBe(true)
    expect(userOwnsStorageKey(me, '../etc/passwd')).toBe(false)
  })

  it('extracts keys from legacy public URLs', () => {
    expect(extractKeyFromStoredUrl('https://cdn.example/uploads/1-photo.jpg')).toBe('uploads/1-photo.jpg')
    expect(extractKeyFromStoredUrl('blob:https://x/1')).toBe(null)
  })
})

describe('tags', () => {
  it('normalizes names without changing display beyond trim', () => {
    expect(normalizeTagName('  Beach  Trip ')).toEqual({ name: 'Beach Trip', name_normalized: 'beach trip' })
  })
})

describe('multipart config', () => {
  it('caps part count and produces exponential backoff', () => {
    expect(MAX_PARTS).toBe(10_000)
    const a = backoffMs(0)
    const b = backoffMs(4)
    expect(b).toBeGreaterThan(a)
    expect(partConcurrency()).toBeGreaterThanOrEqual(1)
  })
})
