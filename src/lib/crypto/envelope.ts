import { toArrayBuffer } from './bytes'

const WRAP_IV_BYTES = 12

export async function wrapDek(masterKey: CryptoKey, dekRaw: Uint8Array): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(WRAP_IV_BYTES))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, masterKey, toArrayBuffer(dekRaw))
  const out = new Uint8Array(1 + iv.byteLength + ct.byteLength)
  out[0] = 1
  out.set(iv, 1)
  out.set(new Uint8Array(ct), 1 + iv.byteLength)
  return bytesToBase64(out)
}

export async function unwrapDek(masterKey: CryptoKey, wrappedB64: string): Promise<Uint8Array> {
  const buf = base64ToBytes(wrappedB64)
  if (buf.byteLength < 1 + WRAP_IV_BYTES + 16) throw new Error('Invalid wrapped DEK')
  const version = buf[0]
  if (version !== 1) throw new Error(`Unsupported wrap version ${version}`)
  const iv = buf.slice(1, 1 + WRAP_IV_BYTES)
  const ct = buf.slice(1 + WRAP_IV_BYTES)
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: toArrayBuffer(iv) }, masterKey, toArrayBuffer(ct))
  return new Uint8Array(plain)
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]!)
  return btoa(bin)
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
