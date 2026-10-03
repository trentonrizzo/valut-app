import { describe, expect, it } from 'vitest'
import { fileModifiedFallback } from './extractMetadata'
import { extractMp4MovCaptureDateDetailsFromBuffer } from './videoCaptureDate'

function mvhdBuffer(macSeconds: number): ArrayBuffer {
  const bytes = new Uint8Array(40)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, 40)
  bytes.set([0x6d, 0x6f, 0x6f, 0x76], 4) // moov
  view.setUint32(8, 32)
  bytes.set([0x6d, 0x76, 0x68, 0x64], 12) // mvhd
  bytes[16] = 0
  view.setUint32(20, macSeconds)
  return bytes.buffer
}

describe('capture-date provenance', () => {
  it('extracts absolute QuickTime mvhd creation time', () => {
    const unix = Date.parse('2023-07-14T20:37:12Z') / 1000
    const result = extractMp4MovCaptureDateDetailsFromBuffer(mvhdBuffer(unix + 2082844800))
    expect(result).toMatchObject({ capturedAt: '2023-07-14T20:37:12.000Z', source: 'quicktime_mvhd', capturedOffset: '+00:00' })
  })

  it('labels File.lastModified as a lower-confidence fallback', () => {
    expect(fileModifiedFallback({ lastModified: Date.parse('2020-01-02T03:04:05Z') })).toMatchObject({
      capturedAt: '2020-01-02T03:04:05.000Z',
      capturedAtSource: 'file_last_modified',
    })
  })

  it('does not fabricate a fallback from invalid file metadata', () => {
    expect(fileModifiedFallback({ lastModified: 0 }).capturedAt).toBeNull()
  })
})
