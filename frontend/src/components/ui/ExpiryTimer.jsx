import { useState, useEffect } from 'react'

// ============================================================
// ExpiryTimer — Shows time until expiry with urgency colors
// Used for proposals, airdrops, limit orders, auctions
// ============================================================

function getTimeLeft(target) {
  const diff = Math.max(0, target - Date.now())
  const days = Math.floor(diff / 86400000)
  const hours = Math.floor((diff % 86400000) / 3600000)
  const minutes = Math.floor((diff % 3600000) / 60000)
  return { days, hours, minutes, total: diff }
}

function getColor(total) {
  if (total <= 0) return '#ef4444'
  if (total < 3600000) return '#ef4444'     // < 1 hour
  if (total < 86400000) return '#f59e0b'    // < 1 day
  return '#22c55e'
}

export default function ExpiryTimer({
  target,
  label = 'Expires',
  compact = false,
  className = '',
}) {
  const [time, setTime] = useState(() => getTimeLeft(target))

  useEffect(() => {
    const id = setInterval(() => setTime(getTimeLeft(target)), 60000)
    return () => clearInterval(id)
  }, [target])

  if (time.total <= 0) {
    return (
      <span className={`text-[10px] font-mono font-medium text-red-400 ${className}`}>
        Expired
      </span>
    )
  }

  const color = getColor(time.total)
  const parts = []
  if (time.days > 0) parts.push(`${time.days}d`)
  if (time.hours > 0 || time.days > 0) parts.push(`${time.hours}h`)
  parts.push(`${time.minutes}m`)

  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      {!compact && (
        <span className="text-[10px] font-mono text-black-500">{label}</span>
      )}
      <span className="text-[10px] font-mono font-medium" style={{ color }}>
        {parts.join(' ')}
      </span>
    </span>
  )
}
