import { uploadFile } from '../lib/r2Upload.js'
import { requireAuthenticatedUser } from './_auth.js'
import { readJsonBody, sendJson } from './_json.js'

function isAllowedType(fileType) {
  return typeof fileType === 'string' && (fileType.startsWith('image/') || fileType.startsWith('video/'))
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed' })
  }

  try {
    const { user } = await requireAuthenticatedUser(req)
    const { fileDataBase64, fileType, userId, album, fileName } = await readJsonBody(req)

    if (!fileDataBase64 || !userId || !album || !fileName) {
      return sendJson(res, 400, { error: 'fileDataBase64, userId, album, and fileName are required' })
    }

    if (userId !== user.id) {
      return sendJson(res, 403, { error: 'User mismatch' })
    }

    if (!isAllowedType(fileType)) {
      return sendJson(res, 400, { error: 'Only image and video files are supported' })
    }

    const fileBuffer = Buffer.from(fileDataBase64, 'base64')
    const result = await uploadFile({ fileBuffer, fileType, userId: user.id, album, fileName })

    return sendJson(res, 200, result)
  } catch (error) {
    const status = error?.statusCode || 500
    return sendJson(res, status, { error: error instanceof Error ? error.message : 'Upload failed' })
  }
}
