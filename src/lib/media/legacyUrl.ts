export function isHttpsUrl(value: string | null | undefined): value is string {
  return Boolean(value && /^https?:\/\//i.test(value))
}

export function isBlobUrl(value: string | null | undefined): value is string {
  return Boolean(value && value.startsWith('blob:'))
}

/** Legacy V1 objects are public HTTPS. Do not wait on signed-get to display them. */
export function isLegacyPublicFile(file: {
  file_url?: string | null
  storage_key?: string | null
  thumbnail_key?: string | null
  poster_key?: string | null
}): boolean {
  if (!isHttpsUrl(file.file_url)) return false
  return !file.storage_key && !file.thumbnail_key && !file.poster_key
}

export function mediaFragmentUrl(src: string, seconds = 0.1): string {
  if (!src || src.startsWith('blob:') || src.includes('#')) return src
  return `${src}#t=${seconds}`
}
