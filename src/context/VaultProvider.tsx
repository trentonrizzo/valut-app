import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAuth } from './useAuth'
import { VaultContext } from './vault-context'
import {
  createVaultWithRecovery,
  resolveVaultKeyStatus,
  unlockWithRecovery,
} from '../lib/crypto/vaultMasterKey'
import { configureUploader, hydrateUploadQueue } from '../lib/upload/manager'

export function VaultProvider({ children }: { children: ReactNode }) {
  const { user, session } = useAuth()
  const [masterKey, setMasterKey] = useState<CryptoKey | null>(null)
  const [status, setStatus] = useState<'loading' | 'missing' | 'needs-unlock' | 'ready'>('loading')
  const [recoveryJustCreated, setRecoveryJustCreated] = useState<string | null>(null)

  useEffect(() => {
    if (!user) {
      setMasterKey(null)
      setStatus('loading')
      configureUploader({ accessToken: '', userId: '', masterKey: null })
      return
    }
    let cancelled = false
    setStatus('loading')
    resolveVaultKeyStatus(user.id)
      .then((s) => {
        if (cancelled) return
        if (s.state === 'ready') {
          setMasterKey(s.key)
          setStatus('ready')
        } else if (s.state === 'needs-unlock') {
          setMasterKey(null)
          setStatus('needs-unlock')
        } else {
          setMasterKey(null)
          setStatus('missing')
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMasterKey(null)
          setStatus('missing')
        }
      })
    return () => {
      cancelled = true
    }
  }, [user])

  useEffect(() => {
    configureUploader({
      accessToken: session?.access_token ?? '',
      userId: user?.id ?? '',
      masterKey,
    })
  }, [session?.access_token, user?.id, masterKey])

  useEffect(() => {
    if (user) void hydrateUploadQueue()
  }, [user?.id])

  const setupVault = useCallback(async () => {
    if (!user) throw new Error('Not signed in')
    const { recoverySecret, key } = await createVaultWithRecovery(user.id)
    setMasterKey(key)
    setStatus('ready')
    setRecoveryJustCreated(recoverySecret)
    return recoverySecret
  }, [user])

  const unlockVault = useCallback(
    async (recovery: string) => {
      if (!user) throw new Error('Not signed in')
      const key = await unlockWithRecovery(user.id, recovery)
      setMasterKey(key)
      setStatus('ready')
    },
    [user],
  )

  const value = useMemo(
    () => ({
      masterKey,
      status,
      setupVault,
      unlockVault,
      recoveryJustCreated,
      clearRecoveryDisplay: () => setRecoveryJustCreated(null),
    }),
    [masterKey, status, setupVault, unlockVault, recoveryJustCreated],
  )

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>
}
