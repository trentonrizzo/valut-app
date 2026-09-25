import { supabase } from './supabase'
import { formatBytes } from './formatBytes'

export type VaultStorageStats = {
  total_items: number
  total_bytes: number
  photo_items: number
  photo_bytes: number
  video_items: number
  video_bytes: number
}

export type AlbumStorageStats = {
  album_id: string
  item_count: number
  total_bytes: number
  photo_items: number
  photo_bytes: number
  video_items: number
  video_bytes: number
}

export type DuplicateGroup = {
  content_hash: string
  file_count: number
  total_bytes: number
  file_ids: string[]
}

export async function fetchVaultStorageStats(): Promise<VaultStorageStats | null> {
  const { data, error } = await supabase.rpc('vault_storage_stats')
  if (error) return null
  const row = Array.isArray(data) ? data[0] : data
  if (!row || typeof row !== 'object') return null
  const r = row as Record<string, unknown>
  return {
    total_items: Number(r.total_items ?? 0),
    total_bytes: Number(r.total_bytes ?? 0),
    photo_items: Number(r.photo_items ?? 0),
    photo_bytes: Number(r.photo_bytes ?? 0),
    video_items: Number(r.video_items ?? 0),
    video_bytes: Number(r.video_bytes ?? 0),
  }
}

export async function fetchAlbumStorageStats(): Promise<AlbumStorageStats[]> {
  const { data, error } = await supabase.rpc('album_content_stats')
  if (error) return []
  return (data ?? []).map((row: Record<string, unknown>) => ({
    album_id: String(row.album_id),
    item_count: Number(row.item_count ?? 0),
    total_bytes: Number(row.total_bytes ?? 0),
    photo_items: Number(row.photo_items ?? 0),
    photo_bytes: Number(row.photo_bytes ?? 0),
    video_items: Number(row.video_items ?? 0),
    video_bytes: Number(row.video_bytes ?? 0),
  }))
}

export async function fetchDuplicateGroups(): Promise<DuplicateGroup[]> {
  const { data, error } = await supabase.rpc('duplicate_content_groups')
  if (error) return []
  return (data ?? []).map((row: Record<string, unknown>) => ({
    content_hash: String(row.content_hash ?? ''),
    file_count: Number(row.file_count ?? 0),
    total_bytes: Number(row.total_bytes ?? 0),
    file_ids: Array.isArray(row.file_ids) ? row.file_ids.map(String) : [],
  }))
}

export function formatStorageLine(stats: VaultStorageStats | null): string {
  if (!stats) return 'Storage stats unavailable until the latest migration is applied.'
  return `${stats.total_items} items · ${formatBytes(stats.total_bytes)} (photos ${stats.photo_items} / ${formatBytes(stats.photo_bytes)}, videos ${stats.video_items} / ${formatBytes(stats.video_bytes)})`
}
