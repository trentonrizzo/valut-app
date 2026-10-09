import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sortGalleryFiles } from './gallerySort'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

describe('truthful original-date sorting', () => {
  const rows = [
    {
      file_name: 'unknown.jpg',
      created_at: '2026-10-09T00:00:00Z',
      captured_at: '2025-01-01T00:00:00Z',
      captured_at_source: 'file_last_modified',
    },
    {
      file_name: 'old.jpg',
      created_at: '2026-10-08T00:00:00Z',
      captured_at: '2020-01-01T00:00:00Z',
      captured_at_source: 'exif_datetime_original',
    },
    {
      file_name: 'new.jpg',
      created_at: '2026-10-07T00:00:00Z',
      captured_at: '2024-01-01T00:00:00Z',
      captured_at_source: 'quicktime_day',
    },
  ]

  it('puts trustworthy dates in order and unknown/fallback dates last', () => {
    expect(sortGalleryFiles(rows, 'newest_captured').map((row) => row.file_name)).toEqual([
      'new.jpg',
      'old.jpg',
      'unknown.jpg',
    ])
    expect(sortGalleryFiles(rows, 'oldest_captured').map((row) => row.file_name)).toEqual([
      'old.jpg',
      'new.jpg',
      'unknown.jpg',
    ])
  })
})

describe('viewer reliability source contracts', () => {
  it('keeps slide width stable before and after measurement', () => {
    const css = readFileSync(join(root, 'src/index.css'), 'utf8')
    const viewer = readFileSync(join(root, 'src/pages/FullScreenMediaViewer.tsx'), 'utf8')
    expect(css).toContain('flex: 0 0 100%')
    expect(css).toContain('min-width: 100%')
    expect(viewer).toContain('getBoundingClientRect().width')
    expect(viewer).toContain('window.visualViewport')
  })

  it('offers distinct Photos share and file download actions', () => {
    const viewer = readFileSync(join(root, 'src/pages/FullScreenMediaViewer.tsx'), 'utf8')
    expect(viewer).toContain('Save to Photos')
    expect(viewer).toContain('Download File')
    expect(viewer).toContain('Share sheet opened — choose Save Image or Save Video.')
  })
})

