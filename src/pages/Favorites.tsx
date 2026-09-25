import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

/** Dedicated Favorites route → Library filtered to favorites. */
export function Favorites() {
  const navigate = useNavigate()
  useEffect(() => {
    navigate('/library?favorite=yes', { replace: true })
  }, [navigate])
  return <div className="vault-loading">Opening favorites…</div>
}
