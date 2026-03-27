import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { AuthCard } from '../components/layout/AuthCard'
import { formatAuthError } from '../lib/authMessages'

export function Register() {
  const { user, loading, signUp } = useAuth()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (loading) {
    return (
      <div className="app-loading">
        <div className="spinner" aria-hidden />
        <p>Loading…</p>
      </div>
    )
  }

  if (user) {
    return <Navigate to="/albums" replace />
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setInfo(null)
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }
    setSubmitting(true)
    const { error: err } = await signUp(email.trim(), password)
    setSubmitting(false)
    if (err) {
      setError(formatAuthError(err.message))
      return
    }
    setInfo(
      'If your project requires email confirmation, check your inbox and click the link—then sign in. If confirmation is disabled, you’ll be signed in automatically.',
    )
  }

  return (
    <AuthCard
      title="Create account"
      subtitle="Start organizing your Vault."
      footer={
        <p>
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      }
    >
      <form className="auth-form" onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="register-email" className="field-label">
            Email
          </label>
          <input
            id="register-email"
            type="email"
            className="field-input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
            disabled={submitting}
          />
        </div>
        <div className="field">
          <label htmlFor="register-password" className="field-label">
            Password
          </label>
          <input
            id="register-password"
            type="password"
            className="field-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            required
            minLength={6}
            disabled={submitting}
          />
        </div>
        <div className="field">
          <label htmlFor="register-confirm" className="field-label">
            Confirm password
          </label>
          <input
            id="register-confirm"
            type="password"
            className="field-input"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            required
            disabled={submitting}
          />
        </div>
        {error ? <p className="field-error">{error}</p> : null}
        {info ? <p className="field-info">{info}</p> : null}
        <button type="submit" className="btn btn--primary btn--block" disabled={submitting}>
          {submitting ? 'Creating…' : 'Create account'}
        </button>
      </form>
    </AuthCard>
  )
}
