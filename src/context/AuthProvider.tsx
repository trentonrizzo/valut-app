import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { ensureUserProfile } from '../lib/ensureUserProfile'
import { clearEncryptionSession, ensureEncryptionKey } from '../lib/vaultCrypto'
import { AuthContext } from './auth-context'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      if (!mounted) return
      setSession(s)
      setUser(s?.user ?? null)
      setLoading(false)
      if (s?.user) {
        void ensureUserProfile(s.user)
        void ensureEncryptionKey(s.user.id).catch(() => {})
      } else {
        clearEncryptionSession()
      }
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      setUser(s?.user ?? null)
      setLoading(false)
      if (s?.user) {
        void ensureUserProfile(s.user)
        void ensureEncryptionKey(s.user.id).catch(() => {})
      } else {
        clearEncryptionSession()
      }
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return { error: new Error(error.message) }
    if (data.user) {
      await ensureUserProfile(data.user)
      void ensureEncryptionKey(data.user.id).catch(() => {})
    }
    return { error: null }
  }, [])

  const signUp = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) return { error: new Error(error.message) }
    if (data.user && data.session) {
      await ensureUserProfile(data.user)
      void ensureEncryptionKey(data.user.id).catch(() => {})
    }
    return { error: null }
  }, [])

  const signOut = useCallback(async () => {
    clearEncryptionSession()
    await supabase.auth.signOut()
  }, [])

  const value = useMemo(
    () => ({
      session,
      user,
      loading,
      signIn,
      signUp,
      signOut,
    }),
    [session, user, loading, signIn, signUp, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
