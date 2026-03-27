import { supabase } from './supabase'
import { isVideoFileName } from './mediaTypes'
import type { AlbumRow, AlbumWithMeta } from '../types/album'

/** Minimal file row for dashboard aggregation and previews */
export type FileRowForAlbumMeta = {
  id: string
  album_id: string
  file_name: string
  file_url: string
  created_at: string
  file_size_bytes: number | null
  /** 'content' | 'cover'; missing/null treated as content */
  purpose: string | null
  is_encrypted: boolean | null
}

export function isContentFile(f: FileRowForAlbumMeta): boolean {
  return f.purpose !== 'cover'
}

function sumContentFileBytes(files: FileRowForAlbumMeta[]): number {
  let sum = 0
  for (const f of files) {
    if (!isContentFile(f)) continue
    const n = f.file_size_bytes
    if (n != null && Number.isFinite(n) && n >= 0) sum += n
  }
  return sum
}

function countContentFiles(files: FileRowForAlbumMeta[]): number {
  return files.reduce((n, f) => (isContentFile(f) ? n + 1 : n), 0)
}

function pickNewest(files: FileRowForAlbumMeta[]): FileRowForAlbumMeta | null {
  if (files.length === 0) return null
  return [...files].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  )[0]
}

function previewForAlbum(album: AlbumRow, byAlbum: Map<string, FileRowForAlbumMeta[]>): {
  previewUrl: string | null
  previewIsVideo: boolean
  previewIsEncrypted: boolean
  previewFileName: string | null
} {
  const all = byAlbum.get(album.id) ?? []
  const contentOnly = all.filter(isContentFile)

  let file: FileRowForAlbumMeta | null = null

  if (album.cover_file_id) {
    file = all.find((f) => f.id === album.cover_file_id) ?? null
  }
  if (!file) {
    file = pickNewest(contentOnly)
  }

  if (!file) {
    return { previewUrl: null, previewIsVideo: false, previewIsEncrypted: false, previewFileName: null }
  }

  return {
    previewUrl: file.file_url,
    previewIsVideo: isVideoFileName(file.file_name),
    previewIsEncrypted: file.is_encrypted === true,
    previewFileName: file.file_name,
  }
}

/**
 * Build album metadata from album rows and all files for the user.
 * Item count and storage use only purpose=content (legacy rows without purpose count as content).
 * Preview uses custom cover when set, else newest content file.
 */
export function buildAlbumsWithMeta(
  albums: AlbumRow[],
  allFiles: FileRowForAlbumMeta[],
): AlbumWithMeta[] {
  const byAlbum = new Map<string, FileRowForAlbumMeta[]>()
  for (const f of allFiles) {
    const arr = byAlbum.get(f.album_id)
    if (arr) arr.push(f)
    else byAlbum.set(f.album_id, [f])
  }

  return albums.map((album) => {
    const list = byAlbum.get(album.id) ?? []
    const { previewUrl, previewIsVideo, previewIsEncrypted, previewFileName } = previewForAlbum(
      album,
      byAlbum,
    )
    return {
      ...album,
      itemCount: countContentFiles(list),
      totalBytes: sumContentFileBytes(list),
      previewUrl,
      previewIsVideo,
      previewIsEncrypted,
      previewFileName,
    }
  })
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

  const filesRes = await supabase
    .from('files')
    .select('id, album_id, file_name, file_url, created_at, file_size_bytes, purpose, is_encrypted')
    .eq('user_id', userId)

  if (filesRes.error) {
    return { data: null as AlbumWithMeta[] | null, error: filesRes.error.message }
  }

  const fileRows = (filesRes.data ?? []) as FileRowForAlbumMeta[]
  return {
    data: buildAlbumsWithMeta(albumRows, fileRows),
    error: null as string | null,
  }
}
