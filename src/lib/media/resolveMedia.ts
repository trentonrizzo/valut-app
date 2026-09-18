import { apiSignedGet } from '../upload/storageApi'
import { decryptChunk, CHUNK_PLAINTEXT_BYTES } from '../crypto/chunkCipher'
import { unwrapDek, base64ToBytes } from '../crypto/envelope'
import { importDek } from '../crypto/chunkCipher'
import { setDecryptedBlobUrlForFile, getDecryptedBlobUrlForFile } from '../decryptedBlobCache'

export type ResolvedMedia = {
  displayUrl: string
  downloadUrl: string
  mode: 'legacy-public' | 'signed' | 'blob'
}

async function decryptRemoteChunks(opts: {
  signedUrl: string
  wrappedDek: string
  masterKey: CryptoKey
  fileNonceB64: string
  chunkSize: number
  mime: string
}): Promise<Blob> {
  const dekRaw = await unwrapDek(opts.masterKey, opts.wrappedDek)
  const dek = await importDek(dekRaw)
  const fileNonce = base64ToBytes(opts.fileNonceB64)
  const head = await fetch(opts.signedUrl, { method: 'HEAD' })
  const lenHeader = head.headers.get('content-length')
  const total = lenHeader ? Number(lenHeader) : NaN
  if (!Number.isFinite(total) || total <= 0) {
    const full = await fetch(opts.signedUrl)
    if (!full.ok) throw new Error(`Fetch failed (${full.status})`)
    const buf = new Uint8Array(await full.arrayBuffer())
    return decryptBufferAsChunks(buf, dek, fileNonce, opts.chunkSize, opts.mime)
  }
  const cipherChunk = opts.chunkSize + 16
  const count = Math.ceil(total / cipherChunk)
  const parts: Blob[] = []
  for (let i = 0; i < count; i++) {
    const start = i * cipherChunk
    const end = Math.min(total, start + cipherChunk) - 1
    const res = await fetch(opts.signedUrl, { headers: { Range: `bytes=${start}-${end}` } })
    if (!res.ok && res.status !== 206) throw new Error(`Range fetch failed (${res.status})`)
    const ct = await res.arrayBuffer()
    const plain = await decryptChunk(dek, fileNonce, i, ct)
    parts.push(new Blob([plain]))
  }
  return new Blob(parts, { type: opts.mime || 'application/octet-stream' })
}

async function decryptBufferAsChunks(
  buf: Uint8Array,
  dek: CryptoKey,
  fileNonce: Uint8Array,
  chunkSize: number,
  mime: string,
): Promise<Blob> {
  const cipherChunk = chunkSize + 16
  const parts: Blob[] = []
  let offset = 0
  let index = 0
  while (offset < buf.byteLength) {
    const slice = buf.subarray(offset, Math.min(buf.byteLength, offset + cipherChunk))
    const plain = await decryptChunk(dek, fileNonce, index, slice)
    parts.push(new Blob([plain]))
    offset += cipherChunk
    index += 1
  }
  return new Blob(parts, { type: mime || 'application/octet-stream' })
}

export async function resolveVaultMedia(opts: {
  fileId: string
  accessToken: string
  variant?: 'original' | 'thumb' | 'poster'
  masterKey?: CryptoKey | null
  fallbackUrl?: string | null
}): Promise<ResolvedMedia> {
  const variant = opts.variant ?? 'original'
  if (variant === 'original') {
    const cached = getDecryptedBlobUrlForFile(opts.fileId)
    if (cached) return { displayUrl: cached, downloadUrl: cached, mode: 'blob' }
  }

  try {
    const signed = await apiSignedGet(opts.accessToken, opts.fileId, variant)
    const encV = signed.encryptionVersion ?? 0
    if (signed.mode === 'legacy-public' || encV === 0 || variant !== 'original') {
      return { displayUrl: signed.url, downloadUrl: signed.url, mode: signed.mode === 'legacy-public' ? 'legacy-public' : 'signed' }
    }
    if (!opts.masterKey) throw new Error('Unlock your vault recovery key to view encrypted media')
    const meta = signed.metadata ?? {}
    const nonce = typeof meta.fileNonce === 'string' ? meta.fileNonce : null
    if (!signed.wrappedDek || !nonce) throw new Error('Missing encryption metadata')
    const blob = await decryptRemoteChunks({
      signedUrl: signed.url,
      wrappedDek: signed.wrappedDek,
      masterKey: opts.masterKey,
      fileNonceB64: nonce,
      chunkSize: signed.chunkSize || CHUNK_PLAINTEXT_BYTES,
      mime: signed.mimeType || 'application/octet-stream',
    })
    const url = URL.createObjectURL(blob)
    setDecryptedBlobUrlForFile(opts.fileId, url)
    return { displayUrl: url, downloadUrl: url, mode: 'blob' }
  } catch (e) {
    if (opts.fallbackUrl && /^https?:\/\//i.test(opts.fallbackUrl)) {
      return { displayUrl: opts.fallbackUrl, downloadUrl: opts.fallbackUrl, mode: 'legacy-public' }
    }
    if (opts.fallbackUrl?.startsWith('blob:')) {
      return { displayUrl: opts.fallbackUrl, downloadUrl: opts.fallbackUrl, mode: 'blob' }
    }
    throw e
  }
}
