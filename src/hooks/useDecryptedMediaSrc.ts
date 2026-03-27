import { useEffect, useState } from 'react'
import { decryptRemoteToBlob, ensureEncryptionKey } from '../lib/vaultCrypto'

/**
 * Resolves a stored file URL for display. Plain files use the remote URL.
 * Encrypted files are fetched, decrypted, and exposed as a blob URL (revoked on cleanup).
 */
export function useDecryptedMediaSrc(
  storedUrl: string | null | undefined,
  isEncrypted: boolean | null | undefined,
  userId: string | null | undefined,
  fileNameHint: string,
): string | null {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!isEncrypted || !storedUrl || !userId) {
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
        setBlobUrl(objectUrl)
      } catch {
        if (!alive) return
        setBlobUrl(storedUrl)
      }
    })()

    return () => {
      alive = false
      if (objectUrl?.startsWith('blob:')) URL.revokeObjectURL(objectUrl)
    }
  }, [storedUrl, isEncrypted, userId, fileNameHint])

  if (!storedUrl) return null
  if (!isEncrypted) return storedUrl
  return blobUrl
}
