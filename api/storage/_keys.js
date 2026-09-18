export function userOwnsStorageKey(userId, key) {
  if (!userId || typeof key !== 'string') return false
  if (key.includes('..') || key.startsWith('/') || key.includes('\\')) return false
  const prefix = `users/${userId}/`
  return key.startsWith(prefix) && key.length > prefix.length
}

export function originalKey(userId, objectId) {
  return `users/${userId}/originals/${objectId}`
}

export function extractKeyFromStoredUrl(stored) {
  if (!stored || typeof stored !== 'string') return null
  const s = stored.trim()
  if (!s || s.startsWith('blob:')) return null
  if (s.startsWith('r2://')) {
    const key = s.slice(5).replace(/^\/+/, '')
    return key || null
  }
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

export function assertOwnKey(userId, key) {
  if (!userOwnsStorageKey(userId, key)) {
    const err = new Error('Forbidden storage key')
    err.statusCode = 403
    throw err
  }
}
