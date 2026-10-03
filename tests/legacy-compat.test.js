import { readFileSync } from 'node:fs'
import { URL } from 'node:url'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const source = readFileSync(new URL('../public/legacy-compat.js', import.meta.url), 'utf8')
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')

function runCompat(overrides = {}) {
  const listeners = {}
  const crypto = overrides.crypto || {
    getRandomValues(bytes) {
      for (let index = 0; index < bytes.length; index += 1) bytes[index] = index
      return bytes
    },
  }
  const window = {
    crypto,
    document: { getElementById: () => ({ firstChild: {}, setAttribute: vi.fn(), style: {} }) },
    addEventListener(type, listener) {
      listeners[type] = listener
    },
    setTimeout: vi.fn(),
    ...overrides,
  }
  vm.runInNewContext(source, { window, Object, Array, Symbol, Uint8Array, Number, Math, Error })
  return { window, crypto, listeners }
}

describe('Safari 12 compatibility bootstrap', () => {
  it('loads before the application module', () => {
    expect(html.indexOf('/legacy-compat.js')).toBeGreaterThan(-1)
    expect(html.indexOf('/legacy-compat.js')).toBeLessThan(html.indexOf('/src/main.tsx'))
  })

  it('defines globalThis and Object.fromEntries when absent', () => {
    const original = Object.fromEntries
    try {
      Object.fromEntries = undefined
      const { window } = runCompat()
      expect(window.globalThis).toBe(window)
      expect(Object.fromEntries([
        ['album', 'family'],
        ['count', 2],
      ])).toEqual({ album: 'family', count: 2 })
    } finally {
      Object.fromEntries = original
    }
  })

  it('uses cryptographically secure random bytes for RFC 4122 version 4 UUIDs', () => {
    const getRandomValues = vi.fn((bytes) => {
      for (let index = 0; index < bytes.length; index += 1) bytes[index] = index
      return bytes
    })
    const crypto = { getRandomValues }
    runCompat({ crypto })

    expect(crypto.randomUUID()).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f')
    expect(getRandomValues).toHaveBeenCalledTimes(1)
    expect(source).not.toContain('Math.random')
  })

  it('does not replace native implementations', () => {
    const nativeRandomUUID = vi.fn(() => 'native')
    const crypto = { randomUUID: nativeRandomUUID, getRandomValues: vi.fn() }
    const nativeFromEntries = Object.fromEntries
    const { window } = runCompat({ crypto, globalThis: { native: true } })

    expect(crypto.randomUUID()).toBe('native')
    expect(crypto.getRandomValues).not.toHaveBeenCalled()
    expect(Object.fromEntries).toBe(nativeFromEntries)
    expect(window.globalThis).toEqual({ native: true })
  })
})
