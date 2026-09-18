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
