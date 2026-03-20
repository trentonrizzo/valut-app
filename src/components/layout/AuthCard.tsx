import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'

type Props = {
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
}

export function AuthCard({ title, subtitle, children, footer }: Props) {
  return (
    <div className="auth-page">
      <div className="auth-brand">
        <Link to="/" className="auth-logo">
          Vault
        </Link>
      </div>
      <div className="auth-card">
        <header className="auth-card__header">
          <h1>{title}</h1>
          {subtitle ? <p className="auth-card__subtitle">{subtitle}</p> : null}
        </header>
        {children}
        {footer ? <footer className="auth-card__footer">{footer}</footer> : null}
      </div>
    </div>
  )
}
