import type { Database } from './database'

export type AlbumRow = Database['public']['Tables']['albums']['Row']

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
}
