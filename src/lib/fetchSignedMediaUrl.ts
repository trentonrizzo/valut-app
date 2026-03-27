/** In-memory cache: signed GET URLs expire on R2; refresh before 1h. */
const cache = new Map<string, { url: string; expiresAtMs: number }>()
const TTL_MS = 50 * 60 * 1000

export function clearSignedMediaUrlCacheForFile(fileId: string): void {
  cache.delete(fileId)
}

/**
 * GET /api/media/signed-url?fileId= — returns temporary signed GET URL for private R2 object.
 */
export async function fetchSignedMediaUrl(fileId: string, accessToken: string): Promise<string> {
  const now = Date.now()
  const hit = cache.get(fileId)
  if (hit && hit.expiresAtMs > now + 30_000) {
    return hit.url
  }

  const res = await fetch(`/api/media/signed-url?fileId=${encodeURIComponent(fileId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  const data: { ok?: boolean; url?: string; error?: string } = await res.json().catch(() => ({}))
  if (!res.ok || data?.ok !== true || !data.url) {
    throw new Error(data?.error || `Could not get signed URL (${res.status})`)
  }

  cache.set(fileId, { url: data.url, expiresAtMs: now + TTL_MS })
  return data.url
}

/** Same as {@link fetchSignedMediaUrl} — resolves a temporary GET URL for a DB file id. */
export const resolveSignedMediaUrl = fetchSignedMediaUrl
