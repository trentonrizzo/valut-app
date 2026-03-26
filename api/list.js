import { listUserFiles } from '../lib/r2List.js'
import { requireAuthenticatedUser } from './_auth.js'
import { readJsonBody, sendJson } from './_json.js'

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed' })
  }

  try {
    const { user } = await requireAuthenticatedUser(req)

    const queryUserId = req.method === 'GET' ? req.query?.userId : undefined
    const queryAlbum = req.method === 'GET' ? req.query?.album : undefined

    let userId = queryUserId
    let album = queryAlbum

    if (!userId) {
      const body = await readJsonBody(req)
      userId = body.userId
      album = body.album
    }

    if (!userId) {
      return sendJson(res, 400, { error: 'userId is required' })
    }

    if (userId !== user.id) {
      return sendJson(res, 403, { error: 'User mismatch' })
    }

    const files = await listUserFiles(user.id, album)
    return sendJson(res, 200, files)
  } catch (error) {
    console.error('R2 ERROR:', error)
    const status = error?.statusCode || 500
    return sendJson(res, status, { error: error instanceof Error ? error.message : 'List failed' })
  }
}
