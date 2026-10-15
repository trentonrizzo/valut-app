import { supabase } from './supabase'
import { addTagsToFiles, normalizeTagName } from './tags'
import { detectPersonName, detectSourceSite, type NameSources } from './nameTag'

export async function applyDetectedNameTag(userId: string, fileId: string, sources: NameSources): Promise<string | null> {
  const name = detectPersonName(sources)
  const source = detectSourceSite(sources)
  if (name) {
    const tag = await createTaggedLabel(userId, name, 'name')
    await addTagsToFiles(userId, [fileId], [tag.id])
  }
  if (source) {
    const tag = await createTaggedLabel(userId, source, 'source')
    await addTagsToFiles(userId, [fileId], [tag.id])
  }
  return name
}

export async function createNameTag(userId: string, rawName: string) {
  return createTaggedLabel(userId, rawName, 'name')
}

export async function createTaggedLabel(userId: string, rawName: string, kind: 'name' | 'source') {
  const { name, name_normalized } = normalizeTagName(rawName)
  const existing = await supabase
    .from('tags')
    .select('*')
    .eq('user_id', userId)
    .eq('name_normalized', name_normalized)
    .maybeSingle()
  if (existing.error && !/schema cache|column/i.test(existing.error.message)) {
    throw new Error(existing.error.message)
  }
  if (existing.data) {
    const current = existing.data.kind
    const nextKind = kind === 'name' || !current ? kind : current
    if (current !== nextKind || existing.data.name !== name) {
      const updated = await supabase.from('tags').update({ name, kind: nextKind }).eq('id', existing.data.id).eq('user_id', userId)
      if (updated.error && /kind|schema cache|column/i.test(updated.error.message)) {
        const nameOnly = await supabase.from('tags').update({ name }).eq('id', existing.data.id).eq('user_id', userId)
        if (nameOnly.error) throw new Error(nameOnly.error.message)
      } else if (updated.error) {
        throw new Error(updated.error.message)
      }
    }
    return { ...existing.data, name, kind: nextKind }
  }
  const withKind = await supabase
    .from('tags')
    .insert({ user_id: userId, name, name_normalized, kind })
    .select()
    .single()
  if (!withKind.error && withKind.data) return withKind.data
  if (withKind.error && !/kind|schema cache|column/i.test(withKind.error.message)) {
    throw new Error(withKind.error.message)
  }
  const plain = await supabase
    .from('tags')
    .insert({ user_id: userId, name, name_normalized })
    .select()
    .single()
  if (plain.error || !plain.data) throw new Error(plain.error?.message || 'Could not save tag')
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
  const sourcesBySite = new Map<string, string[]>()
  for (const row of rows) {
    if (row.purpose === 'cover') continue
    const sources = {
      filename: row.original_filename,
      alternateFilename: row.file_name,
      title: row.description,
      sourceUrl: row.source_url,
    }
    const name = detectPersonName(sources)
    if (name) {
      const list = groups.get(name) ?? []
      list.push(row.id)
      groups.set(name, list)
    }
    const source = detectSourceSite(sources)
    if (source) {
      const list = sourcesBySite.get(source) ?? []
      list.push(row.id)
      sourcesBySite.set(source, list)
    }
  }
  let tagged = 0
  for (const [name, fileIds] of groups) {
    const tag = await createTaggedLabel(userId, name, 'name')
    tagged += await addTagsToFiles(userId, fileIds, [tag.id])
  }
  for (const [source, fileIds] of sourcesBySite) {
    const tag = await createTaggedLabel(userId, source, 'source')
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
