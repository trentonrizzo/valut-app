/**
 * Extract trustworthy creation/capture timestamps from MP4/MOV (ISO BMFF / QuickTime).
 * Never uses filesystem mtime. Returns ISO UTC or null.
 */

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

function parseAsciiDate(raw: string): string | null {
  const t = raw.trim().replace(/\0/g, '')
  // QuickTime ©day often "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM:SS"
  const m = t.match(/^(\d{4})[-:](\d{2})[-:](\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2}))?/)
  if (!m) return null
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4] || '00'}:${m[5] || '00'}:${m[6] || '00'}`
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return null
  if (ms < Date.parse('1985-01-01') || ms > Date.now() + 86400_000) return null
  return new Date(ms).toISOString()
}

function scanAtoms(
  view: DataView,
  start: number,
  end: number,
  depth: number,
  out: { mvhd: string | null; day: string | null },
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

    if (type === 'moov' || type === 'trak' || type === 'mdia' || type === 'minf' || type === 'stbl' || type === 'udta' || type === 'meta') {
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

/** Parse capture date from an ArrayBuffer of an MP4/MOV file (or large prefix). */
export function extractMp4MovCaptureDateFromBuffer(buf: ArrayBuffer): string | null {
  try {
    if (buf.byteLength < 16) return null
    const view = new DataView(buf)
    const out = { mvhd: null as string | null, day: null as string | null }
    scanAtoms(view, 0, buf.byteLength, 0, out)
    // Prefer ©day (often camera wall-clock) over mvhd when both exist
    return out.day || out.mvhd || null
  } catch {
    return null
  }
}

export async function extractVideoCaptureDate(file: Blob): Promise<string | null> {
  try {
    // moov may be at end (iPhone); read head + tail when large
    const headSize = Math.min(file.size, 4 * 1024 * 1024)
    const head = await file.slice(0, headSize).arrayBuffer()
    let found = extractMp4MovCaptureDateFromBuffer(head)
    if (found) return found
    if (file.size > headSize) {
      const tailSize = Math.min(file.size, 3 * 1024 * 1024)
      const tail = await file.slice(file.size - tailSize).arrayBuffer()
      found = extractMp4MovCaptureDateFromBuffer(tail)
      if (found) return found
    }
    return null
  } catch {
    return null
  }
}
