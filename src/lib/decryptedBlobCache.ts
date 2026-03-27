/** In-memory blob URL cache keyed by file id — avoids repeated decrypt/fetch. */

const cache = new Map<string, string>()
let version = 0
const listeners = new Set<() => void>()

function bump() {
  version += 1
  for (const l of listeners) l()
}

export function subscribeDecryptedBlobCache(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange)
  return () => listeners.delete(onStoreChange)
}

export function getDecryptedBlobCacheVersion(): number {
  return version
}

export function getDecryptedBlobUrlForFile(fileId: string): string | undefined {
  return cache.get(fileId)
}

export function setDecryptedBlobUrlForFile(fileId: string, url: string): void {
  const prev = cache.get(fileId)
  if (prev === url) return
  if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev)
  cache.set(fileId, url)
  bump()
}
