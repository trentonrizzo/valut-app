import { supabase } from './supabase'

let cached: boolean | null = null
let cachedV2: boolean | null = null
let cachedOrg: boolean | null = null

/** True only after additive V1.1 columns exist (e.g. files.storage_key). */
export async function isV11SchemaReady(): Promise<boolean> {
  if (cached !== null) return cached
  const { error } = await supabase.from('files').select('storage_key').limit(1)
  cached = !error
  return cached
}

/** True after V2 columns exist (files.deleted_at). */
export async function isV2SchemaReady(): Promise<boolean> {
  if (cachedV2 !== null) return cachedV2
  const { error } = await supabase.from('files').select('deleted_at').limit(1)
  cachedV2 = !error
  return cachedV2
}

/** True after intelligent-org additive tables/columns exist (ai_jobs / parent_album_id). */
export async function isIntelligentOrgReady(): Promise<boolean> {
  if (cachedOrg !== null) return cachedOrg
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).from('ai_jobs').select('id').limit(1)
  cachedOrg = !error
  return cachedOrg
}

export function resetSchemaGuardCache(): void {
  cached = null
  cachedV2 = null
  cachedOrg = null
}
