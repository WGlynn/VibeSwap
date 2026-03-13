// ============================================================
// WalletAvatar — Deterministic avatar from wallet address
// Uses address bytes to generate a unique pattern
// ============================================================

const PALETTE = [
  '#06b6d4', '#8b5cf6', '#f59e0b', '#ec4899', '#22c55e',
  '#f97316', '#3b82f6', '#a855f7', '#14b8a6', '#ef4444',
]

function hashAddress(addr) {
  if (!addr) return 0
  let hash = 0
  for (let i = 0; i < addr.length; i++) {
    hash = ((hash << 5) - hash + addr.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

export default function WalletAvatar({
  address = '',
  size = 32,
  className = '',
}) {
  const hash = hashAddress(address)
  const color1 = PALETTE[hash % PALETTE.length]
  const color2 = PALETTE[(hash >> 4) % PALETTE.length]
  const angle = (hash % 360)

  // Generate a 3x3 symmetric pattern
  const cells = []
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < 3; x++) {
      const mx = x <= 1 ? x : 2 - x // mirror
      const bit = (hash >> (y * 2 + mx)) & 1
      cells.push(bit)
    }
  }

  const cellSize = size / 3

  return (
    <div
      className={`rounded-full overflow-hidden shrink-0 ${className}`}
      style={{
        width: size,
        height: size,
        background: `linear-gradient(${angle}deg, ${color1}, ${color2})`,
      }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {cells.map((on, i) => {
          if (!on) return null
          const x = (i % 3) * cellSize
          const y = Math.floor(i / 3) * cellSize
          return (
            <rect
              key={i}
              x={x}
              y={y}
              width={cellSize}
              height={cellSize}
              fill="rgba(255,255,255,0.3)"
            />
          )
        })}
      </svg>
    </div>
  )
}
