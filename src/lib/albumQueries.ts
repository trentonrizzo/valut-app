import { supabase } from './supabase'
import { isVideoFileName } from './mediaTypes'
import type { AlbumRow, AlbumWithMeta } from '../types/album'
import type { FileRow } from '../types/media'
import { albumViewAllowed } from './albumPin'

export type FileRowForAlbumMeta = {
  id: string
  album_id: string | null
  file_name: string
  file_url: string
  created_at: string
  file_size_bytes: number | null
  purpose: string | null
  is_encrypted: boolean | null
}

function metaFromFile(file: Pick<FileRow, 'id' | 'file_name' | 'file_url' | 'is_encrypted'> | null) {
  if (!file) {
    return {
      previewUrl: null as string | null,
      previewIsVideo: false,
      previewIsEncrypted: false,
      previewFileName: null as string | null,
      previewFileId: null as string | null,
    }
  }
  return {
    previewUrl: file.file_url,
    previewIsVideo: isVideoFileName(file.file_name),
    previewIsEncrypted: file.is_encrypted === true,
    previewFileName: file.file_name,
    previewFileId: file.id,
  }
}

export function isContentFile(f: FileRowForAlbumMeta): boolean {
  return f.purpose !== 'cover'
}

export function buildAlbumsWithMeta(albums: AlbumRow[], _allFiles: FileRowForAlbumMeta[] = []): AlbumWithMeta[] {
  return albums.map((album) => ({
    ...album,
    itemCount: 0,
    totalBytes: 0,
    ...metaFromFile(null),
  }))
}

export async function fetchAlbumsWithCounts(userId: string) {
  const albumsRes = await supabase
    .from('albums')
    .select('*')
    .eq('user_id', userId)
    .order('order_index', { ascending: true })

  if (albumsRes.error) {
    return { data: null as AlbumWithMeta[] | null, error: albumsRes.error.message }
  }

  const albumRows = (albumsRes.data ?? []) as AlbumRow[]
  const { data: stats, error: statsErr } = await supabase.rpc('album_content_stats')
  if (statsErr) {
    return fetchAlbumsWithCountsLegacy(userId, albumRows)
  }
  const byAlbum = new Map<string, { item_count: number; total_bytes: number }>()
  for (const row of (stats as { album_id: string; item_count: number; total_bytes: number }[] | null) ?? []) {
    byAlbum.set(row.album_id, { item_count: Number(row.item_count), total_bytes: Number(row.total_bytes) })
  }

  const coverIds = albumRows.map((a) => a.cover_file_id).filter((id): id is string => Boolean(id))
  const coverMap = new Map<string, FileRow>()
  if (coverIds.length > 0) {
    const { data: covers, error: cErr } = await supabase
      .from('files')
      .select('id, file_name, file_url, is_encrypted, mime_type')
      .eq('user_id', userId)
      .in('id', coverIds)
    if (cErr) return { data: null as AlbumWithMeta[] | null, error: cErr.message }
    for (const c of (covers ?? []) as FileRow[]) coverMap.set(c.id, c)
  }

  const missing = albumRows.filter((a) => !a.cover_file_id || !coverMap.has(a.cover_file_id))
  const fallback = new Map<string, FileRow>()
  await Promise.all(
    missing.map(async (album) => {
      const { data } = await supabase
        .from('album_files')
        .select('file_id, files(id, file_name, file_url, is_encrypted, mime_type)')
        .eq('user_id', userId)
        .eq('album_id', album.id)
        .order('added_at', { ascending: false })
        .limit(1)
      const row = data?.[0] as { files?: FileRow | FileRow[] | null } | undefined
      const file = Array.isArray(row?.files) ? row?.files[0] : row?.files
      if (file) fallback.set(album.id, file)
    }),
  )

  const data: AlbumWithMeta[] = albumRows.map((album) => {
    const st = byAlbum.get(album.id)
    const cover = album.cover_file_id ? coverMap.get(album.cover_file_id) : undefined
    const file = cover ?? fallback.get(album.id) ?? null
    const reveal = albumViewAllowed(album)
    return {
      ...album,
      isProtected: album.is_protected === true,
      itemCount: st?.item_count ?? 0,
      totalBytes: st?.total_bytes ?? 0,
      ...metaFromFile(reveal ? file : null),
    }
  })

  return { data, error: null as string | null }
}

/** V1-compatible album list when V1.1 RPCs/tables are not applied yet. */
async function fetchAlbumsWithCountsLegacy(userId: string, albumRows: AlbumRow[]) {
  const { data: files, error } = await supabase
    .from('files')
    .select('id, album_id, file_name, file_url, is_encrypted, mime_type, file_size_bytes, purpose, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1000)
  if (error) return { data: null as AlbumWithMeta[] | null, error: error.message }

  const byAlbum = new Map<string, { item_count: number; total_bytes: number; preview: FileRow | null }>()
  for (const raw of files ?? []) {
    const f = raw as FileRow & { album_id: string | null }
    if (!f.album_id) continue
    const st = byAlbum.get(f.album_id) ?? { item_count: 0, total_bytes: 0, preview: null }
    if (f.purpose !== 'cover') {
      st.item_count += 1
      st.total_bytes += Number(f.file_size_bytes ?? 0)
      if (!st.preview) st.preview = f
    }
    byAlbum.set(f.album_id, st)
  }

  const coverIds = albumRows.map((a) => a.cover_file_id).filter((id): id is string => Boolean(id))
  const coverMap = new Map<string, FileRow>()
  for (const f of (files ?? []) as FileRow[]) {
    if (coverIds.includes(f.id)) coverMap.set(f.id, f)
  }

  const data: AlbumWithMeta[] = albumRows.map((album) => {
    const st = byAlbum.get(album.id)
    const cover = album.cover_file_id ? coverMap.get(album.cover_file_id) : undefined
    const file = cover ?? st?.preview ?? null
    return {
      ...album,
      itemCount: st?.item_count ?? 0,
      totalBytes: st?.total_bytes ?? 0,
      ...metaFromFile(file),
    }
  })
  return { data, error: null as string | null }
}
