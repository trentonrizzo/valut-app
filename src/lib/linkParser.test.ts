import { describe, expect, it } from 'vitest'
import { normalizeSafeHttpUrl, parseLinksFromText } from './linkParser'

describe('bulk link parser', () => {
  it('parses Notes-style text and preserves MEGA fragments and query strings exactly', () => {
    const mega = 'https://mega.nz/folder/AbC123#Key_With-Case_9'
    const query = 'https://example.com/a?token=AbC%2F123&x=1#part'
    const rows = parseLinksFromText(`MEGA folder\n${mega}\nold photos: (${query}).\nrandom notes`)
    expect(rows.map((row) => row.url)).toEqual([mega, query])
  })

  it('deduplicates only exact normalized duplicates in the current batch', () => {
    const rows = parseLinksFromText('https://example.com/a https://example.com/a https://example.com/A')
    expect(rows).toHaveLength(2)
  })

  it('accepts 100 links without truncation', () => {
    const text = Array.from({ length: 100 }, (_, index) => `note ${index}: https://example.com/${index}`).join('\n')
    expect(parseLinksFromText(text)).toHaveLength(100)
  })

  it('supports www and rejects unsafe schemes', () => {
    expect(normalizeSafeHttpUrl('www.example.com/path')).toBe('https://www.example.com/path')
    expect(normalizeSafeHttpUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeSafeHttpUrl('data:text/html,test')).toBeNull()
    expect(normalizeSafeHttpUrl('file:///tmp/private')).toBeNull()
  })
})
