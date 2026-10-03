import { readBlobSlice } from './boundedBlobRead'
import { extOf, isImageUpload, isVideoUpload, normalizeUploadMime } from './strategy'

export const TECHNICAL_METADATA_VERSION = 1
const HEAD_BYTES = 4 * 1024 * 1024
const TAIL_BYTES = 16 * 1024 * 1024

export type TechnicalMediaMetadata = {
  metadataVersion: number
  format: string | null
  container: string | null
  videoCodec: string | null
  videoCodecFourcc: string | null
  audioCodec: string | null
  audioCodecFourcc: string | null
  frameRate: number | null
  overallBitrateBps: number | null
  width: number | null
  height: number | null
  durationMs: number | null
}

type Atom = { type: string; start: number; contentStart: number; end: number }

function u32(view: DataView, offset: number): number {
  return view.getUint32(offset, false)
}

function u64(view: DataView, offset: number): number {
  return u32(view, offset) * 2 ** 32 + u32(view, offset + 4)
}

function ascii(view: DataView, offset: number, length: number): string {
  if (offset < 0 || offset + length > view.byteLength) return ''
  let value = ''
  for (let i = 0; i < length; i += 1) value += String.fromCharCode(view.getUint8(offset + i))
  return value
}

function atoms(view: DataView, start: number, end: number): Atom[] {
  const result: Atom[] = []
  let offset = Math.max(0, start)
  const safeEnd = Math.min(view.byteLength, end)
  while (offset + 8 <= safeEnd) {
    let size = u32(view, offset)
    const type = ascii(view, offset + 4, 4)
    let header = 8
    if (size === 1) {
      if (offset + 16 > safeEnd) break
      size = u64(view, offset + 8)
      header = 16
    } else if (size === 0) {
      size = safeEnd - offset
    }
    if (!Number.isSafeInteger(size) || size < header || offset + size > safeEnd) break
    result.push({ type, start: offset, contentStart: offset + header, end: offset + size })
    offset += size
  }
  return result
}

function findCompleteAtomBuffers(buffer: ArrayBuffer, wanted: string): ArrayBuffer[] {
  const view = new DataView(buffer)
  const ranges = new Map<string, [number, number]>()
  for (const atom of atoms(view, 0, view.byteLength)) {
    if (atom.type === wanted) ranges.set(`${atom.start}:${atom.end}`, [atom.start, atom.end])
  }
  const bytes = new Uint8Array(buffer)
  const target = [...wanted].map((char) => char.charCodeAt(0))
  for (let i = 4; i + 4 <= bytes.length; i += 1) {
    if (!target.every((value, index) => bytes[i + index] === value)) continue
    const start = i - 4
    const size = view.getUint32(start, false)
    if (size >= 8 && start + size <= bytes.length) ranges.set(`${start}:${start + size}`, [start, start + size])
  }
  return [...ranges.values()].map(([start, end]) => buffer.slice(start, end))
}

function versionedDuration(view: DataView, atom: Atom): { timescale: number; duration: number } | null {
  const version = view.getUint8(atom.contentStart)
  const timescaleOffset = version === 1 ? atom.contentStart + 20 : atom.contentStart + 12
  const durationOffset = version === 1 ? atom.contentStart + 24 : atom.contentStart + 16
  if (timescaleOffset + 4 > atom.end || durationOffset + (version === 1 ? 8 : 4) > atom.end) return null
  const timescale = u32(view, timescaleOffset)
  const duration = version === 1 ? u64(view, durationOffset) : u32(view, durationOffset)
  return timescale > 0 && Number.isFinite(duration) ? { timescale, duration } : null
}

function codecLabel(fourcc: string): string | null {
  const code = fourcc.trim().toLowerCase()
  if (code === 'hvc1' || code === 'hev1') return 'HEVC (H.265)'
  if (code === 'avc1' || code === 'avc3') return 'H.264 (AVC)'
  if (code === 'vp09') return 'VP9'
  if (code === 'av01') return 'AV1'
  if (code === 'mp4v') return 'MPEG-4 Video'
  if (code === 'mp4a') return 'AAC'
  if (code === 'alac') return 'Apple Lossless (ALAC)'
  if (code === 'ac-3') return 'Dolby Digital (AC-3)'
  if (code === 'ec-3') return 'Dolby Digital Plus (E-AC-3)'
  if (code === 'opus') return 'Opus'
  return fourcc.trim() || null
}

function parseTrack(view: DataView, track: Atom) {
  const children = atoms(view, track.contentStart, track.end)
  const tkhd = children.find((atom) => atom.type === 'tkhd')
  const mdia = children.find((atom) => atom.type === 'mdia')
  let width: number | null = null
  let height: number | null = null
  if (tkhd && tkhd.end - tkhd.contentStart >= 8) {
    width = Math.round(u32(view, tkhd.end - 8) / 65536) || null
    height = Math.round(u32(view, tkhd.end - 4) / 65536) || null
  }
  if (!mdia) return { handler: '', width, height, duration: null, timescale: null, codec: null, sampleCount: null }
  const mediaChildren = atoms(view, mdia.contentStart, mdia.end)
  const hdlr = mediaChildren.find((atom) => atom.type === 'hdlr')
  const handler = hdlr && hdlr.contentStart + 12 <= hdlr.end ? ascii(view, hdlr.contentStart + 8, 4) : ''
  const mdhd = mediaChildren.find((atom) => atom.type === 'mdhd')
  const time = mdhd ? versionedDuration(view, mdhd) : null
  const minf = mediaChildren.find((atom) => atom.type === 'minf')
  const stbl = minf ? atoms(view, minf.contentStart, minf.end).find((atom) => atom.type === 'stbl') : null
  const sampleAtoms = stbl ? atoms(view, stbl.contentStart, stbl.end) : []
  const stsd = sampleAtoms.find((atom) => atom.type === 'stsd')
  let codec: string | null = null
  if (stsd && stsd.contentStart + 16 <= stsd.end && u32(view, stsd.contentStart + 4) > 0) {
    const entryStart = stsd.contentStart + 8
    const entrySize = u32(view, entryStart)
    if (entrySize >= 8 && entryStart + entrySize <= stsd.end) codec = ascii(view, entryStart + 4, 4)
  }
  const stts = sampleAtoms.find((atom) => atom.type === 'stts')
  let sampleCount: number | null = null
  if (stts && stts.contentStart + 8 <= stts.end) {
    const count = u32(view, stts.contentStart + 4)
    let total = 0
    for (let i = 0; i < count; i += 1) {
      const entry = stts.contentStart + 8 + i * 8
      if (entry + 8 > stts.end) break
      total += u32(view, entry)
    }
    if (total > 0) sampleCount = total
  }
  return {
    handler,
    width,
    height,
    duration: time?.duration ?? null,
    timescale: time?.timescale ?? null,
    codec,
    sampleCount,
  }
}

function brandContainer(buffer: ArrayBuffer): string | null {
  const view = new DataView(buffer)
  const ftyp = atoms(view, 0, view.byteLength).find((atom) => atom.type === 'ftyp')
  if (!ftyp || ftyp.contentStart + 4 > ftyp.end) return null
  return ascii(view, ftyp.contentStart, 4).trim() === 'qt' ? 'QuickTime (MOV)' : 'MP4'
}

export function calculateOverallBitrate(fileSizeBytes: number, durationMs: number | null): number | null {
  if (!Number.isSafeInteger(fileSizeBytes) || fileSizeBytes < 0 || !durationMs || durationMs <= 0) return null
  const bps = (fileSizeBytes * 8 * 1000) / durationMs
  return Number.isFinite(bps) ? Math.round(bps) : null
}

function fallbackContainer(name: string, mime: string): string | null {
  const ext = extOf(name)
  if (ext === 'mov' || ext === 'qt' || mime === 'video/quicktime') return 'QuickTime (MOV)'
  if (ext === 'mp4' || ext === 'm4v' || mime === 'video/mp4') return 'MP4'
  return ext ? ext.toUpperCase() : mime || null
}

function parseVideo(segments: ArrayBuffer[], input: { name: string; mime: string; size: number }): TechnicalMediaMetadata {
  let container = segments.map(brandContainer).find(Boolean) || fallbackContainer(input.name, input.mime)
  let durationMs: number | null = null
  let width: number | null = null
  let height: number | null = null
  let videoCodecFourcc: string | null = null
  let audioCodecFourcc: string | null = null
  let frameRate: number | null = null
  for (const segment of segments) {
    for (const moovBuffer of findCompleteAtomBuffers(segment, 'moov')) {
      const view = new DataView(moovBuffer)
      const moov = atoms(view, 0, view.byteLength).find((atom) => atom.type === 'moov')
      if (!moov) continue
      const children = atoms(view, moov.contentStart, moov.end)
      const mvhd = children.find((atom) => atom.type === 'mvhd')
      const movieTime = mvhd ? versionedDuration(view, mvhd) : null
      if (movieTime && movieTime.duration >= 0) durationMs ||= Math.round(movieTime.duration / movieTime.timescale * 1000)
      for (const trackAtom of children.filter((atom) => atom.type === 'trak')) {
        const track = parseTrack(view, trackAtom)
        if (track.handler === 'vide') {
          width ||= track.width
          height ||= track.height
          videoCodecFourcc ||= track.codec
          if (track.sampleCount && track.duration && track.timescale) {
            const fps = track.sampleCount / (track.duration / track.timescale)
            if (fps >= 1 && fps <= 240) frameRate ||= Math.round(fps * 1000) / 1000
          }
          if (!durationMs && track.duration != null && track.timescale) durationMs = Math.round(track.duration / track.timescale * 1000)
        } else if (track.handler === 'soun') {
          audioCodecFourcc ||= track.codec
        }
      }
    }
  }
  container ||= fallbackContainer(input.name, input.mime)
  return {
    metadataVersion: TECHNICAL_METADATA_VERSION,
    format: null,
    container,
    videoCodec: codecLabel(videoCodecFourcc || ''),
    videoCodecFourcc,
    audioCodec: codecLabel(audioCodecFourcc || ''),
    audioCodecFourcc,
    frameRate,
    overallBitrateBps: calculateOverallBitrate(input.size, durationMs),
    width,
    height,
    durationMs,
  }
}

function imageDimensions(buffer: ArrayBuffer): { width: number | null; height: number | null; format: string | null } {
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)
  if (bytes.length >= 24 && ascii(view, 1, 3) === 'PNG') {
    return { width: u32(view, 16), height: u32(view, 20), format: 'PNG' }
  }
  if (bytes.length >= 12 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue }
      const marker = bytes[offset + 1]!
      const size = (bytes[offset + 2]! * 256) + bytes[offset + 3]!
      if (marker >= 0xc0 && marker <= 0xc3 && size >= 7) {
        return { width: view.getUint16(offset + 7, false), height: view.getUint16(offset + 5, false), format: 'JPEG' }
      }
      if (size < 2) break
      offset += 2 + size
    }
    return { width: null, height: null, format: 'JPEG' }
  }
  for (let i = 4; i + 16 <= bytes.length; i += 1) {
    if (ascii(view, i, 4) !== 'ispe') continue
    const width = u32(view, i + 8)
    const height = u32(view, i + 12)
    if (width > 0 && height > 0) return { width, height, format: 'HEIC/HEIF' }
  }
  return { width: null, height: null, format: null }
}

export function extractTechnicalMetadataFromSegments(
  segments: ArrayBuffer[],
  input: { name: string; mime: string; size: number; kind: 'image' | 'video' },
): TechnicalMediaMetadata {
  if (input.kind === 'video') return parseVideo(segments, input)
  const parsed = imageDimensions(segments[0] ?? new ArrayBuffer(0))
  const ext = extOf(input.name)
  const format = parsed.format || (ext ? ext.toUpperCase() : input.mime.replace(/^image\//, '').toUpperCase() || null)
  return {
    metadataVersion: TECHNICAL_METADATA_VERSION,
    format,
    container: null,
    videoCodec: null,
    videoCodecFourcc: null,
    audioCodec: null,
    audioCodecFourcc: null,
    frameRate: null,
    overallBitrateBps: null,
    width: parsed.width,
    height: parsed.height,
    durationMs: null,
  }
}

export async function readBoundedMetadataSegments(file: Blob, kind: 'image' | 'video'): Promise<ArrayBuffer[]> {
  const headSize = Math.min(file.size, HEAD_BYTES)
  const head = await readBlobSlice(file, 0, headSize)
  if (kind === 'image' || file.size <= headSize) return [head]
  const tailSize = Math.min(file.size, TAIL_BYTES)
  const tail = await readBlobSlice(file, file.size - tailSize, file.size)
  return [head, tail]
}

export async function extractTechnicalMediaMetadata(file: File): Promise<TechnicalMediaMetadata | null> {
  const kind = isImageUpload(file) ? 'image' : isVideoUpload(file) ? 'video' : null
  if (!kind) return null
  const mime = normalizeUploadMime(file)
  const segments = await readBoundedMetadataSegments(file, kind)
  return extractTechnicalMetadataFromSegments(segments, { name: file.name, mime, size: file.size, kind })
}
