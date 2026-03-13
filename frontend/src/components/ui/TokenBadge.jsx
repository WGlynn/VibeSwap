import { memo } from 'react'

// ============================================================
// Token Badge — Circular token icon with gradient background
// Compact badge variant with 2-letter symbol, chain indicator,
// and optional glow. Used in lists, tables, and compact layouts.
// ============================================================

const TOKEN_COLORS = {
  ETH:    '#627eea',
  BTC:    '#f7931a',
  USDC:   '#2775ca',
  USDT:   '#26a17b',
  VIBE:   '#06b6d4',
  JUL:    '#8b5cf6',
  MATIC:  '#8247e5',
  ARB:    '#28a0f0',
  OP:     '#ff0420',
  LINK:   '#2a5ada',
  UNI:    '#ff007a',
  AAVE:   '#b6509e',
  CRV:    '#a4a4a4',
  MKR:    '#1aab9b',
  SNX:    '#1e1a31',
  COMP:   '#00d395',
  LDO:    '#00a3ff',
  RPL:    '#ffb547',
  GMX:    '#2d42fc',
  PENDLE: '#07d1aa',
}

const CHAIN_COLORS = {
  ethereum:  '#627eea',
  arbitrum:  '#28a0f0',
  optimism:  '#ff0420',
  base:      '#0052ff',
  polygon:   '#8247e5',
  avalanche: '#e84142',
  bsc:       '#f0b90b',
  solana:    '#9945ff',
  nervos:    '#3cc68a',
  fantom:    '#1969ff',
}

const SIZES = {
  sm: { box: 20, font: 8,  chainDot: 8,  chainFont: 5,  chainOffset: -2 },
  md: { box: 28, font: 10, chainDot: 10, chainFont: 6,  chainOffset: -2 },
  lg: { box: 36, font: 13, chainDot: 12, chainFont: 7,  chainOffset: -3 },
  xl: { box: 48, font: 17, chainDot: 14, chainFont: 8,  chainOffset: -3 },
}

function getAbbreviation(symbol) {
  if (!symbol) return '?'
  const upper = symbol.toUpperCase()
  return upper.length <= 2 ? upper : upper.slice(0, 2)
}

function TokenBadge({ symbol = 'ETH', size = 'md', chain, glow = false, className = '' }) {
  const upper = symbol.toUpperCase()
  const color = TOKEN_COLORS[upper] || '#666666'
  const abbr = getAbbreviation(upper)
  const isUnknown = !TOKEN_COLORS[upper]
  const s = SIZES[size] || SIZES.md

  const chainColor = chain ? (CHAIN_COLORS[chain] || '#666') : null

  return (
    <div className={`relative inline-flex shrink-0 ${className}`} style={{ width: s.box, height: s.box }}>
      {/* Main circular badge */}
      <div
        className="rounded-full flex items-center justify-center font-mono font-bold text-white select-none"
        style={{
          width: s.box,
          height: s.box,
          fontSize: s.font,
          lineHeight: 1,
          background: isUnknown
            ? '#444'
            : `linear-gradient(135deg, ${color}, ${color}cc)`,
          boxShadow: glow && !isUnknown
            ? `0 0 ${s.box * 0.4}px ${color}66, 0 0 ${s.box * 0.15}px ${color}33`
            : 'none',
        }}
        title={upper}
      >
        {isUnknown ? '?' : abbr}
      </div>

      {/* Optional chain indicator dot */}
      {chain && chainColor && (
        <div
          className="absolute rounded-full border border-gray-900 flex items-center justify-center font-mono font-bold text-white"
          style={{
            width: s.chainDot,
            height: s.chainDot,
            fontSize: s.chainFont,
            lineHeight: 1,
            bottom: s.chainOffset,
            right: s.chainOffset,
            backgroundColor: chainColor,
          }}
          title={chain}
        >
          {chain.charAt(0).toUpperCase()}
        </div>
      )}
    </div>
  )
}

export default memo(TokenBadge)
export { TOKEN_COLORS as BADGE_TOKEN_COLORS, CHAIN_COLORS as BADGE_CHAIN_COLORS, SIZES as BADGE_SIZES }
