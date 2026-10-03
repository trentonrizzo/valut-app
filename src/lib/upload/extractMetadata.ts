/**
 * Best-effort client metadata. Never fabricates capture dates.
 * Video poster/metadata must never block upload finalization.
 */
import { isImageUpload, isVideoUpload, normalizeUploadMime } from './strategy'
import { extractImageCaptureDateFromBuffer, type CaptureDateResult } from './exifCaptureDate'
import { extractVideoCaptureDateFromSegments } from './videoCaptureDate'
import {
  extractTechnicalMetadataFromSegments,
  readBoundedMetadataSegments,
  type TechnicalMediaMetadata,
} from './technicalMetadata'

export type ExtractedMeta = {
  width: number | null
  height: number | null
  durationMs: number | null
  capturedAt: string | null
  capturedAtLocal: string | null
  capturedAtOffset: string | null
  capturedAtSource: CaptureDateResult['source'] | null
  mime: string
  technicalMetadata: TechnicalMediaMetadata | null
}

const META_TIMEOUT_MS = 4000
const POSTER_TIMEOUT_MS = 4500

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms)
    void p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      () => {
        clearTimeout(t)
        resolve(fallback)
      },
    )
  })
}

export async function extractMediaMetadata(file: File): Promise<ExtractedMeta> {
  const mime = normalizeUploadMime(file)
  const base: ExtractedMeta = {
    width: null,
    height: null,
    durationMs: null,
    capturedAt: null,
    capturedAtLocal: null,
    capturedAtOffset: null,
    capturedAtSource: null,
    mime,
    technicalMetadata: null,
  }
  try {
    if (isImageUpload(file)) {
      const [dim, bounded] = await Promise.all([
        withTimeout(imageSize(file), META_TIMEOUT_MS, { width: null, height: null }),
        extractBoundedMediaMetadata(file),
      ])
      return {
        ...base,
        width: dim.width ?? bounded.technicalMetadata?.width ?? null,
        height: dim.height ?? bounded.technicalMetadata?.height ?? null,
        ...bounded.capture,
        technicalMetadata: bounded.technicalMetadata,
      }
    }
    if (isVideoUpload(file)) {
      const [v, bounded] = await Promise.all([
        withTimeout(videoMeta(file), META_TIMEOUT_MS, {
          width: null,
          height: null,
          durationMs: null,
        }),
        extractBoundedMediaMetadata(file),
      ])
      return {
        ...base,
        width: v.width ?? bounded.technicalMetadata?.width ?? null,
        height: v.height ?? bounded.technicalMetadata?.height ?? null,
        durationMs: v.durationMs ?? bounded.technicalMetadata?.durationMs ?? null,
        ...bounded.capture,
        technicalMetadata: bounded.technicalMetadata,
      }
    }
    return base
  } catch {
    return base
  }
}

/** Bounded metadata-only path. It never decodes pixels/video or reads the full original. */
export async function extractCaptureDateMetadata(
  file: File,
): Promise<Pick<ExtractedMeta, 'capturedAt' | 'capturedAtLocal' | 'capturedAtOffset' | 'capturedAtSource'>> {
  return (await extractBoundedMediaMetadata(file)).capture
}

export async function extractBoundedMediaMetadata(file: File): Promise<{
  capture: Pick<ExtractedMeta, 'capturedAt' | 'capturedAtLocal' | 'capturedAtOffset' | 'capturedAtSource'>
  technicalMetadata: TechnicalMediaMetadata | null
}> {
  const none = { capturedAt: null, capturedAtLocal: null, capturedAtOffset: null, capturedAtSource: null }
  try {
    const kind = isImageUpload(file) ? 'image' : isVideoUpload(file) ? 'video' : null
    if (!kind) return { capture: none, technicalMetadata: null }
    const segments = await withTimeout(readBoundedMetadataSegments(file, kind), META_TIMEOUT_MS, [] as ArrayBuffer[])
    const embedded = kind === 'image'
      ? extractImageCaptureDateFromBuffer(segments[0] ?? new ArrayBuffer(0))
      : extractVideoCaptureDateFromSegments(segments)
    const technicalMetadata = segments.length
      ? extractTechnicalMetadataFromSegments(segments, { name: file.name, mime: normalizeUploadMime(file), size: file.size, kind })
      : null
    if (embedded) {
      return { capture: {
          capturedAt: embedded.capturedAt,
          capturedAtLocal: embedded.capturedLocal,
          capturedAtOffset: embedded.capturedOffset,
          capturedAtSource: embedded.source,
        }, technicalMetadata }
    }
    return { capture: fileModifiedFallback(file), technicalMetadata }
  } catch {
    return {
      capture: isImageUpload(file) || isVideoUpload(file) ? fileModifiedFallback(file) : none,
      technicalMetadata: null,
    }
  }
}

export function fileModifiedFallback(file: Pick<File, 'lastModified'>): Pick<ExtractedMeta, 'capturedAt' | 'capturedAtLocal' | 'capturedAtOffset' | 'capturedAtSource'> {
  const ms = Number(file.lastModified)
  if (!Number.isFinite(ms) || ms <= 0 || ms > Date.now() + 86_400_000) {
    return { capturedAt: null, capturedAtLocal: null, capturedAtOffset: null, capturedAtSource: null }
  }
  return { capturedAt: new Date(ms).toISOString(), capturedAtLocal: null, capturedAtOffset: null, capturedAtSource: 'file_last_modified' }
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
      video.removeAttribute('src')
      video.load()
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
  if (!isImageUpload(file)) return null
  try {
    const bitmap = await withTimeout(
      createImageBitmap(file).then(async (bitmap) => {
        const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
        const w = Math.max(1, Math.round(bitmap.width * scale))
        const h = Math.max(1, Math.round(bitmap.height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          bitmap.close()
          return null
        }
        ctx.drawImage(bitmap, 0, 0, w, h)
        bitmap.close()
        return await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.82))
      }),
      META_TIMEOUT_MS,
      null,
    )
    return bitmap
  } catch {
    return null
  }
}

export async function makeVideoPoster(file: File, maxEdge = 640): Promise<Blob | null> {
  if (!isVideoUpload(file)) return null
  return withTimeout(
    new Promise<Blob | null>((resolve) => {
      const url = URL.createObjectURL(file)
      const video = document.createElement('video')
      video.muted = true
      video.playsInline = true
      video.preload = 'metadata'
      let settled = false
      const finish = (blob: Blob | null) => {
        if (settled) return
        settled = true
        URL.revokeObjectURL(url)
        try {
          video.removeAttribute('src')
          video.load()
        } catch {
          /* ignore */
        }
        resolve(blob)
      }
      video.onloadeddata = () => {
        try {
          const t =
            video.duration && Number.isFinite(video.duration) ? Math.min(0.12, video.duration * 0.02) : 0.05
          video.currentTime = t > 0 ? t : 0.05
        } catch {
          finish(null)
        }
      }
      video.onseeked = () => {
        try {
          if (video.videoWidth < 2) {
            finish(null)
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
            finish(null)
            return
          }
          ctx.drawImage(video, 0, 0, w, h)
          canvas.toBlob((b) => finish(b), 'image/jpeg', 0.84)
        } catch {
          finish(null)
        }
      }
      video.onerror = () => finish(null)
      video.src = url
    }),
    POSTER_TIMEOUT_MS,
    null,
  )
}
