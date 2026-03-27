import { isVideoFileName } from './mediaTypes'

export type FileSort =
  | 'newest'
  | 'oldest'
  | 'largest'
  | 'smallest'
  | 'images_first'
  | 'videos_first'

type SortableRow = {
  file_name: string
  created_at: string
  file_size_bytes?: number | null
}

export function sortGalleryFiles<T extends SortableRow>(list: T[], sort: FileSort): T[] {
  const copy = [...list]
  const byDateDesc = (a: T, b: T) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  const byDateAsc = (a: T, b: T) =>
    new Date(a.created_at).getTime() - new Date(b.created_at).getTime()

  switch (sort) {
    case 'newest':
      return copy.sort(byDateDesc)
    case 'oldest':
      return copy.sort(byDateAsc)
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
