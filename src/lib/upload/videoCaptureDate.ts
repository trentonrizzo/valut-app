/** Bounded MP4/MOV capture-date extraction; originals are never modified. */
import type { CaptureDateResult } from './exifCaptureDate'
import { readBlobSlice } from './boundedBlobRead'

const MAC_EPOCH_OFFSET_SEC = 2082844800 // 1904-01-01 → 1970-01-01

function readU32(view: DataView, offset: number, be = true): number {
  return view.getUint32(offset, !be)
}

function atomType(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  )
}

function macTimeToIso(macSec: number): string | null {
  if (!Number.isFinite(macSec) || macSec <= 0) return null
  // Reject clearly bogus (before ~1985 or far future)
  const unix = macSec - MAC_EPOCH_OFFSET_SEC
  if (unix < 473_385_600) return null // 1985-01-01
  if (unix > Date.now() / 1000 + 86400 * 2) return null
  return new Date(unix * 1000).toISOString()
}

function parseAsciiDate(raw: string): CaptureDateResult | null {
  const t = raw.trim().replace(/\0/g, '')
  // QuickTime ©day often "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM:SS"
  const m = t.match(/^(\d{4})[-:](\d{2})[-:](\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2}))?/)
  if (!m) return null
  const local = `${m[1]}-${m[2]}-${m[3]}T${m[4] || '00'}:${m[5] || '00'}:${m[6] || '00'}`
  const offsetMatch = t.match(/(?:Z|[+-]\d{2}:?\d{2})$/)
  const offset = offsetMatch ? (offsetMatch[0] === 'Z' ? '+00:00' : offsetMatch[0].replace(/([+-]\d{2})(\d{2})$/, '$1:$2')) : null
  const ms = offset ? Date.parse(`${local}${offset}`) : Number.NaN
  if (Number.isFinite(ms) && (ms < Date.parse('1985-01-01') || ms > Date.now() + 86400_000)) return null
  return { capturedAt: Number.isFinite(ms) ? new Date(ms).toISOString() : null, capturedLocal: local, capturedOffset: offset, source: 'quicktime_day' }
}

function scanAtoms(
  view: DataView,
  start: number,
  end: number,
  depth: number,
  out: { mvhd: string | null; day: CaptureDateResult | null },
): void {
  if (depth > 12) return
  let offset = start
  while (offset + 8 <= end) {
    let size = readU32(view, offset)
    const type = atomType(view, offset + 4)
    let header = 8
    if (size === 1) {
      if (offset + 16 > end) break
      const high = readU32(view, offset + 8)
      const low = readU32(view, offset + 12)
      size = high * 2 ** 32 + low
      header = 16
    } else if (size === 0) {
      size = end - offset
    }
    if (size < header || offset + size > end + 8) break
    const contentStart = offset + header
    const contentEnd = offset + size

    if (type === 'moov' || type === 'trak' || type === 'mdia' || type === 'minf' || type === 'stbl' || type === 'udta' || type === 'meta' || type === 'ilst' || type === '©day') {
      // meta often has 4-byte version/flags before children
      const childStart = type === 'meta' ? contentStart + 4 : contentStart
      scanAtoms(view, childStart, contentEnd, depth + 1, out)
    } else if (type === 'mvhd' && contentEnd - contentStart >= 24) {
      const version = view.getUint8(contentStart)
      const creation =
        version === 1
          ? readU32(view, contentStart + 4 + 8) // skip 64-bit creation high; use low only if reasonable — prefer version 0
          : readU32(view, contentStart + 4)
      if (version === 0) {
        out.mvhd = macTimeToIso(creation) || out.mvhd
      } else if (version === 1 && contentEnd - contentStart >= 20) {
        // 64-bit creation: use low 32 if high is 0
        const high = readU32(view, contentStart + 4)
        const low = readU32(view, contentStart + 8)
        if (high === 0) out.mvhd = macTimeToIso(low) || out.mvhd
      }
    } else if ((type === '©day' || type === 'day ') && contentEnd > contentStart + 4) {
      const bytes = new Uint8Array(view.buffer, view.byteOffset + contentStart, contentEnd - contentStart)
      // data atom style: often 4 byte type/locale then string, or raw string
      let text = ''
      for (let i = 0; i < bytes.length; i++) {
        const b = bytes[i]!
        if (b >= 32 && b < 127) text += String.fromCharCode(b)
      }
      const parsed = parseAsciiDate(text)
      if (parsed) out.day = parsed
    } else if (type === 'data' && contentEnd - contentStart > 8) {
      const bytes = new Uint8Array(view.buffer, view.byteOffset + contentStart + 8, contentEnd - contentStart - 8)
      let text = ''
      for (const b of bytes) {
        if (b >= 32 && b < 127) text += String.fromCharCode(b)
        else if (b === 0) break
      }
      const parsed = parseAsciiDate(text)
      if (parsed) out.day = out.day || parsed
    }

    if (size <= 0) break
    offset += size
  }
}

function scanEmbeddedQuickTimeDate(buf: ArrayBuffer): CaptureDateResult | null {
  const bytes = new Uint8Array(buf)
  const markers = ['com.apple.quicktime.creationdate', 'creationdate', '©day']
  let foundMarker = false
  for (const marker of markers) {
    const needle = Array.from(marker, (char) => char.charCodeAt(0) & 0xff)
    for (let i = 0; i <= bytes.length - needle.length; i += 1) {
      let same = true
      for (let j = 0; j < needle.length; j += 1) if (bytes[i + j] !== needle[j]) { same = false; break }
      if (!same) continue
      foundMarker = true
      let snippet = ''
      const end = Math.min(bytes.length, i + marker.length + 192)
      for (let j = i + marker.length; j < end; j += 1) snippet += bytes[j]! >= 32 && bytes[j]! < 127 ? String.fromCharCode(bytes[j]!) : ' '
      const parsed = parseAsciiDate(snippet.trim())
      if (parsed) return parsed
    }
  }
  // mdta stores the key name and its value in separate atoms. Once the
  // authoritative creation-date key is present, scan this bounded metadata
  // segment for its ISO value without treating unrelated timestamps as capture.
  if (foundMarker) {
    for (let i = 0; i + 19 < bytes.length; i += 1) {
      if (bytes[i] < 0x31 || bytes[i] > 0x32 || bytes[i + 4] !== 0x2d || bytes[i + 7] !== 0x2d) continue
      let snippet = ''
      for (let j = i; j < Math.min(bytes.length, i + 40); j += 1) {
        const b = bytes[j]!
        snippet += b >= 32 && b < 127 ? String.fromCharCode(b) : ' '
      }
      const parsed = parseAsciiDate(snippet.trim())
      if (parsed) return parsed
    }
  }
  return null
}

function parseResynchronizedAtoms(buf: ArrayBuffer): CaptureDateResult | null {
  const embedded = scanEmbeddedQuickTimeDate(buf)
  if (embedded) return embedded
  const direct = extractMp4MovCaptureDateDetailsFromBuffer(buf)
  if (direct) return direct
  const bytes = new Uint8Array(buf)
  const view = new DataView(buf)
  for (let i = 4; i + 12 <= bytes.length; i += 1) {
    if (bytes[i] !== 0x6d || bytes[i + 1] !== 0x6f || bytes[i + 2] !== 0x6f || bytes[i + 3] !== 0x76) continue
    const start = i - 4
    const size = view.getUint32(start, false)
    if (size >= 8 && start + size <= bytes.length) {
      const slice = buf.slice(start, start + size)
      const parsed = extractMp4MovCaptureDateDetailsFromBuffer(slice)
      if (parsed) return parsed
    }
  }
  return null
}

/** Parse capture date from an ArrayBuffer of an MP4/MOV file (or large prefix). */
export function extractMp4MovCaptureDateDetailsFromBuffer(buf: ArrayBuffer): CaptureDateResult | null {
  try {
    if (buf.byteLength < 16) return null
    const view = new DataView(buf)
    const out = { mvhd: null as string | null, day: null as CaptureDateResult | null }
    scanAtoms(view, 0, buf.byteLength, 0, out)
    // Prefer ©day (often camera wall-clock) over mvhd when both exist
    return out.day || (out.mvhd ? { capturedAt: out.mvhd, capturedLocal: null, capturedOffset: '+00:00', source: 'quicktime_mvhd' } : null)
  } catch {
    return null
  }
}

export async function extractVideoCaptureDateDetails(file: Blob): Promise<CaptureDateResult | null> {
  try {
    // moov may be at end (iPhone); read head + tail when large
    const headSize = Math.min(file.size, 4 * 1024 * 1024)
    const head = await readBlobSlice(file, 0, headSize)
    const headResult = parseResynchronizedAtoms(head)
    if (headResult?.source === 'quicktime_day') return headResult
    if (file.size > headSize) {
      const tailSize = Math.min(file.size, 16 * 1024 * 1024)
      const tail = await readBlobSlice(file, file.size - tailSize, file.size)
      const tailResult = parseResynchronizedAtoms(tail)
      // Authoritative camera/date metadata can live at the end of an edited
      // iPhone MOV. It outranks the generic container creation timestamp.
      if (tailResult?.source === 'quicktime_day') return tailResult
      return headResult || tailResult
    }
    return headResult
  } catch {
    return null
  }
}

export function extractVideoCaptureDateFromSegments(segments: ArrayBuffer[]): CaptureDateResult | null {
  let containerFallback: CaptureDateResult | null = null
  for (const segment of segments) {
    const found = parseResynchronizedAtoms(segment)
    if (found?.source === 'quicktime_day') return found
    containerFallback ||= found
  }
  return containerFallback
}

/** Backwards-compatible exact timestamp accessor. */
export function extractMp4MovCaptureDateFromBuffer(buf: ArrayBuffer): string | null {
  return extractMp4MovCaptureDateDetailsFromBuffer(buf)?.capturedAt ?? null
}

export async function extractVideoCaptureDate(file: Blob): Promise<string | null> {
  return (await extractVideoCaptureDateDetails(file))?.capturedAt ?? null
}
