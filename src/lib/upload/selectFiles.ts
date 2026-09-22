import { extOf, isVideoUpload, normalizeUploadMime } from './strategy'

export type SelectedUpload = {
  file: File
  name: string
  size: number
  type: string
  extension: string
  lastModified: number
  isVideo: boolean
}

export function inspectSelectedFile(file: File): SelectedUpload {
  const type = normalizeUploadMime(file)
  return {
    file,
    name: file.name,
    size: file.size,
    type,
    extension: extOf(file.name),
    lastModified: file.lastModified,
    isVideo: isVideoUpload(file),
  }
}

export function filesFromInput(list: FileList | null | undefined): File[] {
  if (!list || list.length === 0) return []
  return Array.from(list)
}

/** Why a Photos/Safari confirm produced nothing usable. */
export function selectionFailureReason(files: File[]): string | null {
  if (files.length === 0) {
    return 'Safari did not hand over a file. If this video is in iCloud, open Photos, download it to this iPhone, then select it again.'
  }
  const empty = files.filter((f) => !f || f.size <= 0)
  if (empty.length === files.length) {
    return `The selected file is empty (${empty[0]?.name || 'unnamed'}). iCloud-only items must be downloaded on this iPhone before Vault can upload them.`
  }
  return null
}

const SAFE_LOG_KEYS = new Set([
  'stage',
  'name',
  'size',
  'type',
  'extension',
  'lastModified',
  'zeroByte',
  'readable',
  'readableBytes',
  'strategy',
  'partCount',
  'encrypted',
  'storedSize',
  'albumId',
  'purpose',
  'width',
  'height',
  'durationMs',
  'mime',
  'count',
  'error',
  'httpStatus',
])

function sanitizeLog(extra: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(extra)) {
    if (!SAFE_LOG_KEYS.has(k)) continue
    if (typeof v === 'string' && /https?:|token|secret|eyJ|r2:\/\//i.test(v)) continue
    out[k] = v
  }
  return out
}

/** Safe stage logs only: never file bytes, tokens, signed URLs, or media contents. */
export function logUploadSelection(stage: string, extra: Record<string, unknown> = {}): void {
  console.info(`[vault-upload] ${stage}`, sanitizeLog(extra))
}

export async function probeSelectedFile(file: File): Promise<{ readable: boolean; readableBytes: number; zeroByte: boolean }> {
  const zeroByte = !file || file.size <= 0
  if (zeroByte) return { readable: false, readableBytes: 0, zeroByte: true }
  try {
    const n = Math.min(file.size, 64)
    const buf = await file.slice(0, n).arrayBuffer()
    if (buf.byteLength > 0) return { readable: true, readableBytes: buf.byteLength, zeroByte: false }
  } catch {
    /* try FileReader below */
  }
  try {
    const n = Math.min(file.size, 64)
    const buf = await new Promise<ArrayBuffer>((resolve, reject) => {
      const fr = new FileReader()
      fr.onload = () => {
        if (fr.result instanceof ArrayBuffer) resolve(fr.result)
        else reject(new Error('no buffer'))
      }
      fr.onerror = () => reject(fr.error || new Error('FileReader failed'))
      fr.readAsArrayBuffer(file.slice(0, n))
    })
    return { readable: buf.byteLength > 0, readableBytes: buf.byteLength, zeroByte: false }
  } catch {
    return { readable: false, readableBytes: 0, zeroByte: false }
  }
}
