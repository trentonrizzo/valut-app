import { useEffect, useState } from 'react'
import { useAuth } from '../context/useAuth'
import { useVault } from '../context/useVault'
import { resolveVaultMedia } from '../lib/media/resolveMedia'

export type VaultMediaState = {
  displayUrl: string | null
  downloadUrl: string | null
  loading: boolean
  failed: boolean
}

/**
 * Local blob URLs display immediately. Remote files resolve via authenticated signed GET,
 * with legacy public URL fallback. Encrypted originals decrypt in chunks.
 */
export function useDecryptedMediaSrc(
  storedUrl: string | null | undefined,
  _isEncrypted?: boolean | null,
  _userId?: string | null,
  _fileNameHint?: string,
  fileId?: string | null,
): VaultMediaState {
  const { session } = useAuth()
  const { masterKey } = useVault()
  const token = session?.access_token ?? null
  const [state, setState] = useState<VaultMediaState>({
    displayUrl: storedUrl?.startsWith('blob:') ? storedUrl : null,
    downloadUrl: storedUrl?.startsWith('blob:') ? storedUrl : null,
    loading: Boolean(storedUrl && fileId && !storedUrl.startsWith('blob:')),
    failed: false,
  })

  useEffect(() => {
    if (!storedUrl) {
      setState({ displayUrl: null, downloadUrl: null, loading: false, failed: false })
      return
    }
    if (storedUrl.startsWith('blob:')) {
      setState({ displayUrl: storedUrl, downloadUrl: storedUrl, loading: false, failed: false })
      return
    }
    if (!fileId || !token) {
      if (/^https?:\/\//i.test(storedUrl)) {
        setState({ displayUrl: storedUrl, downloadUrl: storedUrl, loading: false, failed: false })
        return
      }
      setState({ displayUrl: null, downloadUrl: null, loading: false, failed: true })
      return
    }
    let alive = true
    setState((s) => ({ ...s, loading: true, failed: false }))
    resolveVaultMedia({
      fileId,
      accessToken: token,
      masterKey,
      fallbackUrl: storedUrl,
    })
      .then((r) => {
        if (!alive) return
        setState({ displayUrl: r.displayUrl, downloadUrl: r.downloadUrl, loading: false, failed: false })
      })
      .catch(() => {
        if (!alive) return
        setState({ displayUrl: null, downloadUrl: null, loading: false, failed: true })
      })
    return () => {
      alive = false
    }
  }, [storedUrl, fileId, token, masterKey])

  return state
}
