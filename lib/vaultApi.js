function parseJsonOrThrow(response) {
  return response.json().then((data) => {
    if (!response.ok || data?.ok === false) {
      throw new Error(data?.error || `Request failed (${response.status})`)
    }
    return data
  })
}

export async function uploadToVault() {
  console.log("UPLOAD OVERRIDE ACTIVE");

  throw new Error("UPLOAD SYSTEM DISABLED");
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
