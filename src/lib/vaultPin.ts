import { supabase } from './supabase'

const SESSION_KEY = 'vault-session-unlock'

export async function vaultPinIsSet(): Promise<boolean> {
  const { data, error } = await supabase.rpc('vault_pin_is_set')
  if (error) throw new Error(error.message)
  return data === true
}

export async function setVaultPin(pin: string): Promise<void> {
  const { error } = await supabase.rpc('set_vault_pin', { p_pin: pin })
  if (error) throw new Error(error.message)
  sessionStorage.setItem(SESSION_KEY, '1')
}

export async function verifyVaultPin(pin: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('verify_vault_pin', { p_pin: pin })
  if (error) throw new Error(error.message)
  const ok = data === true
  if (ok) sessionStorage.setItem(SESSION_KEY, '1')
  return ok
}

export async function clearVaultPin(): Promise<void> {
  const { error } = await supabase.rpc('clear_vault_pin')
  if (error) throw new Error(error.message)
  sessionStorage.removeItem(SESSION_KEY)
}

export function isVaultSessionUnlocked(): boolean {
  try {
    return sessionStorage.getItem(SESSION_KEY) === '1'
  } catch {
    return false
  }
}

export function lockVaultSession(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY)
  } catch {
    /* ignore */
  }
}
