import { supabase } from './supabase'
import { isV11SchemaReady } from './schemaGuard'
import type { FileRow } from '../types/media'

export type AlbumMemberFile = FileRow & { membershipAddedAt?: string; sortIndex?: number }

export type ListAlbumMembersOpts = {
  offset?: number
  limit?: number
  includeCoverAssets?: boolean
}

export type LegacyFileRef = { id: string; album_id: string | null; user_id: string }
export type MembershipRef = { album_id: string; file_id: string }

export function albumMemberPagePlan(canonicalCount: number, offset: number, limit: number) {
  const canonicalLimit = Math.max(0, Math.min(limit, canonicalCount - offset))
  return {
    canonicalOffset: Math.min(offset, canonicalCount),
    canonicalLimit,
    legacyOffset: Math.max(0, offset - canonicalCount),
    legacyLimit: limit - canonicalLimit,
  }
}

export function isAlbumGalleryFile(f: {
  purpose?: string | null
  upload_status?: string | null
  deleted_at?: string | null
}): boolean {
  if (f.deleted_at) return false
  if (f.upload_status && f.upload_status !== 'ready') return false
  return f.purpose !== 'cover'
}

export function missingLegacyMemberships(files: LegacyFileRef[], existing: MembershipRef[]): Array<{
  album_id: string
  file_id: string
  user_id: string
}> {
  const have = new Set(existing.map((m) => `${m.album_id}:${m.file_id}`))
  const out: Array<{ album_id: string; file_id: string; user_id: string }> = []
  for (const f of files) {
    if (!f.album_id) continue
    const key = `${f.album_id}:${f.id}`
    if (have.has(key)) continue
    have.add(key)
    out.push({ album_id: f.album_id, file_id: f.id, user_id: f.user_id })
  }
  return out
}

export function mergeAlbumMemberFiles(primary: AlbumMemberFile[], extra: AlbumMemberFile[]): AlbumMemberFile[] {
  const seen = new Set<string>()
  const out: AlbumMemberFile[] = []
  for (const f of [...primary, ...extra]) {
    if (!f?.id || seen.has(f.id)) continue
    seen.add(f.id)
    out.push(f)
  }
  return out
}

function unwrapJoinedFile(raw: unknown): FileRow | null {
  if (!raw) return null
  if (Array.isArray(raw)) return (raw[0] as FileRow) ?? null
  return raw as FileRow
}

function toMember(file: FileRow, addedAt?: string, sortIndex?: number): AlbumMemberFile {
  return { ...file, membershipAddedAt: addedAt, sortIndex: sortIndex ?? 0 }
}

function keepMember(file: FileRow, opts: ListAlbumMembersOpts): boolean {
  if (file.deleted_at) return false
  if (!opts.includeCoverAssets) return isAlbumGalleryFile(file)
  if (file.upload_status && file.upload_status !== 'ready') return false
  return true
}

export async function reconcileLegacyAlbumMemberships(userId: string): Promise<number> {
  const v11 = await isV11SchemaReady()
  if (!v11) return 0
  const { data: files, error } = await supabase
    .from('files')
    .select('id, album_id, user_id')
    .eq('user_id', userId)
    .not('album_id', 'is', null)
  if (error || !files?.length) return 0

  const { data: existing, error: memErr } = await supabase
    .from('album_files')
    .select('album_id, file_id')
    .eq('user_id', userId)
  if (memErr) return 0

  const missing = missingLegacyMemberships(files as LegacyFileRef[], (existing ?? []) as MembershipRef[])
  if (missing.length === 0) return 0

  const { error: upErr } = await supabase.from('album_files').upsert(missing, { onConflict: 'album_id,file_id' })
  if (upErr) return 0
  return missing.length
}

export async function listAlbumMemberFiles(
  userId: string,
  albumId: string,
  opts: ListAlbumMembersOpts = {},
): Promise<{ rows: AlbumMemberFile[]; hasMore: boolean }> {
  const offset = opts.offset ?? 0
  const limit = opts.limit ?? 48
  const v11 = await isV11SchemaReady()
  if (!v11) return legacyPage(userId, albumId, offset, limit, opts, false)

  // Canonical membership order is stable. Legacy-only rows follow it, without
  // loading/truncating an ID list or repeating the first window on every page.
  let countQuery = supabase.from('album_files')
    .select('file_id,files!inner(*)', { count: 'exact', head: true })
    .eq('user_id', userId).eq('album_id', albumId).eq('files.user_id', userId)
    .is('files.deleted_at', null)
    .or('upload_status.eq.ready,upload_status.is.null', { referencedTable: 'files' })
  if (!opts.includeCoverAssets) countQuery = countQuery.or('purpose.eq.content,purpose.is.null', { referencedTable: 'files' })
  const countResult = await countQuery
  if (countResult.error) throw new Error(countResult.error.message)
  const total = countResult.count ?? 0
  const plan = albumMemberPagePlan(total, offset, limit)

  const buildCanonical = (withSort: boolean) => {
    let q = supabase.from('album_files')
      .select(withSort ? 'file_id,added_at,sort_index,files!inner(*)' : 'file_id,added_at,files!inner(*)')
      .eq('user_id', userId).eq('album_id', albumId).eq('files.user_id', userId)
      .is('files.deleted_at', null)
      .or('upload_status.eq.ready,upload_status.is.null', { referencedTable: 'files' })
    if (!opts.includeCoverAssets) q = q.or('purpose.eq.content,purpose.is.null', { referencedTable: 'files' })
    if (withSort) q = q.order('sort_index', { ascending: true })
    return q.order('added_at', { ascending: false }).order('file_id', { ascending: false })
      .range(plan.canonicalOffset, plan.canonicalOffset + plan.canonicalLimit - 1)
  }
  const rows: AlbumMemberFile[] = []
  if (plan.canonicalLimit > 0) {
    let result = await buildCanonical(true)
    if (result.error && /sort_index/.test(result.error.message)) result = await buildCanonical(false)
    if (result.error) throw new Error(result.error.message)
    for (const raw of result.data ?? []) {
      const row = raw as unknown as { files: unknown; added_at: string; sort_index?: number }
      const file = unwrapJoinedFile(row.files)
      if (file && keepMember(file, opts)) rows.push(toMember(file, row.added_at, row.sort_index))
    }
  }
  if (offset + rows.length < total) return { rows, hasMore: true }
  const legacy = await legacyPage(userId, albumId, plan.legacyOffset, plan.legacyLimit + 1, opts, true)
  const merged = [...rows, ...legacy.rows]
  return { rows: merged.slice(0, limit), hasMore: merged.length > limit || legacy.hasMore }
}

async function legacyPage(userId: string, albumId: string, offset: number, limit: number, opts: ListAlbumMembersOpts, excludeCanonical: boolean) {
  let q = supabase.from('files').select(excludeCanonical ? '*,canonical:album_files()' : '*')
    .eq('user_id', userId).eq('album_id', albumId)
    .or('upload_status.eq.ready,upload_status.is.null').is('deleted_at', null)
  if (!opts.includeCoverAssets) q = q.or('purpose.eq.content,purpose.is.null')
  if (excludeCanonical) q = q.eq('canonical.album_id', albumId).is('canonical', null)
  const { data, error } = await q.order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + limit)
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as unknown as AlbumMemberFile[]
  return { rows: rows.slice(0, limit), hasMore: rows.length > limit }
}

export async function listAlbumCoverCandidates(userId: string, albumId: string): Promise<AlbumMemberFile[]> {
  const page = await listAlbumMemberFiles(userId, albumId, {
    offset: 0,
    limit: 200,
    includeCoverAssets: true,
  })
  return page.rows
}

export function membershipKey(albumId: string, fileId: string): string {
  return `${albumId}:${fileId}`
}
