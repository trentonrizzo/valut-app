import { useContext } from 'react'
import { VaultContext } from './vault-context'

export function useVault() {
  const ctx = useContext(VaultContext)
  if (!ctx) {
    return {
      masterKey: null,
      status: 'loading' as const,
      setupVault: async () => '',
      unlockVault: async () => {},
      recoveryJustCreated: null,
      clearRecoveryDisplay: () => {},
    }
  }
  return ctx
}
