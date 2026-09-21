import { supabase } from './supabase'
import { isV11SchemaReady } from './schemaGuard'
import type { FileRow } from '../types/media'

export type AlbumMemberFile = FileRow & { membershipAddedAt?: string; sortIndex?: number }

export type ListAlbumMembersOpts = {
  offset?: number
  limit?: number
  includeCoverAssets?: boolean
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

function unwrapJoinedFile(raw: unknown): FileRow | null {
  if (!raw) return null
  if (Array.isArray(raw)) return (raw[0] as FileRow) ?? null
  return raw as FileRow
}

export async function listAlbumMemberFiles(
  userId: string,
  albumId: string,
  opts: ListAlbumMembersOpts = {},
): Promise<{ rows: AlbumMemberFile[]; hasMore: boolean }> {
  const offset = opts.offset ?? 0
  const limit = opts.limit ?? 48
  const v11 = await isV11SchemaReady()

  if (v11) {
    const { data, error } = await supabase
      .from('album_files')
      .select('file_id, added_at, sort_index, files(*)')
      .eq('user_id', userId)
      .eq('album_id', albumId)
      .order('sort_index', { ascending: true })
      .order('added_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) {
      return listAlbumMemberFilesLegacy(userId, albumId, opts)
    }

    const rows: AlbumMemberFile[] = []
    for (const raw of data ?? []) {
      const file = unwrapJoinedFile((raw as { files?: unknown }).files)
      if (!file) continue
      if (!opts.includeCoverAssets && !isAlbumGalleryFile(file)) continue
      if (opts.includeCoverAssets && file.upload_status && file.upload_status !== 'ready') continue
      if (file.deleted_at) continue
      rows.push({
        ...file,
        membershipAddedAt: (raw as { added_at?: string }).added_at,
        sortIndex: Number((raw as { sort_index?: number }).sort_index ?? 0),
      })
    }
    return { rows, hasMore: (data ?? []).length >= limit }
  }

  return listAlbumMemberFilesLegacy(userId, albumId, opts)
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
  if (error) throw new Error(error.message)
  const all = (data as FileRow[]) ?? []
  const rows = all
    .filter((f) => (opts.includeCoverAssets ? true : isAlbumGalleryFile(f)))
    .filter((f) => !f.deleted_at)
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
