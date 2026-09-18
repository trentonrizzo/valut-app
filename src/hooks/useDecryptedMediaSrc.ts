import { useEffect, useState } from 'react'
import { useAuth } from '../context/useAuth'
import { useVault } from '../context/useVault'
import { resolveVaultMedia } from '../lib/media/resolveMedia'
import { isBlobUrl, isHttpsUrl } from '../lib/media/legacyUrl'

export type VaultMediaState = {
  displayUrl: string | null
  downloadUrl: string | null
  loading: boolean
  failed: boolean
}

/**
 * Local blob URLs and legacy HTTPS display immediately.
 * Private objects resolve via authenticated signed GET.
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
  const immediate = isBlobUrl(storedUrl) || isHttpsUrl(storedUrl) ? storedUrl : null
  const [state, setState] = useState<VaultMediaState>({
    displayUrl: immediate,
    downloadUrl: immediate,
    loading: Boolean(storedUrl && !immediate),
    failed: false,
  })

  useEffect(() => {
    if (!storedUrl) {
      setState({ displayUrl: null, downloadUrl: null, loading: false, failed: false })
      return
    }
    if (isBlobUrl(storedUrl)) {
      setState({ displayUrl: storedUrl, downloadUrl: storedUrl, loading: false, failed: false })
      return
    }
    const https = isHttpsUrl(storedUrl) ? storedUrl : null
    if (https) {
      setState({ displayUrl: https, downloadUrl: https, loading: false, failed: false })
    }
    if (!fileId || !token) {
      if (!https) setState({ displayUrl: null, downloadUrl: null, loading: false, failed: true })
      return
    }
    let alive = true
    if (!https) setState((s) => ({ ...s, loading: true, failed: false }))
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
        if (https) {
          setState({ displayUrl: https, downloadUrl: https, loading: false, failed: false })
        } else {
          setState({ displayUrl: null, downloadUrl: null, loading: false, failed: true })
        }
      })
    return () => {
      alive = false
    }
  }, [storedUrl, fileId, token, masterKey])

  return state
}
