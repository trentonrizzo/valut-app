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

async function parse<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as T & { ok?: boolean; error?: string }
  if (!res.ok || (data as { ok?: boolean }).ok === false) {
    throw new Error((data as { error?: string }).error || `Request failed (${res.status})`)
  }
  return data
}

export async function apiPutUrl(
  authFetch: AuthFetch,
  args: { objectId: string; contentType: string; key?: string },
) {
  const res = await authFetch('/api/storage/put-url', {
    method: 'POST',
    body: JSON.stringify(args),
  })
  return parse<{ ok: true; key: string; uploadUrl: string; expiresIn: number }>(res)
}

export async function apiMultipartInit(
  authFetch: AuthFetch,
  args: { objectId: string; contentType: string; key?: string },
) {
  const res = await authFetch('/api/storage/multipart-init', {
    method: 'POST',
    body: JSON.stringify(args),
  })
  return parse<{ ok: true; key: string; uploadId: string }>(res)
}

export async function apiMultipartPartUrl(
  authFetch: AuthFetch,
  args: { key: string; uploadId: string; partNumber: number },
) {
  const res = await authFetch('/api/storage/multipart-part-url', {
    method: 'POST',
    body: JSON.stringify(args),
  })
  return parse<{ ok: true; url: string; expiresIn: number; partNumber: number }>(res)
}

export async function apiMultipartComplete(
  authFetch: AuthFetch,
  args: { key: string; uploadId: string; parts: { PartNumber: number; ETag: string }[] },
) {
  const res = await authFetch('/api/storage/multipart-complete', {
    method: 'POST',
    body: JSON.stringify(args),
  })
  return parse<{ ok: true; key: string }>(res)
}

export async function apiMultipartAbort(authFetch: AuthFetch, args: { key: string; uploadId: string }) {
  const res = await authFetch('/api/storage/multipart-abort', {
    method: 'POST',
    body: JSON.stringify(args),
  })
  return parse<{ ok: true }>(res)
}

export async function apiRecordOrphan(
  authFetch: AuthFetch,
  args: { storageKey: string; originalName: string; fileSizeBytes: number; uploadId?: string; error: string },
) {
  const res = await authFetch('/api/storage/record-orphan', {
    method: 'POST',
    body: JSON.stringify(args),
  })
  return parse<{ ok: true }>(res)
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
  }>(res)
}
