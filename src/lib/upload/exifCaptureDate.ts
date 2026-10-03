/** Bounded JPEG EXIF capture-date reader. The original is never modified. */
import { readBlobSlice } from './boundedBlobRead'

export type CaptureDateSource =
  | 'exif_datetime_original'
  | 'exif_create_date'
  | 'xmp_date_created'
  | 'quicktime_day'
  | 'quicktime_mvhd'
  | 'file_last_modified'
  | 'user_entered'

export type CaptureDateResult = {
  capturedAt: string | null
  capturedLocal: string | null
  capturedOffset: string | null
  source: CaptureDateSource
}

function readU16(view: DataView, offset: number, le: boolean): number {
  return view.getUint16(offset, le)
}
function readU32(view: DataView, offset: number, le: boolean): number {
  return view.getUint32(offset, le)
}
function normalizeOffset(raw: string | null): string | null {
  const m = raw?.trim().match(/^([+-])(\d{2}):(\d{2})$/)
  if (!m || Number(m[2]) > 23 || Number(m[3]) > 59) return null
  return `${m[1]}${m[2]}:${m[3]}`
}
function parseExifDate(
  raw: string,
  offset: string | null,
  source: Extract<CaptureDateSource, 'exif_datetime_original' | 'exif_create_date'>,
): CaptureDateResult | null {
  const m = raw.trim().match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/)
  if (!m) return null
  const local = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`
  const normalizedOffset = normalizeOffset(offset)
  const parsed = normalizedOffset ? Date.parse(`${local}${normalizedOffset}`) : Number.NaN
  return {
    capturedAt: Number.isFinite(parsed) ? new Date(parsed).toISOString() : null,
    capturedLocal: local,
    capturedOffset: normalizedOffset,
    source,
  }
}
function readExifAscii(view: DataView, offset: number, count: number): string {
  if (offset < 0 || count <= 0 || offset + count > view.byteLength) return ''
  const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, Math.max(0, count - 1))
  let out = ''
  for (const b of bytes) {
    if (b === 0) break
    out += String.fromCharCode(b)
  }
  return out
}
type ExifFields = { original: string | null; digitized: string | null; offsetOriginal: string | null; offsetDigitized: string | null }
function scanIfd(view: DataView, tiffStart: number, ifdOffset: number, le: boolean): ExifFields {
  const out: ExifFields = { original: null, digitized: null, offsetOriginal: null, offsetDigitized: null }
  if (ifdOffset <= 0 || tiffStart + ifdOffset + 2 > view.byteLength) return out
  const count = readU16(view, tiffStart + ifdOffset, le)
  for (let i = 0; i < count; i += 1) {
    const entry = tiffStart + ifdOffset + 2 + i * 12
    if (entry + 12 > view.byteLength) break
    const tag = readU16(view, entry, le)
    const type = readU16(view, entry + 2, le)
    const num = readU32(view, entry + 4, le)
    const valueOffset = readU32(view, entry + 8, le)
    if (type !== 2 || num < 2) continue
    const dataOff = num <= 4 ? entry + 8 : tiffStart + valueOffset
    if (dataOff + num > view.byteLength) continue
    const text = readExifAscii(view, dataOff, num)
    // 0x0132 is DateTime (last modification), not original capture time.
    if (tag === 0x9003) out.original ||= text
    if (tag === 0x9004) out.digitized = text
    if (tag === 0x9011) out.offsetOriginal = text
    if (tag === 0x9012) out.offsetDigitized = text
  }
  return out
}

function extractTiffCaptureDate(view: DataView, tiffStart: number): CaptureDateResult | null {
  if (tiffStart < 0 || tiffStart + 8 > view.byteLength) return null
  const endian = String.fromCharCode(view.getUint8(tiffStart), view.getUint8(tiffStart + 1))
  const le = endian === 'II'
  if (!le && endian !== 'MM') return null
  if (readU16(view, tiffStart + 2, le) !== 42) return null
  const ifd0 = readU32(view, tiffStart + 4, le)
  const first = scanIfd(view, tiffStart, ifd0, le)
  let exifPtr: number | null = null
  if (ifd0 > 0 && tiffStart + ifd0 + 2 < view.byteLength) {
    const n = readU16(view, tiffStart + ifd0, le)
    for (let i = 0; i < n; i += 1) {
      const entry = tiffStart + ifd0 + 2 + i * 12
      if (entry + 12 > view.byteLength) break
      if (readU16(view, entry, le) === 0x8769) {
        exifPtr = readU32(view, entry + 8, le)
        break
      }
    }
  }
  const exif = exifPtr != null ? scanIfd(view, tiffStart, exifPtr, le) : first
  if (exif.original || first.original) {
    return parseExifDate(exif.original || first.original || '', exif.offsetOriginal || first.offsetOriginal, 'exif_datetime_original')
  }
  if (exif.digitized || first.digitized) {
    return parseExifDate(exif.digitized || first.digitized || '', exif.offsetDigitized || first.offsetDigitized, 'exif_create_date')
  }
  return null
}

function findTiffCaptureDate(buffer: ArrayBuffer): CaptureDateResult | null {
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)
  const max = Math.max(0, bytes.byteLength - 8)
  for (let i = 0; i <= max; i += 1) {
    const intel = bytes[i] === 0x49 && bytes[i + 1] === 0x49 && bytes[i + 2] === 0x2a && bytes[i + 3] === 0
    const motorola = bytes[i] === 0x4d && bytes[i + 1] === 0x4d && bytes[i + 2] === 0 && bytes[i + 3] === 0x2a
    if (!intel && !motorola) continue
    const capture = extractTiffCaptureDate(view, i)
    if (capture) return capture
  }
  return null
}

function findXmpCaptureDate(buffer: ArrayBuffer): CaptureDateResult | null {
  const bytes = new Uint8Array(buffer)
  const markers = ['DateTimeOriginal', 'DateCreated', 'CreateDate']
  let match: RegExpMatchArray | null = null
  for (const marker of markers) {
    const needle = Array.from(marker, (char) => char.charCodeAt(0))
    for (let i = 0; i <= bytes.length - needle.length; i += 1) {
      let same = true
      for (let j = 0; j < needle.length; j += 1) if (bytes[i + j] !== needle[j]) { same = false; break }
      if (!same) continue
      let snippet = ''
      const end = Math.min(bytes.length, i + marker.length + 192)
      for (let j = i; j < end; j += 1) snippet += bytes[j]! >= 32 && bytes[j]! < 127 ? String.fromCharCode(bytes[j]!) : ' '
      match = snippet.match(/(?:DateTimeOriginal|DateCreated|CreateDate)[^0-9]{0,32}(\d{4})[-:](\d{2})[-:](\d{2})[T ](\d{2}):(\d{2}):(\d{2})(Z|[+-]\d{2}:?\d{2})?/i)
      if (match) break
    }
    if (match) break
  }
  if (!match) return null
  const local = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}`
  const rawOffset = match[7] === 'Z' ? '+00:00' : match[7]?.replace(/([+-]\d{2})(\d{2})$/, '$1:$2') || null
  const offset = normalizeOffset(rawOffset)
  const parsed = offset ? Date.parse(`${local}${offset}`) : Number.NaN
  return {
    capturedAt: Number.isFinite(parsed) ? new Date(parsed).toISOString() : null,
    capturedLocal: local,
    capturedOffset: offset,
    source: 'xmp_date_created',
  }
}

export function extractJpegCaptureDateFromBuffer(buffer: ArrayBuffer): CaptureDateResult | null {
  try {
    const head = new Uint8Array(buffer)
    if (head.length < 12 || head[0] !== 0xff || head[1] !== 0xd8) return null
    let offset = 2
    while (offset + 4 < head.length) {
      if (head[offset] !== 0xff) break
      const marker = head[offset + 1]
      const size = (head[offset + 2] << 8) | head[offset + 3]
      if (marker === 0xe1 && size > 8) {
        const segment = head.subarray(offset + 4, Math.min(head.length, offset + 2 + size))
        if (segment.length < 14 || String.fromCharCode(...segment.subarray(0, 6)) !== 'Exif\0\0') break
        return extractTiffCaptureDate(new DataView(segment.buffer, segment.byteOffset + 6, segment.byteLength - 6), 0)
      }
      if (size < 2) break
      offset += 2 + size
      if (marker === 0xda) break
    }
    return null
  } catch {
    return null
  }
}

/**
 * Bounded image metadata reader. JPEG APP1, PNG eXIf and HEIC/HEIF Exif
 * items all contain an ordinary TIFF header, so scanning the bounded prefix
 * covers the common browser-selected forms without decoding pixels.
 */
export function extractImageCaptureDateFromBuffer(buffer: ArrayBuffer): CaptureDateResult | null {
  return extractJpegCaptureDateFromBuffer(buffer) || findTiffCaptureDate(buffer) || findXmpCaptureDate(buffer)
}

export async function extractJpegCaptureDateDetails(file: Blob): Promise<CaptureDateResult | null> {
  try {
    return extractImageCaptureDateFromBuffer(await readBlobSlice(file, 0, Math.min(file.size, 4 * 1024 * 1024)))
  } catch {
    return null
  }
}

/** Unknown-offset EXIF intentionally returns null instead of inventing a timezone. */
export async function extractJpegCaptureDate(file: Blob): Promise<string | null> {
  return (await extractJpegCaptureDateDetails(file))?.capturedAt ?? null
}
