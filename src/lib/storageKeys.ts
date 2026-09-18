/** Pure helpers for V1.1 R2 object keys. Shared conceptually with api/storage/_keys.js */

export const STORAGE_PREFIX = 'users'

export function originalKey(userId: string, objectId: string): string {
  return `${STORAGE_PREFIX}/${userId}/originals/${objectId}`
}

export function thumbKey(userId: string, objectId: string): string {
  return `${STORAGE_PREFIX}/${userId}/thumbs/${objectId}`
}

export function posterKey(userId: string, objectId: string): string {
  return `${STORAGE_PREFIX}/${userId}/posters/${objectId}`
}

export function userOwnsStorageKey(userId: string, key: string): boolean {
  if (!userId || !key || key.includes('..') || key.startsWith('/')) return false
  const prefix = `${STORAGE_PREFIX}/${userId}/`
  return key.startsWith(prefix) && key.length > prefix.length
}

/** Parse object key from a stored public/legacy URL. Never throws. */
export function extractKeyFromStoredUrl(stored: string | null | undefined): string | null {
  if (!stored || typeof stored !== 'string') return null
  const s = stored.trim()
  if (!s || s.startsWith('blob:')) return null
  if (!/^https?:\/\//i.test(s)) {
    const key = s.replace(/^\/+/, '')
    return key || null
  }
  try {
    const u = new URL(s)
    const path = u.pathname.replace(/^\/+/, '')
    return path || null
  } catch {
    return null
  }
}

export function isLegacyPublicUrl(stored: string | null | undefined): boolean {
  if (!stored) return false
  return /^https?:\/\//i.test(stored.trim())
}
