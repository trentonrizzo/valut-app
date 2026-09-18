import { supabase } from './supabase'

let cached: boolean | null = null

/** True only after additive V1.1 columns exist (e.g. files.storage_key). */
export async function isV11SchemaReady(): Promise<boolean> {
  if (cached !== null) return cached
  const { error } = await supabase.from('files').select('storage_key').limit(1)
  cached = !error
  return cached
}

export function resetSchemaGuardCache(): void {
  cached = null
}
