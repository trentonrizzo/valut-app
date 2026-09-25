import type { MediaFilters } from '../types/media'
import { DEFAULT_MEDIA_FILTERS } from '../types/media'

export function advancedFilterCount(filters: MediaFilters): number {
  let n = 0
  if (filters.type !== 'all') n += 1
  if (filters.favorite !== 'all') n += 1
  if (filters.albumId || filters.noAlbum) n += 1
  if (filters.tagIds.length > 0) n += 1
  if (filters.resolution) n += 1
  if (filters.ratingExact != null || filters.ratingMin != null) n += 1
  if (filters.sizeMin != null) n += 1
  if (filters.sizeMax != null) n += 1
  if (filters.durationMinMs != null) n += 1
  if (filters.durationMaxMs != null) n += 1
  if (filters.uploadedFrom) n += 1
  if (filters.uploadedTo) n += 1
  if (filters.capturedFrom) n += 1
  if (filters.capturedTo) n += 1
  if (filters.domain) n += 1
  return n
}

export function clearAdvancedFilters(filters: MediaFilters): MediaFilters {
  return {
    ...DEFAULT_MEDIA_FILTERS,
    search: filters.search,
    sort: filters.sort,
  }
}
