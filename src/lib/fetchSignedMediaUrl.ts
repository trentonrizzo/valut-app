/** In-memory cache: signed GET URLs expire on R2; refresh before 1h. */
import { extractObjectKeyFromStoredUrl } from './r2ObjectKey'

const cache = new Map<string, { url: string; expiresAtMs: number }>()
const TTL_MS = 50 * 60 * 1000

export function clearSignedMediaUrlCacheForFile(fileId: string): void {
  cache.delete(fileId)
}

function resolveFileKey(storedUrl: string): string | null {
  const fromStored = extractObjectKeyFromStoredUrl(storedUrl)
  if (fromStored) return fromStored
  const s = storedUrl.trim()
  if (!s || s.startsWith('blob:')) return null
  return s.replace(/^\/+/, '')
}

/**
 * GET /api/media/signed-url?fileKey= — returns temporary signed GET URL for private R2 object.
 */
export async function fetchSignedMediaUrl(fileId: string, storedUrl: string): Promise<string> {
  const fileKey = resolveFileKey(storedUrl)
  if (!fileKey) {
    throw new Error('Could not resolve object key for file')
  }

  const now = Date.now()
  const hit = cache.get(fileId)
  if (hit && hit.expiresAtMs > now + 30_000) {
    return hit.url
  }

  const res = await fetch(`/api/media/signed-url?fileKey=${encodeURIComponent(fileKey)}`)

  const data: { url?: string; error?: string } = await res.json().catch(() => ({}))
  if (!res.ok || !data.url) {
    throw new Error(data?.error || `Could not get signed URL (${res.status})`)
  }

  cache.set(fileId, { url: data.url, expiresAtMs: now + TTL_MS })
  return data.url
}

/** Same as {@link fetchSignedMediaUrl}. */
export const resolveSignedMediaUrl = fetchSignedMediaUrl
