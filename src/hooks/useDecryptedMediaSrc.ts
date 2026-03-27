import { useEffect, useState, useSyncExternalStore } from 'react'
import { useAuth } from '../context/useAuth'
import {
  getDecryptedBlobCacheVersion,
  getDecryptedBlobUrlForFile,
  setDecryptedBlobUrlForFile,
  subscribeDecryptedBlobCache,
} from '../lib/decryptedBlobCache'
import { decryptRemoteToBlob, ensureEncryptionKey } from '../lib/vaultCrypto'
import { isLocalBlobUrl } from '../lib/r2ObjectKey'
import { useSignedRemoteUrl } from './useSignedRemoteUrl'

export type VaultMediaState = {
  displayUrl: string | null
  downloadUrl: string | null
  loading: boolean
  failed: boolean
}

/**
 * Resolves media for vault files: local blob previews, then signed R2 GET + optional decrypt.
 * Never uses raw private object URLs in the DOM.
 */
export function useDecryptedMediaSrc(
  storedUrl: string | null | undefined,
  isEncrypted: boolean | null | undefined,
  userId: string | null | undefined,
  fileNameHint: string,
  fileId?: string | null,
): VaultMediaState {
  const { session } = useAuth()
  const accessToken = session?.access_token ?? null

  const cacheVersion = useSyncExternalStore(
    subscribeDecryptedBlobCache,
    getDecryptedBlobCacheVersion,
    () => 0,
  )
  void cacheVersion

  const cachedDecrypted = fileId ? getDecryptedBlobUrlForFile(fileId) : undefined

  const isBlob = isLocalBlobUrl(storedUrl ?? null)
  const enc = isEncrypted === true

  const needsSignedRemote =
    Boolean(storedUrl && userId && fileId && accessToken) &&
    !isBlob &&
    !(enc && cachedDecrypted)

  const { signedUrl, loading: signingLoading, error: signError } = useSignedRemoteUrl({
    fileId: fileId ?? null,
    accessToken,
    enabled: needsSignedRemote,
  })

  const [decryptedBlobUrl, setDecryptedBlobUrl] = useState<string | null>(null)
  const [decrypting, setDecrypting] = useState(false)

  useEffect(() => {
    if (!enc || !userId || !storedUrl) {
      setDecryptedBlobUrl(null)
      return
    }
    if (isBlob) {
      setDecryptedBlobUrl(null)
      return
    }
    if (fileId && getDecryptedBlobUrlForFile(fileId)) {
      setDecryptedBlobUrl(null)
      return
    }
    if (!signedUrl) {
      setDecryptedBlobUrl(null)
      return
    }

    let alive = true
    let objectUrl: string | null = null

    setDecrypting(true)
    ;(async () => {
      try {
        const key = await ensureEncryptionKey(userId)
        const blob = await decryptRemoteToBlob(signedUrl, key, fileNameHint)
        if (!alive) return
        objectUrl = URL.createObjectURL(blob)
        if (fileId) setDecryptedBlobUrlForFile(fileId, objectUrl)
        setDecryptedBlobUrl(objectUrl)
      } catch {
        if (!alive) return
        setDecryptedBlobUrl(null)
      } finally {
        if (alive) setDecrypting(false)
      }
    })()

    return () => {
      alive = false
      if (!fileId && objectUrl?.startsWith('blob:')) URL.revokeObjectURL(objectUrl)
    }
  }, [enc, userId, storedUrl, isBlob, signedUrl, fileNameHint, fileId])

  if (!storedUrl || !userId) {
    return { displayUrl: null, downloadUrl: null, loading: false, failed: false }
  }

  if (isBlob) {
    if (enc) {
      return { displayUrl: null, downloadUrl: null, loading: false, failed: true }
    }
    return {
      displayUrl: storedUrl,
      downloadUrl: storedUrl,
      loading: false,
      failed: false,
    }
  }

  if (!fileId || !accessToken) {
    return { displayUrl: null, downloadUrl: null, loading: false, failed: true }
  }

  if (enc) {
    const fromCache = fileId ? getDecryptedBlobUrlForFile(fileId) : undefined
    const plain = fromCache ?? decryptedBlobUrl

    if (fromCache) {
      return {
        displayUrl: fromCache,
        downloadUrl: fromCache,
        loading: false,
        failed: false,
      }
    }

    const loading = signingLoading || decrypting || (needsSignedRemote && !signedUrl && !signError)
    const failed =
      signError || (!loading && !plain && !(signingLoading || decrypting))

    return {
      displayUrl: plain ?? null,
      downloadUrl: plain ?? null,
      loading,
      failed,
    }
  }

  const loading = signingLoading || (needsSignedRemote && !signedUrl && !signError)
  const failed = signError || (!loading && !signedUrl && needsSignedRemote)

  return {
    displayUrl: signedUrl,
    downloadUrl: signedUrl,
    loading,
    failed,
  }
}
