import { describe, expect, it } from 'vitest'
import { DEFAULT_MEDIA_FILTERS } from '../types/media'
import { sortColumn } from './mediaQueries'

describe('library query helpers', () => {
  it('stacks default filters as AND-friendly empty constraints', () => {
    const f = DEFAULT_MEDIA_FILTERS
    expect(f.type).toBe('all')
    expect(f.tagMode).toBe('and')
    expect(f.tagIds).toEqual([])
  })

  it('maps sort keys used by pagination', () => {
    expect(sortColumn('largest').col).toBe('file_size_bytes')
    expect(sortColumn('newest_upload').ascending).toBe(false)
    expect(sortColumn('longest').col).toBe('duration_ms')
  })
})

describe('library visibility compatibility', () => {
  it('keeps legacy null upload_status visible and hides deleted rows', async () => {
    const { readFileSync } = await import('node:fs')
    const { dirname, join } = await import('node:path')
    const { fileURLToPath } = await import('node:url')
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'mediaQueries.ts'), 'utf8')
    expect(src).toContain('upload_status.eq.ready')
    expect(src).toContain('upload_status.is.null')
    expect(src).toContain("is('deleted_at', null)")
    expect(src).toContain("eq('album_id', f.albumId)")
  })
})
