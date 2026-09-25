/**
 * Persist / reuse media analysis. Additive only — never overwrites media objects.
 */
import { supabase } from '../supabase'
import type { Database } from '../../types/database'

export type MediaAnalysisRow = Database['public']['Tables']['media_analysis']['Row']
export type MediaAnalysisInsert = Database['public']['Tables']['media_analysis']['Insert']

export const ANALYSIS_VERSION = '1'

export async function getCachedAnalysis(
  userId: string,
  fileId: string,
  opts?: { provider?: string; version?: string },
): Promise<MediaAnalysisRow | null> {
  const version = opts?.version ?? ANALYSIS_VERSION
  let q = supabase
    .from('media_analysis')
    .select('*')
    .eq('user_id', userId)
    .eq('file_id', fileId)
    .eq('analysis_version', version)
    .eq('status', 'ready')
    .order('updated_at', { ascending: false })
    .limit(1)
  if (opts?.provider) q = q.eq('provider', opts.provider)
  const { data, error } = await q.maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

export async function upsertAnalysis(row: MediaAnalysisInsert): Promise<MediaAnalysisRow> {
  const { data, error } = await supabase
    .from('media_analysis')
    .upsert(
      {
        ...row,
        analysis_version: row.analysis_version ?? ANALYSIS_VERSION,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'file_id,analysis_version,provider' },
    )
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data
}

/** Mark pending without calling a vision provider — used when analysis is requested but key missing. */
export async function markAnalysisPending(
  userId: string,
  fileId: string,
  reason: string,
): Promise<void> {
  await upsertAnalysis({
    user_id: userId,
    file_id: fileId,
    provider: 'none',
    model: null,
    status: 'skipped',
    error: reason,
    attributes_json: {},
    sample_info_json: {},
  })
}
