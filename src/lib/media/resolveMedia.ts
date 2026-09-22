import { apiSignedGet } from '../upload/storageApi'
import { decryptChunk, CHUNK_PLAINTEXT_BYTES } from '../crypto/chunkCipher'
import { toArrayBuffer } from '../crypto/bytes'
import { unwrapDek, base64ToBytes } from '../crypto/envelope'
import { importDek } from '../crypto/chunkCipher'
import { setDecryptedBlobUrlForFile, getDecryptedBlobUrlForFile } from '../decryptedBlobCache'

export type ResolvedMedia = {
  displayUrl: string
  downloadUrl: string
  mode: 'legacy-public' | 'signed' | 'blob'
}

type SignedCacheEntry = {
  url: string
  mode: 'signed' | 'legacy-public'
  encryptionVersion: number
  chunkSize?: number | null
  wrappedDek?: string | null
  metadata?: Record<string, unknown> | null
  mimeType?: string | null
  expiresAt: number
}

const signedCache = new Map<string, SignedCacheEntry>()
const inFlight = new Map<string, Promise<SignedCacheEntry>>()

function cacheKey(fileId: string, variant: string) {
  return `${fileId}:${variant}`
}

export function invalidateSignedMedia(fileId: string, variant?: string) {
  if (variant) {
    signedCache.delete(cacheKey(fileId, variant))
    inFlight.delete(cacheKey(fileId, variant))
    return
  }
  for (const k of [...signedCache.keys()]) {
    if (k.startsWith(`${fileId}:`)) signedCache.delete(k)
  }
  for (const k of [...inFlight.keys()]) {
    if (k.startsWith(`${fileId}:`)) inFlight.delete(k)
  }
}

async function fetchSigned(accessToken: string, fileId: string, variant: 'original' | 'thumb' | 'poster'): Promise<SignedCacheEntry> {
  const key = cacheKey(fileId, variant)
  const cached = signedCache.get(key)
  if (cached && cached.expiresAt > Date.now() + 15_000) return cached
  const existing = inFlight.get(key)
  if (existing) return existing
  const pending = (async () => {
    const signed = await apiSignedGet(accessToken, fileId, variant)
    const ttlMs = Math.max(30_000, ((signed.expiresIn ?? 15 * 60) - 90) * 1000)
    const entry: SignedCacheEntry = {
      url: signed.url,
      mode: signed.mode,
      encryptionVersion: signed.encryptionVersion ?? 0,
      chunkSize: signed.chunkSize,
      wrappedDek: signed.wrappedDek,
      metadata: signed.metadata,
      mimeType: signed.mimeType,
      expiresAt: Date.now() + ttlMs,
    }
    signedCache.set(key, entry)
    return entry
  })()
  inFlight.set(key, pending)
  try {
    return await pending
  } finally {
    inFlight.delete(key)
  }
}

async function fetchSignedWithRetry(accessToken: string, fileId: string, variant: 'original' | 'thumb' | 'poster'): Promise<SignedCacheEntry> {
  try {
    return await fetchSigned(accessToken, fileId, variant)
  } catch {
    invalidateSignedMedia(fileId, variant)
    return fetchSigned(accessToken, fileId, variant)
  }
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
    const plain = await decryptChunk(dek, fileNonce, index, toArrayBuffer(slice))
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
    const signed = await fetchSignedWithRetry(opts.accessToken, opts.fileId, variant)
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
