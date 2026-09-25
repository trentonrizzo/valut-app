import { supabase } from './supabase'

export type PersonGroup = {
  id: string
  user_id: string
  label: string
  sort_index: number
  created_at: string
  updated_at: string
}

/** Ensure Person 1..N exist for user (additive). Does not claim identities. */
export async function ensureNeutralPersonGroups(userId: string, count: number): Promise<PersonGroup[]> {
  const n = Math.max(0, Math.min(24, Math.floor(count)))
  const { data: existing, error } = await supabase
    .from('person_groups')
    .select('*')
    .eq('user_id', userId)
    .order('sort_index', { ascending: true })
  if (error) throw new Error(error.message)
  const rows = (existing as PersonGroup[]) ?? []
  const out = [...rows]
  for (let i = rows.length; i < n; i += 1) {
    const label = `Person ${i + 1}`
    const { data, error: insErr } = await supabase
      .from('person_groups')
      .insert({ user_id: userId, label, sort_index: i })
      .select()
      .single()
    if (insErr) throw new Error(insErr.message)
    out.push(data as PersonGroup)
  }
  return out.slice(0, Math.max(n, rows.length))
}

export async function listPersonGroups(userId: string): Promise<PersonGroup[]> {
  const { data, error } = await supabase
    .from('person_groups')
    .select('*')
    .eq('user_id', userId)
    .order('sort_index', { ascending: true })
  if (error) throw new Error(error.message)
  return (data as PersonGroup[]) ?? []
}

export async function renamePersonGroup(userId: string, id: string, label: string): Promise<void> {
  const name = label.trim()
  if (!name) throw new Error('Label required')
  const { error } = await supabase
    .from('person_groups')
    .update({ label: name, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw new Error(error.message)
}

export async function linkMediaToPersonGroup(
  userId: string,
  personGroupId: string,
  fileId: string,
  confidence: number | null = null,
): Promise<void> {
  const { error } = await supabase.from('person_group_media').upsert(
    {
      person_group_id: personGroupId,
      file_id: fileId,
      user_id: userId,
      confidence,
    },
    { onConflict: 'person_group_id,file_id' },
  )
  if (error) throw new Error(error.message)
}

/**
 * Honest initial grouping: create Person 1..maxPeople placeholders for an album scope
 * and attach media that vision marked with matching person_slots labels.
 * Does NOT claim cross-album identity matching without embeddings.
 */
export async function applyPersonSlotsFromAnalysis(
  userId: string,
  fileId: string,
  personSlots: { label?: string }[],
  confidence: number | null,
): Promise<number> {
  if (!personSlots.length) return 0
  const maxIdx = personSlots.reduce((m, s) => {
    const n = Number(String(s.label || '').replace(/\D/g, ''))
    return Number.isFinite(n) ? Math.max(m, n) : m
  }, 0)
  const groups = await ensureNeutralPersonGroups(userId, Math.max(maxIdx, personSlots.length))
  let linked = 0
  for (const slot of personSlots) {
    const n = Number(String(slot.label || '').replace(/\D/g, '')) || 0
    const group = n > 0 ? groups[n - 1] : groups[0]
    if (!group) continue
    await linkMediaToPersonGroup(userId, group.id, fileId, confidence)
    linked += 1
  }
  return linked
}
