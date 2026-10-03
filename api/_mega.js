import { createDecipheriv, randomInt } from 'node:crypto'

const MEGA_API = 'https://g.api.mega.co.nz/cs'
const MAX_RESPONSE_BYTES = 512 * 1024
const TIMEOUT_MS = 8_000

function decodeBase64Url(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4)
  return Buffer.from(padded, 'base64')
}

function decryptBlock(ciphertext, key, mode = 'cbc') {
  const iv = mode === 'cbc' ? Buffer.alloc(16) : null
  const decipher = createDecipheriv(`aes-128-${mode}`, key, iv)
  decipher.setAutoPadding(false)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

export function decryptAttributes(encoded, key) {
  const encrypted = decodeBase64Url(encoded)
  if (!encrypted.length || encrypted.length % 16 !== 0) throw new Error('Invalid MEGA attributes')
  const plain = decryptBlock(encrypted, key).toString('utf8').replace(/\0+$/g, '')
  if (!plain.startsWith('MEGA')) throw new Error('MEGA attribute key did not authenticate')
  const attrs = JSON.parse(plain.slice(4))
  const name = typeof attrs?.n === 'string' ? attrs.n.trim() : ''
  if (!name) throw new Error('MEGA metadata has no root name')
  return { name }
}

export function parseMegaPublicLink(raw) {
  const url = new URL(raw)
  if (!/(^|\.)mega\.nz$/i.test(url.hostname)) return null
  const modern = url.pathname.match(/^\/(folder|file)\/([A-Za-z0-9_-]+)/i)
  if (modern) {
    const key = url.hash.slice(1).split('/')[0]
    return key ? { kind: modern[1].toLowerCase(), handle: modern[2], key } : null
  }
  const legacy = url.hash.replace(/^#/, '')
  const folder = legacy.match(/^F!([A-Za-z0-9_-]+)!([A-Za-z0-9_-]+)/i)
  if (folder) return { kind: 'folder', handle: folder[1], key: folder[2] }
  const file = legacy.match(/^!([A-Za-z0-9_-]+)!([A-Za-z0-9_-]+)/i)
  return file ? { kind: 'file', handle: file[1], key: file[2] } : null
}

async function megaCommand(command, folderHandle) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const id = randomInt(1, 2_147_483_647)
    const endpoint = `${MEGA_API}?id=${id}${folderHandle ? `&n=${encodeURIComponent(folderHandle)}` : ''}`
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([command]),
      signal: controller.signal,
      redirect: 'error',
    })
    if (!response.ok) throw new Error(`MEGA metadata request failed (${response.status})`)
    const declared = Number(response.headers.get('content-length') || 0)
    if (declared > MAX_RESPONSE_BYTES) throw new Error('MEGA metadata response was too large')
    const text = await response.text()
    if (text.length > MAX_RESPONSE_BYTES) throw new Error('MEGA metadata response was too large')
    const payload = JSON.parse(text)
    const result = Array.isArray(payload) ? payload[0] : null
    if (typeof result === 'number' && result < 0) throw new Error(`MEGA metadata unavailable (${result})`)
    if (!result || typeof result !== 'object') throw new Error('Invalid MEGA metadata response')
    return result
  } finally {
    clearTimeout(timer)
  }
}

export function fileAttributeKey(publicKey) {
  if (publicKey.length !== 32) throw new Error('Invalid MEGA file key')
  const key = Buffer.alloc(16)
  for (let i = 0; i < 16; i += 1) key[i] = publicKey[i] ^ publicKey[i + 16]
  return key
}

export async function resolveMegaPublicMetadata(rawUrl) {
  const parsed = parseMegaPublicLink(rawUrl)
  if (!parsed) return null
  const publicKey = decodeBase64Url(parsed.key)
  let attributes
  if (parsed.kind === 'file') {
    const result = await megaCommand({ a: 'g', g: 1, p: parsed.handle })
    attributes = decryptAttributes(result.at, fileAttributeKey(publicKey))
  } else {
    if (publicKey.length !== 16) throw new Error('Invalid MEGA folder key')
    const result = await megaCommand({ a: 'pli', ph: parsed.handle })
    const encryptedNodeKey = decodeBase64Url(String(result.k || '').split(':').pop())
    if (encryptedNodeKey.length !== 16) throw new Error('Invalid MEGA root node key')
    const nodeKey = decryptBlock(encryptedNodeKey, publicKey, 'ecb')
    attributes = decryptAttributes(result.attrs, nodeKey)
  }
  return {
    provider: 'MEGA',
    automaticTitle: attributes.name,
    // MEGA's public-link metadata exposes timestamps that may represent upload
    // or modification. Do not mislabel either as resource creation time.
    providerCreatedAt: null,
  }
}
