import type { Database } from './database'

export type FileRow = Database['public']['Tables']['files']['Row']
export type AlbumRow = Database['public']['Tables']['albums']['Row']
export type TagRow = Database['public']['Tables']['tags']['Row']

export type MediaTypeFilter = 'all' | 'photos' | 'videos'
export type FavoriteFilter = 'all' | 'yes' | 'no'
export type TagMode = 'and' | 'or'
export type ResolutionPreset = '720' | '1080' | '1440' | '2160'

export type MediaSort =
  | 'newest_upload'
  | 'oldest_upload'
  | 'newest_captured'
  | 'oldest_captured'
  | 'largest'
  | 'smallest'
  | 'longest'
  | 'shortest'
  | 'highest_res'
  | 'lowest_res'
  | 'highest_rating'
  | 'favorites_first'

export type MediaFilters = {
  type: MediaTypeFilter
  tagIds: string[]
  tagMode: TagMode
  albumId: string | null
  noAlbum: boolean
  favorite: FavoriteFilter
  ratingExact: number | null
  ratingMin: number | null
  sizeMin: number | null
  sizeMax: number | null
  durationMinMs: number | null
  durationMaxMs: number | null
  resolution: ResolutionPreset | null
  uploadedFrom: string | null
  uploadedTo: string | null
  capturedFrom: string | null
  capturedTo: string | null
  /** Substring match against source_url / domain (trustworthy metadata only). */
  domain: string | null
  /** Optional banner title for smart/dynamic result views. */
  resultTitle: string | null
  search: string
  sort: MediaSort
}

export const DEFAULT_MEDIA_FILTERS: MediaFilters = {
  type: 'all',
  tagIds: [],
  tagMode: 'and',
  albumId: null,
  noAlbum: false,
  favorite: 'all',
  ratingExact: null,
  ratingMin: null,
  sizeMin: null,
  sizeMax: null,
  durationMinMs: null,
  durationMaxMs: null,
  resolution: null,
  uploadedFrom: null,
  uploadedTo: null,
  capturedFrom: null,
  capturedTo: null,
  domain: null,
  resultTitle: null,
  search: '',
  sort: 'newest_upload',
}

export type PageCursor = {
  ts: string | null
  id: string
  num: number | null
}

export const PAGE_SIZE = 48
