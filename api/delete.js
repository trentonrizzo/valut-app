import { deleteFile } from '../lib/r2Delete.js'
import { requireAuthenticatedUser } from './_auth.js'
import { readJsonBody, sendJson } from './_json.js'

function ownsKey(userId, key) {
  return typeof key === 'string' && key.startsWith(`${userId}/albums/`)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed' })
  }

  try {
    const { user } = await requireAuthenticatedUser(req)
    const { key, userId } = await readJsonBody(req)

    if (!key || !userId) {
      return sendJson(res, 400, { error: 'key and userId are required' })
    }

    if (userId !== user.id || !ownsKey(user.id, key)) {
      return sendJson(res, 403, { error: 'Forbidden' })
    }

    await deleteFile(key)
    return sendJson(res, 200, { success: true })
  } catch (error) {
    const status = error?.statusCode || 500
    return sendJson(res, status, { error: error instanceof Error ? error.message : 'Delete failed' })
  }
}
