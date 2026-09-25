/**
 * Client visual analysis: sample frames → server vision → media_analysis cache.
 * Metadata/cache first; vision only when needed.
 */
import { supabase } from '../supabase'
import { apiSignedGet } from '../upload/storageApi'
import { ANALYSIS_VERSION, getCachedAnalysis, upsertAnalysis } from './analysisCache'
import { classifyFileKind } from '../fileKind'
import type { FileRow } from '../../types/media'

export type VisualFocus = {
  peopleCount?: number | null
  blondeHair?: boolean | null
  freeText?: string
}

function canvasToJpegDataUrl(canvas: HTMLCanvasElement, quality = 0.72): string {
  return canvas.toDataURL('image/jpeg', quality)
}

async function loadImageToCanvas(url: string, maxEdge = 768): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight))
        const w = Math.max(1, Math.round(img.naturalWidth * scale))
        const h = Math.max(1, Math.round(img.naturalHeight * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) return resolve(null)
        ctx.drawImage(img, 0, 0, w, h)
        resolve(canvasToJpegDataUrl(canvas))
      } catch {
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    img.src = url
  })
}

async function sampleVideoFrames(url: string, durationHintMs: number | null, maxEdge = 640): Promise<string[]> {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    video.crossOrigin = 'anonymous'
    const frames: string[] = []
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      try {
        video.removeAttribute('src')
        video.load()
      } catch {
        /* ignore */
      }
      resolve(frames)
    }
    const timeout = window.setTimeout(finish, 12_000)
    video.onloadedmetadata = () => {
      const dur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : (durationHintMs || 0) / 1000
      const targets =
        dur > 0
          ? [Math.min(0.15, dur * 0.05), dur * 0.5, Math.max(0, dur * 0.92)]
          : [0.1]
      let i = 0
      const capture = () => {
        try {
          if (video.videoWidth < 2) {
            window.clearTimeout(timeout)
            finish()
            return
          }
          const scale = Math.min(1, maxEdge / video.videoWidth)
          const w = Math.max(1, Math.round(video.videoWidth * scale))
          const h = Math.max(1, Math.round(video.videoHeight * scale))
          const canvas = document.createElement('canvas')
          canvas.width = w
          canvas.height = h
          const ctx = canvas.getContext('2d')
          if (ctx) {
            ctx.drawImage(video, 0, 0, w, h)
            frames.push(canvasToJpegDataUrl(canvas, 0.7))
          }
        } catch {
          /* ignore frame */
        }
        i += 1
        if (i >= targets.length) {
          window.clearTimeout(timeout)
          finish()
          return
        }
        try {
          video.currentTime = Math.min(targets[i]!, Math.max(0, (dur || 1) - 0.05))
        } catch {
          window.clearTimeout(timeout)
          finish()
        }
      }
      video.onseeked = () => capture()
      try {
        video.currentTime = targets[0] || 0.1
      } catch {
        window.clearTimeout(timeout)
        finish()
      }
    }
    video.onerror = () => {
      window.clearTimeout(timeout)
      finish()
    }
    video.src = url
  })
}

async function collectSampleDataUrls(
  accessToken: string,
  file: FileRow,
): Promise<{ images: string[]; sampleInfo: Record<string, unknown> }> {
  const kind = classifyFileKind({ name: file.file_name, mime_type: file.mime_type })
  const sampleInfo: Record<string, unknown> = { kind, sources: [] as string[] }

  // Prefer existing poster/thumb to avoid full video decode when possible
  if (kind === 'video' || file.mime_type?.startsWith('video/')) {
    try {
      const poster = await apiSignedGet(accessToken, file.id, 'poster')
      const thumb = await apiSignedGet(accessToken, file.id, 'thumb').catch(() => null)
      const images: string[] = []
      if (poster.url) {
        const d = await loadImageToCanvas(poster.url)
        if (d) {
          images.push(d)
          ;(sampleInfo.sources as string[]).push('poster')
        }
      }
      if (thumb?.url) {
        const d = await loadImageToCanvas(thumb.url)
        if (d) {
          images.push(d)
          ;(sampleInfo.sources as string[]).push('thumb')
        }
      }
      if (images.length >= 1) {
        // One extra mid-frame sample from original when short
        try {
          const orig = await apiSignedGet(accessToken, file.id, 'original')
          if (orig.encryptionVersion && orig.encryptionVersion > 0) {
            // encrypted originals need unlock path — skip extra frames
          } else {
            const extra = await sampleVideoFrames(orig.url, file.duration_ms, 512)
            if (extra[1]) {
              images.push(extra[1])
              ;(sampleInfo.sources as string[]).push('mid_frame')
            }
          }
        } catch {
          /* poster/thumb enough */
        }
        return { images: images.slice(0, 3), sampleInfo }
      }
      const orig = await apiSignedGet(accessToken, file.id, 'original')
      const frames = await sampleVideoFrames(orig.url, file.duration_ms)
      sampleInfo.sources = ['sampled_frames']
      return { images: frames.slice(0, 3), sampleInfo }
    } catch {
      return { images: [], sampleInfo }
    }
  }

  try {
    const thumb = await apiSignedGet(accessToken, file.id, 'thumb').catch(() => null)
    if (thumb?.url) {
      const d = await loadImageToCanvas(thumb.url)
      if (d) {
        sampleInfo.sources = ['thumb']
        return { images: [d], sampleInfo }
      }
    }
    const orig = await apiSignedGet(accessToken, file.id, 'original')
    const d = await loadImageToCanvas(orig.url)
    sampleInfo.sources = ['original']
    return { images: d ? [d] : [], sampleInfo }
  } catch {
    return { images: [], sampleInfo }
  }
}

export async function analyzeMediaVisual(opts: {
  userId: string
  accessToken: string
  file: FileRow
  focus?: VisualFocus
  force?: boolean
}): Promise<{ fromCache: boolean; analysis: Record<string, unknown> | null; error?: string }> {
  if (!opts.force) {
    const cached = await getCachedAnalysis(opts.userId, opts.file.id, { provider: 'openai' })
    if (cached?.status === 'ready') {
      return {
        fromCache: true,
        analysis: {
          description: cached.description,
          people_count: cached.people_count,
          attributes: cached.attributes_json,
          confidence: cached.confidence,
          sample_info: cached.sample_info_json,
        },
      }
    }
  }

  const { images, sampleInfo } = await collectSampleDataUrls(opts.accessToken, opts.file)
  if (!images.length) {
    await upsertAnalysis({
      user_id: opts.userId,
      file_id: opts.file.id,
      provider: 'openai',
      status: 'failed',
      error: 'Could not sample frames',
      attributes_json: {},
      sample_info_json: sampleInfo,
      content_hash_at_analysis: opts.file.content_hash ?? null,
    })
    return { fromCache: false, analysis: null, error: 'Could not sample frames' }
  }

  const focusParts: string[] = []
  if (opts.focus?.peopleCount != null) focusParts.push(`exact people count near ${opts.focus.peopleCount}`)
  if (opts.focus?.blondeHair) focusParts.push('blonde hair presence')
  if (opts.focus?.freeText) focusParts.push(opts.focus.freeText)

  const res = await fetch('/api/ai/analyze', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${opts.accessToken}`,
    },
    body: JSON.stringify({ images, focus: focusParts.join('; ') || undefined }),
  })
  if (res.status === 503) {
    await upsertAnalysis({
      user_id: opts.userId,
      file_id: opts.file.id,
      provider: 'none',
      status: 'skipped',
      error: 'AI provider not configured',
      attributes_json: {},
      sample_info_json: sampleInfo,
    })
    return { fromCache: false, analysis: null, error: 'Visual analysis unavailable (no API key)' }
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    await upsertAnalysis({
      user_id: opts.userId,
      file_id: opts.file.id,
      provider: 'openai',
      status: 'failed',
      error: body.error || `HTTP ${res.status}`,
      attributes_json: {},
      sample_info_json: sampleInfo,
    })
    return { fromCache: false, analysis: null, error: body.error || 'Vision failed' }
  }
  const body = (await res.json()) as {
    analysis?: {
      description?: string | null
      people_count?: number | null
      attributes?: Record<string, unknown>
      person_slots?: unknown[]
      confidence?: number | null
    }
    model?: string
    provider?: string
  }
  const a = body.analysis || {}
  const attrs = { ...(a.attributes || {}), person_slots: a.person_slots || [] }
  await upsertAnalysis({
    user_id: opts.userId,
    file_id: opts.file.id,
    provider: body.provider || 'openai',
    model: body.model || null,
    status: 'ready',
    description: a.description ?? null,
    people_count: a.people_count ?? null,
    attributes_json: attrs,
    sample_info_json: { ...sampleInfo, analysis_version: ANALYSIS_VERSION },
    confidence: a.confidence ?? null,
    content_hash_at_analysis: opts.file.content_hash ?? null,
    error: null,
  })
  return {
    fromCache: false,
    analysis: {
      description: a.description,
      people_count: a.people_count,
      attributes: attrs,
      confidence: a.confidence,
    },
  }
}

export async function listAlbumContentFiles(userId: string, albumId: string): Promise<FileRow[]> {
  const { data: memb, error } = await supabase
    .from('album_files')
    .select('file_id')
    .eq('user_id', userId)
    .eq('album_id', albumId)
  if (error) throw new Error(error.message)
  const ids = (memb ?? []).map((m) => m.file_id)
  if (!ids.length) return []
  const { data, error: fErr } = await supabase
    .from('files')
    .select('*')
    .eq('user_id', userId)
    .in('id', ids.slice(0, 500))
    .is('deleted_at', null)
    .eq('purpose', 'content')
  if (fErr) throw new Error(fErr.message)
  return (data as FileRow[]) ?? []
}

export function analysisMatchesFocus(
  analysis: { people_count?: number | null; attributes?: Record<string, unknown> } | null,
  focus: VisualFocus,
): boolean {
  if (!analysis) return false
  if (focus.peopleCount != null && analysis.people_count !== focus.peopleCount) return false
  if (focus.blondeHair) {
    const attrs = analysis.attributes || {}
    if (attrs.blonde_hair !== true) {
      const desc = JSON.stringify(attrs).toLowerCase()
      if (!desc.includes('blonde')) return false
    }
  }
  return true
}
