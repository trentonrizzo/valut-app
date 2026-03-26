import { supabase } from './supabase'
import type { AlbumRow, AlbumWithMeta } from '../types/album'

type RowWithCount = AlbumRow & { files?: { count: number }[] | null }

export function mapAlbumRow(row: RowWithCount): AlbumWithMeta {
  const c = row.files?.[0]?.count
  const itemCount = typeof c === 'number' && !Number.isNaN(c) ? c : Number(c ?? 0)
  const { files: _files, ...rest } = row
  return { ...rest, itemCount }
}

export async function fetchAlbumsWithCounts(userId: string) {
  const primary = await supabase
    .from('albums')
    .select('*, files(count)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (!primary.error && primary.data) {
    const rows = primary.data as RowWithCount[]
    return { data: rows.map(mapAlbumRow), error: null as string | null }
  }

  const fallback = await supabase
    .from('albums')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (fallback.error) {
    return { data: null as AlbumWithMeta[] | null, error: fallback.error.message }
  }

  const rows = (fallback.data ?? []) as AlbumRow[]
  return {
    data: rows.map((r) => ({ ...r, itemCount: 0 })),
    error: null as string | null,
  }
}
