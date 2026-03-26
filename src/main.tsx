import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

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
if (!root) throw new Error('Root element #root not found')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
