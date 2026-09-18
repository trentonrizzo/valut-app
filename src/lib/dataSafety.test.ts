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

  it('api/delete never deletes R2 objects', () => {
    const src = readFileSync(join(root, 'api/delete.js'), 'utf8')
    expect(src).not.toContain('deleteFile')
    expect(src).not.toContain('DeleteObject')
    expect(src).toContain('Permanent original deletion is disabled')
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

  it('album gallery query does not require upload_status', () => {
    const src = readFileSync(join(root, 'src/pages/Dashboard.tsx'), 'utf8')
    expect(src).not.toMatch(/eq\('upload_status'/)
  })
})
