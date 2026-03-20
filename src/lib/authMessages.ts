/** Maps Supabase Auth errors to clearer UI copy. */
export function formatAuthError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('email not confirmed')) {
    return 'Confirm your email before signing in. Check your inbox for the link from Supabase.'
  }
  if (m.includes('invalid login credentials')) {
    return 'Invalid email or password.'
  }
  if (m.includes('user already registered')) {
    return 'An account with this email already exists. Try signing in instead.'
  }
  return message
}
