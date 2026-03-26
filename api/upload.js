export const config = {
  api: {
    bodyParser: false,
  },
}

import Busboy from 'busboy'
import { uploadFile } from '../lib/r2Upload.js'
import { requireAuthenticatedUser } from './_auth.js'
import { sendJson } from './_json.js'

function isAllowedType(fileType) {
  return typeof fileType === 'string' && (fileType.startsWith('image/') || fileType.startsWith('video/'))
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  })
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
        const buffer = Buffer.concat(chunks)
        filePart = {
          buffer,
          fileName: info.filename,
          fileType: info.mimeType,
          size: buffer.length,
        }
      })
    })

    bb.on('error', reject)
    bb.on('finish', () => resolve({ fields, filePart }))
    req.pipe(bb)
  })
}

async function parseUploadRequest(req) {
  // Preferred parser path for runtimes exposing Request.formData()
  if (typeof req.formData === 'function') {
    const formData = await req.formData()
    const file = formData.get('file')
    const userId = formData.get('userId')
    const album = formData.get('album')

    if (!file || typeof file === 'string') {
      return { userId, album, file: null }
    }

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    return {
      userId,
      album,
      file: {
        buffer,
        fileName: file.name,
        fileType: file.type,
        size: file.size,
      },
    }
  }

  // Node req/res fallback (Vercel serverless function style)
  const { fields, filePart } = await parseMultipartFallback(req)
  return {
    userId: fields.userId,
    album: fields.album,
    file: filePart,
  }
}

function respond(req, res, payload, status = 200) {
  if (res && typeof sendJson === 'function') {
    sendJson(res, status, payload)
    return null
  }
  return jsonResponse(payload, status)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return respond(req, res, { ok: false, error: 'Method not allowed' }, 405)
  }

  try {
    const { user } = await requireAuthenticatedUser(req)
    const { userId, album, file } = await parseUploadRequest(req)

    if (!file) {
      return respond(req, res, { ok: false, error: 'No file' }, 400)
    }

    if (!userId || !album) {
      return respond(req, res, { ok: false, error: 'userId and album are required' }, 400)
    }

    if (userId !== user.id) {
      return respond(req, res, { ok: false, error: 'User mismatch' }, 403)
    }

    if (!isAllowedType(file.fileType)) {
      return respond(req, res, { ok: false, error: 'Only image and video files are supported' }, 400)
    }

    if (!file.buffer || file.buffer.length === 0) {
      return respond(req, res, { ok: false, error: 'Uploaded file is empty' }, 400)
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

    return respond(req, res, {
      ok: true,
      key: result.key,
      url: result.url,
      fileName: result.fileName,
    })
  } catch (error) {
    console.error('UPLOAD ERROR', error)
    return respond(req, res, {
      ok: false,
      error: error instanceof Error ? error.message : 'Upload failed',
    }, 400)
  }
}
