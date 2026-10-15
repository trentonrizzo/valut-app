import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { detectPersonName, nameFromLabel } from './nameTag'

describe('person name detection', () => {
  it('reads a name after a site prefix and a trailing number', () => {
    expect(detectPersonName({ filename: 'Website - Kaylee May 182.mp4' })).toBe('Kaylee May')
    expect(detectPersonName({ filename: 'Kaylee May 039.mp4' })).toBe('Kaylee May')
    expect(nameFromLabel('kaylee_may_039.mp4')).toBe('Kaylee May')
  })

  it('strips a domain and still keeps one shared name', () => {
    expect(detectPersonName({ filename: 'onlyfans.com - Kaylee May.mp4' })).toBe('Kaylee May')
    expect(detectPersonName({ sourceUrl: 'https://cdn.example.com/files/Kaylee%20May%20039.mp4' })).toBe('Kaylee May')
  })

  it('skips filenames that are not a confident name', () => {
    expect(detectPersonName({ filename: 'IMG_3432.MOV' })).toBeNull()
    expect(detectPersonName({ filename: 'vacation.mp4' })).toBeNull()
    expect(detectPersonName({ filename: 'Screenshot 2024-01-01.png' })).toBeNull()
    expect(detectPersonName({ filename: 'Kaylee.mp4' })).toBeNull()
    expect(detectPersonName({ filename: 'Kaylee May - Jordan Lee.mp4' })).toBeNull()
    expect(detectPersonName({ filename: 'notes about the beach trip today.mp4' })).toBeNull()
  })

  it('can use a short title when the filename has no name', () => {
    expect(detectPersonName({ filename: 'export.mp4', title: 'Kaylee May' })).toBe('Kaylee May')
  })

  it('keeps name search inside the signed-in library query', () => {
    const library = readFileSync(new URL('./mediaQueries.ts', import.meta.url), 'utf8')
    const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')
    const upload = readFileSync(new URL('./upload/manager.ts', import.meta.url), 'utf8')
    expect(library).toContain('tag_search.tags.name')
    expect(library).toContain('original_filename.ilike')
    expect(app).toContain('path="names"')
    expect(upload).toContain('applyDetectedNameTag')
  })
})
