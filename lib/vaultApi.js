function parseJsonOrThrow(response) {
  return response.json().then((data) => {
    if (!response.ok) {
      throw new Error(data?.error || `Request failed (${response.status})`)
    }
    return data
  })
}

async function fileToBase64(file) {
  const buffer = await file.arrayBuffer()
  let binary = ''
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode(...chunk)
  }

  return btoa(binary)
}

function authHeaders(accessToken) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
  }
}

export async function uploadToVault(file, userId, album, accessToken) {
  if (!file) throw new Error('uploadToVault requires a file')
  if (!accessToken) throw new Error('Missing auth token')

  const payload = {
    fileDataBase64: await fileToBase64(file),
    fileType: file.type || 'application/octet-stream',
    userId,
    album,
    fileName: file.name,
  }

  const response = await fetch('/api/upload', {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify(payload),
  })

  return parseJsonOrThrow(response)
}

export async function deleteFromVault(key, userId, accessToken) {
  if (!accessToken) throw new Error('Missing auth token')

  const response = await fetch('/api/delete', {
    method: 'POST',
    headers: authHeaders(accessToken),
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
