import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

describe('data-safety source contracts', () => {
  it('album membership helpers never delete files or R2 objects', () => {
    const src = readFileSync(join(root, 'src/lib/albumMembership.ts'), 'utf8')
    expect(src).toContain("from('album_files')")
    expect(src).not.toMatch(/from\('files'\)\.delete/)
    expect(src).not.toContain('DeleteObject')
  })

  it('tag deletion only targets tags/file_tags', () => {
    const src = readFileSync(join(root, 'src/lib/tags.ts'), 'utf8')
    expect(src).toContain("from('tags').delete")
    expect(src).not.toMatch(/from\('files'\)\.delete/)
  })

  it('v1.1 migration does not drop tables or truncate', () => {
    const src = readFileSync(join(root, 'supabase/migrations/20260918200000_v11_additive.sql'), 'utf8')
    const uncommented = src.replace(/--.*$/gm, '')
    expect(uncommented.toLowerCase()).not.toMatch(/drop table\s/)
    expect(uncommented.toLowerCase()).not.toMatch(/\btruncate\b/)
    expect(src).toContain('on delete set null')
    expect(src).toContain('on conflict do nothing')
    expect(src).toContain('files_select_own')
    expect(src).toMatch(/using \(auth\.uid\(\) = user_id\)/)
    expect(src).toContain('album_id is null')
  })

  it('api/delete only deletes owned keys after an explicit permanent action', () => {
    const src = readFileSync(join(root, 'api/delete.js'), 'utf8')
    expect(src).toContain("action === 'permanent'")
    expect(src).toContain('userOwnsStorageKey')
    expect(src).toContain('DeleteObjectCommand')
    expect(src).toContain('R2 object still present after delete')
    expect(src).toContain('empty-trash')
  })

  it('one-shot apply script is additive and count-guarded', () => {
    const src = readFileSync(join(root, 'supabase/v11_apply_and_verify.sql'), 'utf8')
    const uncommented = src.replace(/--.*$/gm, '')
    expect(uncommented.toLowerCase()).not.toMatch(/drop table\s/)
    expect(uncommented.toLowerCase()).not.toMatch(/\btruncate\b/)
    expect(src).toContain('BEGIN;')
    expect(src).toContain('COMMIT;')
    expect(src).toMatch(/files count decreased/)
  })

  it('major pass migration is additive (no truncate/drop table)', () => {
    const src = readFileSync(join(root, 'supabase/migrations/20260925180000_major_pass_additive.sql'), 'utf8')
    const uncommented = src.replace(/--.*$/gm, '')
    expect(uncommented.toLowerCase()).not.toMatch(/drop table\s/)
    expect(uncommented.toLowerCase()).not.toMatch(/\btruncate\b/)
    expect(src).toContain('add column if not exists')
    expect(src).toContain('media_analysis')
    // Function drop/recreate for OUT-param changes is allowed; not data-destructive.
    expect(src).toContain('drop function if exists public.album_content_stats')
  })

  it('album gallery hides non-ready uploads without dropping legacy rows', () => {
    const src = readFileSync(join(root, 'src/lib/albumMembers.ts'), 'utf8')
    expect(src).toContain("upload_status && f.upload_status !== 'ready'")
    expect(src).toContain("purpose !== 'cover'")
    expect(src).toContain("from('album_files')")
  })

  it('app renders a boot screen instead of throwing on missing supabase env', () => {
    const src = readFileSync(join(root, 'src/lib/supabase.ts'), 'utf8')
    expect(src).not.toMatch(/if \(!url \|\| !anonKey\) \{\s*throw/)
    expect(src).toContain('supabaseConfigError')
    const app = readFileSync(join(root, 'src/App.tsx'), 'utf8')
    expect(app).toContain('ErrorBoundary')
    expect(app).toContain('BootScreen')
  })

  it('capture-date/link migration is additive and never rewrites media or link rows', () => {
    const src = readFileSync(join(root, 'supabase/migrations/20261002223000_capture_dates_and_link_lifecycle.sql'), 'utf8')
    const uncommented = src.replace(/--.*$/gm, '').toLowerCase()
    expect(uncommented).not.toMatch(/drop table\s/)
    expect(uncommented).not.toMatch(/\btruncate\b/)
    expect(uncommented).not.toMatch(/delete\s+from/)
    expect(uncommented).not.toMatch(/update\s+public\.(files|vault_links)/)
    expect(src).toContain('captured_at_source')
    expect(src).toContain('add column if not exists deleted_at')
  })

  it('saved links never invoke R2 or external preview services', () => {
    const src = readFileSync(join(root, 'src/lib/links.ts'), 'utf8')
    expect(src).not.toContain('DeleteObject')
    expect(src).not.toContain('R2_')
    expect(src).not.toMatch(/fetch\s*\(/)
  })

  it('provider metadata migration is additive and never rewrites URLs or existing titles', () => {
    const src = readFileSync(join(root, 'supabase/migrations/20261003110000_link_provider_metadata.sql'), 'utf8')
    const uncommented = src.replace(/--.*$/gm, '').toLowerCase()
    expect(uncommented).not.toMatch(/drop\s/)
    expect(uncommented).not.toMatch(/\btruncate\b/)
    expect(uncommented).not.toMatch(/delete\s+from/)
    expect(uncommented).not.toMatch(/update\s+public\.vault_links/)
    expect(src).toContain('automatic_title')
    expect(src).toContain('provider_created_at')
  })

  it('always renders Created separately from Uploaded and keeps Created visible when unknown', () => {
    const src = readFileSync(join(root, 'src/components/files/MediaDetailsSheet.tsx'), 'utf8')
    expect(src).toContain("{ label: 'Created', value: fmtCaptured(file) }")
    expect(src).toContain("{ label: 'Uploaded', value: fmtDate(file.created_at) }")
    expect(src).toContain("return 'Unknown'")
  })

  it('keeps bounded capture extraction active in legacy upload mode', () => {
    const src = readFileSync(join(root, 'src/lib/upload/manager.ts'), 'utf8')
    expect(src).toContain('extractBoundedMediaMetadata(file)')
    expect(src).toContain("logUploadSelection('metadata-bounded-legacy'")
  })

  it('persists the exact selected and verified stored byte counts without transforming originals', () => {
    const src = readFileSync(join(root, 'src/lib/upload/manager.ts'), 'utf8')
    expect(src).toContain('file_size_bytes: job.size')
    expect(src).toContain('stored_size_bytes: expectedVerifySize(job)')
    expect(src).toContain('sourceSizeBytes: job.size')
    expect(src).toContain("method: 'r2_head_size'")
    expect(src).toContain("storage_integrity: job.r2Verified")
    expect(src).not.toMatch(/transcod|recompress|downscale/i)
  })

  it('backfills metadata with bounded range reads and never rewrites originals', () => {
    const src = readFileSync(join(root, 'src/lib/mediaIndexBackfill.ts'), 'utf8')
    expect(src).toContain('backfillMediaMetadataBatch')
    expect(src).toContain('fetchBoundedRange')
    expect(src).toContain('captureMetadataChunkIndexes')
    expect(src).toContain('apiVerifyObject')
    expect(src).not.toContain('PutObjectCommand')
    expect(src).not.toContain('DeleteObjectCommand')
  })

  it('uses the authoritative shared Details panel in Library and album views', () => {
    const dashboard = readFileSync(join(root, 'src/pages/Dashboard.tsx'), 'utf8')
    const library = readFileSync(join(root, 'src/pages/Library.tsx'), 'utf8')
    expect(dashboard).toContain('<MediaDetailsSheet')
    expect(library).toContain('<MediaDetailsSheet')
    expect(dashboard).not.toContain('vault-file-info-dl')
  })
})
