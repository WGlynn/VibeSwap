import { useMemo } from 'react'

// Background colors
const BG_COLORS = [
  '#0a0a0a', '#1a0a1a', '#0a1a1a', '#1a1a0a',
  '#0f0f1f', '#1f0f0f', '#0f1f0f', '#1f1f0f',
  '#000000', '#0d0d0d', '#1a0d0d', '#0d1a0d',
  '#0d0d1a', '#151515', '#101018', '#181010'
]

// Body colors
const BODY_COLORS = [
  '#00ff41', '#00cc34', '#1aff76', '#4dff94',
  '#00d4ff', '#00a8cc', '#1ae0ff', '#67e8f9',
  '#ff3366', '#ff1a53', '#ff4d7a', '#ff6699',
  '#a855f7', '#9333ea', '#c084fc', '#d8b4fe'
]

// Eye patterns (simple representations)
const EYE_PATTERNS = [
  { type: 'dots', desc: 'Simple dots' },
  { type: 'curved', desc: 'Curved eyes' },
  { type: 'slant', desc: 'Slanted' },
  { type: 'wide', desc: 'Wide eyes' },
  { type: 'circles', desc: 'Circle eyes' },
  { type: 'triangle', desc: 'Triangle' },
  { type: 'angry', desc: 'Angry' },
  { type: 'sleepy', desc: 'Sleepy' },
  { type: 'happy', desc: 'Happy' },
  { type: 'surprised', desc: 'Surprised' },
  { type: 'long', desc: 'Long' },
  { type: 'oval', desc: 'Oval' },
  { type: 'small', desc: 'Small' },
  { type: 'wink', desc: 'Wink' },
  { type: 'arch', desc: 'Arch' },
  { type: 'extra-wide', desc: 'Extra Wide' }
]

// Aura colors
const AURA_COLORS = [
  'transparent',
  'rgba(0, 255, 65, 0.15)',   // matrix green
  'rgba(0, 212, 255, 0.15)',  // cyan
  'rgba(168, 85, 247, 0.15)', // purple
  'rgba(255, 51, 102, 0.15)', // pink
  'rgba(255, 215, 0, 0.15)',  // gold
  'rgba(255, 255, 255, 0.1)', // white
  'rgba(0, 255, 65, 0.3)',    // bright matrix
]

/**
 * Renders a soulbound identity avatar
 * @param {Object} props
 * @param {Object} props.identity - Identity object with avatar traits
 * @param {number} props.size - Size in pixels (default 64)
 * @param {boolean} props.showLevel - Show level badge (default true)
 * @param {string} props.className - Additional CSS classes
 */
function SoulboundAvatar({ identity, size = 64, showLevel = true, className = '' }) {
  const avatar = identity?.avatar || { background: 0, body: 0, eyes: 0, mouth: 0, accessory: 0, aura: 0 }
  const level = identity?.level || 1

  const bgColor = BG_COLORS[avatar.background % BG_COLORS.length]
  const bodyColor = BODY_COLORS[avatar.body % BODY_COLORS.length]
  const auraColor = AURA_COLORS[avatar.aura % AURA_COLORS.length]

  // Eye rendering based on pattern
  const eyeContent = useMemo(() => {
    const pattern = EYE_PATTERNS[avatar.eyes % EYE_PATTERNS.length]
    const eyeSize = size * 0.08
    const eyeY = size * 0.38
    const leftX = size * 0.35
    const rightX = size * 0.65

    switch (pattern.type) {
      case 'dots':
        return (
          <>
            <circle cx={leftX} cy={eyeY} r={eyeSize} fill="#000" />
            <circle cx={rightX} cy={eyeY} r={eyeSize} fill="#000" />
          </>
        )
      case 'curved':
        return (
          <>
            <path d={`M${leftX - eyeSize} ${eyeY} Q${leftX} ${eyeY - eyeSize * 1.5} ${leftX + eyeSize} ${eyeY}`} stroke="#000" strokeWidth={2} fill="none" />
            <path d={`M${rightX - eyeSize} ${eyeY} Q${rightX} ${eyeY - eyeSize * 1.5} ${rightX + eyeSize} ${eyeY}`} stroke="#000" strokeWidth={2} fill="none" />
          </>
        )
      case 'slant':
        return (
          <>
            <line x1={leftX - eyeSize} y1={eyeY + eyeSize/2} x2={leftX + eyeSize} y2={eyeY - eyeSize/2} stroke="#000" strokeWidth={2} />
            <line x1={rightX - eyeSize} y1={eyeY - eyeSize/2} x2={rightX + eyeSize} y2={eyeY + eyeSize/2} stroke="#000" strokeWidth={2} />
          </>
        )
      case 'circles':
        return (
          <>
            <circle cx={leftX} cy={eyeY} r={eyeSize * 1.2} fill="none" stroke="#000" strokeWidth={2} />
            <circle cx={leftX} cy={eyeY} r={eyeSize * 0.4} fill="#000" />
            <circle cx={rightX} cy={eyeY} r={eyeSize * 1.2} fill="none" stroke="#000" strokeWidth={2} />
            <circle cx={rightX} cy={eyeY} r={eyeSize * 0.4} fill="#000" />
          </>
        )
      case 'happy':
        return (
          <>
            <path d={`M${leftX - eyeSize} ${eyeY} Q${leftX} ${eyeY + eyeSize * 1.5} ${leftX + eyeSize} ${eyeY}`} stroke="#000" strokeWidth={2} fill="none" />
            <path d={`M${rightX - eyeSize} ${eyeY} Q${rightX} ${eyeY + eyeSize * 1.5} ${rightX + eyeSize} ${eyeY}`} stroke="#000" strokeWidth={2} fill="none" />
          </>
        )
      case 'angry':
        return (
          <>
            <line x1={leftX - eyeSize} y1={eyeY - eyeSize/2} x2={leftX + eyeSize} y2={eyeY + eyeSize/2} stroke="#000" strokeWidth={2} />
            <line x1={rightX - eyeSize} y1={eyeY + eyeSize/2} x2={rightX + eyeSize} y2={eyeY - eyeSize/2} stroke="#000" strokeWidth={2} />
          </>
        )
      default:
        return (
          <>
            <line x1={leftX - eyeSize} y1={eyeY} x2={leftX + eyeSize} y2={eyeY} stroke="#000" strokeWidth={2} />
            <line x1={rightX - eyeSize} y1={eyeY} x2={rightX + eyeSize} y2={eyeY} stroke="#000" strokeWidth={2} />
          </>
        )
    }
  }, [avatar.eyes, size])

  // Level badge color based on level
  const getLevelColor = (lvl) => {
    if (lvl >= 10) return '#ffd700' // gold
    if (lvl >= 7) return '#00ff41'  // matrix green
    if (lvl >= 5) return '#ef4444'  // red
    if (lvl >= 4) return '#f59e0b'  // amber
    if (lvl >= 3) return '#a855f7'  // purple
    if (lvl >= 2) return '#3b82f6'  // blue
    return '#6b7280' // gray
  }

  const levelColor = getLevelColor(level)

  return (
    <div className={`relative inline-block ${className}`} style={{ width: size, height: size }}>
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        className="rounded-full overflow-hidden"
      >
        {/* Background */}
        <rect width={size} height={size} fill={bgColor} />

        {/* Aura (if unlocked) */}
        {avatar.aura > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={size * 0.45}
            fill={auraColor}
          />
        )}

        {/* Body/Head */}
        <circle
          cx={size / 2}
          cy={size * 0.55}
          r={size * 0.35}
          fill={bodyColor}
        />

        {/* Eyes */}
        {eyeContent}
      </svg>

      {/* Level badge */}
      {showLevel && (
        <div
          className="absolute -bottom-1 -right-1 rounded-full flex items-center justify-center text-[10px] font-bold border-2 border-black-800"
          style={{
            width: size * 0.35,
            height: size * 0.35,
            minWidth: 18,
            minHeight: 18,
            backgroundColor: bgColor,
            borderColor: levelColor,
            color: levelColor,
          }}
        >
          {level}
        </div>
      )}
    </div>
  )
}

export default SoulboundAvatar
