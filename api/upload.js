import Busboy from 'busboy'
import { uploadFile } from '../lib/r2Upload.js'
import { requireAuthenticatedUser } from './_auth.js'
import { sendJson } from './_json.js'

function isAllowedType(fileType) {
  return typeof fileType === 'string' && (fileType.startsWith('image/') || fileType.startsWith('video/'))
}

function parseMultipartFallback(req) {
  return new Promise((resolve, reject) => {
    const bb = Busboy({ headers: req.headers })
    const fields = {}
    let filePart = null

    bb.on('field', (name, value) => {
      fields[name] = value
    })

    bb.on('file', (_name, stream, info) => {
      const chunks = []
      stream.on('data', (chunk) => chunks.push(chunk))
      stream.on('error', reject)
      stream.on('end', () => {
        filePart = {
          buffer: Buffer.concat(chunks),
          fileName: info.filename,
          fileType: info.mimeType,
          size: Buffer.concat(chunks).length,
        }
      })
    })

    bb.on('error', reject)
    bb.on('finish', () => resolve({ fields, filePart }))
    req.pipe(bb)
  })
}

async function parseUploadRequest(req) {
  // Preferred path: Web Request API style
  if (typeof req.formData === 'function') {
    const formData = await req.formData()
    const file = formData.get('file')
    const userId = formData.get('userId')
    const album = formData.get('album')

    if (!file || typeof file === 'string') {
      return { userId, album, file: null }
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer())

    return {
      userId,
      album,
      file: {
        buffer: fileBuffer,
        fileName: file.name,
        fileType: file.type,
        size: file.size,
      },
    }
  }

  // Fallback for Node serverless req/res handlers
  const { fields, filePart } = await parseMultipartFallback(req)
  return {
    userId: fields.userId,
    album: fields.album,
    file: filePart,
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { ok: false, error: 'Method not allowed' })
  }

  try {
    const { user } = await requireAuthenticatedUser(req)
    const { userId, album, file } = await parseUploadRequest(req)

    if (!file) {
      return sendJson(res, 200, { ok: false, error: 'No file provided' })
    }

    if (!userId || !album) {
      return sendJson(res, 200, { ok: false, error: 'userId and album are required' })
    }

    if (userId !== user.id) {
      return sendJson(res, 200, { ok: false, error: 'User mismatch' })
    }

    if (!isAllowedType(file.fileType)) {
      return sendJson(res, 200, { ok: false, error: 'Only image and video files are supported' })
    }

    if (!file.buffer || file.buffer.length === 0) {
      return sendJson(res, 200, { ok: false, error: 'Uploaded file is empty' })
    }

    console.log('UPLOAD START', {
      name: file.fileName,
      size: file.size ?? file.buffer.length,
      type: file.fileType,
    })

    const result = await uploadFile({
      fileBuffer: file.buffer,
      fileType: file.fileType,
      userId: user.id,
      album: String(album),
      fileName: file.fileName,
    })

    console.log('UPLOAD SUCCESS', { key: result.key, url: result.url })

    return sendJson(res, 200, {
      ok: true,
      key: result.key,
      url: result.url,
      fileName: result.fileName,
    })
  } catch (error) {
    console.error(error)
    return sendJson(res, 200, {
      ok: false,
      error: error instanceof Error ? error.message : 'Upload failed',
    })
  }
}
