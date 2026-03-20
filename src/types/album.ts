import type { Database } from './database'

export type AlbumRow = Database['public']['Tables']['albums']['Row']

/** Album row plus item count from nested `items(count)` query */
export type AlbumWithMeta = AlbumRow & { itemCount: number }
