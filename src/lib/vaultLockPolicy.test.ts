import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  displayOriginalInstant,
  genericPinFailure,
  inferFilenameCapture,
  lockoutSecondsAfterFailure,
  pinSetupAllowed,
} from './vaultLockPolicy'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

describe('PIN policy', () => {
  it('defaults to six digits and requires a warning before a shorter PIN', () => {
    expect(pinSetupAllowed('123456', false).ok).toBe(true)
    expect(pinSetupAllowed('12', false).ok).toBe(false)
    expect(pinSetupAllowed('12', false).warning).toBe(true)
    expect(pinSetupAllowed('12', true).ok).toBe(true)
    expect(pinSetupAllowed('1234567', true).ok).toBe(false)
    expect(pinSetupAllowed('12a', true).ok).toBe(false)
  })

  it('increases lockout time and never describes the PIN length', () => {
    expect(lockoutSecondsAfterFailure(2)).toBe(0)
    expect(lockoutSecondsAfterFailure(3)).toBe(30)
    expect(lockoutSecondsAfterFailure(5)).toBeGreaterThan(lockoutSecondsAfterFailure(3))
    expect(lockoutSecondsAfterFailure(10)).toBeGreaterThan(lockoutSecondsAfterFailure(8))
    expect(genericPinFailure()).toBe('Incorrect PIN')
    expect(genericPinFailure()).not.toMatch(/digit|length|close/i)
  })

  it('keeps the lock opaque and does not reveal PIN length', () => {
    const screen = readFileSync(join(root, 'src/components/security/VaultLockGate.tsx'), 'utf8')
    const route = readFileSync(join(root, 'src/components/layout/ProtectedRoute.tsx'), 'utf8')
    const auth = readFileSync(join(root, 'api/_auth.js'), 'utf8')
    expect(screen).toContain('Enter six-digit PIN')
    expect(screen).toContain('PIN_DOTS')
    expect(screen).toContain("phase === 'open'")
    expect(screen).toContain('filePickerAllowsBackground')
    expect(route).toContain('VaultLockGate')
    expect(auth).toContain('vault_private_access')
    expect(screen).not.toContain('sessionStorage')
  })
})

describe('original capture dates', () => {
  it('ranks a user correction above extracted metadata without calling a modified date original', () => {
    const corrected = displayOriginalInstant({
      capturedAt: '2018-07-10T15:04:00.000Z',
      source: 'exif_datetime_original',
      userAt: '2019-01-02T12:00:00.000Z',
    })
    expect(corrected.explanation).toMatch(/Extracted metadata was kept/i)
    const modified = displayOriginalInstant({ capturedAt: '2026-10-15T00:00:00.000Z', source: 'file_last_modified' })
    expect(modified.text).toBe('Unknown')
    const inferred = displayOriginalInstant({ capturedLocal: '2018-07-10T15:30:45', source: 'filename_inferred' })
    expect(inferred.explanation).toMatch(/filename/i)
  })

  it('reads a filename date only as a low-confidence inference', () => {
    expect(inferFilenameCapture('IMG_20180710_153045.jpg')?.local).toBe('2018-07-10T15:30:45')
    expect(inferFilenameCapture('notes.txt')).toBeNull()
  })
})
