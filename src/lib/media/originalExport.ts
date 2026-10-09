import { resolveVaultMedia } from './resolveMedia'
import { apiSignedGet } from '../upload/storageApi'

export type OriginalExportFile = {
  id: string
  file_name: string
  file_url: string
  file_size_bytes?: number | null
  is_encrypted?: boolean | null
  mime_type?: string | null
}

export type OriginalExportStage =
  | 'preparing'
  | 'decrypting'
  | 'ready'
  | 'sharing'
  | 'downloading'

type ExportOptions = {
  file: OriginalExportFile
  accessToken: string
  masterKey: CryptoKey | null
  onStage?: (stage: OriginalExportStage) => void
}

function clickDownload(url: string, filename: string) {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

async function resolvedBlob(options: ExportOptions): Promise<Blob> {
  options.onStage?.(options.file.is_encrypted ? 'decrypting' : 'preparing')
  const resolved = await resolveVaultMedia({
    fileId: options.file.id,
    accessToken: options.accessToken,
    variant: 'original',
    masterKey: options.masterKey,
    fallbackUrl: options.file.file_url,
  })
  const response = await fetch(resolved.downloadUrl)
  if (!response.ok) throw new Error(`Could not retrieve the original (${response.status})`)
  const blob = await response.blob()
  if (blob.size <= 0) throw new Error('The retrieved original was empty')
  return blob.type || options.file.mime_type
    ? blob.slice(0, blob.size, blob.type || options.file.mime_type || 'application/octet-stream')
    : blob
}

export function supportsFileSharing(): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return false
  if (typeof File !== 'function') return false
  try {
    const probe = new File(['vault'], 'vault.txt', { type: 'text/plain' })
    return typeof navigator.canShare === 'function' && navigator.canShare({ files: [probe] })
  } catch {
    return false
  }
}

/**
 * Opens the native share sheet. Web apps cannot verify that the user selected
 * Save Image/Save Video, so callers must report only that the sheet opened.
 */
export async function prepareOriginalForSharing(options: ExportOptions): Promise<File> {
  if (!supportsFileSharing()) {
    throw new Error('Save to Photos is not supported by this browser. Use Download File instead.')
  }
  const blob = await resolvedBlob(options)
  const file = new File([blob], options.file.file_name, {
    type: options.file.mime_type || blob.type || 'application/octet-stream',
  })
  if (!navigator.canShare?.({ files: [file] })) {
    throw new Error('This browser cannot share this file. Use Download File instead.')
  }
  options.onStage?.('ready')
  return file
}

/** Must be called by a fresh user gesture after asynchronous preparation. */
export async function sharePreparedOriginal(file: File): Promise<void> {
  if (!supportsFileSharing() || !navigator.canShare?.({ files: [file] })) {
    throw new Error('This browser cannot share this file. Use Download File instead.')
  }
  await navigator.share({ files: [file], title: file.name })
}

/**
 * Unencrypted R2 originals stream directly from a short-lived attachment URL.
 * Encrypted originals are decrypted through the existing client resolver first.
 */
export async function downloadOriginalFile(options: ExportOptions): Promise<void> {
  options.onStage?.('preparing')
  if (!options.file.is_encrypted) {
    const signed = await apiSignedGet(options.accessToken, options.file.id, 'original', 'attachment')
    if (signed.mode === 'legacy-public') {
      const response = await fetch(signed.url)
      if (!response.ok) throw new Error(`Could not retrieve the legacy original (${response.status})`)
      const blob = await response.blob()
      if (blob.size <= 0) throw new Error('The retrieved legacy original was empty')
      const url = URL.createObjectURL(blob)
      options.onStage?.('downloading')
      clickDownload(url, options.file.file_name)
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
      return
    }
    options.onStage?.('downloading')
    clickDownload(signed.url, options.file.file_name)
    return
  }

  const blob = await resolvedBlob(options)
  const url = URL.createObjectURL(blob)
  options.onStage?.('downloading')
  clickDownload(url, options.file.file_name)
  // Keep the URL alive through Safari's asynchronous handoff to Downloads.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
