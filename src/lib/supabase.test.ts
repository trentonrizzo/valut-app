import { describe, expect, it } from 'vitest'
import { supabaseConfigError, supabase } from './supabase'

describe('supabase bootstrap', () => {
  it('does not throw while importing the client module', () => {
    expect(supabase).toBeTruthy()
    expect(typeof supabaseConfigError === 'string' || supabaseConfigError === null).toBe(true)
  })
})
