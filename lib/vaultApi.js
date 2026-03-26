function parseJsonOrThrow(response) {
  return response.json().then((data) => {
    if (!response.ok) {
      throw new Error(data?.error || `Request failed (${response.status})`)
    }
    return data
  })
}

export async function uploadToVault(file, userId, album, accessToken) {
  if (!file) throw new Error('uploadToVault requires a file')
  if (!accessToken) throw new Error('Missing auth token')

  const formData = new FormData()
  formData.append('file', file)
  formData.append('userId', userId)
  formData.append('album', album)

  const response = await fetch('/api/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body: formData,
  })

  return parseJsonOrThrow(response)
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
