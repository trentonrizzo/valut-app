import { supabase } from './supabase'
import { isVideoFileName } from './mediaTypes'
import type { FileRow, MediaFilters, MediaSort, PageCursor } from '../types/media'
import { PAGE_SIZE } from '../types/media'

const RESOLUTION_MIN: Record<NonNullable<MediaFilters['resolution']>, { w: number; h: number }> = {
  '720': { w: 1280, h: 720 },
  '1080': { w: 1920, h: 1080 },
  '1440': { w: 2560, h: 1440 },
  '2160': { w: 3840, h: 2160 },
}

export function sortColumn(sort: MediaSort): { col: string; ascending: boolean; extra?: string } {
  switch (sort) {
    case 'oldest_upload':
      return { col: 'created_at', ascending: true }
    case 'newest_captured':
      return { col: 'captured_at', ascending: false }
    case 'oldest_captured':
      return { col: 'captured_at', ascending: true }
    case 'largest':
      return { col: 'file_size_bytes', ascending: false }
    case 'smallest':
      return { col: 'file_size_bytes', ascending: true }
    case 'longest':
      return { col: 'duration_ms', ascending: false }
    case 'shortest':
      return { col: 'duration_ms', ascending: true }
    case 'highest_res':
      return { col: 'width', ascending: false }
    case 'lowest_res':
      return { col: 'width', ascending: true }
    case 'highest_rating':
      return { col: 'rating', ascending: false }
    case 'favorites_first':
      return { col: 'favorite', ascending: false, extra: 'created_at' }
    default:
      return { col: 'created_at', ascending: false }
  }
}

export async function fetchTagAndFileIds(tagIds: string[]): Promise<string[]> {
  if (tagIds.length === 0) return []
  const { data, error } = await supabase.rpc('file_ids_with_all_tags', { p_tag_ids: tagIds })
  if (error) throw new Error(error.message)
  return ((data as { file_id: string }[] | null) ?? []).map((r) => r.file_id)
}

export async function listMediaPage(opts: {
  userId: string
  filters: MediaFilters
  cursor?: PageCursor | null
  limit?: number
}): Promise<{ rows: FileRow[]; nextCursor: PageCursor | null }> {
  const limit = opts.limit ?? PAGE_SIZE
  const f = opts.filters

  let tagIds: string[] | null = null
  if (f.tagIds.length > 0 && f.tagMode === 'and') {
    tagIds = await fetchTagAndFileIds(f.tagIds)
    if (tagIds.length === 0) return { rows: [], nextCursor: null }
  }

  let albumFileIds: string[] | null = null
  if (f.albumId) {
    const { data, error } = await supabase
      .from('album_files')
      .select('file_id')
      .eq('user_id', opts.userId)
      .eq('album_id', f.albumId)
    if (error) throw new Error(error.message)
    albumFileIds = (data ?? []).map((r) => r.file_id)
    if (albumFileIds.length === 0) return { rows: [], nextCursor: null }
  }

  let noAlbumIds: string[] | null = null
  if (f.noAlbum) {
    const { data, error } = await supabase.from('album_files').select('file_id').eq('user_id', opts.userId)
    if (error) throw new Error(error.message)
    noAlbumIds = (data ?? []).map((r) => r.file_id)
  }

  let q = supabase
    .from('files')
    .select('*')
    .eq('user_id', opts.userId)
    .eq('purpose', 'content')
    .eq('upload_status', 'ready')

  if (f.type === 'videos') {
    q = q.or('mime_type.ilike.video/%,file_name.ilike.%.mp4,file_name.ilike.%.mov,file_name.ilike.%.webm,file_name.ilike.%.mkv')
  } else if (f.type === 'photos') {
    q = q.not('mime_type', 'ilike', 'video/%')
  }

  if (tagIds) {
    q = q.in('id', tagIds.slice(0, 500))
  } else if (f.tagIds.length > 0 && f.tagMode === 'or') {
    const { data, error } = await supabase
      .from('file_tags')
      .select('file_id')
      .eq('user_id', opts.userId)
      .in('tag_id', f.tagIds)
    if (error) throw new Error(error.message)
    const ids = [...new Set((data ?? []).map((r) => r.file_id))]
    if (ids.length === 0) return { rows: [], nextCursor: null }
    q = q.in('id', ids.slice(0, 500))
  }

  if (albumFileIds) q = q.in('id', albumFileIds.slice(0, 500))
  if (noAlbumIds && noAlbumIds.length > 0) q = q.not('id', 'in', `(${noAlbumIds.slice(0, 500).join(',')})`)

  if (f.favorite === 'yes') q = q.eq('favorite', true)
  if (f.favorite === 'no') q = q.eq('favorite', false)
  if (f.ratingExact != null) q = q.eq('rating', f.ratingExact)
  if (f.ratingMin != null) q = q.gte('rating', f.ratingMin)
  if (f.sizeMin != null) q = q.gte('file_size_bytes', f.sizeMin)
  if (f.sizeMax != null) q = q.lte('file_size_bytes', f.sizeMax)
  if (f.durationMinMs != null) q = q.gte('duration_ms', f.durationMinMs)
  if (f.durationMaxMs != null) q = q.lte('duration_ms', f.durationMaxMs)
  if (f.resolution) {
    const r = RESOLUTION_MIN[f.resolution]
    q = q.gte('width', r.w).gte('height', r.h)
  }
  if (f.uploadedFrom) q = q.gte('created_at', f.uploadedFrom)
  if (f.uploadedTo) q = q.lte('created_at', f.uploadedTo)
  if (f.capturedFrom) q = q.gte('captured_at', f.capturedFrom)
  if (f.capturedTo) q = q.lte('captured_at', f.capturedTo)
  if (f.search.trim()) {
    const s = f.search.trim()
    q = q.or(`file_name.ilike.%${s}%`)
  }

  const { col, ascending, extra } = sortColumn(f.sort)
  const cursor = opts.cursor
  if (cursor) {
    if (col === 'created_at' || col === 'captured_at') {
      const op = ascending ? 'gt' : 'lt'
      if (cursor.ts) q = q.filter(col, op, cursor.ts)
    } else if (col === 'favorite') {
      if (cursor.ts) q = q.lt('created_at', cursor.ts)
    } else if (cursor.num != null) {
      const op = ascending ? 'gt' : 'lt'
      q = q.filter(col, op, cursor.num)
    }
  }

  q = q.order(col, { ascending, nullsFirst: false })
  if (extra) q = q.order(extra, { ascending: false })
  q = q.order('id', { ascending: false }).limit(limit + 1)

  const { data, error } = await q
  if (error) throw new Error(error.message)
  const rows = (data as FileRow[]) ?? []
  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  const last = page[page.length - 1]
  let nextCursor: PageCursor | null = null
  if (hasMore && last) {
    const num =
      col === 'file_size_bytes' || col === 'duration_ms' || col === 'width' || col === 'rating'
        ? Number(last[col as keyof FileRow] ?? 0)
        : col === 'favorite'
          ? last.favorite ? 1 : 0
          : null
    nextCursor = {
      ts: last.created_at,
      id: last.id,
      num,
    }
    if (col === 'captured_at') nextCursor.ts = last.captured_at
  }
  return { rows: page, nextCursor }
}

export async function countAlbumContent(userId: string, albumId: string): Promise<number> {
  const { count, error } = await supabase
    .from('album_files')
    .select('file_id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('album_id', albumId)
  if (error) throw new Error(error.message)
  return count ?? 0
}

export async function fetchAlbumPreviewFile(userId: string, albumId: string, coverFileId: string | null) {
  if (coverFileId) {
    const { data, error } = await supabase
      .from('files')
      .select('*')
      .eq('id', coverFileId)
      .eq('user_id', userId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (data) return data as FileRow
  }
  const { data: membership, error: mErr } = await supabase
    .from('album_files')
    .select('file_id')
    .eq('user_id', userId)
    .eq('album_id', albumId)
    .order('added_at', { ascending: false })
    .limit(1)
  if (mErr) throw new Error(mErr.message)
  const fid = membership?.[0]?.file_id
  if (!fid) return null
  const { data, error } = await supabase.from('files').select('*').eq('id', fid).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as FileRow) ?? null
}

export function isVideoRow(f: Pick<FileRow, 'file_name' | 'mime_type'>): boolean {
  if (f.mime_type?.startsWith('video/')) return true
  return isVideoFileName(f.file_name)
}
