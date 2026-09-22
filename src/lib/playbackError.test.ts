import { describe, expect, it } from 'vitest'
import {
  classifyResolveFailure,
  classifyVideoElementError,
  playbackFailureMessage,
  videoSourceType,
} from './playbackError'

describe('video error classification', () => {
  it('does not call a network failure an unsupported format', () => {
    expect(classifyVideoElementError({ error: { code: 2, message: 'network error' } })).toBe('network')
    expect(playbackFailureMessage('network')).not.toMatch(/cannot play this video format/i)
  })

  it('treats 403/401 source errors as authorization, not codec', () => {
    expect(classifyVideoElementError({ error: { code: 4, message: '403 Forbidden' } })).toBe('authorization')
    expect(classifyResolveFailure(new Error('Invalid or expired auth token'))).toBe('authorization')
  })

  it('treats missing objects separately from decode', () => {
    expect(classifyVideoElementError({ error: { code: 4, message: '404 not found' } })).toBe('missing')
    expect(classifyResolveFailure(new Error('No storage object for this file'))).toBe('missing')
  })

  it('shows the format message only for decode/unsupported format', () => {
    expect(classifyVideoElementError({ error: { code: 3, message: 'decode error' } })).toBe('decode')
    expect(playbackFailureMessage('decode')).toMatch(/cannot play this video format/i)
    expect(classifyVideoElementError({ error: { code: 4, message: 'DEMUXER_ERROR_COULD_NOT_OPEN: format' } })).toBe(
      'unsupported_format',
    )
  })

  it('does not force video/mp4 on QuickTime files', () => {
    expect(videoSourceType('IMG_3432.mov', 'video/mp4')).toBeUndefined()
    expect(videoSourceType('clip.mp4', 'video/mp4')).toBe('video/mp4')
  })
})
