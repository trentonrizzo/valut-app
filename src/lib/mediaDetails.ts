import { supabase } from './supabase'
import type { FileRow } from '../types/media'
import { tagsForFile } from './tags'
import { listAlbumMembershipsForFile } from './albumMembership'

export type MediaDetailsModel = {
  file: FileRow
  tags: { id: string; name: string }[]
  albums: { id: string; name: string }[]
  importDate: string
  captureDate: string | null
  aspectRatio: string | null
  resolutionLabel: string | null
  duplicateHint: string | null
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a)
  let y = Math.abs(b)
  while (y) {
    const t = y
    y = x % y
    x = t
  }
  return x || 1
}

export function aspectRatioLabel(width: number | null, height: number | null): string | null {
  if (!width || !height || width < 1 || height < 1) return null
  const g = gcd(width, height)
  return `${width / g}:${height / g}`
}

export function resolutionLabel(width: number | null, height: number | null): string | null {
  if (!width || !height) return null
  const short = Math.min(width, height)
  if (short >= 2160) return '4K+'
  if (short >= 1440) return '1440p'
  if (short >= 1080) return '1080p'
  if (short >= 720) return '720p'
  return `${width}×${height}`
}

export async function loadMediaDetails(userId: string, file: FileRow): Promise<MediaDetailsModel> {
  const [tags, albums] = await Promise.all([
    tagsForFile(userId, file.id).catch(() => []),
    listAlbumMembershipsForFile(userId, file.id).catch(() => []),
  ])
  let duplicateHint: string | null = null
  const hash = (file as FileRow & { content_hash?: string | null }).content_hash
  if (hash) {
    const { count } = await supabase
      .from('files')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('content_hash', hash)
      .is('deleted_at', null)
    if ((count ?? 0) > 1) duplicateHint = `${count} library items share this content hash`
  }
  return {
    file,
    tags,
    albums,
    importDate: file.created_at,
    captureDate: file.captured_at,
    aspectRatio: aspectRatioLabel(file.width, file.height),
    resolutionLabel: resolutionLabel(file.width, file.height),
    duplicateHint,
  }
}
