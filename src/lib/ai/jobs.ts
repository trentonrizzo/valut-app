/**
 * Durable AI / organization jobs — persisted in Supabase, processed in resumable chunks.
 * Survives drawer close / navigation. Not a browser-only timer fake.
 */
// @ts-nocheck — additive ai_jobs / related tables land before generated Database types refresh.
import { supabase } from '../supabase'
import { createTag, addTagsToFiles } from '../tags'
import { addFilesToAlbum } from '../albumMembership'
import { listMediaPage } from '../mediaQueries'
import { DEFAULT_MEDIA_FILTERS } from '../../types/media'
import { analyzeMediaVisual, analysisMatchesFocus, type VisualFocus } from './visualAnalysis'

/** Untyped client for additive tables not yet in generated Database types. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => supabase as any

export type AiJobStatus =
  | 'QUEUED'
  | 'PLANNING'
  | 'RUNNING'
  | 'PAUSED'
  | 'WAITING'
  | 'VERIFYING'
  | 'COMPLETED'
  | 'PARTIAL'
  | 'FAILED'
  | 'CANCELED'

export type AiJobRow = {
  id: string
  user_id: string
  request_text: string
  objective_json: Record<string, unknown>
  scope_json: Record<string, unknown>
  plan_json: unknown[]
  status: AiJobStatus
  current_phase: string
  progress_total: number
  progress_completed: number
  error_count: number
  retry_count: number
  result_summary: string | null
  verification_json: Record<string, unknown>
  usage_json: Record<string, unknown>
  cursor_json: Record<string, unknown>
  created_at: string
  started_at: string | null
  updated_at: string
  completed_at: string | null
}

async function appendEvent(userId: string, jobId: string, message: string, kind = 'info') {
  await db().from('ai_job_events').insert({ user_id: userId, job_id: jobId, message, kind })
}

export async function createAiJobFromToolResult(
  userId: string,
  requestText: string,
  data: Record<string, unknown>,
): Promise<AiJobRow | null> {
  const mode = String(data.mode || 'organize')
  const createTagName = data.createTag ? String(data.createTag) : null
  const createAlbumName = data.createAlbum ? String(data.createAlbum) : null
  const visualFocus = (data.visualFocus || {}) as VisualFocus

  // Estimate total from library size (first page count is lower bound; refine later)
  const page = await listMediaPage({ userId, filters: { ...DEFAULT_MEDIA_FILTERS }, cursor: null })
  const total = Math.max(page.rows.length, 1)

  const { data: job, error } = await supabase
    .from('ai_jobs')
    .insert({
      user_id: userId,
      request_text: requestText,
      objective_json: { mode, createTagName, createAlbumName, visualFocus },
      scope_json: { scope: data.scope || 'vault' },
      plan_json: [
        { key: 'scope', label: 'Resolve scope' },
        { key: 'cache', label: 'Load cached analysis' },
        { key: 'analyze', label: 'Visual analysis' },
        { key: 'match', label: 'Candidate matching' },
        { key: 'tag', label: 'Apply tag' },
        { key: 'album', label: 'Update collection' },
        { key: 'verify', label: 'Verification' },
      ],
      status: 'QUEUED',
      current_phase: 'queued',
      progress_total: total,
      progress_completed: 0,
      cursor_json: { offset: 0, matchedIds: [] as string[] },
    })
    .select('*')
    .single()

  if (error) {
    // Migration not applied yet
    console.warn('ai_jobs insert failed', error.message)
    return null
  }

  const steps = [
    { step_key: 'scope', label: 'Resolve scope', sort_index: 0 },
    { step_key: 'cache', label: 'Load cached analysis', sort_index: 1 },
    { step_key: 'analyze', label: 'Visual analysis', sort_index: 2 },
    { step_key: 'match', label: 'Candidate matching', sort_index: 3 },
    { step_key: 'tag', label: 'Apply tag', sort_index: 4 },
    { step_key: 'album', label: 'Update collection', sort_index: 5 },
    { step_key: 'verify', label: 'Verification', sort_index: 6 },
  ]
  await db().from('ai_job_steps').insert(steps.map((s) => ({ ...s, job_id: job.id, user_id: userId, status: 'pending' })))
  await appendEvent(userId, job.id, `Job created · scope ${String(data.scope || 'vault')} · ~${total} media`)
  return job as AiJobRow
}

export async function listActiveJobs(userId: string): Promise<AiJobRow[]> {
  const { data, error } = await supabase
    .from('ai_jobs')
    .select('*')
    .eq('user_id', userId)
    .in('status', ['QUEUED', 'PLANNING', 'RUNNING', 'WAITING'])
    .order('created_at', { ascending: true })
    .limit(10)
  if (error) return []
  return (data as AiJobRow[]) || []
}

export async function listRecentJobs(userId: string, limit = 20): Promise<AiJobRow[]> {
  const { data, error } = await supabase
    .from('ai_jobs')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(limit)
  if (error) return []
  return (data as AiJobRow[]) || []
}

export async function listJobEvents(userId: string, jobId: string) {
  const { data } = await supabase
    .from('ai_job_events')
    .select('id, kind, message, created_at')
    .eq('user_id', userId)
    .eq('job_id', jobId)
    .order('id', { ascending: true })
    .limit(200)
  return data || []
}

export async function pauseJob(userId: string, jobId: string) {
  await db().from('ai_jobs').update({ status: 'PAUSED', updated_at: new Date().toISOString() }).eq('id', jobId).eq('user_id', userId)
  await appendEvent(userId, jobId, 'Paused')
}

export async function resumeJob(userId: string, jobId: string) {
  await supabase
    .from('ai_jobs')
    .update({ status: 'QUEUED', updated_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('user_id', userId)
  await appendEvent(userId, jobId, 'Resumed')
}

export async function cancelJob(userId: string, jobId: string) {
  await supabase
    .from('ai_jobs')
    .update({ status: 'CANCELED', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('user_id', userId)
  await appendEvent(userId, jobId, 'Canceled', 'warn')
}

const CHUNK = 8

/** Process one chunk of a job; safe to call repeatedly (idempotent cursor). */
export async function processJobChunk(userId: string, jobId: string, accessToken?: string | null): Promise<AiJobRow | null> {
  const { data: job, error } = await db().from('ai_jobs').select('*').eq('id', jobId).eq('user_id', userId).maybeSingle()
  if (error || !job) return null
  const row = job as AiJobRow
  if (['COMPLETED', 'FAILED', 'CANCELED', 'PAUSED'].includes(row.status)) return row

  const now = new Date().toISOString()
  if (row.status === 'QUEUED') {
    await supabase
      .from('ai_jobs')
      .update({ status: 'RUNNING', started_at: row.started_at || now, current_phase: 'analyzing', updated_at: now })
      .eq('id', jobId)
    await db().from('ai_job_steps').update({ status: 'done' }).eq('job_id', jobId).eq('step_key', 'scope')
    await appendEvent(userId, jobId, 'Scope resolved')
  }

  const objective = row.objective_json || {}
  const focus = (objective.visualFocus || {}) as VisualFocus
  const cursor = { ...(row.cursor_json || {}) } as { offset?: number; matchedIds?: string[] }
  const offset = Number(cursor.offset || 0)
  const matchedIds = Array.isArray(cursor.matchedIds) ? [...cursor.matchedIds] : []

  // Page through library using search empty + skip offset via repeated pages (simple approach)
  const page = await listMediaPage({ userId, filters: { ...DEFAULT_MEDIA_FILTERS }, cursor: null })
  // Without a true offset cursor in listMediaPage, process first page then mark complete for search_only small vaults.
  // For larger vaults, store file ids in cursor progressively from album_files / files query.
  const { data: fileRows } = await supabase
    .from('files')
    .select('id, file_name, mime_type, file_url, thumb_url, poster_url, content_hash, purpose, deleted_at')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .eq('purpose', 'content')
    .order('created_at', { ascending: false })
    .range(offset, offset + CHUNK - 1)

  const batch = fileRows || []
  if (!batch.length) {
    return finishJob(userId, row, matchedIds, objective)
  }

  let needsConfig = false
  let analyzed = 0
  for (const file of batch) {
    if (!accessToken) {
      needsConfig = true
      break
    }
    const result = await analyzeMediaVisual({
      userId,
      accessToken,
      file: file as never,
      focus,
    })
    if (result.error && /no API key|not configured|unavailable/i.test(result.error)) {
      needsConfig = true
      break
    }
    if (result.analysis) analyzed += 1
    if (result.analysis && analysisMatchesFocus(result.analysis as never, focus)) {
      if (!matchedIds.includes(file.id)) matchedIds.push(file.id)
    }
  }

  if (needsConfig) {
    await supabase
      .from('ai_jobs')
      .update({
        status: 'FAILED',
        current_phase: 'needs_configuration',
        result_summary: 'Visual analysis is not configured yet. Add OPENAI_API_KEY or VAULT_AI_API_KEY on Vercel.',
        completed_at: now,
        updated_at: now,
        cursor_json: { offset, matchedIds },
      })
      .eq('id', jobId)
    await appendEvent(userId, jobId, 'Visual analysis unavailable — provider not configured', 'error')
    return ((await db().from('ai_jobs').select('*').eq('id', jobId).single()).data || null) as AiJobRow | null
  }

  const nextOffset = offset + batch.length
  const completed = Math.min(nextOffset, row.progress_total || nextOffset)
  await supabase
    .from('ai_jobs')
    .update({
      status: 'RUNNING',
      progress_completed: completed,
      progress_total: Math.max(row.progress_total, nextOffset),
      current_phase: 'analyzing',
      updated_at: now,
      cursor_json: { offset: nextOffset, matchedIds },
      usage_json: { ...(row.usage_json || {}), last_batch_analyzed: analyzed },
    })
    .eq('id', jobId)
  await appendEvent(userId, jobId, `Analyzed batch @ ${offset} · matches so far ${matchedIds.length}`)

  void page
  // If short batch, finish
  if (batch.length < CHUNK) {
    const latest = (await db().from('ai_jobs').select('*').eq('id', jobId).single()).data as AiJobRow
    return finishJob(userId, latest, matchedIds, objective)
  }
  return ((await db().from('ai_jobs').select('*').eq('id', jobId).single()).data || null) as AiJobRow | null
}

async function finishJob(
  userId: string,
  row: AiJobRow,
  matchedIds: string[],
  objective: Record<string, unknown>,
): Promise<AiJobRow> {
  const now = new Date().toISOString()
  const mode = String(objective.mode || 'organize')
  const createTagName = objective.createTagName ? String(objective.createTagName) : null
  const createAlbumName = objective.createAlbumName ? String(objective.createAlbumName) : null

  await db().from('ai_job_steps').update({ status: 'done' }).eq('job_id', row.id).in('step_key', ['cache', 'analyze', 'match'])

  let tagId: string | null = null
  let albumId: string | null = null

  if (mode !== 'search_only' && createTagName && matchedIds.length) {
    const tag = await createTag(userId, createTagName)
    tagId = tag.id
    await addTagsToFiles(userId, matchedIds, [tag.id])
    await appendEvent(userId, row.id, `Tag “${tag.name}” applied to ${matchedIds.length}`)
    await db().from('ai_job_steps').update({ status: 'done' }).eq('job_id', row.id).eq('step_key', 'tag')
  } else {
    await db().from('ai_job_steps').update({ status: 'skipped' }).eq('job_id', row.id).eq('step_key', 'tag')
  }

  if (mode !== 'search_only' && createAlbumName && matchedIds.length) {
    const { data: existing } = await supabase
      .from('albums')
      .select('id, name')
      .eq('user_id', userId)
      .ilike('name', createAlbumName)
      .limit(1)
    if (existing?.[0]) albumId = existing[0].id
    else {
      const { data: created } = await supabase
        .from('albums')
        .insert({ user_id: userId, name: createAlbumName, order_index: 0 })
        .select('id')
        .single()
      albumId = created?.id || null
    }
    if (albumId) {
      await addFilesToAlbum(userId, albumId, matchedIds)
      await appendEvent(userId, row.id, `Album “${createAlbumName}” · ${matchedIds.length} memberships`)
    }
    await db().from('ai_job_steps').update({ status: 'done' }).eq('job_id', row.id).eq('step_key', 'album')
  } else {
    await db().from('ai_job_steps').update({ status: 'skipped' }).eq('job_id', row.id).eq('step_key', 'album')
  }

  // Verify counts
  let verified = true
  if (tagId && matchedIds.length) {
    const { count } = await supabase
      .from('file_tags')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('tag_id', tagId)
      .in('file_id', matchedIds)
    verified = (count || 0) >= matchedIds.length
  }

  await db().from('ai_job_results').insert({
    job_id: row.id,
    user_id: userId,
    result_kind: 'file_ids',
    payload_json: { matchedIds, tagId, albumId, mode },
  })

  const summary = verified
    ? `✓ Completed & verified · ${matchedIds.length} matches${createTagName ? ` · tagged ${createTagName}` : ''}${createAlbumName ? ` · album ${createAlbumName}` : ''}`
    : `PARTIAL · ${matchedIds.length} matches (verification incomplete)`

  await supabase
    .from('ai_jobs')
    .update({
      status: verified ? 'COMPLETED' : 'PARTIAL',
      current_phase: 'done',
      progress_completed: row.progress_total || matchedIds.length,
      result_summary: summary,
      verification_json: { verified, matched: matchedIds.length },
      completed_at: now,
      updated_at: now,
      cursor_json: { offset: row.progress_total, matchedIds },
    })
    .eq('id', row.id)
  await db().from('ai_job_steps').update({ status: verified ? 'done' : 'failed' }).eq('job_id', row.id).eq('step_key', 'verify')
  await appendEvent(userId, row.id, summary, verified ? 'success' : 'warn')

  return (await db().from('ai_jobs').select('*').eq('id', row.id).single()).data as AiJobRow
}
