import { describe, expect, it, vi } from 'vitest'
import { toArrayBuffer } from './bytes'
import {
  CHUNK_PLAINTEXT_BYTES,
  chunkCountForSize,
  decryptChunk,
  encryptChunk,
  generateDek,
  ivForChunk,
  newFileNonce,
  readFileSlice,
} from './chunkCipher'
import * as chunkCipher from './chunkCipher'

describe('chunked AES-GCM', () => {
  it('round-trips independent chunks', async () => {
    const dek = await generateDek()
    const nonce = newFileNonce()
    const a = new TextEncoder().encode('hello-chunk-0')
    const b = new TextEncoder().encode('hello-chunk-1')
    const ca = await encryptChunk(dek, nonce, 0, toArrayBuffer(a))
    const cb = await encryptChunk(dek, nonce, 1, toArrayBuffer(b))
    const pa = new TextDecoder().decode(await decryptChunk(dek, nonce, 0, toArrayBuffer(ca)))
    const pb = new TextDecoder().decode(await decryptChunk(dek, nonce, 1, toArrayBuffer(cb)))
    expect(pa).toBe('hello-chunk-0')
    expect(pb).toBe('hello-chunk-1')
  })

  it('fails authentication on a corrupted chunk', async () => {
    const dek = await generateDek()
    const nonce = newFileNonce()
    const plain = new Uint8Array([1, 2, 3, 4, 5])
    const ct = await encryptChunk(dek, nonce, 0, toArrayBuffer(plain))
    ct[0] ^= 0xff
    await expect(decryptChunk(dek, nonce, 0, toArrayBuffer(ct))).rejects.toThrow()
  })

  it('does not reuse IVs across chunk indexes', () => {
    const nonce = new Uint8Array(8).fill(7)
    const iv0 = ivForChunk(nonce, 0)
    const iv1 = ivForChunk(nonce, 1)
    expect([...iv0].join(',')).not.toBe([...iv1].join(','))
  })

  it('never calls arrayBuffer on the original File for a multi-chunk payload', async () => {
    const bytes = new Uint8Array(CHUNK_PLAINTEXT_BYTES + 100)
    const file = new File([bytes], 'big.bin', { type: 'application/octet-stream' })
    const spy = vi.spyOn(file, 'arrayBuffer')
    await readFileSlice(file, 0, 128)
    expect(spy).not.toHaveBeenCalled()
    expect(chunkCountForSize(file.size)).toBe(2)
  })

  it('does not export a whole-file encrypt helper from the v1.1 module', () => {
    expect('encryptFile' in chunkCipher).toBe(false)
  })
})
