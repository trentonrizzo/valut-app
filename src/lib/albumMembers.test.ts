import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isAlbumGalleryFile, membershipKey, missingLegacyMemberships } from './albumMembers'
import { addFilesToAlbum, moveFilesToAlbum, removeFilesFromAlbum } from './albumMembership'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

describe('canonical album_files membership', () => {
  it('hides cover assets, non-ready uploads, and deleted rows from galleries', () => {
    expect(isAlbumGalleryFile({ purpose: 'content', upload_status: 'ready' })).toBe(true)
    expect(isAlbumGalleryFile({ purpose: null, upload_status: null })).toBe(true)
    expect(isAlbumGalleryFile({ purpose: 'cover', upload_status: 'ready' })).toBe(false)
    expect(isAlbumGalleryFile({ purpose: 'content', upload_status: 'uploading' })).toBe(false)
    expect(isAlbumGalleryFile({ purpose: 'content', upload_status: 'failed' })).toBe(false)
    expect(isAlbumGalleryFile({ purpose: 'content', upload_status: 'ready', deleted_at: '2026-01-01' })).toBe(false)
  })

  it('treats membership as album+file, allowing one file in many albums', () => {
    expect(membershipKey('a1', 'f1')).not.toBe(membershipKey('a2', 'f1'))
    expect(membershipKey('a1', 'f1')).toBe('a1:f1')
  })

  it('album helpers only write album_files for add/move/remove', () => {
    expect(addFilesToAlbum).toBeTypeOf('function')
    expect(removeFilesFromAlbum).toBeTypeOf('function')
    expect(moveFilesToAlbum).toBeTypeOf('function')
    const src = readFileSync(join(root, 'src/lib/albumMembership.ts'), 'utf8')
    expect(src).toContain("from('album_files')")
    expect(src).toContain('onConflict')
    expect(src).toMatch(/addFilesToAlbum[\s\S]*removeFilesFromAlbum/)
    expect(src).not.toMatch(/from\('files'\)\.delete/)
  })

  it('album gallery, cover picker, and viewer load members from album_files', () => {
    const dash = readFileSync(join(root, 'src/pages/Dashboard.tsx'), 'utf8')
    const viewer = readFileSync(join(root, 'src/pages/FullScreenMediaViewer.tsx'), 'utf8')
    const picker = readFileSync(join(root, 'src/components/albums/AlbumCoverPickerModal.tsx'), 'utf8')
    const members = readFileSync(join(root, 'src/lib/albumMembers.ts'), 'utf8')
    expect(members).toContain("from('album_files')")
    expect(members).toContain("from('files')")
    expect(members).toContain('reconcileLegacyAlbumMemberships')
    expect(dash).toContain('listAlbumMemberFiles')
    expect(viewer).toContain('listAlbumMemberFiles')
    expect(picker).toContain('listAlbumCoverCandidates')
    expect(dash).not.toMatch(/\.from\('files'\)[\s\S]{0,120}\.eq\('album_id'/)
  })

  it('phase 1 migration backfills album_files and does not drop files.album_id', () => {
    const src = readFileSync(join(root, 'supabase/migrations/20260921180000_v2_album_files_canonical.sql'), 'utf8')
    expect(src).toContain('on conflict do nothing')
    expect(src).toContain('sort_index')
    expect(src.toLowerCase()).not.toMatch(/drop column/)
    expect(src.toLowerCase()).not.toMatch(/drop table/)
    expect(src.toLowerCase()).not.toMatch(/drop column\s+.*album_id/)
    const reconcile = readFileSync(join(root, 'supabase/migrations/20260922120000_v2_album_files_legacy_reconcile.sql'), 'utf8')
    expect(reconcile).toContain('on conflict do nothing')
    expect(reconcile.toLowerCase()).not.toMatch(/delete from/)
    expect(reconcile.toLowerCase()).not.toMatch(/drop /)
  })

  it('legacy files.album_id without album_files becomes visible after backfill', () => {
    const files = [
      { id: 'f-recent', album_id: 'a1', user_id: 'u1' },
      { id: 'f-old', album_id: 'a1', user_id: 'u1' },
    ]
    const existing = [{ album_id: 'a1', file_id: 'f-old' }]
    const missing = missingLegacyMemberships(files, existing)
    expect(missing).toEqual([{ album_id: 'a1', file_id: 'f-recent', user_id: 'u1' }])
    const after = [...existing, ...missing]
    const members = after.filter((m) => m.album_id === 'a1').map((m) => m.file_id)
    expect(members.sort()).toEqual(['f-old', 'f-recent'])
    expect(
      isAlbumGalleryFile({ purpose: 'content', upload_status: 'ready', deleted_at: null }),
    ).toBe(true)
  })

  it('does not overwrite extra many-to-many memberships', () => {
    const files = [{ id: 'f1', album_id: 'a1', user_id: 'u1' }]
    const existing = [
      { album_id: 'a1', file_id: 'f1' },
      { album_id: 'a2', file_id: 'f1' },
    ]
    expect(missingLegacyMemberships(files, existing)).toEqual([])
  })
})
