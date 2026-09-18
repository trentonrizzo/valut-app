import { supabase } from '../supabase'
import { base64ToBytes, bytesToBase64 } from './envelope'

const IDB_NAME = 'vault-v11'
const IDB_STORE = 'keys'
const IDB_MASTER = 'vmk'
const PBKDF2_ITERATIONS = 210_000

export type VaultKeyStatus =
  | { state: 'missing' }
  | { state: 'needs-unlock' }
  | { state: 'ready'; key: CryptoKey }

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
  })
}

async function idbGet(key: string): Promise<ArrayBuffer | undefined> {
  const db = await openDb()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly')
      const req = tx.objectStore(IDB_STORE).get(key)
      req.onsuccess = () => resolve(req.result as ArrayBuffer | undefined)
      req.onerror = () => reject(req.error)
    })
  } finally {
    db.close()
  }
}

async function idbSet(key: string, value: ArrayBuffer): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.objectStore(IDB_STORE).put(value, key)
    })
  } finally {
    db.close()
  }
}

export function formatRecoverySecret(raw: Uint8Array): string {
  const hex = [...raw].map((b) => b.toString(16).padStart(2, '0')).join('')
  const parts = hex.match(/.{1,4}/g) ?? [hex]
  return parts.join('-').toUpperCase()
}

export function parseRecoverySecret(input: string): Uint8Array {
  const hex = input.replace(/[^0-9a-fA-F]/g, '')
  if (hex.length !== 64) throw new Error('Recovery key must be 32 bytes (64 hex chars)')
  const out = new Uint8Array(32)
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

async function importMasterKey(raw: BufferSource, extractable: boolean): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, extractable, [
    'encrypt',
    'decrypt',
  ])
}

async function deriveWrapKey(secret: Uint8Array, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', secret, 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function loadLocalMasterKey(): Promise<CryptoKey | null> {
  const raw = await idbGet(IDB_MASTER)
  if (!raw) return null
  return importMasterKey(raw, false)
}

export async function persistLocalMasterKey(raw: Uint8Array): Promise<CryptoKey> {
  const copy = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer
  await idbSet(IDB_MASTER, copy)
  return importMasterKey(raw, false)
}

export async function fetchVaultWrapRow(userId: string): Promise<{
  vault_wrap_salt: string | null
  vault_wrapped_master_key: string | null
} | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('vault_wrap_salt, vault_wrapped_master_key')
    .eq('id', userId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

export async function createVaultWithRecovery(userId: string): Promise<{ recoverySecret: string; key: CryptoKey }> {
  const vmkRaw = crypto.getRandomValues(new Uint8Array(32))
  const recovery = crypto.getRandomValues(new Uint8Array(32))
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const wrapKey = await deriveWrapKey(recovery, salt)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrapKey, vmkRaw)
  const packed = new Uint8Array(1 + iv.byteLength + wrapped.byteLength)
  packed[0] = 1
  packed.set(iv, 1)
  packed.set(new Uint8Array(wrapped), 1 + iv.byteLength)

  const { error } = await supabase
    .from('profiles')
    .update({
      vault_wrap_salt: bytesToBase64(salt),
      vault_wrapped_master_key: bytesToBase64(packed),
      vault_key_created_at: new Date().toISOString(),
    })
    .eq('id', userId)
  if (error) throw new Error(error.message)

  const key = await persistLocalMasterKey(vmkRaw)
  return { recoverySecret: formatRecoverySecret(recovery), key }
}

export async function unlockWithRecovery(userId: string, recoveryInput: string): Promise<CryptoKey> {
  const row = await fetchVaultWrapRow(userId)
  if (!row?.vault_wrap_salt || !row.vault_wrapped_master_key) {
    throw new Error('No vault recovery is set up on this account')
  }
  const salt = base64ToBytes(row.vault_wrap_salt)
  const packed = base64ToBytes(row.vault_wrapped_master_key)
  if (packed[0] !== 1) throw new Error('Unsupported vault wrap version')
  const iv = packed.slice(1, 13)
  const ct = packed.slice(13)
  const secret = parseRecoverySecret(recoveryInput)
  const wrapKey = await deriveWrapKey(secret, salt)
  const vmkBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, wrapKey, ct)
  const vmkRaw = new Uint8Array(vmkBuf)
  return persistLocalMasterKey(vmkRaw)
}

export async function resolveVaultKeyStatus(userId: string): Promise<VaultKeyStatus> {
  const local = await loadLocalMasterKey()
  if (local) return { state: 'ready', key: local }
  const row = await fetchVaultWrapRow(userId)
  if (row?.vault_wrapped_master_key) return { state: 'needs-unlock' }
  return { state: 'missing' }
}
