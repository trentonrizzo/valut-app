import { supabase } from './supabase'
import { cursorPredicate } from './mediaCursor'
import { isVideoFileName } from './mediaTypes'
import type { FileRow, MediaFilters, MediaSort, PageCursor } from '../types/media'
import { PAGE_SIZE } from '../types/media'
import { isV11SchemaReady, isV2SchemaReady } from './schemaGuard'
import { isAlbumGalleryFile } from './albumMembers'

function sanitizeSearch(raw: string): string {
  return raw.trim().replace(/[%(),]/g, ' ').replace(/\s+/g, ' ').slice(0, 80)
}

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
  signal?: AbortSignal
  fileIds?: string[]
  idsOnly?: boolean
}): Promise<{ rows: FileRow[]; nextCursor: PageCursor | null }> {
  const limit = opts.limit ?? PAGE_SIZE
  const f = opts.filters
  const v11 = await isV11SchemaReady()

  const qSearch = sanitizeSearch(f.search)
  const embeds: string[] = []
  if (v11 && (f.albumId || f.noAlbum)) embeds.push('album_match:album_files()')
  if (v11 && f.tagIds.length) {
    if (f.tagMode === 'and') f.tagIds.forEach((_, i) => embeds.push(`tag_${i}:file_tags!inner()`))
    else embeds.push('tag_any:file_tags!inner()')
  }
  if (v11 && qSearch) embeds.push('tag_search:file_tags(tags!inner())')
  const fields = opts.idsOnly ? 'id,created_at,captured_at,width,file_size_bytes,duration_ms,rating,favorite' : '*'
  let q = supabase.from('files').select([fields, ...embeds].join(',')).eq('user_id', opts.userId)
  if (v11 && f.albumId) {
    q = q.eq('album_match.album_id', f.albumId).eq('album_match.user_id', opts.userId)
      .or(`album_id.eq.${f.albumId},album_match.not.is.null`)
  }
  if (v11 && f.noAlbum) q = q.is('album_match', null).is('album_id', null)
  if (v11 && f.tagIds.length) {
    if (f.tagMode === 'and') f.tagIds.forEach((tag, i) => { q = q.eq(`tag_${i}.tag_id`, tag).eq(`tag_${i}.user_id`, opts.userId) })
    else q = q.in('tag_any.tag_id', f.tagIds).eq('tag_any.user_id', opts.userId)
  }
  if (v11 && qSearch) q = q.ilike('tag_search.tags.name', `%${qSearch}%`).eq('tag_search.user_id', opts.userId)
  if (opts.fileIds) {
    if (!opts.fileIds.length) return { rows: [], nextCursor: null }
    q = q.in('id', opts.fileIds)
  }

  q = q.or(
    v11
      ? [
          'and(purpose.eq.content,upload_status.eq.ready)',
          'and(purpose.is.null,upload_status.eq.ready)',
          'and(purpose.eq.content,upload_status.is.null)',
          'and(purpose.is.null,upload_status.is.null)',
        ].join(',')
      : 'purpose.eq.content,purpose.is.null',
  )
  if (await isV2SchemaReady()) q = q.is('deleted_at', null)
  if (!v11 && f.albumId) q = q.eq('album_id', f.albumId)

  if (f.type === 'videos') {
    q = q.or('mime_type.ilike.video/%,file_name.ilike.%.mp4,file_name.ilike.%.mov,file_name.ilike.%.webm,file_name.ilike.%.mkv')
  } else if (f.type === 'photos') {
    q = q.not('mime_type', 'ilike', 'video/%')
  }

  if (!v11 && f.noAlbum) q = q.is('album_id', null)

  if (v11 && f.favorite === 'yes') q = q.eq('favorite', true)
  if (v11 && f.favorite === 'no') q = q.eq('favorite', false)
  if (v11 && f.ratingExact != null) q = q.eq('rating', f.ratingExact)
  if (v11 && f.ratingMin != null) q = q.gte('rating', f.ratingMin)
  if (f.sizeMin != null) q = q.gte('file_size_bytes', f.sizeMin)
  if (f.sizeMax != null) q = q.lte('file_size_bytes', f.sizeMax)
  if (v11 && f.durationMinMs != null) q = q.gte('duration_ms', f.durationMinMs)
  if (v11 && f.durationMaxMs != null) q = q.lte('duration_ms', f.durationMaxMs)
  if (v11 && f.resolution) {
    const r = RESOLUTION_MIN[f.resolution]
    q = q.gte('width', r.w).gte('height', r.h)
  }
  if (f.uploadedFrom) q = q.gte('created_at', f.uploadedFrom)
  if (f.uploadedTo) q = q.lte('created_at', f.uploadedTo)
  if (v11 && f.capturedFrom) q = q.gte('captured_at', f.capturedFrom)
  if (v11 && f.capturedTo) q = q.lte('captured_at', f.capturedTo)
  if (f.domain) {
    const d = sanitizeSearch(f.domain)
    if (d) q = q.ilike('source_url', `%${d}%`)
  }
  if (qSearch) {
    q = v11 ? q.or(`file_name.ilike.%${qSearch}%,tag_search.not.is.null`) : q.ilike('file_name', `%${qSearch}%`)
  }

  const { col, ascending, extra } = (() => {
    const requested = sortColumn(f.sort)
    if (!v11 && ['captured_at', 'duration_ms', 'width', 'rating', 'favorite'].includes(requested.col)) {
      return sortColumn('newest_upload')
    }
    return requested
  })()
  const cursor = opts.cursor
  if (cursor) q = q.or(cursorPredicate(col, ascending, cursor, extra))

  q = q.order(col, { ascending, nullsFirst: false })
  if (extra) q = q.order(extra, { ascending: false })
  q = q.order('id', { ascending: false }).limit(limit + 1)

  if (opts.signal) q = q.abortSignal(opts.signal)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  const rows = (data as unknown as FileRow[]) ?? []
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
      value: last[col as keyof FileRow] as string | number | boolean | null ?? null,
      ts: last.created_at,
      id: last.id,
      num,
    }
    if (col === 'captured_at') nextCursor.ts = last.captured_at
  }
  return { rows: page, nextCursor }
}

/** Page through matching ids only — never loads full library rows into memory. */
export async function listAllMatchingFileIds(opts: {
  userId: string
  filters: MediaFilters
  max?: number
}): Promise<string[]> {
  const ids: string[] = []
  let cursor: PageCursor | null = null
  const max = opts.max ?? Number.POSITIVE_INFINITY
  while (ids.length < max) {
    const page = await listMediaPage({
      userId: opts.userId,
      filters: opts.filters,
      cursor,
      limit: Math.min(100, max - ids.length),
      idsOnly: true,
    })
    for (const row of page.rows) ids.push(row.id)
    if (!page.nextCursor || page.rows.length === 0) break
    cursor = page.nextCursor
  }
  return ids
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
    if (data && isAlbumGalleryFile(data as FileRow)) return data as FileRow
  }
  const { data: membership, error: mErr } = await supabase
    .from('album_files')
    .select('file_id, files(*)')
    .eq('user_id', userId)
    .eq('album_id', albumId)
    .order('added_at', { ascending: false })
    .limit(12)
  if (mErr) throw new Error(mErr.message)
  for (const raw of membership ?? []) {
    const joined = (raw as unknown as { files?: FileRow | FileRow[] | null }).files
    const file = Array.isArray(joined) ? joined[0] : joined
    if (file && isAlbumGalleryFile(file)) return file
  }
  const { data: legacy } = await supabase
    .from('files')
    .select('*')
    .eq('user_id', userId)
    .eq('album_id', albumId)
    .or('upload_status.eq.ready,upload_status.is.null')
    .order('created_at', { ascending: false })
    .limit(12)
  return ((legacy as FileRow[]) ?? []).find((f) => isAlbumGalleryFile(f)) ?? null
}

export function isVideoRow(f: Pick<FileRow, 'file_name' | 'mime_type'>): boolean {
  if (f.mime_type?.startsWith('video/')) return true
  return isVideoFileName(f.file_name)
}
