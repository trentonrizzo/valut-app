export const config = {
  api: {
    bodyParser: false,
  },
}

import Busboy from 'busboy'
import { uploadFile } from '../lib/r2Upload.js'
import { requireAuthenticatedUser } from './_auth.js'
import { sendJson } from './_json.js'

function fail(res, status, message, details) {
  if (details) {
    console.error('UPLOAD ERROR POINT:', details)
  }
  return sendJson(res, status, { ok: false, error: message })
}

function isAllowedType(fileType) {
  return typeof fileType === 'string' && (fileType.startsWith('image/') || fileType.startsWith('video/'))
}

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const contentType = req.headers['content-type'] || req.headers['Content-Type'] || ''
    if (!String(contentType).toLowerCase().includes('multipart/form-data')) {
      reject(new Error('Content-Type must be multipart/form-data'))
      return
    }

    const bb = Busboy({ headers: req.headers })
    const fields = {}
    let filePart = null

    bb.on('field', (name, value) => {
      fields[name] = value
    })

    bb.on('file', (_name, stream, info) => {
      const chunks = []

      stream.on('data', (chunk) => {
        chunks.push(chunk)
      })

      stream.on('error', (err) => {
        reject(err)
      })

      stream.on('end', () => {
        const buffer = Buffer.concat(chunks)
        filePart = {
          buffer,
          fileName: info.filename,
          fileType: info.mimeType,
          size: buffer.length,
        }
      })
    })

    bb.on('error', (err) => {
      reject(err)
    })

    bb.on('finish', () => {
      resolve({ fields, filePart })
    })

    req.pipe(bb)
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return fail(res, 405, 'Method not allowed')
  }

  try {
    const { user } = await requireAuthenticatedUser(req)

    const { fields, filePart } = await parseMultipart(req)
    const userId = fields.userId
    const album = fields.album

    if (!filePart) {
      return fail(res, 400, 'No file provided')
    }

    if (!userId || !album) {
      return fail(res, 400, 'userId and album are required')
    }

    if (userId !== user.id) {
      return fail(res, 403, 'User mismatch')
    }

    if (!isAllowedType(filePart.fileType)) {
      return fail(res, 400, 'Only image and video files are supported')
    }

    if (!filePart.buffer || filePart.buffer.length === 0) {
      return fail(res, 400, 'Uploaded file is empty')
    }

    console.log('UPLOAD START', {
      name: filePart.fileName,
      size: filePart.size,
      type: filePart.fileType,
      album,
      userId,
    })

    const uploaded = await uploadFile({
      fileBuffer: filePart.buffer,
      fileType: filePart.fileType,
      userId: user.id,
      album,
      fileName: filePart.fileName,
    })

    console.log('UPLOAD SUCCESS', { key: uploaded.key, url: uploaded.url })

    return sendJson(res, 200, {
      ok: true,
      key: uploaded.key,
      url: uploaded.url,
      fileName: uploaded.fileName,
      contentType: uploaded.contentType,
    })
  } catch (error) {
    console.error('UPLOAD ERROR', error)
    return sendJson(res, 400, {
      ok: false,
      error: error instanceof Error ? error.message : 'Upload failed',
    })
  }
}
