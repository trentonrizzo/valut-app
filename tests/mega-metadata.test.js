import { createCipheriv, randomBytes } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { decryptAttributes, fileAttributeKey, parseMegaPublicLink, resolveMegaPublicMetadata } from '../api/_mega.js'

function b64url(bytes) { return Buffer.from(bytes).toString('base64url') }
function encryptBlock(plain, key, mode = 'cbc') {
  const padded = Buffer.alloc(Math.ceil(plain.length / 16) * 16)
  plain.copy(padded)
  const cipher = createCipheriv(`aes-128-${mode}`, key, mode === 'cbc' ? Buffer.alloc(16) : null)
  cipher.setAutoPadding(false)
  return Buffer.concat([cipher.update(padded), cipher.final()])
}
function encryptedAttrs(name, key) {
  return b64url(encryptBlock(Buffer.from(`MEGA${JSON.stringify({ n: name })}`), key))
}

describe('MEGA public metadata', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('parses modern file/folder links without changing the source URL', () => {
    const folder = 'https://mega.nz/folder/AbC123#Key_With-Case_9'
    expect(parseMegaPublicLink(folder)).toEqual({ kind: 'folder', handle: 'AbC123', key: 'Key_With-Case_9' })
    expect(folder).toBe('https://mega.nz/folder/AbC123#Key_With-Case_9')
    expect(parseMegaPublicLink('https://mega.nz/#!oldFile!oldKey')).toEqual({ kind: 'file', handle: 'oldFile', key: 'oldKey' })
    expect(parseMegaPublicLink('https://mega.nz/#F!oldFolder!oldKey')).toEqual({ kind: 'folder', handle: 'oldFolder', key: 'oldKey' })
  })

  it('decrypts a public file root name without downloading contents', async () => {
    const publicKey = randomBytes(32)
    const attrKey = fileAttributeKey(publicKey)
    const at = encryptedAttrs('John Doe.mov', attrKey)
    vi.stubGlobal('fetch', vi.fn(async () => new globalThis.Response(JSON.stringify([{ at, s: 123 }]), { status: 200 })))
    await expect(resolveMegaPublicMetadata(`https://mega.nz/file/AbC123#${b64url(publicKey)}`)).resolves.toEqual({
      provider: 'MEGA', automaticTitle: 'John Doe.mov', providerCreatedAt: null,
    })
  })

  it('decrypts a public folder root name through the metadata-only pli command', async () => {
    const folderKey = randomBytes(16)
    const nodeKey = randomBytes(16)
    const encryptedNodeKey = encryptBlock(nodeKey, folderKey, 'ecb')
    const attrs = encryptedAttrs('John Doe', nodeKey)
    vi.stubGlobal('fetch', vi.fn(async () => new globalThis.Response(JSON.stringify([{ attrs, k: `AAAAAAAAAAA:${b64url(encryptedNodeKey)}` }]), { status: 200 })))
    await expect(resolveMegaPublicMetadata(`https://mega.nz/folder/AbC123#${b64url(folderKey)}`)).resolves.toMatchObject({
      provider: 'MEGA', automaticTitle: 'John Doe', providerCreatedAt: null,
    })
  })

  it('rejects an incorrect key rather than fabricating a name', () => {
    expect(() => decryptAttributes(encryptedAttrs('Private', randomBytes(16)), randomBytes(16))).toThrow()
  })
})
