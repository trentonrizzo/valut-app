import { supabase } from './supabase'
import { isV2SchemaReady } from './schemaGuard'
import type { FileRow } from '../types/media'

async function requireV2() {
  if (!(await isV2SchemaReady())) {
    throw new Error('Recently Deleted needs the V2 database migration. Apply supabase/migrations/20260921190000_v2_trash_locks_tags_editor.sql in Supabase, then reload.')
  }
}

export async function softDeleteFiles(userId: string, fileIds: string[]) {
  await requireV2()
  if (fileIds.length === 0) return
  const { data: memberships, error: mErr } = await supabase
    .from('album_files')
    .select('album_id, file_id')
    .eq('user_id', userId)
    .in('file_id', fileIds)
  if (mErr) throw new Error(mErr.message)

  const byFile = new Map<string, string[]>()
  for (const row of memberships ?? []) {
    const list = byFile.get(row.file_id) ?? []
    list.push(row.album_id)
    byFile.set(row.file_id, list)
  }

  for (const fileId of fileIds) {
    const snapshot = byFile.get(fileId) ?? []
    const { error } = await supabase
      .from('files')
      .update({ deleted_at: new Date().toISOString(), membership_snapshot: snapshot })
      .eq('user_id', userId)
      .eq('id', fileId)
    if (error) throw new Error(error.message)
  }

  const { error: delMem } = await supabase.from('album_files').delete().eq('user_id', userId).in('file_id', fileIds)
  if (delMem) throw new Error(delMem.message)
}

export async function restoreFiles(userId: string, fileIds: string[]) {
  await requireV2()
  if (fileIds.length === 0) return
  const { data, error } = await supabase
    .from('files')
    .select('id, membership_snapshot')
    .eq('user_id', userId)
    .in('id', fileIds)
  if (error) throw new Error(error.message)

  for (const row of data ?? []) {
    const albums = Array.isArray(row.membership_snapshot)
      ? (row.membership_snapshot as unknown[]).filter((x): x is string => typeof x === 'string')
      : []
    if (albums.length > 0) {
      const mem = albums.map((album_id) => ({ user_id: userId, album_id, file_id: row.id }))
      const { error: up } = await supabase.from('album_files').upsert(mem, { onConflict: 'album_id,file_id' })
      if (up) throw new Error(up.message)
    }
    const { error: clr } = await supabase
      .from('files')
      .update({ deleted_at: null, membership_snapshot: [] })
      .eq('user_id', userId)
      .eq('id', row.id)
    if (clr) throw new Error(clr.message)
  }
}

export async function listDeletedFiles(userId: string): Promise<FileRow[]> {
  await requireV2()
  const { data, error } = await supabase
    .from('files')
    .select('*')
    .eq('user_id', userId)
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data as FileRow[]) ?? []
}

export async function permanentDeleteFiles(accessToken: string, fileIds: string[]) {
  const results: { fileId: string; ok: boolean; error?: string }[] = []
  for (const fileId of fileIds) {
    const res = await fetch('/api/delete', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'permanent', fileId }),
    })
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
    results.push({ fileId, ok: Boolean(res.ok && body.ok), error: body.error })
    if (!res.ok || !body.ok) {
      throw new Error(body.error || `Permanent delete failed for ${fileId}`)
    }
  }
  return results
}

export async function emptyRecentlyDeleted(accessToken: string) {
  const res = await fetch('/api/delete', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'empty-trash' }),
  })
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; deleted?: number }
  if (!res.ok || !body.ok) throw new Error(body.error || 'Empty Recently Deleted failed')
  return body
}
