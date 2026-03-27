import type { Database } from './database'

export type AlbumRow = Database['public']['Tables']['albums']['Row']

/** Album with aggregated file stats and preview metadata (computed client-side). */
export type AlbumWithMeta = AlbumRow & {
  itemCount: number
  totalBytes: number
  previewUrl: string | null
  previewIsVideo: boolean
}
