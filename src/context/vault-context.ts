import { createContext } from 'react'

export type VaultContextValue = {
  masterKey: CryptoKey | null
  status: 'loading' | 'missing' | 'needs-unlock' | 'ready'
  setupVault: () => Promise<string>
  unlockVault: (recovery: string) => Promise<void>
  recoveryJustCreated: string | null
  clearRecoveryDisplay: () => void
}

export const VaultContext = createContext<VaultContextValue | undefined>(undefined)
