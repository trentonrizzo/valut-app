export const MULTIPART_THRESHOLD_BYTES = 8 * 1024 * 1024
export const PART_PLAINTEXT_BYTES = 8 * 1024 * 1024
export const MAX_PARTS = 10_000
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

export async function putWithRetry(
  url: string,
  body: Blob,
  onProgress: (loaded: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  let lastErr: Error | null = null
  for (let attempt = 0; attempt <= MAX_PART_RETRIES; attempt++) {
    if (signal?.aborted) throw new Error('Upload paused or cancelled')
    try {
      const etag = await xhrPut(url, body, onProgress, signal)
      return etag
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error('Part upload failed')
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
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url, true)
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) onProgress(ev.loaded)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const etag = xhr.getResponseHeader('ETag') || xhr.getResponseHeader('etag')
        if (!etag) {
          reject(new Error('Upload succeeded but R2 did not return an ETag'))
          return
        }
        resolve(etag)
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
