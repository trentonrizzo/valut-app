import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'

window.onerror = function (message, source, lineno, colno, error) {
  console.error('[window.onerror]', { message, source, lineno, colno, error, stack: error?.stack })
}

window.onunhandledrejection = function (event) {
  console.error('[window.onunhandledrejection]', {
    reason: event.reason,
    stack: event.reason?.stack,
  })
}

const root = document.getElementById('root')
if (!root) {
  document.body.textContent = 'Vault failed to start: missing #root element.'
} else {
  createRoot(root).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  )
}

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
