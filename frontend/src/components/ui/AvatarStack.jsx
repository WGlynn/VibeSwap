// ============================================================
// AvatarStack — Overlapping avatar circles for groups
// Used for LP positions, governance delegates, team members
// ============================================================

const COLORS = ['#06b6d4', '#8b5cf6', '#f59e0b', '#ec4899', '#22c55e', '#f97316']

function getInitial(name) {
  if (!name) return '?'
  return name.charAt(0).toUpperCase()
}

function hashCode(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

export default function AvatarStack({
  items = [],
  max = 4,
  size = 28,
  className = '',
}) {
  const visible = items.slice(0, max)
  const overflow = items.length - max

  return (
    <div className={`flex items-center ${className}`}>
      {visible.map((item, i) => {
        const name = typeof item === 'string' ? item : item.name || item.address || ''
        const img = typeof item === 'object' ? item.avatar : null
        const color = COLORS[hashCode(name) % COLORS.length]

        return (
          <div
            key={i}
            className="rounded-full flex items-center justify-center border-2 border-black-900"
            style={{
              width: size,
              height: size,
              marginLeft: i > 0 ? -(size * 0.3) : 0,
              zIndex: visible.length - i,
              background: img ? 'transparent' : color,
              position: 'relative',
            }}
            title={name}
          >
            {img ? (
              <img
                src={img}
                alt={name}
                className="w-full h-full rounded-full object-cover"
              />
            ) : (
              <span
                className="text-white font-mono font-bold"
                style={{ fontSize: size * 0.38 }}
              >
                {getInitial(name)}
              </span>
            )}
          </div>
        )
      })}
      {overflow > 0 && (
        <div
          className="rounded-full flex items-center justify-center border-2 border-black-900"
          style={{
            width: size,
            height: size,
            marginLeft: -(size * 0.3),
            zIndex: 0,
            background: 'rgba(255,255,255,0.08)',
            position: 'relative',
          }}
        >
          <span
            className="text-black-400 font-mono font-bold"
            style={{ fontSize: size * 0.32 }}
          >
            +{overflow}
          </span>
        </div>
      )}
    </div>
  )
}
