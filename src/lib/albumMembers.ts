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

  const legacy = await listAlbumMemberFilesLegacy(userId, albumId, { ...opts, offset: 0, limit: Math.max(limit, 200) })

  if (!v11) {
    return { rows: legacy.rows.slice(offset, offset + limit), hasMore: legacy.rows.length > offset + limit }
  }

  const fromCanonical = await listAlbumMemberFilesCanonical(userId, albumId, opts)
  const merged = mergeAlbumMemberFiles(fromCanonical.rows, legacy.rows).filter((f) => keepMember(f, opts))
  const page = merged.slice(offset, offset + limit)
  return { rows: page, hasMore: merged.length > offset + limit || fromCanonical.hasMore }
}

async function listAlbumMemberFilesCanonical(
  userId: string,
  albumId: string,
  opts: ListAlbumMembersOpts,
): Promise<{ rows: AlbumMemberFile[]; hasMore: boolean }> {
  const offset = 0
  const limit = Math.max(opts.limit ?? 48, 200)
  const withSort = await supabase
    .from('album_files')
    .select('file_id, added_at, sort_index, files(*)')
    .eq('user_id', userId)
    .eq('album_id', albumId)
    .order('sort_index', { ascending: true })
    .order('added_at', { ascending: false })
    .range(offset, offset + limit - 1)

  const result = withSort.error
    ? await supabase
        .from('album_files')
        .select('file_id, added_at, files(*)')
        .eq('user_id', userId)
        .eq('album_id', albumId)
        .order('added_at', { ascending: false })
        .range(offset, offset + limit - 1)
    : withSort

  if (result.error) return { rows: [], hasMore: false }

  const rows: AlbumMemberFile[] = []
  for (const raw of result.data ?? []) {
    const file = unwrapJoinedFile((raw as { files?: unknown }).files)
    if (!file) continue
    if (!keepMember(file, opts)) continue
    rows.push(
      toMember(
        file,
        (raw as { added_at?: string }).added_at,
        Number((raw as { sort_index?: number }).sort_index ?? 0),
      ),
    )
  }
  return { rows, hasMore: (result.data ?? []).length >= limit }
}

async function listAlbumMemberFilesLegacy(
  userId: string,
  albumId: string,
  opts: ListAlbumMembersOpts,
): Promise<{ rows: AlbumMemberFile[]; hasMore: boolean }> {
  const offset = opts.offset ?? 0
  const limit = opts.limit ?? 48
  const { data, error } = await supabase
    .from('files')
    .select('*')
    .eq('user_id', userId)
    .eq('album_id', albumId)
    .or('upload_status.eq.ready,upload_status.is.null')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)
  if (error) return { rows: [], hasMore: false }
  const all = (data as FileRow[]) ?? []
  const rows = all.filter((f) => keepMember(f, opts))
  return { rows, hasMore: all.length >= limit }
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
