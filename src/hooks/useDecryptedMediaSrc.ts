import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  getDecryptedBlobCacheVersion,
  getDecryptedBlobUrlForFile,
  setDecryptedBlobUrlForFile,
  subscribeDecryptedBlobCache,
} from '../lib/decryptedBlobCache'
import { decryptRemoteToBlob, ensureEncryptionKey } from '../lib/vaultCrypto'

/**
 * Resolves a stored file URL for display. Plain files use the remote URL.
 * Encrypted files are fetched, decrypted, and exposed as a blob URL.
 * Optional `fileId` enables in-memory cache and immediate local previews (blob URLs).
 */
export function useDecryptedMediaSrc(
  storedUrl: string | null | undefined,
  isEncrypted: boolean | null | undefined,
  userId: string | null | undefined,
  fileNameHint: string,
  fileId?: string | null,
): string | null {
  const cacheVersion = useSyncExternalStore(
    subscribeDecryptedBlobCache,
    getDecryptedBlobCacheVersion,
    () => 0,
  )

  const cachedUrl = fileId ? getDecryptedBlobUrlForFile(fileId) : undefined
  void cacheVersion

  const [blobUrl, setBlobUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!storedUrl) {
      setBlobUrl(null)
      return
    }
    if (!isEncrypted) {
      setBlobUrl(null)
      return
    }
    if (!userId) {
      setBlobUrl(null)
      return
    }

    if (fileId && getDecryptedBlobUrlForFile(fileId)) {
      setBlobUrl(null)
      return
    }

    let alive = true
    let objectUrl: string | null = null

    ;(async () => {
      try {
        const key = await ensureEncryptionKey(userId)
        const blob = await decryptRemoteToBlob(storedUrl, key, fileNameHint)
        if (!alive) return
        objectUrl = URL.createObjectURL(blob)
        if (fileId) setDecryptedBlobUrlForFile(fileId, objectUrl)
        setBlobUrl(objectUrl)
      } catch {
        if (!alive) return
        setBlobUrl(storedUrl)
      }
    })()

    return () => {
      alive = false
      if (!fileId && objectUrl?.startsWith('blob:')) URL.revokeObjectURL(objectUrl)
    }
  }, [storedUrl, isEncrypted, userId, fileNameHint, fileId])
  if (!storedUrl) return null
  if (!isEncrypted) return storedUrl
  if (cachedUrl) return cachedUrl
  return blobUrl
}
