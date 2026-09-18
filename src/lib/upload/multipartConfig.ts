export {
  MAX_PARTS,
  MULTIPART_THRESHOLD_BYTES,
  DEFAULT_PART_BYTES as PART_PLAINTEXT_BYTES,
} from './strategy'

export const MAX_PART_RETRIES = 6

export function isIosDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iP(hone|od|ad)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

export function partConcurrency(): number {
  return isIosDevice() ? 2 : 4
}

export function fileConcurrency(): number {
  return isIosDevice() ? 1 : 2
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export function backoffMs(attempt: number): number {
  const base = Math.min(30_000, 400 * 2 ** attempt)
  return base + Math.floor(Math.random() * 250)
}

export class ExpiredSignedUrlError extends Error {
  constructor(message = 'Signed upload URL expired') {
    super(message)
    this.name = 'ExpiredSignedUrlError'
  }
}

export type PutRetryOpts = {
  requireEtag?: boolean
  signal?: AbortSignal
  refreshUrl?: () => Promise<string>
}

function optsOf(signalOrOpts?: AbortSignal | PutRetryOpts): PutRetryOpts {
  if (!signalOrOpts) return {}
  if (typeof AbortSignal !== 'undefined' && signalOrOpts instanceof AbortSignal) {
    return { signal: signalOrOpts }
  }
  return signalOrOpts as PutRetryOpts
}

export async function putWithRetry(
  url: string,
  body: Blob,
  onProgress: (loaded: number) => void,
  signalOrOpts?: AbortSignal | PutRetryOpts,
): Promise<string | null> {
  const opts = optsOf(signalOrOpts)
  const requireEtag = opts.requireEtag !== false
  let lastErr: Error | null = null
  let currentUrl = url
  for (let attempt = 0; attempt <= MAX_PART_RETRIES; attempt++) {
    if (opts.signal?.aborted) throw new Error('Upload paused or cancelled')
    try {
      const etag = await xhrPut(currentUrl, body, onProgress, opts.signal, requireEtag)
      return etag
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error('Part upload failed')
      if (lastErr instanceof ExpiredSignedUrlError && opts.refreshUrl) {
        try {
          currentUrl = await opts.refreshUrl()
          continue
        } catch (refreshErr) {
          lastErr = refreshErr instanceof Error ? refreshErr : lastErr
        }
      }
      if (attempt === MAX_PART_RETRIES) break
      await sleep(backoffMs(attempt))
    }
  }
  throw lastErr ?? new Error('Part upload failed')
}

function xhrPut(
  url: string,
  body: Blob,
  onProgress: (loaded: number) => void,
  signal: AbortSignal | undefined,
  requireEtag: boolean,
): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url, true)
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) onProgress(ev.loaded)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const etag = xhr.getResponseHeader('ETag') || xhr.getResponseHeader('etag')
        if (!etag && requireEtag) {
          reject(new Error('Upload succeeded but R2 did not return an ETag'))
          return
        }
        resolve(etag)
      } else if (xhr.status === 403 || xhr.status === 401) {
        reject(new ExpiredSignedUrlError(`Upload part rejected (${xhr.status})`))
      } else {
        reject(new Error(`Upload part failed (${xhr.status})`))
      }
    }
    xhr.onerror = () => reject(new Error('Network error during part upload'))
    xhr.onabort = () => reject(new Error('Upload paused or cancelled'))
    if (signal) {
      if (signal.aborted) {
        xhr.abort()
        return
      }
      signal.addEventListener('abort', () => xhr.abort(), { once: true })
    }
    xhr.send(body)
  })
}
