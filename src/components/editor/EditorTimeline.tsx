import { useEffect, useRef, useState } from 'react'
import type { EditorLayer } from '../../lib/editor/projects'

type Props = {
  layer: EditorLayer
  duration: number
  onChange: (patch: Partial<EditorLayer>) => void
  onSeek?: (t: number) => void
  currentTime?: number
}

function fmt(t: number) {
  if (!Number.isFinite(t) || t < 0) return '0:00'
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

/**
 * Touch-first trim timeline: drag left/right handles; scrub playhead.
 * Numeric entry is intentionally not the primary path.
 */
export function EditorTimeline({ layer, duration, onChange, onSeek, currentTime = 0 }: Props) {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const [dragging, setDragging] = useState<'start' | 'end' | 'play' | null>(null)
  const safeDur = Math.max(0.1, duration || 1)
  const start = Math.min(Math.max(0, layer.trimStart || 0), safeDur)
  const end = Math.min(Math.max(start + 0.1, layer.trimEnd ?? safeDur), safeDur)

  function pct(t: number) {
    return `${(t / safeDur) * 100}%`
  }

  function timeFromClientX(clientX: number) {
    const el = trackRef.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    const x = Math.min(Math.max(0, clientX - rect.left), rect.width)
    return (x / rect.width) * safeDur
  }

  useEffect(() => {
    if (!dragging) return
    const move = (clientX: number) => {
      const t = timeFromClientX(clientX)
      if (dragging === 'start') {
        onChange({ trimStart: Math.min(t, end - 0.1) })
        onSeek?.(Math.min(t, end - 0.1))
      } else if (dragging === 'end') {
        onChange({ trimEnd: Math.max(t, start + 0.1) })
        onSeek?.(Math.max(t, start + 0.1))
      } else if (dragging === 'play') {
        onSeek?.(t)
      }
    }
    const onPointerMove = (e: PointerEvent) => move(e.clientX)
    const onPointerUp = () => setDragging(null)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
    }
  }, [dragging, end, start, onChange, onSeek])

  return (
    <div className="editor-timeline">
      <div className="editor-timeline__meta">
        <span>
          {fmt(start)} – {fmt(end)}
        </span>
        <span>
          {fmt(currentTime)} / {fmt(safeDur)}
        </span>
      </div>
      <div
        ref={trackRef}
        className="editor-timeline__track"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          setDragging('play')
          onSeek?.(timeFromClientX(e.clientX))
        }}
      >
        <div className="editor-timeline__full" />
        <div
          className="editor-timeline__range"
          style={{ left: pct(start), width: pct(end - start) }}
        />
        <button
          type="button"
          className="editor-timeline__handle editor-timeline__handle--start"
          style={{ left: pct(start) }}
          aria-label="Trim start"
          onPointerDown={(e) => {
            e.stopPropagation()
            e.currentTarget.setPointerCapture(e.pointerId)
            setDragging('start')
          }}
        />
        <button
          type="button"
          className="editor-timeline__handle editor-timeline__handle--end"
          style={{ left: pct(end) }}
          aria-label="Trim end"
          onPointerDown={(e) => {
            e.stopPropagation()
            e.currentTarget.setPointerCapture(e.pointerId)
            setDragging('end')
          }}
        />
        <div className="editor-timeline__playhead" style={{ left: pct(Math.min(safeDur, Math.max(0, currentTime))) }} />
      </div>
    </div>
  )
}
