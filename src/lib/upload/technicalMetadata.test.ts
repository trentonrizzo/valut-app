import { describe, expect, it } from 'vitest'
import { formatBytesExact } from '../formatBytes'
import { calculateOverallBitrate, extractTechnicalMetadataFromSegments, readBoundedMetadataSegments } from './technicalMetadata'
import { planUpload } from './strategy'

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) { out.set(part, offset); offset += part.length }
  return out
}

function atom(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(payload.length + 8)
  const view = new DataView(out.buffer)
  view.setUint32(0, out.length, false)
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i)
  out.set(payload, 8)
  return out
}

function fullBox(bytes: number): Uint8Array { return new Uint8Array(bytes) }
function ab(bytes: Uint8Array): ArrayBuffer { return bytes.slice().buffer as ArrayBuffer }

function syntheticMovie(codec: 'hvc1' | 'hev1' | 'avc1', brand: 'qt  ' | 'isom' = 'qt  ', width = 3840, height = 2160) {
  const ftypPayload = new Uint8Array(8)
  for (let i = 0; i < 4; i += 1) ftypPayload[i] = brand.charCodeAt(i)
  const ftyp = atom('ftyp', ftypPayload)

  const mvhd = fullBox(20)
  new DataView(mvhd.buffer).setUint32(12, 1000, false)
  new DataView(mvhd.buffer).setUint32(16, 60000, false)

  const tkhd = fullBox(84)
  new DataView(tkhd.buffer).setUint32(tkhd.length - 8, width * 65536, false)
  new DataView(tkhd.buffer).setUint32(tkhd.length - 4, height * 65536, false)

  const mdhd = fullBox(20)
  new DataView(mdhd.buffer).setUint32(12, 30000, false)
  new DataView(mdhd.buffer).setUint32(16, 1800000, false)
  const videoHdlr = fullBox(12)
  videoHdlr.set([...`vide`].map((c) => c.charCodeAt(0)), 8)
  const sampleEntry = atom(codec, new Uint8Array(16))
  const stsdPayload = concat(new Uint8Array(8), sampleEntry)
  new DataView(stsdPayload.buffer).setUint32(4, 1, false)
  const sttsPayload = new Uint8Array(16)
  const sttsView = new DataView(sttsPayload.buffer)
  sttsView.setUint32(4, 1, false)
  sttsView.setUint32(8, 1800, false)
  sttsView.setUint32(12, 1000, false)
  const videoStbl = atom('stbl', concat(atom('stsd', stsdPayload), atom('stts', sttsPayload)))
  const videoMdia = atom('mdia', concat(atom('mdhd', mdhd), atom('hdlr', videoHdlr), atom('minf', videoStbl)))
  const videoTrak = atom('trak', concat(atom('tkhd', tkhd), videoMdia))

  const audioHdlr = fullBox(12)
  audioHdlr.set([...`soun`].map((c) => c.charCodeAt(0)), 8)
  const audioEntry = atom('mp4a', new Uint8Array(16))
  const audioStsd = concat(new Uint8Array(8), audioEntry)
  new DataView(audioStsd.buffer).setUint32(4, 1, false)
  const audioMdia = atom('mdia', concat(atom('hdlr', audioHdlr), atom('minf', atom('stbl', atom('stsd', audioStsd)))))
  const audioTrak = atom('trak', audioMdia)
  return { ftyp, moov: atom('moov', concat(atom('mvhd', mvhd), videoTrak, audioTrak)) }
}

describe('bounded technical media metadata', () => {
  it.each([
    ['hvc1', 'HEVC (H.265)'],
    ['hev1', 'HEVC (H.265)'],
    ['avc1', 'H.264 (AVC)'],
  ] as const)('reads 4K dimensions, duration, frame rate and %s codec from a MOV tail', (fourcc, label) => {
    const movie = syntheticMovie(fourcc)
    const tail = concat(new Uint8Array(37), movie.moov)
    const result = extractTechnicalMetadataFromSegments([ab(movie.ftyp), ab(tail)], {
      name: 'IMG_0001.MOV', mime: 'video/quicktime', size: 4_294_967_297, kind: 'video',
    })
    expect(result).toMatchObject({
      container: 'QuickTime (MOV)', videoCodec: label, videoCodecFourcc: fourcc,
      audioCodec: 'AAC', width: 3840, height: 2160, durationMs: 60000, frameRate: 30,
    })
    expect(result.overallBitrateBps).toBe(572662306)
  })

  it('identifies an MP4 container when metadata is at the head', () => {
    const movie = syntheticMovie('avc1', 'isom', 1920, 1080)
    const result = extractTechnicalMetadataFromSegments([ab(concat(movie.ftyp, movie.moov))], {
      name: 'clip.mp4', mime: 'video/mp4', size: 1000, kind: 'video',
    })
    expect(result.container).toBe('MP4')
    expect(result).toMatchObject({ width: 1920, height: 1080 })
  })

  it('keeps exact byte counts above 1, 2 and 4 GiB without 32-bit truncation', () => {
    for (const size of [1_073_741_825, 2_147_483_649, 4_294_967_297]) {
      const plan = planUpload(size)
      expect(plan.parts.reduce((sum, part) => sum + part.bytes, 0)).toBe(size)
      expect(formatBytesExact(size)).toContain(`${size.toLocaleString('en-US')} bytes`)
    }
  })

  it('calculates overall file bitrate using safe multi-gigabyte arithmetic', () => {
    expect(calculateOverallBitrate(3_846_291_204, 363000)).toBe(84766748)
  })

  it('reads PNG and bounded HEIC dimensions without decoding the image', () => {
    const png = new Uint8Array(24)
    png.set([0x89, 0x50, 0x4e, 0x47], 0)
    const pngView = new DataView(png.buffer)
    pngView.setUint32(16, 4032, false)
    pngView.setUint32(20, 3024, false)
    expect(extractTechnicalMetadataFromSegments([ab(png)], {
      name: 'IMG_0001.PNG', mime: 'image/png', size: 1024, kind: 'image',
    })).toMatchObject({ format: 'PNG', width: 4032, height: 3024 })

    const heic = new Uint8Array(32)
    heic.set([...`ispe`].map((c) => c.charCodeAt(0)), 4)
    const heicView = new DataView(heic.buffer)
    heicView.setUint32(12, 3024, false)
    heicView.setUint32(16, 4032, false)
    expect(extractTechnicalMetadataFromSegments([ab(heic)], {
      name: 'IMG_0002.HEIC', mime: 'image/heic', size: 2048, kind: 'image',
    })).toMatchObject({ format: 'HEIC/HEIF', width: 3024, height: 4032 })
  })

  it('reads only bounded head and tail ranges from a synthetic 10 GiB source', async () => {
    const size = 10 * 1024 ** 3
    const ranges: Array<[number, number]> = []
    const source = {
      size,
      slice(start: number, end: number) {
        ranges.push([start, end])
        return new Blob([new Uint8Array(32)])
      },
    } as Blob
    const segments = await readBoundedMetadataSegments(source, 'video')
    expect(segments).toHaveLength(2)
    expect(ranges).toEqual([
      [0, 4 * 1024 * 1024],
      [size - 16 * 1024 * 1024, size],
    ])
    expect(ranges.reduce((sum, [start, end]) => sum + end - start, 0)).toBe(20 * 1024 * 1024)
  })
})
