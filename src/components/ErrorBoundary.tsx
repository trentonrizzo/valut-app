import { Component, type ErrorInfo, type ReactNode } from 'react'
import { BootScreen } from './BootScreen'

type Props = { children: ReactNode }
type State = { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[Vault] render error', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <BootScreen
          title="Vault hit a problem"
          message={this.state.error.message || 'The app failed to render.'}
          onRetry={() => {
            this.setState({ error: null })
            window.location.reload()
          }}
        />
      )
    }
    return this.props.children
  }
}
