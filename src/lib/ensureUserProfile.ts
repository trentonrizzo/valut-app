import type { User } from '@supabase/supabase-js'
import { supabase } from './supabase'

/**
 * Ensures a row exists in public.profiles for the given auth user.
 * Uses upsert so it is safe if a DB trigger already created the row.
 */
export async function ensureUserProfile(user: User): Promise<void> {
  const email = user.email ?? ''
  const { error } = await supabase.from('profiles').upsert(
    { id: user.id, email },
    { onConflict: 'id' },
  )
  if (error) {
    console.warn('[Vault] ensureUserProfile:', error.message)
  }
}
