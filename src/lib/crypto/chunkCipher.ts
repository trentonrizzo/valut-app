/** Chunked AES-256-GCM for vault originals. Never whole-file arrayBuffer. */

export const ENCRYPTION_VERSION = 1
export const CHUNK_PLAINTEXT_BYTES = 8 * 1024 * 1024
export const GCM_TAG_BYTES = 16
export const FILE_NONCE_BYTES = 8

export function ciphertextChunkBytes(plaintextBytes: number): number {
  return plaintextBytes + GCM_TAG_BYTES
}

export function chunkCountForSize(plainSize: number, chunkSize = CHUNK_PLAINTEXT_BYTES): number {
  if (plainSize <= 0) return 1
  return Math.ceil(plainSize / chunkSize)
}

export function ivForChunk(fileNonce: Uint8Array, chunkIndex: number): Uint8Array {
  if (fileNonce.byteLength !== FILE_NONCE_BYTES) {
    throw new Error('fileNonce must be 8 bytes')
  }
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
    throw new Error('chunkIndex must be a non-negative integer')
  }
  const iv = new Uint8Array(12)
  iv.set(fileNonce, 0)
  const view = new DataView(iv.buffer, iv.byteOffset, iv.byteLength)
  view.setUint32(8, chunkIndex, false)
  return iv
}

export async function encryptChunk(
  dek: CryptoKey,
  fileNonce: Uint8Array,
  chunkIndex: number,
  plaintext: BufferSource,
): Promise<Uint8Array> {
  const iv = ivForChunk(fileNonce, chunkIndex)
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, dek, plaintext)
  return new Uint8Array(ct)
}

export async function decryptChunk(
  dek: CryptoKey,
  fileNonce: Uint8Array,
  chunkIndex: number,
  ciphertext: BufferSource,
): Promise<ArrayBuffer> {
  const iv = ivForChunk(fileNonce, chunkIndex)
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, dek, ciphertext)
}

export async function generateDek(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
}

export async function exportRawKey(key: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.exportKey('raw', key))
}

export async function importDek(raw: BufferSource): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
}

export function newFileNonce(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(FILE_NONCE_BYTES))
}

/** Read one plaintext slice from a File without loading the rest. */
export async function readFileSlice(file: Blob, start: number, end: number): Promise<ArrayBuffer> {
  const slice = file.slice(start, end)
  return slice.arrayBuffer()
}
