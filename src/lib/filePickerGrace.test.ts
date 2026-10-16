// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { armFilePicker, filePickerAllowsBackground, installFilePickerGrace, noteFilePickerHidden, noteFilePickerReturned } from './filePickerGrace'

describe('file picker grace', () => {
  afterEach(() => {
    vi.useRealTimers()
    noteFilePickerReturned(Date.now() + 60 * 60 * 1000)
  })

  it('allows the background events that the photo picker produces, then expires', () => {
    const start = 1_000_000
    expect(filePickerAllowsBackground(start)).toBe(false)
    armFilePicker(start)
    expect(filePickerAllowsBackground(start + 1000)).toBe(true)
    expect(filePickerAllowsBackground(start + 10 * 60 * 1000)).toBe(false)
  })

  it('arms from a file input and releases after the selection returns', () => {
    vi.useFakeTimers()
    const stop = installFilePickerGrace()
    const input = document.createElement('input')
    input.type = 'file'
    document.body.appendChild(input)
    input.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(filePickerAllowsBackground()).toBe(true)
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
    noteFilePickerHidden()
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    expect(filePickerAllowsBackground()).toBe(true)
    vi.advanceTimersByTime(8000)
    expect(filePickerAllowsBackground()).toBe(false)
    stop()
    input.remove()
  })

  it('ends shortly after the picker returns so a later background still locks', () => {
    vi.useFakeTimers()
    vi.setSystemTime(5_000)
    armFilePicker()
    noteFilePickerHidden()
    noteFilePickerReturned()
    expect(filePickerAllowsBackground()).toBe(true)
    vi.advanceTimersByTime(8000)
    expect(filePickerAllowsBackground()).toBe(false)
  })
})
