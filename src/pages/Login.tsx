import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { AuthCard } from '../components/layout/AuthCard'

export function Login() {
  const { user, loading, signIn } = useAuth()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
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
    return <Navigate to="/dashboard" replace />
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const { error: err } = await signIn(email.trim(), password)
    setSubmitting(false)
    if (err) {
      setError(err.message)
      return
    }
  }

  return (
    <AuthCard
      title="Sign in"
      subtitle="Access your Vault."
      footer={
        <p>
          No account? <Link to="/register">Create one</Link>
        </p>
      }
    >
      <form className="auth-form" onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="login-email" className="field-label">
            Email
          </label>
          <input
            id="login-email"
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
          <label htmlFor="login-password" className="field-label">
            Password
          </label>
          <input
            id="login-password"
            type="password"
            className="field-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            disabled={submitting}
          />
        </div>
        {error ? <p className="field-error">{error}</p> : null}
        <button type="submit" className="btn btn--primary btn--block" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </AuthCard>
  )
}
