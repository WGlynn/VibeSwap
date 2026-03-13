// ============================================================
// Avatar — User/token avatar with status indicator
// Deterministic gradient from address/name hash
// ============================================================

const CYAN = '#06b6d4'

const GRADIENTS = [
  ['#06b6d4', '#3b82f6'],
  ['#8b5cf6', '#ec4899'],
  ['#f59e0b', '#ef4444'],
  ['#22c55e', '#06b6d4'],
  ['#6366f1', '#a855f7'],
  ['#f97316', '#f59e0b'],
  ['#14b8a6', '#22d3ee'],
  ['#e11d48', '#f43f5e'],
]

function hashCode(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

export default function Avatar({
  src,
  name = '',
  address = '',
  size = 32,
  status,
  className = '',
}) {
  const seed = address || name
  const gradient = GRADIENTS[hashCode(seed) % GRADIENTS.length]
  const initials = name
    ? name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    : address
    ? address.slice(2, 4).toUpperCase()
    : '?'

  const statusColors = {
    online: '#22c55e',
    offline: 'rgba(255,255,255,0.2)',
    busy: '#ef4444',
    away: '#f59e0b',
  }

  return (
    <div className={`relative inline-flex shrink-0 ${className}`} style={{ width: size, height: size }}>
      {src ? (
        <img
          src={src}
          alt={name || 'Avatar'}
          className="rounded-full object-cover"
          style={{ width: size, height: size }}
        />
      ) : (
        <div
          className="rounded-full flex items-center justify-center font-mono font-bold text-white"
          style={{
            width: size,
            height: size,
            background: `linear-gradient(135deg, ${gradient[0]}, ${gradient[1]})`,
            fontSize: Math.max(8, size / 3),
          }}
        >
          {initials}
        </div>
      )}
      {status && (
        <span
          className="absolute bottom-0 right-0 rounded-full border-2"
          style={{
            width: Math.max(6, size / 4),
            height: Math.max(6, size / 4),
            background: statusColors[status] || statusColors.offline,
            borderColor: 'rgba(0,0,0,0.8)',
          }}
        />
      )}
    </div>
  )
}
