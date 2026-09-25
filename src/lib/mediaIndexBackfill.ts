/**
 * Progressive library indexing: content hash + capture-date backfill.
 * Never modifies storage objects — only metadata columns on files rows.
 */
import { supabase } from './supabase'
import { apiSignedGet } from './upload/storageApi'
import { sha256HexOfFile } from './upload/contentHash'
import { extractJpegCaptureDate } from './upload/exifCaptureDate'
import { extractVideoCaptureDate } from './upload/videoCaptureDate'
import { resolveVaultMedia } from './media/resolveMedia'
import type { FileRow } from '../types/media'

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
  failed: number
  done: boolean
  nextCursorCreatedAt: string | null
  nextCursorId: string | null
  messages: string[]
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
    .select('id, file_url, is_encrypted, mime_type, file_name, file_size_bytes, captured_at, created_at')
    .eq('user_id', opts.userId)
    .eq('purpose', 'content')
    .is('deleted_at', null)
    .is('captured_at', null)
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
        continue
      }
      // Cap download for capture-date scan
      if ((row.file_size_bytes ?? 0) > 400 * 1024 * 1024) {
        skipped += 1
        continue
      }
      const blob = await blobFromResolved(opts.accessToken, row, opts.masterKey)
      let captured: string | null = null
      if (isImage) {
        captured = await extractJpegCaptureDate(new File([blob], row.file_name || 'image.jpg', { type: mime || 'image/jpeg' }))
      } else {
        captured = await extractVideoCaptureDate(blob)
      }
      if (!captured) {
        skipped += 1
        continue
      }
      const { error: upErr } = await supabase
        .from('files')
        .update({ captured_at: captured })
        .eq('id', row.id)
        .eq('user_id', opts.userId)
        .is('captured_at', null)
      if (upErr) throw new Error(upErr.message)
      updated += 1
    } catch (e) {
      failed += 1
      messages.push(`${row.file_name}: ${e instanceof Error ? e.message : 'capture backfill failed'}`)
    }
  }
  const last = rows[rows.length - 1]
  return {
    scanned: rows.length,
    updated,
    skipped,
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
