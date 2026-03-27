/**
 * Extract R2 object key from DB `file_url` (stores key or legacy public URL).
 */
export function extractObjectKeyFromStoredUrl(stored: string | null | undefined): string | null {
  if (!stored || typeof stored !== 'string') return null
  const s = stored.trim()
  if (!s || s.startsWith('blob:')) return null
  if (!/^https?:\/\//i.test(s)) return s.replace(/^\/+/, '')
  try {
    const u = new URL(s)
    return u.pathname.replace(/^\/+/, '')
  } catch {
    return null
  }
}

export function isLocalBlobUrl(url: string | null | undefined): boolean {
  return typeof url === 'string' && url.startsWith('blob:')
}
