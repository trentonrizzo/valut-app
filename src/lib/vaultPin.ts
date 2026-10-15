import { supabase } from './supabase'
import { releaseAllDecryptedBlobUrls } from './decryptedBlobCache'
import { genericPinFailure, normalizePin, pinSetupAllowed } from './vaultLockPolicy'

let memoryUnlocked = false

export function isVaultSessionUnlocked(): boolean {
  return memoryUnlocked
}

export function lockVaultSession(): void {
  memoryUnlocked = false
  releaseAllDecryptedBlobUrls()
  try {
    sessionStorage.removeItem('vault-session-unlock')
  } catch {
    /* private mode */
  }
  void supabase.rpc('vault_lock_now')
  window.dispatchEvent(new Event('vault-lock'))
}

export async function vaultLockStatus(): Promise<{
  pinSet: boolean
  serverEnforced: boolean
  retryAt: string | null
  breakinEnabled: boolean
}> {
  const { data, error } = await supabase.rpc('vault_lock_status')
  if (error || !data || typeof data !== 'object') {
    const legacy = await supabase.rpc('vault_pin_is_set')
    return {
      pinSet: legacy.data === true,
      serverEnforced: false,
      retryAt: null,
      breakinEnabled: false,
    }
  }
  const row = data as { pin_set?: boolean; server_enforced?: boolean; retry_at?: string | null; breakin_enabled?: boolean }
  return {
    pinSet: row.pin_set === true,
    serverEnforced: row.server_enforced === true,
    retryAt: row.retry_at || null,
    breakinEnabled: row.breakin_enabled === true,
  }
}

export async function vaultPinIsSet(): Promise<boolean> {
  const status = await vaultLockStatus()
  return status.pinSet
}

export async function setVaultPin(pin: string, acceptedShortPin: boolean): Promise<string[]> {
  const policy = pinSetupAllowed(pin, acceptedShortPin)
  if (!policy.ok) throw new Error(policy.reason || 'Choose a PIN')
  const value = normalizePin(pin)
  const created = await supabase.rpc('vault_create_pin', { p_pin: value })
  if (!created.error && created.data && typeof created.data === 'object') {
    const codes = (created.data as { recovery_codes?: string[] }).recovery_codes
    memoryUnlocked = false
    return Array.isArray(codes) ? codes : []
  }
  if (created.error && !/could not find the function|PGRST202|schema cache/i.test(created.error.message)) {
    throw new Error('Could not save PIN')
  }
  const { error } = await supabase.rpc('set_vault_pin', { p_pin: value })
  if (error) throw new Error('Could not save PIN')
  memoryUnlocked = false
  return []
}

export async function verifyVaultPin(pin: string): Promise<{ ok: boolean; retryAt: string | null }> {
  const value = normalizePin(pin)
  const next = await supabase.rpc('vault_unlock_pin', { p_pin: value })
  if (!next.error && next.data && typeof next.data === 'object') {
    const row = next.data as { ok?: boolean; retry_at?: string | null }
    memoryUnlocked = row.ok === true
    return { ok: row.ok === true, retryAt: row.retry_at || null }
  }
  if (next.error && !/could not find the function|PGRST202|schema cache/i.test(next.error.message)) {
    memoryUnlocked = false
    return { ok: false, retryAt: null }
  }
  const { data, error } = await supabase.rpc('verify_vault_pin', { p_pin: value })
  if (error || data !== true) {
    memoryUnlocked = false
    return { ok: false, retryAt: null }
  }
  memoryUnlocked = true
  return { ok: true, retryAt: null }
}

export async function changeVaultPin(current: string, next: string, acceptedShortPin: boolean): Promise<boolean> {
  const policy = pinSetupAllowed(next, acceptedShortPin)
  if (!policy.ok) throw new Error(policy.reason || 'Choose a PIN')
  const { data, error } = await supabase.rpc('vault_change_pin', {
    p_current: normalizePin(current),
    p_next: normalizePin(next),
  })
  if (error) throw new Error(genericPinFailure())
  const ok = Boolean(data && typeof data === 'object' && (data as { ok?: boolean }).ok)
  if (ok) lockVaultSession()
  return ok
}

export async function recoverVaultPin(code: string, next: string, acceptedShortPin: boolean): Promise<boolean> {
  const policy = pinSetupAllowed(next, acceptedShortPin)
  if (!policy.ok) throw new Error(policy.reason || 'Choose a PIN')
  const { data, error } = await supabase.rpc('vault_recover_pin', {
    p_code: code.trim(),
    p_next: normalizePin(next),
  })
  if (error) throw new Error(genericPinFailure())
  const ok = Boolean(data && typeof data === 'object' && (data as { ok?: boolean }).ok)
  if (ok) lockVaultSession()
  return ok
}

export async function clearVaultPin(): Promise<void> {
  throw new Error('The current PIN is required')
}
