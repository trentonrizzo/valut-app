import { describe, expect, it } from 'vitest'
import { isLegacyPublicFile, isHttpsUrl, mediaFragmentUrl } from './legacyUrl'

describe('legacy media URLs', () => {
  it('treats https file_url without storage_key as legacy public', () => {
    expect(
      isLegacyPublicFile({
        file_url: 'https://cdn.example/uploads/a.jpg',
        storage_key: null,
        thumbnail_key: null,
        poster_key: null,
      }),
    ).toBe(true)
  })

  it('does not treat private storage_key rows as legacy public', () => {
    expect(
      isLegacyPublicFile({
        file_url: 'r2://users/u/originals/1',
        storage_key: 'users/u/originals/1',
      }),
    ).toBe(false)
  })

  it('adds a media fragment for video frame fallback', () => {
    expect(mediaFragmentUrl('https://cdn.example/v.mp4')).toBe('https://cdn.example/v.mp4#t=0.1')
    expect(isHttpsUrl('https://cdn.example/v.mp4')).toBe(true)
  })
})
