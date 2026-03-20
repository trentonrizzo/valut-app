import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../context/useAuth'

export function Home() {
  const { user, loading } = useAuth()

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

  return (
    <div className="landing">
      <div className="landing__inner">
        <h1 className="landing__title">Vault</h1>
        <p className="landing__lead">Dark, minimal cloud storage for your files and albums.</p>
        <div className="landing__actions">
          <Link to="/login" className="btn btn--primary">
            Sign in
          </Link>
          <Link to="/register" className="btn btn--outline">
            Create account
          </Link>
        </div>
      </div>
    </div>
  )
}
