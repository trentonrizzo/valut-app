export function isVideoFileName(name: string): boolean {
  return /\.(mp4|m4v|webm|ogg|ogv|mov|mkv|qt)$/i.test(String(name || '').toLowerCase())
}

export function isVideoMime(mime: string | null | undefined, name?: string): boolean {
  const m = String(mime || '').toLowerCase()
  if (m.startsWith('video/')) return true
  if (m === 'video/quicktime' || m === 'video/x-quicktime') return true
  return Boolean(name && isVideoFileName(name))
}
