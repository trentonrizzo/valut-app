const MIME_BY_EXT = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  qt: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
}

export function extOfName(name) {
  const s = String(name || '')
  const i = s.lastIndexOf('.')
  return i >= 0 ? s.slice(i + 1).toLowerCase() : ''
}

/**
 * Content-Type for signed GET / playback.
 * Prefer a real stored mime, but never label a .mov as video/mp4.
 */
export function responseContentType(mime, fileName) {
  const ext = extOfName(fileName)
  const stored = typeof mime === 'string' ? mime.trim().toLowerCase() : ''
  const fromExt = MIME_BY_EXT[ext]
  if (ext === 'mov' || ext === 'qt') return 'video/quicktime'
  if (stored && stored !== 'application/octet-stream' && stored !== 'binary/octet-stream') {
    if (fromExt && stored.startsWith('video/') && fromExt.startsWith('video/') && stored !== fromExt) {
      return fromExt
    }
    return stored
  }
  return fromExt || stored || null
}
