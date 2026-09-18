import { classifyUploadError } from './strategy'

export type AuthFetch = (input: string, init?: RequestInit) => Promise<Response>

export function createAuthFetch(accessToken: string): AuthFetch {
  return (input, init) =>
    fetch(input, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    })
}

async function parse<T>(res: Response, stage: string): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as T & { ok?: boolean; error?: string; code?: string }
  if (!res.ok || (data as { ok?: boolean }).ok === false) {
    const code = (data as { code?: string }).code
    const msg = (data as { error?: string }).error || `Request failed (${res.status})`
    throw classifyUploadError(new Error(code ? `${code}: ${msg}` : msg), stage)
  }
  return data
}

async function call<T>(stage: string, fn: () => Promise<Response>): Promise<T> {
  try {
    const res = await fn()
    return await parse<T>(res, stage)
  } catch (e) {
    throw classifyUploadError(e, stage)
  }
}

export async function apiPutUrl(
  authFetch: AuthFetch,
  args: { objectId: string; contentType: string; key?: string },
) {
  return call<{ ok: true; key: string; uploadUrl: string; expiresIn: number }>('put-url', () =>
    authFetch('/api/storage/put-url', { method: 'POST', body: JSON.stringify(args) }),
  )
}

export async function apiMultipartInit(
  authFetch: AuthFetch,
  args: { objectId: string; contentType: string; key?: string },
) {
  return call<{ ok: true; key: string; uploadId: string }>('multipart-init', () =>
    authFetch('/api/storage/multipart-init', { method: 'POST', body: JSON.stringify(args) }),
  )
}

export async function apiMultipartPartUrl(
  authFetch: AuthFetch,
  args: { key: string; uploadId: string; partNumber: number },
) {
  return call<{ ok: true; url: string; expiresIn: number; partNumber: number }>('part-sign', () =>
    authFetch('/api/storage/multipart-part-url', { method: 'POST', body: JSON.stringify(args) }),
  )
}

export async function apiMultipartListParts(
  authFetch: AuthFetch,
  args: { key: string; uploadId: string },
) {
  return call<{ ok: true; parts: { PartNumber: number; ETag: string; Size: number }[] }>('part-list', () =>
    authFetch('/api/storage/multipart-complete', {
      method: 'POST',
      body: JSON.stringify({ action: 'list', ...args }),
    }),
  )
}

export async function apiMultipartComplete(
  authFetch: AuthFetch,
  args: { key: string; uploadId: string; parts: { PartNumber: number; ETag: string }[]; expectedSize: number },
) {
  return call<{ ok: true; key: string; verified?: boolean; contentLength?: number; alreadyComplete?: boolean }>(
    'multipart-complete',
    () => authFetch('/api/storage/multipart-complete', { method: 'POST', body: JSON.stringify({ action: 'complete', ...args }) }),
  )
}

export async function apiVerifyObject(
  authFetch: AuthFetch,
  args: { key: string; expectedSize: number },
) {
  return call<{ ok: true; verified: true; key: string; contentLength: number; contentType: string | null; etag: string | null }>(
    'r2-verify',
    () => authFetch('/api/storage/multipart-complete', {
      method: 'POST',
      body: JSON.stringify({ action: 'verify', ...args }),
    }),
  )
}

export async function apiMultipartAbort(authFetch: AuthFetch, args: { key: string; uploadId: string }) {
  return call<{ ok: true }>('multipart-abort', () =>
    authFetch('/api/storage/multipart-abort', { method: 'POST', body: JSON.stringify(args) }),
  )
}

export async function apiRecordOrphan(
  authFetch: AuthFetch,
  args: { storageKey: string; originalName: string; fileSizeBytes: number; uploadId?: string; error: string },
) {
  return call<{ ok: true }>('record-orphan', () =>
    authFetch('/api/storage/record-orphan', { method: 'POST', body: JSON.stringify(args) }),
  )
}

export async function apiSignedGet(accessToken: string, fileId: string, variant: 'original' | 'thumb' | 'poster' = 'original') {
  const res = await fetch(`/api/storage/signed-get?fileId=${encodeURIComponent(fileId)}&variant=${variant}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  return parse<{
    ok: true
    mode: 'signed' | 'legacy-public'
    url: string
    encryptionVersion?: number
    chunkSize?: number | null
    wrappedDek?: string | null
    metadata?: Record<string, unknown> | null
    mimeType?: string | null
    fileName?: string | null
  }>(res, 'signed-get')
}
