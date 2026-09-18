type Props = {
  title: string
  message: string
  onRetry?: () => void
}

export function BootScreen({ title, message, onRetry }: Props) {
  return (
    <div className="boot-screen">
      <div className="boot-screen__card">
        <h1 className="boot-screen__title">{title}</h1>
        <p className="boot-screen__message">{message}</p>
        {onRetry ? (
          <button type="button" className="btn btn--primary btn--block" onClick={onRetry}>
            Retry
          </button>
        ) : null}
      </div>
    </div>
  )
}
