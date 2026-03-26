import Busboy from 'busboy'
import { uploadFile } from '../lib/r2Upload.js'
import { requireAuthenticatedUser } from './_auth.js'
import { sendJson } from './_json.js'

function isAllowedType(fileType) {
  return typeof fileType === 'string' && (fileType.startsWith('image/') || fileType.startsWith('video/'))
}

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const bb = Busboy({ headers: req.headers })
    const fields = {}
    let filePart = null

    bb.on('field', (name, value) => {
      fields[name] = value
    })

    bb.on('file', (name, stream, info) => {
      const chunks = []
      stream.on('data', (chunk) => chunks.push(chunk))
      stream.on('error', reject)
      stream.on('end', () => {
        filePart = {
          fieldName: name,
          buffer: Buffer.concat(chunks),
          fileName: info.filename,
          fileType: info.mimeType,
        }
      })
    })

    bb.on('error', reject)
    bb.on('finish', () => resolve({ fields, filePart }))
    req.pipe(bb)
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed' })
  }

  try {
    const contentType = req.headers['content-type'] || ''
    if (!String(contentType).toLowerCase().includes('multipart/form-data')) {
      return sendJson(res, 400, { error: 'Content-Type must be multipart/form-data' })
    }

    const { user } = await requireAuthenticatedUser(req)
    const { fields, filePart } = await parseMultipart(req)

    const userId = fields.userId
    const album = fields.album

    console.info('[UPLOAD] start', {
      userId,
      album,
      fileName: filePart?.fileName,
      fileType: filePart?.fileType,
      fileSize: filePart?.buffer?.length,
    })

    if (!filePart || !userId || !album) {
      return sendJson(res, 400, { error: 'file, userId, and album are required' })
    }

    if (userId !== user.id) {
      return sendJson(res, 403, { error: 'User mismatch' })
    }

    if (!isAllowedType(filePart.fileType)) {
      return sendJson(res, 400, { error: 'Only image and video files are supported' })
    }

    if (!filePart.buffer || filePart.buffer.length === 0) {
      return sendJson(res, 400, { error: 'Uploaded file is empty' })
    }

    const result = await uploadFile({
      fileBuffer: filePart.buffer,
      fileType: filePart.fileType,
      userId: user.id,
      album,
      fileName: filePart.fileName,
    })

    console.info('[UPLOAD] success', { key: result.key, url: result.url })

    return sendJson(res, 200, result)
  } catch (error) {
    console.error('UPLOAD ERROR:', error)
    const status = error?.statusCode || 500
    return sendJson(res, status, { error: error instanceof Error ? error.message : 'Upload failed' })
  }
}
