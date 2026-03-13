import { useState, useEffect, useCallback } from 'react'

// ============================================================
// Countdown — Live countdown timer with format options
// Used for auction phases, proposal deadlines, events
// ============================================================

function pad(n) {
  return String(n).padStart(2, '0')
}

function getTimeLeft(target) {
  const diff = Math.max(0, target - Date.now())
  return {
    days: Math.floor(diff / 86400000),
    hours: Math.floor((diff % 86400000) / 3600000),
    minutes: Math.floor((diff % 3600000) / 60000),
    seconds: Math.floor((diff % 60000) / 1000),
    total: diff,
  }
}

export default function Countdown({
  target,
  showDays = true,
  showLabels = true,
  onComplete,
  className = '',
}) {
  const [time, setTime] = useState(() => getTimeLeft(target))

  const tick = useCallback(() => {
    const t = getTimeLeft(target)
    setTime(t)
    if (t.total <= 0 && onComplete) onComplete()
  }, [target, onComplete])

  useEffect(() => {
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [tick])

  if (time.total <= 0) {
    return (
      <span className={`font-mono text-red-400 text-sm ${className}`}>Expired</span>
    )
  }

  const segments = []
  if (showDays && time.days > 0) segments.push({ val: time.days, label: 'd' })
  segments.push({ val: time.hours, label: 'h' })
  segments.push({ val: time.minutes, label: 'm' })
  segments.push({ val: time.seconds, label: 's' })

  return (
    <div className={`inline-flex items-center gap-1 ${className}`}>
      {segments.map((s, i) => (
        <span key={s.label} className="flex items-baseline gap-px">
          {i > 0 && <span className="text-black-600 font-mono text-xs mx-0.5">:</span>}
          <span className="font-mono font-bold text-white text-sm tabular-nums">
            {pad(s.val)}
          </span>
          {showLabels && (
            <span className="text-[9px] font-mono text-black-500">{s.label}</span>
          )}
        </span>
      ))}
    </div>
  )
}
