import { supabase } from './supabase'

const IV_LENGTH = 12

let cachedUserId: string | null = null
let cachedKey: CryptoKey | null = null
let inflightKey: Promise<CryptoKey> | null = null

export function clearEncryptionSession(): void {
  cachedUserId = null
  cachedKey = null
  inflightKey = null
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]!)
  return btoa(bin)
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/**
 * Load or create the user's AES-256-GCM key; cached for the session.
 */
export async function ensureEncryptionKey(userId: string): Promise<CryptoKey> {
  if (cachedKey && cachedUserId === userId) return cachedKey
  if (inflightKey) return inflightKey

  inflightKey = loadOrCreateKey(userId).finally(() => {
    inflightKey = null
  })
  return inflightKey
}

async function loadOrCreateKey(userId: string): Promise<CryptoKey> {
  const { data, error } = await supabase
    .from('profiles')
    .select('encryption_key')
    .eq('id', userId)
    .single()

  if (error) throw new Error(error.message)

  const existing = data?.encryption_key as string | null | undefined
  if (existing && existing.length > 0) {
    const raw = base64ToBytes(existing)
    const rawBuf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer
    const key = await crypto.subtle.importKey('raw', rawBuf, { name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ])
    cachedUserId = userId
    cachedKey = key
    return key
  }

  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ])
  const exported = await crypto.subtle.exportKey('raw', key)
  const b64 = bytesToBase64(new Uint8Array(exported))

  const { error: upErr } = await supabase
    .from('profiles')
    .update({ encryption_key: b64 })
    .eq('id', userId)

  if (upErr) {
    const { data: again, error: e2 } = await supabase
      .from('profiles')
      .select('encryption_key')
      .eq('id', userId)
      .single()
    if (e2) throw new Error(e2.message)
    const b64b = again?.encryption_key as string | undefined
    if (!b64b) throw new Error(upErr.message)
    const raw2 = base64ToBytes(b64b)
    const rawBuf2 = raw2.buffer.slice(raw2.byteOffset, raw2.byteOffset + raw2.byteLength) as ArrayBuffer
    const key2 = await crypto.subtle.importKey('raw', rawBuf2, { name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ])
    cachedUserId = userId
    cachedKey = key2
    return key2
  }

  cachedUserId = userId
  cachedKey = key
  return key
}

/**
 * Encrypt file bytes; output = IV (12) || ciphertext (includes GCM tag).
 */
export async function encryptFile(file: File, key: CryptoKey): Promise<Blob> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const plain = await file.arrayBuffer()
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain)
  const out = new Uint8Array(iv.byteLength + encrypted.byteLength)
  out.set(iv, 0)
  out.set(new Uint8Array(encrypted), iv.byteLength)
  return new Blob([out], { type: 'application/octet-stream' })
}

export async function decryptToArrayBuffer(blob: Blob, key: CryptoKey): Promise<ArrayBuffer> {
  const buf = await blob.arrayBuffer()
  const u8 = new Uint8Array(buf)
  if (u8.byteLength < IV_LENGTH + 16) {
    throw new Error('Invalid encrypted payload')
  }
  const iv = u8.slice(0, IV_LENGTH)
  const ciphertext = u8.slice(IV_LENGTH)
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
}

export function guessMimeFromFileName(fileName: string): string {
  const lower = String(fileName || '').toLowerCase()
  if (/\.(jpe?g)$/i.test(lower)) return 'image/jpeg'
  if (/\.png$/i.test(lower)) return 'image/png'
  if (/\.gif$/i.test(lower)) return 'image/gif'
  if (/\.webp$/i.test(lower)) return 'image/webp'
  if (/\.(mp4)$/i.test(lower)) return 'video/mp4'
  if (/\.webm$/i.test(lower)) return 'video/webm'
  if (/\.(mov)$/i.test(lower)) return 'video/quicktime'
  if (/\.(ogg)$/i.test(lower)) return 'video/ogg'
  if (/\.(mkv)$/i.test(lower)) return 'video/x-matroska'
  return 'application/octet-stream'
}

/**
 * Fetch encrypted object from URL and return a decrypted Blob with a useful MIME type.
 */
export async function decryptRemoteToBlob(
  storedUrl: string,
  key: CryptoKey,
  fileNameHint: string,
): Promise<Blob> {
  const res = await fetch(storedUrl)
  if (!res.ok) throw new Error(`Fetch failed (${res.status})`)
  const encBlob = await res.blob()
  const plain = await decryptToArrayBuffer(encBlob, key)
  const type = guessMimeFromFileName(fileNameHint)
  return new Blob([plain], { type })
}
