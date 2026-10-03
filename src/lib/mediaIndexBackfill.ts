/**
 * Progressive library indexing: content hash + capture-date backfill.
 * Never modifies storage objects — only metadata columns on files rows.
 */
import { supabase } from './supabase'
import { apiSignedGet, apiVerifyObject, createAuthFetch } from './upload/storageApi'
import { sha256HexOfFile } from './upload/contentHash'
import { extractImageCaptureDateFromBuffer } from './upload/exifCaptureDate'
import { extractVideoCaptureDateFromSegments } from './upload/videoCaptureDate'
import { resolveVaultMedia } from './media/resolveMedia'
import type { FileRow } from '../types/media'
import { decryptChunk, importDek, CHUNK_PLAINTEXT_BYTES, GCM_TAG_BYTES } from './crypto/chunkCipher'
import { base64ToBytes, unwrapDek } from './crypto/envelope'
import { extractTechnicalMetadataFromSegments, TECHNICAL_METADATA_VERSION } from './upload/technicalMetadata'
import { storedObjectBytes } from './upload/storedSize'

export type HashBatchResult = {
  scanned: number
  hashed: number
  skipped: number
  failed: number
  done: boolean
  nextCursorCreatedAt: string | null
  nextCursorId: string | null
  messages: string[]
}

export type CaptureBatchResult = {
  scanned: number
  updated: number
  skipped: number
  unknown: number
  technicalSkipped: number
  failed: number
  done: boolean
  nextCursorCreatedAt: string | null
  nextCursorId: string | null
  messages: string[]
}

export type MediaMetadataBatchResult = CaptureBatchResult & {
  technicalUpdated: number
  integrityVerified: number
}

const IMAGE_SCAN_BYTES = 4 * 1024 * 1024
const VIDEO_HEAD_BYTES = 4 * 1024 * 1024
const VIDEO_TAIL_BYTES = 16 * 1024 * 1024

async function fetchBoundedRange(url: string, start: number, end: number): Promise<ArrayBuffer> {
  const response = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } })
  if (!response.ok) throw new Error(`range fetch ${response.status}`)
  const declared = Number(response.headers.get('content-length') || 0)
  const expected = Math.max(0, end - start + 1)
  if (declared > expected + 1024) throw new Error('storage ignored bounded range request')
  const buffer = await response.arrayBuffer()
  if (buffer.byteLength > expected + 1024) throw new Error('storage returned an unbounded range')
  return buffer
}

class CaptureTechnicalSkip extends Error {}

export function captureMetadataChunkIndexes(plainSize: number, chunkSize: number, isImage: boolean): number[] {
  const count = Math.max(1, Math.ceil(Math.max(0, plainSize) / Math.max(1, chunkSize)))
  return [...new Set(isImage ? [0] : [0, Math.max(0, count - 2), count - 1])]
}

async function captureScanSegments(
  accessToken: string,
  file: FileRow,
  masterKey: CryptoKey | null,
  isImage: boolean,
): Promise<ArrayBuffer[]> {
  if (file.is_encrypted) {
    if (!masterKey) throw new CaptureTechnicalSkip('unlock recovery key to scan encrypted metadata')
    if ((file.encryption_version ?? 0) !== 1 || !file.wrapped_dek) {
      throw new CaptureTechnicalSkip('legacy whole-file encryption cannot be range-decrypted safely')
    }
    const signed = await apiSignedGet(accessToken, file.id, 'original')
    const nonceRaw = signed.metadata?.fileNonce
    if (typeof nonceRaw !== 'string') throw new CaptureTechnicalSkip('missing chunk nonce metadata')
    const chunkSize = signed.chunkSize || file.encryption_chunk_size || CHUNK_PLAINTEXT_BYTES
    const plainSize = Math.max(0, file.file_size_bytes ?? 0)
    if (!plainSize) throw new CaptureTechnicalSkip('missing plaintext size')
    const wanted = captureMetadataChunkIndexes(plainSize, chunkSize, isImage)
    const rawDek = await unwrapDek(masterKey, file.wrapped_dek)
    const dek = await importDek(rawDek)
    const nonce = base64ToBytes(nonceRaw)
    const decrypted = new Map<number, ArrayBuffer>()
    for (const index of [...new Set(wanted)]) {
      const plainBytes = Math.min(chunkSize, Math.max(0, plainSize - index * chunkSize))
      if (!plainBytes) continue
      const cipherStart = index * (chunkSize + GCM_TAG_BYTES)
      const cipherEnd = cipherStart + plainBytes + GCM_TAG_BYTES - 1
      const cipher = await fetchBoundedRange(signed.url, cipherStart, cipherEnd)
      decrypted.set(index, await decryptChunk(dek, nonce, index, cipher))
    }
    const first = decrypted.get(0)
    if (isImage) return first ? [first] : []
    const tailIndexes = [...decrypted.keys()].filter((index) => index !== 0).sort((a, b) => a - b)
    const tailParts = tailIndexes.map((index) => new Uint8Array(decrypted.get(index)!))
    const tailBytes = tailParts.reduce((total, part) => total + part.byteLength, 0)
    const tail = tailBytes ? new Uint8Array(tailBytes) : null
    let offset = 0
    for (const part of tailParts) {
      tail!.set(part, offset)
      offset += part.byteLength
    }
    return [first, tail?.buffer ?? null].filter((segment): segment is ArrayBuffer => segment != null)
  }
  const signed = await apiSignedGet(accessToken, file.id, 'original')
  const total = Math.max(0, file.file_size_bytes ?? 0)
  if (isImage) {
    const head = await fetchBoundedRange(signed.url, 0, Math.max(0, Math.min(total || IMAGE_SCAN_BYTES, IMAGE_SCAN_BYTES) - 1))
    return [head]
  }
  const headEnd = Math.max(0, Math.min(total || VIDEO_HEAD_BYTES, VIDEO_HEAD_BYTES) - 1)
  const head = await fetchBoundedRange(signed.url, 0, headEnd)
  if (total <= VIDEO_HEAD_BYTES) return [head]
  const tailStart = Math.max(VIDEO_HEAD_BYTES, total - VIDEO_TAIL_BYTES)
  const tail = await fetchBoundedRange(signed.url, tailStart, total - 1)
  return [head, tail]
}

const MAX_HASH_BYTES = 180 * 1024 * 1024

async function blobFromResolved(
  accessToken: string,
  file: Pick<FileRow, 'id' | 'file_url' | 'is_encrypted' | 'mime_type' | 'file_name'>,
  masterKey: CryptoKey | null,
): Promise<Blob> {
  const resolved = await resolveVaultMedia({
    fileId: file.id,
    accessToken,
    variant: 'original',
    masterKey,
    fallbackUrl: file.file_url,
  })
  if (resolved.mode === 'blob') {
    const res = await fetch(resolved.downloadUrl)
    if (!res.ok) throw new Error(`blob fetch ${res.status}`)
    return await res.blob()
  }
  // Prefer direct signed GET for unencrypted
  const signed = await apiSignedGet(accessToken, file.id, 'original')
  const res = await fetch(signed.url)
  if (!res.ok) throw new Error(`signed fetch ${res.status}`)
  return await res.blob()
}

/** Hash one file; updates content_hash / hash_* only. Idempotent if already hashed. */
export async function hashOneExistingFile(opts: {
  userId: string
  accessToken: string
  file: Pick<FileRow, 'id' | 'file_url' | 'is_encrypted' | 'mime_type' | 'file_name' | 'file_size_bytes' | 'content_hash' | 'hash_status'>
  masterKey: CryptoKey | null
}): Promise<'hashed' | 'skipped' | 'failed'> {
  const { userId, accessToken, file, masterKey } = opts
  if (file.content_hash) return 'skipped'
  const size = file.file_size_bytes ?? 0
  if (size > MAX_HASH_BYTES) {
    await supabase
      .from('files')
      .update({ hash_status: 'skipped', hash_algo: null })
      .eq('id', file.id)
      .eq('user_id', userId)
      .is('content_hash', null)
    return 'skipped'
  }
  await supabase.from('files').update({ hash_status: 'pending' }).eq('id', file.id).eq('user_id', userId)
  try {
    const blob = await blobFromResolved(accessToken, file, masterKey)
    if (blob.size <= 0) throw new Error('empty blob')
    if (blob.size > MAX_HASH_BYTES) {
      await supabase.from('files').update({ hash_status: 'skipped' }).eq('id', file.id).eq('user_id', userId)
      return 'skipped'
    }
    const hash = await sha256HexOfFile(blob)
    if (!hash) throw new Error('hash failed')
    const { error } = await supabase
      .from('files')
      .update({ content_hash: hash, hash_algo: 'sha256', hash_status: 'ready' })
      .eq('id', file.id)
      .eq('user_id', userId)
      .is('content_hash', null)
    if (error) throw new Error(error.message)
    return 'hashed'
  } catch (e) {
    await supabase
      .from('files')
      .update({ hash_status: 'failed' })
      .eq('id', file.id)
      .eq('user_id', userId)
      .is('content_hash', null)
    void e
    return 'failed'
  }
}

export async function hashMissingBatch(opts: {
  userId: string
  accessToken: string
  masterKey: CryptoKey | null
  limit?: number
  cursorCreatedAt?: string | null
  cursorId?: string | null
}): Promise<HashBatchResult> {
  const limit = opts.limit ?? 4
  let q = supabase
    .from('files')
    .select('id, file_url, is_encrypted, mime_type, file_name, file_size_bytes, content_hash, hash_status, created_at')
    .eq('user_id', opts.userId)
    .eq('purpose', 'content')
    .is('deleted_at', null)
    .is('content_hash', null)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(limit)
  if (opts.cursorCreatedAt && opts.cursorId) {
    q = q.or(
      `created_at.gt.${opts.cursorCreatedAt},and(created_at.eq.${opts.cursorCreatedAt},id.gt.${opts.cursorId})`,
    )
  }
  const { data, error } = await q
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as (FileRow & { created_at: string })[]
  let hashed = 0
  let skipped = 0
  let failed = 0
  const messages: string[] = []
  for (const row of rows) {
    const r = await hashOneExistingFile({
      userId: opts.userId,
      accessToken: opts.accessToken,
      file: row,
      masterKey: opts.masterKey,
    })
    if (r === 'hashed') hashed += 1
    else if (r === 'failed') {
      failed += 1
      messages.push(`${row.file_name}: hash failed`)
    } else skipped += 1
  }
  const last = rows[rows.length - 1]
  return {
    scanned: rows.length,
    hashed,
    skipped,
    failed,
    done: rows.length < limit,
    nextCursorCreatedAt: last?.created_at ?? null,
    nextCursorId: last?.id ?? null,
    messages,
  }
}

/** Recover captured_at for files where NULL, using embedded metadata only. */
export async function backfillCaptureDatesBatch(opts: {
  userId: string
  accessToken: string
  masterKey: CryptoKey | null
  limit?: number
  cursorCreatedAt?: string | null
  cursorId?: string | null
}): Promise<CaptureBatchResult> {
  const limit = opts.limit ?? 3
  let q = supabase
    .from('files')
    .select('id, file_url, is_encrypted, mime_type, file_name, file_size_bytes, captured_at, captured_at_source, created_at, encryption_version, wrapped_dek, encryption_chunk_size, metadata_json')
    .eq('user_id', opts.userId)
    .eq('purpose', 'content')
    .is('deleted_at', null)
    .is('captured_at', null)
    .is('captured_at_source', null)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(limit)
  if (opts.cursorCreatedAt && opts.cursorId) {
    q = q.or(
      `created_at.gt.${opts.cursorCreatedAt},and(created_at.eq.${opts.cursorCreatedAt},id.gt.${opts.cursorId})`,
    )
  }
  const { data, error } = await q
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as (FileRow & { created_at: string })[]
  let updated = 0
  let skipped = 0
  let unknown = 0
  let technicalSkipped = 0
  let failed = 0
  const messages: string[] = []
  for (const row of rows) {
    try {
      const mime = (row.mime_type || '').toLowerCase()
      const name = (row.file_name || '').toLowerCase()
      const isImage = mime.startsWith('image/') || /\.(jpe?g|png|heic|heif)$/.test(name)
      const isVideo = mime.startsWith('video/') || /\.(mp4|mov|m4v)$/.test(name)
      if (!isImage && !isVideo) {
        skipped += 1
        technicalSkipped += 1
        continue
      }
      const segments = await captureScanSegments(opts.accessToken, row, opts.masterKey, isImage)
      const capture = isImage
        ? extractImageCaptureDateFromBuffer(segments[0] ?? new ArrayBuffer(0))
        : extractVideoCaptureDateFromSegments(segments)
      if (!capture) {
        skipped += 1
        unknown += 1
        continue
      }
      const { error: upErr } = await supabase
        .from('files')
        .update({
          captured_at: capture.capturedAt,
          captured_at_local: capture.capturedLocal,
          captured_at_offset: capture.capturedOffset,
          captured_at_source: capture.source,
        })
        .eq('id', row.id)
        .eq('user_id', opts.userId)
        .is('captured_at', null)
        .is('captured_at_source', null)
      if (upErr) throw new Error(upErr.message)
      updated += 1
    } catch (e) {
      if (e instanceof CaptureTechnicalSkip) {
        skipped += 1
        technicalSkipped += 1
        messages.push(`${row.file_name}: ${e.message}`)
      } else {
        failed += 1
        messages.push(`${row.file_name}: ${e instanceof Error ? e.message : 'capture backfill failed'}`)
      }
    }
  }
  const last = rows[rows.length - 1]
  return {
    scanned: rows.length,
    updated,
    skipped,
    unknown,
    technicalSkipped,
    failed,
    done: rows.length < limit,
    nextCursorCreatedAt: last?.created_at ?? null,
    nextCursorId: last?.id ?? null,
    messages,
  }
}

/**
 * Bounded, resumable media metadata + storage-size verification backfill.
 * Originals are range-read only and never rewritten.
 */
export async function backfillMediaMetadataBatch(opts: {
  userId: string
  accessToken: string
  masterKey: CryptoKey | null
  limit?: number
  cursorCreatedAt?: string | null
  cursorId?: string | null
}): Promise<MediaMetadataBatchResult> {
  const limit = opts.limit ?? 2
  let q = supabase
    .from('files')
    .select('id, file_url, storage_key, stored_size_bytes, storage_integrity, upload_status, is_encrypted, mime_type, file_name, file_size_bytes, width, height, duration_ms, captured_at, captured_at_local, captured_at_source, created_at, encryption_version, wrapped_dek, encryption_chunk_size, metadata_json')
    .eq('user_id', opts.userId)
    .eq('purpose', 'content')
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(limit)
  if (opts.cursorCreatedAt && opts.cursorId) {
    q = q.or(`created_at.gt.${opts.cursorCreatedAt},and(created_at.eq.${opts.cursorCreatedAt},id.gt.${opts.cursorId})`)
  }
  const { data, error } = await q
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as (FileRow & { created_at: string })[]
  let updated = 0
  let technicalUpdated = 0
  let integrityVerified = 0
  let skipped = 0
  let unknown = 0
  let technicalSkipped = 0
  let failed = 0
  const messages: string[] = []
  const authFetch = createAuthFetch(opts.accessToken)
  for (const row of rows) {
    try {
      const mime = (row.mime_type || '').toLowerCase()
      const name = (row.file_name || '').toLowerCase()
      const isImage = mime.startsWith('image/') || /\.(jpe?g|png|heic|heif)$/.test(name)
      const isVideo = mime.startsWith('video/') || /\.(mp4|mov|m4v)$/.test(name)
      if (!isImage && !isVideo) {
        skipped += 1
        technicalSkipped += 1
        continue
      }
      const existingMetadata = row.metadata_json && typeof row.metadata_json === 'object' ? row.metadata_json : {}
      const existingTechnical = existingMetadata.technicalMetadata
      const hasTechnical = existingTechnical && typeof existingTechnical === 'object'
        && Number((existingTechnical as { metadataVersion?: unknown }).metadataVersion) >= TECHNICAL_METADATA_VERSION
      const needsCapture = !row.captured_at && !row.captured_at_local && !row.captured_at_source
      let capture = null
      let technical = null
      if (needsCapture || !hasTechnical || !row.width || !row.height || (isVideo && !row.duration_ms)) {
        try {
          const segments = await captureScanSegments(opts.accessToken, row, opts.masterKey, isImage)
          capture = needsCapture
            ? isImage
              ? extractImageCaptureDateFromBuffer(segments[0] ?? new ArrayBuffer(0))
              : extractVideoCaptureDateFromSegments(segments)
            : null
          technical = !hasTechnical
            ? extractTechnicalMetadataFromSegments(segments, {
                name: row.file_name,
                mime: row.mime_type || 'application/octet-stream',
                size: row.file_size_bytes ?? 0,
                kind: isImage ? 'image' : 'video',
              })
            : existingTechnical
        } catch (metadataError) {
          if (!(metadataError instanceof CaptureTechnicalSkip)) throw metadataError
          skipped += 1
          technicalSkipped += 1
          messages.push(`${row.file_name}: ${metadataError.message}`)
        }
      }

      let integrityEvidence = existingMetadata.integrityEvidence
      const calculatedStoredSize = row.file_size_bytes == null
        ? null
        : !row.is_encrypted
          ? row.file_size_bytes
          : row.encryption_version === 1
            ? storedObjectBytes(row.file_size_bytes, true, row.encryption_chunk_size || CHUNK_PLAINTEXT_BYTES)
            : null
      const expectedStoredSize = row.stored_size_bytes ?? calculatedStoredSize
      if ((!integrityEvidence || typeof integrityEvidence !== 'object') && row.storage_key && expectedStoredSize != null) {
        try {
          const verified = await apiVerifyObject(authFetch, { key: row.storage_key, expectedSize: expectedStoredSize })
          integrityEvidence = {
            method: 'r2_head_size',
            expectedStoredBytes: expectedStoredSize,
            verifiedStoredBytes: verified.contentLength,
            verifiedAt: new Date().toISOString(),
          }
          integrityVerified += 1
        } catch (verifyError) {
          messages.push(`${row.file_name}: ${verifyError instanceof Error ? verifyError.message : 'storage verification failed'}`)
        }
      }

      const patch: Record<string, unknown> = {
        metadata_json: {
          ...existingMetadata,
          sourceSizeBytes: existingMetadata.sourceSizeBytes ?? row.file_size_bytes,
          technicalMetadata: technical ?? existingTechnical ?? null,
          integrityEvidence: integrityEvidence ?? null,
        },
      }
      if (capture) {
        patch.captured_at = capture.capturedAt
        patch.captured_at_local = capture.capturedLocal
        patch.captured_at_offset = capture.capturedOffset
        patch.captured_at_source = capture.source
        updated += 1
      } else if (needsCapture) {
        unknown += 1
      }
      const technicalValue = technical && typeof technical === 'object' ? technical as ReturnType<typeof extractTechnicalMetadataFromSegments> : null
      if (technicalValue) {
        if (!row.width && technicalValue.width) patch.width = technicalValue.width
        if (!row.height && technicalValue.height) patch.height = technicalValue.height
        if (!row.duration_ms && technicalValue.durationMs) patch.duration_ms = technicalValue.durationMs
        if (!hasTechnical) technicalUpdated += 1
      }
      const evidenceExpected = integrityEvidence && typeof integrityEvidence === 'object'
        ? (integrityEvidence as { expectedStoredBytes?: unknown }).expectedStoredBytes
        : null
      const evidenceVerified = integrityEvidence && typeof integrityEvidence === 'object'
        ? (integrityEvidence as { verifiedStoredBytes?: unknown }).verifiedStoredBytes
        : null
      const verifiedEvidence = integrityEvidence && typeof integrityEvidence === 'object'
        && (integrityEvidence as { method?: unknown }).method === 'r2_head_size'
        && typeof evidenceExpected === 'number'
        && Number.isSafeInteger(evidenceExpected)
        && evidenceExpected >= 0
        && evidenceExpected === evidenceVerified
      if (verifiedEvidence) {
        patch.storage_integrity = 'ready'
        if (row.stored_size_bytes == null && expectedStoredSize != null) patch.stored_size_bytes = expectedStoredSize
      }
      const { error: updateError } = await supabase.from('files').update(patch).eq('id', row.id).eq('user_id', opts.userId)
      if (updateError) throw new Error(updateError.message)
      if (!capture && hasTechnical && integrityEvidence) skipped += 1
    } catch (e) {
      if (e instanceof CaptureTechnicalSkip) {
        skipped += 1
        technicalSkipped += 1
        messages.push(`${row.file_name}: ${e.message}`)
      } else {
        failed += 1
        messages.push(`${row.file_name}: ${e instanceof Error ? e.message : 'media metadata backfill failed'}`)
      }
    }
  }
  const last = rows[rows.length - 1]
  return {
    scanned: rows.length,
    updated,
    technicalUpdated,
    integrityVerified,
    skipped,
    unknown,
    technicalSkipped,
    failed,
    done: rows.length < limit,
    nextCursorCreatedAt: last?.created_at ?? null,
    nextCursorId: last?.id ?? null,
    messages,
  }
}

/** @deprecated use hashMissingBatch — kept for Settings button compatibility */
export async function markMissingHashesPending(userId: string, offset = 0, limit = 40) {
  const { data, error } = await supabase
    .from('files')
    .select('id, content_hash, hash_status')
    .eq('user_id', userId)
    .eq('purpose', 'content')
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .range(offset, offset + limit - 1)
  if (error) throw new Error(error.message)
  const rows = data ?? []
  let markedPending = 0
  let skipped = 0
  for (const row of rows) {
    if (row.content_hash || row.hash_status === 'pending' || row.hash_status === 'ready') {
      skipped += 1
      continue
    }
    const { error: upErr } = await supabase
      .from('files')
      .update({ hash_status: 'pending' })
      .eq('id', row.id)
      .eq('user_id', userId)
      .is('content_hash', null)
    if (!upErr) markedPending += 1
    else skipped += 1
  }
  return {
    scanned: rows.length,
    markedPending,
    skipped,
    done: rows.length < limit,
    nextOffset: offset + rows.length,
  }
}
