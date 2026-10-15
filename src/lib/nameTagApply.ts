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

export type NameBackfillCursor = { phase: 'files' | 'links'; offset: number; done: boolean }

export const GROUP_INDEX_KEY = 'vault-group-index-v2'

export function resetGroupIndex(userId: string) {
  localStorage.removeItem(`${GROUP_INDEX_KEY}:${userId}`)
}

const FILE_COLUMNS = [
  'id, file_name, original_filename, source_url, description, created_at, purpose, mime_type',
  'id, file_name, original_filename, source_url, created_at, purpose, mime_type',
  'id, file_name, created_at, purpose, mime_type',
]

export async function backfillNameTagsBatch(
  userId: string,
  cursor: NameBackfillCursor,
  limit = 80,
): Promise<{ scanned: number; tagged: number; names: number; cursor: NameBackfillCursor }> {
  if (cursor.phase === 'links') return backfillLinksBatch(userId, cursor, limit)
  let lastError = 'Could not read filenames'
  for (const columns of FILE_COLUMNS) {
    const { data, error } = await supabase
      .from('files')
      .select(columns)
      .eq('user_id', userId)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(cursor.offset, cursor.offset + limit - 1)
    if (error) {
      lastError = error.message
      if (/column|schema cache|does not exist/i.test(error.message)) continue
      throw new Error(error.message)
    }
    const rows = (data ?? []) as unknown as {
      id: string
      file_name?: string | null
      original_filename?: string | null
      source_url?: string | null
      description?: string | null
      purpose?: string | null
    }[]
    const tagged = await tagRows(userId, rows.map((row) => ({
      id: row.id,
      skip: row.purpose === 'cover',
      sources: {
        filename: row.original_filename,
        alternateFilename: row.file_name,
        title: row.description,
        sourceUrl: row.source_url,
      },
      table: 'files' as const,
    })))
    const doneFiles = rows.length < limit
    return {
      scanned: rows.length,
      tagged: tagged.linked,
      names: tagged.names,
      cursor: doneFiles
        ? { phase: 'links', offset: 0, done: false }
        : { phase: 'files', offset: cursor.offset + rows.length, done: false },
    }
  }
  throw new Error(lastError)
}

async function backfillLinksBatch(userId: string, cursor: NameBackfillCursor, limit: number) {
  const { data, error } = await supabase
    .from('vault_links')
    .select('id, title, automatic_title, url')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .range(cursor.offset, cursor.offset + limit - 1)
  if (error) {
    if (/relation|does not exist|schema cache/i.test(error.message)) {
      return { scanned: 0, tagged: 0, names: 0, cursor: { phase: 'links' as const, offset: cursor.offset, done: true } }
    }
    throw new Error(error.message)
  }
  const rows = data ?? []
  const tagged = await tagRows(userId, rows.map((row) => ({
    id: row.id,
    skip: false,
    sources: {
      title: row.title || row.automatic_title,
      filename: row.title || row.automatic_title,
      sourceUrl: row.url,
    },
    table: 'links' as const,
  })))
  return {
    scanned: rows.length,
    tagged: tagged.linked,
    names: tagged.names,
    cursor: {
      phase: 'links' as const,
      offset: cursor.offset + rows.length,
      done: rows.length < limit,
    },
  }
}

async function tagRows(
  userId: string,
  rows: { id: string; skip: boolean; sources: NameSources; table: 'files' | 'links' }[],
) {
  const names = new Map<string, { files: string[]; links: string[] }>()
  const sites = new Map<string, { files: string[]; links: string[] }>()
  for (const row of rows) {
    if (row.skip) continue
    const bucket = row.table === 'files' ? 'files' : 'links'
    const name = detectPersonName(row.sources)
    if (name) {
      const group = names.get(name) ?? { files: [], links: [] }
      group[bucket].push(row.id)
      names.set(name, group)
    }
    const source = detectSourceSite(row.sources)
    if (source) {
      const group = sites.get(source) ?? { files: [], links: [] }
      group[bucket].push(row.id)
      sites.set(source, group)
    }
  }
  let linked = 0
  for (const [label, group] of [...names, ...sites]) {
    const kind = names.has(label) ? 'name' : 'source'
    const tag = await createTaggedLabel(userId, label, kind)
    if (group.files.length) linked += await addTagsToFiles(userId, group.files, [tag.id])
    if (group.links.length) {
      const rows = group.links.map((link_id) => ({ user_id: userId, link_id, tag_id: tag.id }))
      const { error } = await supabase.from('link_tags').upsert(rows, { onConflict: 'link_id,tag_id', ignoreDuplicates: true })
      if (error && !/relation|does not exist|schema cache/i.test(error.message)) throw new Error(error.message)
      if (!error) linked += rows.length
    }
  }
  return { linked, names: names.size }
}
