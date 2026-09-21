import { describe, expect, it, vi } from 'vitest'
import { userOwnsStorageKey } from '../api/storage/_keys.js'

describe('storage API key guard', () => {
  it('does not allow a caller to use another user key', () => {
    expect(userOwnsStorageKey('aaa', 'users/bbb/originals/1')).toBe(false)
    expect(userOwnsStorageKey('aaa', 'users/aaa/originals/1')).toBe(true)
  })
})

describe('unauthenticated upload URL', () => {
  it('rejects requests without a bearer token', async () => {
    vi.resetModules()
    const handler = (await import('../api/r2-upload-url.js')).default
    const req = { method: 'POST', headers: {}, body: { fileName: 'a.jpg' } }
    const res = {
      statusCode: 0,
      setHeader() {},
      end(body) {
        res.body = body
      },
      body: '',
    }
    await handler(req, res)
    expect(res.statusCode).toBe(401)
    expect(JSON.parse(res.body).ok).toBe(false)
  })
})

describe('permanent delete ownership', () => {
  it('rejects unauthenticated delete', async () => {
    vi.resetModules()
    const handler = (await import('../api/delete.js')).default
    const req = {
      method: 'POST',
      headers: {},
      body: { action: 'permanent', fileId: 'x' },
    }
    const res = {
      statusCode: 0,
      setHeader() {},
      end(body) {
        res.body = body
      },
      body: '',
    }
    await handler(req, res)
    expect(res.statusCode).toBe(401)
  })

  it('does not allow user A to target user B keys', () => {
    expect(userOwnsStorageKey('user-a', 'users/user-b/originals/1')).toBe(false)
    expect(userOwnsStorageKey('user-a', 'users/user-a/originals/1')).toBe(true)
  })
})
