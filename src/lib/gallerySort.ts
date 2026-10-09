import { isVideoFileName } from './mediaTypes'

export type FileSort =
  | 'newest'
  | 'oldest'
  | 'newest_captured'
  | 'oldest_captured'
  | 'largest'
  | 'smallest'
  | 'images_first'
  | 'videos_first'

type SortableRow = {
  file_name: string
  created_at: string
  file_size_bytes?: number | null
  captured_at?: string | null
  captured_at_local?: string | null
  captured_at_source?: string | null
}

export function sortGalleryFiles<T extends SortableRow>(list: T[], sort: FileSort): T[] {
  const copy = [...list]
  const byDateDesc = (a: T, b: T) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  const byDateAsc = (a: T, b: T) =>
    new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  const captureValue = (row: T) => {
    if (row.captured_at_source === 'file_last_modified') return null
    if (row.captured_at) {
      const value = new Date(row.captured_at).getTime()
      return Number.isFinite(value) ? value : null
    }
    if (row.captured_at_local) {
      const value = new Date(row.captured_at_local).getTime()
      return Number.isFinite(value) ? value : null
    }
    return null
  }
  const byCapture = (direction: 'asc' | 'desc') => (a: T, b: T) => {
    const av = captureValue(a)
    const bv = captureValue(b)
    if (av == null && bv == null) return byDateDesc(a, b)
    if (av == null) return 1
    if (bv == null) return -1
    return direction === 'asc' ? av - bv : bv - av
  }

  switch (sort) {
    case 'newest':
      return copy.sort(byDateDesc)
    case 'oldest':
      return copy.sort(byDateAsc)
    case 'newest_captured':
      return copy.sort(byCapture('desc'))
    case 'oldest_captured':
      return copy.sort(byCapture('asc'))
    case 'largest':
      return copy.sort((a, b) => {
        const sa = a.file_size_bytes
        const sb = b.file_size_bytes
        if (sa == null && sb == null) return byDateDesc(a, b)
        if (sa == null) return 1
        if (sb == null) return -1
        if (sb !== sa) return sb - sa
        return byDateDesc(a, b)
      })
    case 'smallest':
      return copy.sort((a, b) => {
        const sa = a.file_size_bytes
        const sb = b.file_size_bytes
        if (sa == null && sb == null) return byDateDesc(a, b)
        if (sa == null) return 1
        if (sb == null) return -1
        if (sa !== sb) return sa - sb
        return byDateDesc(a, b)
      })
    case 'images_first':
      return copy.sort((a, b) => {
        const va = isVideoFileName(a.file_name)
        const vb = isVideoFileName(b.file_name)
        if (va !== vb) return va ? 1 : -1
        return byDateDesc(a, b)
      })
    case 'videos_first':
      return copy.sort((a, b) => {
        const va = isVideoFileName(a.file_name)
        const vb = isVideoFileName(b.file_name)
        if (va !== vb) return va ? -1 : 1
        return byDateDesc(a, b)
      })
    default:
      return copy.sort(byDateDesc)
  }
}
