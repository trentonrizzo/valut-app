import type { Database } from './database'

export type AlbumRow = Database['public']['Tables']['albums']['Row'] & {
  /** Additive nesting column (migration 20260925190000). Null = root. */
  parent_album_id?: string | null
}

/** Album with aggregated file stats and preview metadata (computed client-side). */
export type AlbumWithMeta = AlbumRow & {
  itemCount: number
  totalBytes: number
  previewUrl: string | null
  previewIsVideo: boolean
  /** True when preview asset is stored encrypted (client-side AES-GCM). */
  previewIsEncrypted: boolean
  /** Original filename of the preview asset (for MIME when decrypting). */
  previewFileName: string | null
  /** File id for the preview asset (decrypt cache). */
  previewFileId: string | null
  isProtected?: boolean
  /** Count of direct child collections (computed client-side). */
  childCount?: number
}
