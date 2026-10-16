import { useEffect, useState } from 'react'
import { batchTotals, getLiveUploads, subscribeUploads } from '../../lib/upload/manager'
import { isPrivacyCovered, setPrivacyCover, subscribePrivacyCover } from '../../lib/privacyCover'

export function PrivacyScreen() {
  const [covered, setCovered] = useState(isPrivacyCovered)
  const [items, setItems] = useState(getLiveUploads)

  useEffect(() => subscribePrivacyCover(() => setCovered(isPrivacyCovered())), [])
  useEffect(() => subscribeUploads(() => setItems(getLiveUploads())), [])

  if (!covered) return null
  const totals = batchTotals(items)
  const finished = totals.total > 0 && totals.completed + totals.failed >= totals.total
  const percent = finished && totals.failed === 0 ? 100 : totals.percent

  return (
    <div className="privacy-screen" role="dialog" aria-modal="true" aria-label="Privacy Screen">
      <div className="privacy-screen__card">
        <div className="pin-lock__mark" aria-hidden>◉</div>
        <h1>Privacy Screen</h1>
        <p>Your Vault is hidden.</p>
        {totals.total > 0 ? (
          <>
            <p className="privacy-screen__count">
              {finished && totals.failed === 0 ? 'Uploads finished' : finished ? 'Some uploads stopped' : 'Uploads continuing'}
              {' · '}
              {totals.completed}/{totals.total}
            </p>
            <div className="privacy-screen__bar" aria-label="Overall upload progress">
              <span style={{ width: `${percent}%` }} />
            </div>
            <p className="privacy-screen__percent">{percent}%</p>
          </>
        ) : (
          <p className="privacy-screen__count">No uploads in progress.</p>
        )}
        <button type="button" className="btn btn--primary" onClick={() => setPrivacyCover(false)}>
          Show Vault
        </button>
      </div>
    </div>
  )
}
