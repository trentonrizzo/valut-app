function parseJsonOrThrow(response) {
  return response.json().then((data) => {
    if (!response.ok || data?.ok === false) {
      throw new Error(data?.error || `Request failed (${response.status})`)
    }
    return data
  })
}

export async function uploadToVault(file, userId, album, accessToken) {
  if (!file) throw new Error('uploadToVault requires a file')
  if (!(file instanceof Blob)) throw new Error('uploadToVault expected a File/Blob')
  if (!accessToken) throw new Error('Missing auth token')

  const presignRes = await fetch('/api/r2-presign', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      userId,
      album,
      fileName: typeof file.name === 'string' ? file.name : 'file',
      contentType: file.type || 'application/octet-stream',
    }),
  })

  const presign = await parseJsonOrThrow(presignRes)

  const putRes = await fetch(presign.url, {
    method: 'PUT',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
    },
    body: file,
  })

  if (!putRes.ok) {
    throw new Error(`Direct upload failed (${putRes.status})`)
  }

  return {
    ok: true,
    key: presign.key,
    url: presign.publicUrl,
    fileName: presign.fileName,
    contentType: file.type || 'application/octet-stream',
  }
}

export async function deleteFromVault(key, userId, accessToken) {
  if (!accessToken) throw new Error('Missing auth token')

  const response = await fetch('/api/delete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ key, userId }),
  })

  return parseJsonOrThrow(response)
}

export async function getVaultFiles(userId, accessToken, album) {
  if (!accessToken) throw new Error('Missing auth token')

  const query = new URLSearchParams({ userId })
  if (album) query.set('album', album)

  const response = await fetch(`/api/list?${query.toString()}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  return parseJsonOrThrow(response)
}
