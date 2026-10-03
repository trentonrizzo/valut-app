import { describe, expect, it } from 'vitest'
import { extractImageCaptureDateFromBuffer } from './exifCaptureDate'
import { extractVideoCaptureDateFromSegments } from './videoCaptureDate'
import { captureMetadataChunkIndexes } from '../mediaIndexBackfill'

function tiffCapture(date = '2023:08:17 19:42:16', offset = '-05:00'): ArrayBuffer {
  const bytes = new Uint8Array(128)
  const view = new DataView(bytes.buffer)
  bytes.set([0x49, 0x49, 0x2a, 0x00], 0)
  view.setUint32(4, 8, true)
  view.setUint16(8, 1, true)
  view.setUint16(10, 0x8769, true); view.setUint16(12, 4, true); view.setUint32(14, 1, true); view.setUint32(18, 26, true)
  view.setUint16(26, 2, true)
  view.setUint16(28, 0x9003, true); view.setUint16(30, 2, true); view.setUint32(32, 20, true); view.setUint32(36, 64, true)
  view.setUint16(40, 0x9011, true); view.setUint16(42, 2, true); view.setUint32(44, 7, true); view.setUint32(48, 88, true)
  bytes.set([...date, '\0'].map((c) => c.charCodeAt(0)), 64)
  bytes.set([...offset, '\0'].map((c) => c.charCodeAt(0)), 88)
  return bytes.buffer
}

function quickTimeMvhd(iso: string): ArrayBuffer {
  const atom = new Uint8Array(40)
  const view = new DataView(atom.buffer)
  view.setUint32(0, 40)
  atom.set([0x6d, 0x6f, 0x6f, 0x76], 4)
  view.setUint32(8, 32)
  atom.set([0x6d, 0x76, 0x68, 0x64], 12)
  atom[16] = 0
  view.setUint32(20, Date.parse(iso) / 1000 + 2082844800)
  return atom.buffer
}

describe('end-to-end bounded capture metadata parsing', () => {
  it('reads EXIF DateTimeOriginal with seconds and offset', () => {
    expect(extractImageCaptureDateFromBuffer(tiffCapture())).toMatchObject({
      capturedAt: '2023-08-18T00:42:16.000Z',
      capturedLocal: '2023-08-17T19:42:16',
      capturedOffset: '-05:00',
      source: 'exif_datetime_original',
    })
  })

  it('finds TIFF metadata embedded inside a HEIC/HEIF-style prefix', () => {
    const tiff = new Uint8Array(tiffCapture())
    const heic = new Uint8Array(256)
    heic.set([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63], 0)
    heic.set(tiff, 96)
    expect(extractImageCaptureDateFromBuffer(heic.buffer)?.capturedLocal).toBe('2023-08-17T19:42:16')
  })

  it('preserves timezone-free XMP as local wall-clock metadata', () => {
    const xmp = new TextEncoder().encode('<x:xmpmeta exif:DateTimeOriginal="2021-04-05T06:07:08"/>')
    expect(extractImageCaptureDateFromBuffer(xmp.buffer)).toMatchObject({
      capturedAt: null,
      capturedLocal: '2021-04-05T06:07:08',
      capturedOffset: null,
      source: 'xmp_date_created',
    })
  })

  it('resynchronizes a MOV moov atom found in a bounded tail segment', () => {
    const moov = new Uint8Array(quickTimeMvhd('2020-02-03T04:05:06Z'))
    const tail = new Uint8Array(512)
    tail.set(moov, 197)
    expect(extractVideoCaptureDateFromSegments([tail.buffer])?.capturedAt).toBe('2020-02-03T04:05:06.000Z')
  })

  it('prefers authoritative QuickTime creation metadata over an earlier container timestamp', () => {
    const head = quickTimeMvhd('2024-02-03T04:05:06Z')
    const tail = new TextEncoder().encode('com.apple.quicktime.creationdate 2020-01-02T03:04:05-06:00')
    expect(extractVideoCaptureDateFromSegments([head, tail.buffer])).toMatchObject({
      capturedAt: '2020-01-02T09:04:05.000Z',
      source: 'quicktime_day',
    })
  })

  it('plans only bounded first/last chunks for a 10 GiB encrypted video', () => {
    const indexes = captureMetadataChunkIndexes(10 * 1024 ** 3, 8 * 1024 ** 2, false)
    expect(indexes).toEqual([0, 1278, 1279])
  })
})
