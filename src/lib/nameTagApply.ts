import { supabase } from './supabase'
import { addTagsToFiles, normalizeTagName } from './tags'
import { detectPersonName, type NameSources } from './nameTag'

export async function applyDetectedNameTag(userId: string, fileId: string, sources: NameSources): Promise<string | null> {
  const name = detectPersonName(sources)
  if (!name) return null
  const tag = await createNameTag(userId, name)
  await addTagsToFiles(userId, [fileId], [tag.id])
  return name
}

export async function createNameTag(userId: string, rawName: string) {
  const { name, name_normalized } = normalizeTagName(rawName)
  const withKind = await supabase
    .from('tags')
    .upsert({ user_id: userId, name, name_normalized, kind: 'name' }, { onConflict: 'user_id,name_normalized' })
    .select()
    .single()
  if (!withKind.error && withKind.data) return withKind.data
  if (withKind.error && !/kind|schema cache|column/i.test(withKind.error.message)) {
    throw new Error(withKind.error.message)
  }
  const plain = await supabase
    .from('tags')
    .upsert({ user_id: userId, name, name_normalized }, { onConflict: 'user_id,name_normalized' })
    .select()
    .single()
  if (plain.error || !plain.data) throw new Error(plain.error?.message || 'Could not save name tag')
  return plain.data
}

export type NameBackfillCursor = { createdAt: string | null; id: string | null; done: boolean }

export async function backfillNameTagsBatch(
  userId: string,
  cursor: NameBackfillCursor,
  limit = 80,
): Promise<{ scanned: number; tagged: number; names: number; cursor: NameBackfillCursor }> {
  let query = supabase
    .from('files')
    .select('id, file_name, original_filename, source_url, description, created_at, purpose')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(limit)
  if (cursor.createdAt && cursor.id) {
    query = query.or(`created_at.gt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.gt.${cursor.id})`)
  }
  const { data, error } = await query
  if (error) throw new Error(error.message)
  const rows = data ?? []
  const groups = new Map<string, string[]>()
  for (const row of rows) {
    if (row.purpose === 'cover') continue
    const name = detectPersonName({
      filename: row.original_filename,
      alternateFilename: row.file_name,
      title: row.description,
      sourceUrl: row.source_url,
    })
    if (!name) continue
    const list = groups.get(name) ?? []
    list.push(row.id)
    groups.set(name, list)
  }
  let tagged = 0
  for (const [name, fileIds] of groups) {
    const tag = await createNameTag(userId, name)
    tagged += await addTagsToFiles(userId, fileIds, [tag.id])
  }
  const last = rows[rows.length - 1]
  return {
    scanned: rows.length,
    tagged,
    names: groups.size,
    cursor: {
      createdAt: last?.created_at ?? cursor.createdAt,
      id: last?.id ?? cursor.id,
      done: rows.length < limit,
    },
  }
}
