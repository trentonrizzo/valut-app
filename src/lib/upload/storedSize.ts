import { CHUNK_PLAINTEXT_BYTES, GCM_TAG_BYTES, chunkCountForSize } from '../crypto/chunkCipher'

/** Bytes R2 must contain after a successful upload of this job. */
export function storedObjectBytes(
  plaintextSize: number,
  encrypted: boolean,
  chunkSize = CHUNK_PLAINTEXT_BYTES,
): number {
  const size = Math.max(0, Math.floor(plaintextSize))
  if (!encrypted) return size
  if (size === 0) return GCM_TAG_BYTES
  const count = chunkCountForSize(size, chunkSize)
  const lastPlain = size % chunkSize === 0 ? chunkSize : size % chunkSize
  const full = count - 1
  return full * (chunkSize + GCM_TAG_BYTES) + lastPlain + GCM_TAG_BYTES
}

export function expectedVerifySize(job: {
  size: number
  storedSize?: number | null
  encryptionVersion?: number
  chunkSize?: number | null
}): number {
  if (job.storedSize != null && Number.isFinite(job.storedSize)) return job.storedSize
  return storedObjectBytes(job.size, (job.encryptionVersion ?? 0) > 0, job.chunkSize || CHUNK_PLAINTEXT_BYTES)
}
