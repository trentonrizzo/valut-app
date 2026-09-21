import { extOf, normalizeUploadMime } from './upload/strategy'

export type FileKind = 'image' | 'video' | 'audio' | 'pdf' | 'document' | 'archive' | 'other'

const IMAGE_EXT = /^(jpe?g|png|gif|webp|heic|heif|bmp|tif|tiff|avif)$/
const VIDEO_EXT = /^(mp4|m4v|mov|qt|webm|mkv|ogv|ogg)$/
const AUDIO_EXT = /^(mp3|m4a|aac|wav|flac|opus|oga)$/
const DOC_EXT = /^(docx?|xlsx?|pptx?|rtf|txt|csv|pages|numbers|key)$/
const ARCHIVE_EXT = /^(zip|rar|7z|tar|gz|tgz)$/

export function classifyFileKind(input: { name?: string | null; mime_type?: string | null; type?: string | null }): FileKind {
  const name = String(input.name || '')
  const mime = normalizeUploadMime({ name, type: input.mime_type || input.type || '' })
  const ext = extOf(name)

  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf'
  if (mime.startsWith('image/') || IMAGE_EXT.test(ext)) return 'image'
  if (mime.startsWith('video/') || VIDEO_EXT.test(ext)) return 'video'
  if (mime.startsWith('audio/') || AUDIO_EXT.test(ext)) return 'audio'
  if (ARCHIVE_EXT.test(ext) || mime.includes('zip') || mime.includes('compressed')) return 'archive'
  if (mime.includes('word') || mime.includes('spreadsheet') || mime.includes('presentation') || DOC_EXT.test(ext)) {
    return 'document'
  }
  if (mime.startsWith('text/')) return 'document'
  return 'other'
}

export function fileKindLabel(kind: FileKind): string {
  switch (kind) {
    case 'image':
      return 'Photo'
    case 'video':
      return 'Video'
    case 'audio':
      return 'Audio'
    case 'pdf':
      return 'PDF'
    case 'document':
      return 'Document'
    case 'archive':
      return 'Archive'
    default:
      return 'File'
  }
}

export function isPhotoKind(kind: FileKind): boolean {
  return kind === 'image'
}
