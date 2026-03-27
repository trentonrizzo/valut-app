export type VaultMediaState = {
  displayUrl: string | null
  downloadUrl: string | null
  loading: boolean
  failed: boolean
}

/**
 * Direct URL display: uses `storedUrl` as-is (public URL or local blob). No fetch, decrypt, or signing.
 */
export function useDecryptedMediaSrc(
  storedUrl: string | null | undefined,
  _isEncrypted?: boolean | null,
  _userId?: string | null,
  _fileNameHint?: string,
  _fileId?: string | null,
): VaultMediaState {
  if (!storedUrl) {
    return { displayUrl: null, downloadUrl: null, loading: false, failed: false }
  }
  return {
    displayUrl: storedUrl,
    downloadUrl: storedUrl,
    loading: false,
    failed: false,
  }
}
