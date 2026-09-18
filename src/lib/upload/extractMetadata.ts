/**
 * Best-effort client metadata. Never fabricates capture dates.
 */
export type ExtractedMeta = {
  width: number | null
  height: number | null
  durationMs: number | null
  capturedAt: string | null
  mime: string
}

export async function extractMediaMetadata(file: File): Promise<ExtractedMeta> {
  const mime = file.type || 'application/octet-stream'
  const base: ExtractedMeta = {
    width: null,
    height: null,
    durationMs: null,
    capturedAt: null,
    mime,
  }

  if (mime.startsWith('image/')) {
    const dim = await imageSize(file)
    return { ...base, ...dim }
  }
  if (mime.startsWith('video/') || /\.(mp4|mov|webm|mkv|ogg)$/i.test(file.name)) {
    const v = await videoMeta(file)
    return { ...base, ...v }
  }
  return base
}

function imageSize(file: File): Promise<{ width: number | null; height: number | null }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve({ width: img.naturalWidth || null, height: img.naturalHeight || null })
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve({ width: null, height: null })
    }
    img.src = url
  })
}

function videoMeta(
  file: File,
): Promise<{ width: number | null; height: number | null; durationMs: number | null }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true
    video.playsInline = true
    const done = (w: number | null, h: number | null, ms: number | null) => {
      URL.revokeObjectURL(url)
      resolve({ width: w, height: h, durationMs: ms })
    }
    video.onloadedmetadata = () => {
      const w = video.videoWidth || null
      const h = video.videoHeight || null
      const d = Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : null
      done(w, h, d)
    }
    video.onerror = () => done(null, null, null)
    video.src = url
  })
}

export async function makeImageThumbnail(file: File, maxEdge = 360): Promise<Blob | null> {
  if (!file.type.startsWith('image/')) return null
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close()
    return await new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.82))
  } catch {
    return null
  }
}

export async function makeVideoPoster(file: File, maxEdge = 640): Promise<Blob | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    const cleanup = () => URL.revokeObjectURL(url)
    video.onloadeddata = () => {
      const t = video.duration && Number.isFinite(video.duration) ? Math.min(0.12, video.duration * 0.02) : 0.05
      video.currentTime = t > 0 ? t : 0.05
    }
    video.onseeked = () => {
      try {
        if (video.videoWidth < 2) {
          cleanup()
          resolve(null)
          return
        }
        const scale = Math.min(1, maxEdge / video.videoWidth)
        const w = Math.max(1, Math.round(video.videoWidth * scale))
        const h = Math.max(1, Math.round(video.videoHeight * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          cleanup()
          resolve(null)
          return
        }
        ctx.drawImage(video, 0, 0, w, h)
        canvas.toBlob(
          (b) => {
            cleanup()
            resolve(b)
          },
          'image/jpeg',
          0.84,
        )
      } catch {
        cleanup()
        resolve(null)
      }
    }
    video.onerror = () => {
      cleanup()
      resolve(null)
    }
    video.src = url
  })
}
