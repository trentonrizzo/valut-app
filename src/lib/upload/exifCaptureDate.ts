/**
 * Minimal JPEG EXIF DateTimeOriginal / DateTimeDigitized reader.
 * Returns ISO UTC string or null. Never invents dates.
 */
function readU16(view: DataView, offset: number, le: boolean): number {
  return le ? view.getUint16(offset, true) : view.getUint16(offset, false)
}

function readU32(view: DataView, offset: number, le: boolean): number {
  return le ? view.getUint32(offset, true) : view.getUint32(offset, false)
}

function parseExifDate(raw: string): string | null {
  // "YYYY:MM:DD HH:MM:SS"
  const m = raw.trim().match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/)
  if (!m) return null
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return null
  // Treat as local wall clock without fabricating timezone offset.
  return new Date(ms).toISOString()
}

function readExifAscii(view: DataView, offset: number, count: number): string {
  const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, Math.max(0, count - 1))
  let out = ''
  for (const b of bytes) {
    if (b === 0) break
    out += String.fromCharCode(b)
  }
  return out
}

function scanIfd(
  view: DataView,
  tiffStart: number,
  ifdOffset: number,
  le: boolean,
): { original: string | null; digitized: string | null } {
  let original: string | null = null
  let digitized: string | null = null
  if (ifdOffset <= 0 || tiffStart + ifdOffset + 2 > view.byteLength) return { original, digitized }
  const count = readU16(view, tiffStart + ifdOffset, le)
  for (let i = 0; i < count; i += 1) {
    const entry = tiffStart + ifdOffset + 2 + i * 12
    if (entry + 12 > view.byteLength) break
    const tag = readU16(view, entry, le)
    const type = readU16(view, entry + 2, le)
    const num = readU32(view, entry + 4, le)
    const valueOffset = readU32(view, entry + 8, le)
    if (type !== 2 || num < 10) continue
    const dataOff = num <= 4 ? entry + 8 : tiffStart + valueOffset
    if (dataOff + num > view.byteLength) continue
    const text = readExifAscii(view, dataOff, num)
    if (tag === 0x9003) original = parseExifDate(text)
    if (tag === 0x9004) digitized = parseExifDate(text)
    if (tag === 0x0132 && !original) original = parseExifDate(text)
  }
  return { original, digitized }
}

export async function extractJpegCaptureDate(file: File): Promise<string | null> {
  try {
    const head = new Uint8Array(await file.slice(0, Math.min(file.size, 256 * 1024)).arrayBuffer())
    if (head.length < 12 || head[0] !== 0xff || head[1] !== 0xd8) return null
    let offset = 2
    while (offset + 4 < head.length) {
      if (head[offset] !== 0xff) break
      const marker = head[offset + 1]
      const size = (head[offset + 2] << 8) | head[offset + 3]
      if (marker === 0xe1 && size > 8) {
        const start = offset + 4
        const end = Math.min(head.length, offset + 2 + size)
        const segment = head.subarray(start, end)
        if (segment.length < 14) break
        const header = String.fromCharCode(...segment.subarray(0, 6))
        if (header !== 'Exif\0\0') break
        const view = new DataView(segment.buffer, segment.byteOffset + 6, segment.byteLength - 6)
        const endian = String.fromCharCode(view.getUint8(0), view.getUint8(1))
        const le = endian === 'II'
        if (!le && endian !== 'MM') break
        const tiffStart = 0
        const ifd0 = readU32(view, 4, le)
        const first = scanIfd(view, tiffStart, ifd0, le)
        // Follow ExifIFD pointer (0x8769) from IFD0
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
        const exif = exifPtr != null ? scanIfd(view, tiffStart, exifPtr, le) : { original: null, digitized: null }
        return exif.original || first.original || exif.digitized || first.digitized || null
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
