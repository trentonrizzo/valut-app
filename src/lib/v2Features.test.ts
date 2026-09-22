import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { classifyFileKind, isPhotoKind } from './fileKind'
import { storedObjectBytes } from './upload/storedSize'
import { canCatalogReady, fileMatchesResume, planUpload } from './upload/strategy'
import { filesFromInput, inspectSelectedFile, selectionFailureReason } from './upload/selectFiles'
import { advancedFilterCount, clearAdvancedFilters } from './libraryFilters'
import { DEFAULT_MEDIA_FILTERS } from '../types/media'
import { CHUNK_PLAINTEXT_BYTES, GCM_TAG_BYTES } from './crypto/chunkCipher'
import { emptyPayload } from './editor/projects'
import { albumViewAllowed } from './albumPin'
import { canRevealLockedContent, isFileLocked } from './locks'
import { isAlbumGalleryFile } from './albumMembers'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

describe('file classification', () => {
  it('does not treat documents as photos', () => {
    expect(classifyFileKind({ name: 'notes.pdf', mime_type: 'application/pdf' })).toBe('pdf')
    expect(classifyFileKind({ name: 'pack.zip' })).toBe('archive')
    expect(classifyFileKind({ name: 'resume.docx' })).toBe('document')
    expect(classifyFileKind({ name: 'song.mp3' })).toBe('audio')
    expect(classifyFileKind({ name: 'IMG_1.HEIC' })).toBe('image')
    expect(classifyFileKind({ name: 'clip.MOV', type: '' })).toBe('video')
    expect(isPhotoKind(classifyFileKind({ name: 'a.pdf' }))).toBe(false)
  })
})

describe('iphone selection diagnostics', () => {
  it('accepts blank MIME .mov and surfaces empty FileList', () => {
    const f = new File([new Uint8Array(32)], 'IMG_0099.MOV', { type: '' })
    const inspected = inspectSelectedFile(f)
    expect(inspected.type).toBe('video/quicktime')
    expect(inspected.isVideo).toBe(true)
    expect(selectionFailureReason([])).toMatch(/iCloud|Safari/)
    expect(selectionFailureReason([new File([], 'empty.mov')])).toMatch(/empty/)
    expect(filesFromInput(null)).toEqual([])
  })
})

describe('encrypted stored-size verification', () => {
  it('compares ciphertext size, not plaintext, when encrypted', () => {
    const plain = 8 * 1024 * 1024 + 100
    const stored = storedObjectBytes(plain, true, CHUNK_PLAINTEXT_BYTES)
    expect(stored).toBe(plain + GCM_TAG_BYTES * 2)
    expect(
      canCatalogReady({
        r2Verified: true,
        verifiedSize: stored,
        size: plain,
        storedSize: stored,
        encryptionVersion: 1,
      }),
    ).toBe(true)
    expect(
      canCatalogReady({
        r2Verified: true,
        verifiedSize: plain,
        size: plain,
        storedSize: stored,
        encryptionVersion: 1,
      }),
    ).toBe(false)
    expect(canCatalogReady({ r2Verified: true, verifiedSize: 18, size: 18 })).toBe(true)
  })
})

describe('10 GB planner', () => {
  it('plans a 10 GB upload without allocating a 10 GB buffer', () => {
    const tenGb = 10 * 1024 * 1024 * 1024
    const plan = planUpload(tenGb)
    expect(plan.useMultipart).toBe(true)
    expect(plan.parts.length).toBeGreaterThan(100)
    expect(plan.parts.length).toBeLessThanOrEqual(10_000)
    expect(plan.parts.reduce((s, p) => s + p.bytes, 0)).toBe(tenGb)
  })
})

describe('resume matching', () => {
  it('rejects a different lastModified when both sides have one', () => {
    expect(
      fileMatchesResume(
        { name: 'a.mov', size: 9, lastModified: 2 },
        { fileName: 'a.mov', size: 9, lastModified: 1 },
      ).ok,
    ).toBe(false)
    expect(
      fileMatchesResume(
        { name: 'a.mov', size: 9, lastModified: 1 },
        { fileName: 'a.mov', size: 9, lastModified: 1 },
      ).ok,
    ).toBe(true)
  })
})

describe('locks and album PIN session', () => {
  it('keeps locked files hidden without a session unlock', () => {
    expect(isFileLocked({ locked: true })).toBe(true)
    expect(canRevealLockedContent({ locked: false })).toBe(true)
    expect(canRevealLockedContent({ locked: true })).toBe(false)
  })

  it('protects only the album context, not the file globally', () => {
    expect(albumViewAllowed({ id: 'a', is_protected: false })).toBe(true)
    expect(albumViewAllowed({ id: 'missing-session', is_protected: true })).toBe(false)
  })
})

describe('editor projects do not rewrite originals', () => {
  it('creates slot state that only references file ids', () => {
    const p = emptyPayload('2x2')
    expect(p.slots).toHaveLength(4)
    expect(p.slots.every((s) => s.fileId === null)).toBe(true)
    const src = readFileSync(join(root, 'src/lib/editor/projects.ts'), 'utf8')
    expect(src).not.toContain('DeleteObject')
    expect(src).toContain('editor_projects')
    const editor = readFileSync(join(root, 'src/pages/Editor.tsx'), 'utf8')
    expect(editor).toContain('VaultPhotoTileMedia')
    expect(editor).toContain('useDecryptedMediaSrc')
    expect(editor).not.toContain('r2://')
  })
})

describe('deleted items stay out of album galleries', () => {
  it('gallery predicate excludes deleted_at', () => {
    expect(isAlbumGalleryFile({ purpose: 'content', upload_status: 'ready', deleted_at: 'x' })).toBe(false)
  })

  it('restored media with null deleted_at is visible again', () => {
    expect(isAlbumGalleryFile({ purpose: 'content', upload_status: 'ready', deleted_at: null })).toBe(true)
    expect(isAlbumGalleryFile({ purpose: 'content', upload_status: null, deleted_at: null })).toBe(true)
  })
})

describe('library filter compaction', () => {
  it('counts advanced filters and keeps search/sort when clearing', () => {
    expect(advancedFilterCount(DEFAULT_MEDIA_FILTERS)).toBe(0)
    expect(
      advancedFilterCount({
        ...DEFAULT_MEDIA_FILTERS,
        type: 'videos',
        favorite: 'yes',
        resolution: '2160',
      }),
    ).toBe(3)
    const cleared = clearAdvancedFilters({
      ...DEFAULT_MEDIA_FILTERS,
      search: 'beach',
      sort: 'largest',
      type: 'photos',
    })
    expect(cleared.search).toBe('beach')
    expect(cleared.sort).toBe('largest')
    expect(cleared.type).toBe('all')
  })
})
