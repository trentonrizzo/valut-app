import { useEffect, useState } from 'react'
import { fetchSignedMediaUrl } from '../lib/fetchSignedMediaUrl'

type Args = {
  fileId: string | null | undefined
  storedUrl: string | null | undefined
  /** When false, skip network (e.g. local blob preview). */
  enabled: boolean
}

/**
 * Fetches a short-lived signed GET URL for a file row (private R2).
 */
export function useSignedRemoteUrl({ fileId, storedUrl, enabled }: Args): {
  signedUrl: string | null
  loading: boolean
  error: boolean
} {
  const [signedUrl, setSignedUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  const canFetch = Boolean(enabled && fileId && storedUrl)

  useEffect(() => {
    if (!canFetch || !fileId || !storedUrl) {
      queueMicrotask(() => {
        setSignedUrl(null)
        setLoading(false)
        setError(false)
      })
      return
    }

    let cancelled = false

    queueMicrotask(() => {
      if (cancelled) return
      setLoading(true)
      setError(false)
      setSignedUrl(null)

      void fetchSignedMediaUrl(fileId, storedUrl)
        .then((url) => {
          if (!cancelled) {
            setSignedUrl(url)
            setError(false)
          }
        })
        .catch(() => {
          if (!cancelled) {
            setSignedUrl(null)
            setError(true)
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    })

    return () => {
      cancelled = true
    }
  }, [canFetch, fileId, storedUrl])

  return {
    signedUrl: canFetch ? signedUrl : null,
    loading: canFetch && loading,
    error: canFetch && error,
  }
}
