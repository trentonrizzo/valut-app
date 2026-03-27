export function isVideoFileName(name: string): boolean {
  return /\.(mp4|webm|ogg|mov|mkv)$/i.test(String(name || '').toLowerCase())
}
