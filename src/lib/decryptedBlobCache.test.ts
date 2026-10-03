import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getDecryptedBlobUrlForFile,
  releaseDecryptedBlobUrlForFile,
  setDecryptedBlobUrlForFile,
} from './decryptedBlobCache'

describe('decrypted blob resource cleanup', () => {
  afterEach(() => releaseDecryptedBlobUrlForFile('legacy-video'))

  it('revokes an owned blob URL when the legacy viewer releases it', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    setDecryptedBlobUrlForFile('legacy-video', 'blob:vault-video')
    releaseDecryptedBlobUrlForFile('legacy-video')
    expect(getDecryptedBlobUrlForFile('legacy-video')).toBeUndefined()
    expect(revoke).toHaveBeenCalledWith('blob:vault-video')
    revoke.mockRestore()
  })
})
