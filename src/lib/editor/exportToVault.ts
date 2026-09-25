/**
 * Export editor collage as a NEW Vault file via existing upload pipeline.
 * Never overwrites originals. Success only after enqueue (verify-before-catalog in manager).
 */
import type { EditorProjectPayload, EditorSlot } from './projects'
import { enqueueFiles } from '../upload/manager'
import { resolveVaultMedia } from '../media/resolveMedia'

export type ExportResult =
  | { ok: true; jobIds: string[]; fileName: string }
  | { ok: false; error: string }

function layoutGrid(layout: EditorProjectPayload['layout']): { cols: number; rows: number; cells: number } {
  switch (layout) {
    case '1':
      return { cols: 1, rows: 1, cells: 1 }
    case '1x2':
      return { cols: 2, rows: 1, cells: 2 }
    case '2x1':
      return { cols: 1, rows: 2, cells: 2 }
    case '1+2':
      return { cols: 2, rows: 2, cells: 3 }
    case '2x2':
    default:
      return { cols: 2, rows: 2, cells: 4 }
  }
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to load media for export'))
    img.src = url
  })
}

function drawFitted(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  x: number,
  y: number,
  w: number,
  h: number,
  fit: 'cover' | 'contain',
  iw: number,
  ih: number,
) {
  const scale =
    fit === 'cover' ? Math.max(w / iw, h / ih) : Math.min(w / iw, h / ih)
  const dw = iw * scale
  const dh = ih * scale
  const dx = x + (w - dw) / 2
  const dy = y + (h - dh) / 2
  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.clip()
  ctx.drawImage(img, dx, dy, dw, dh)
  ctx.restore()
}

/**
 * Rasterize image slots to a JPEG and upload as a new Vault item.
 * Video-only / mixed video collages: not supported in this pass (returns clear error).
 */
export async function exportEditorCollageToVault(opts: {
  title: string
  payload: EditorProjectPayload
  accessToken: string
  albumId: string | null
  fileById: Record<string, { id: string; file_url: string | null; file_name: string; mime_type: string | null; is_encrypted: boolean }>
  masterKey: CryptoKey | null
}): Promise<ExportResult> {
  const slots = opts.payload.slots.filter((s) => s.fileId)
  if (!slots.length) return { ok: false, error: 'Add at least one image before exporting.' }
  if (slots.some((s) => s.kind === 'video')) {
    return {
      ok: false,
      error:
        'Video collage export is not reliable in-browser yet. Export image collages, or save the project (originals stay untouched).',
    }
  }

  const { cols, rows } = layoutGrid(opts.payload.layout)
  const cell = 720
  const canvas = document.createElement('canvas')
  canvas.width = cols * cell
  canvas.height = rows * cell
  const ctx = canvas.getContext('2d')
  if (!ctx) return { ok: false, error: 'Canvas unavailable on this device.' }
  ctx.fillStyle = '#0b0b0c'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const positions: { x: number; y: number; w: number; h: number }[] = []
  if (opts.payload.layout === '1+2') {
    positions.push({ x: 0, y: 0, w: cell * 2, h: cell })
    positions.push({ x: 0, y: cell, w: cell, h: cell })
    positions.push({ x: cell, y: cell, w: cell, h: cell })
  } else {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        positions.push({ x: c * cell, y: r * cell, w: cell, h: cell })
      }
    }
  }

  for (let i = 0; i < slots.length && i < positions.length; i++) {
    const slot = slots[i] as EditorSlot
    const file = opts.fileById[slot.fileId!]
    if (!file) continue
    const resolved = await resolveVaultMedia({
      fileId: file.id,
      accessToken: opts.accessToken,
      variant: 'original',
      masterKey: opts.masterKey,
      fallbackUrl: file.file_url,
    })
    const img = await loadImage(resolved.displayUrl)
    const pos = positions[i]!
    drawFitted(ctx, img, pos.x, pos.y, pos.w, pos.h, slot.objectFit, img.naturalWidth, img.naturalHeight)
  }

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.9))
  if (!blob) return { ok: false, error: 'Failed to encode export JPEG.' }

  const safeTitle = (opts.title || 'Vault edit').replace(/[^\w\- ]+/g, '').trim() || 'Vault edit'
  const fileName = `${safeTitle}-edit-${Date.now()}.jpg`
  const file = new File([blob], fileName, { type: 'image/jpeg', lastModified: Date.now() })
  const jobIds = await enqueueFiles([file], { albumId: opts.albumId, purpose: 'content' })
  if (!jobIds.length) return { ok: false, error: 'Upload queue rejected the export.' }
  return { ok: true, jobIds, fileName }
}
