// ============================================================
// ChainBadge — Reusable chain/network identifier badge
// Variants: dot (8px colored circle) | pill (colored pill w/ abbreviation)
// Used in Bridge, CrossChain, token selectors, etc.
// ============================================================

// ============ Chain Color Map ============
const CHAIN_MAP = {
  Ethereum:  { color: '#627eea', abbr: 'ET' },
  Base:      { color: '#0052ff', abbr: 'BA' },
  Arbitrum:  { color: '#28a0f0', abbr: 'AR' },
  Optimism:  { color: '#ff0420', abbr: 'OP' },
  Polygon:   { color: '#8247e5', abbr: 'PO' },
  BNB:       { color: '#f3ba2f', abbr: 'BN' },
  Avalanche: { color: '#e84142', abbr: 'AV' },
  Solana:    { color: '#9945ff', abbr: 'SO' },
  CKB:       { color: '#3cc68a', abbr: 'CK' },
}

// ============ Fallback Resolver ============
function resolveChain(chain) {
  if (CHAIN_MAP[chain]) return CHAIN_MAP[chain]

  // Case-insensitive lookup
  const key = Object.keys(CHAIN_MAP).find(
    (k) => k.toLowerCase() === chain.toLowerCase()
  )
  if (key) return CHAIN_MAP[key]

  // Unknown chain fallback
  return {
    color: '#6b7280',
    abbr: chain.slice(0, 2).toUpperCase(),
  }
}

// ============ Dot Variant ============
function DotBadge({ color, className }) {
  return (
    <span
      className={`inline-block shrink-0 rounded-full ${className}`}
      style={{
        width: 8,
        height: 8,
        backgroundColor: color,
        boxShadow: `0 0 4px ${color}40`,
      }}
    />
  )
}

// ============ Pill Variant ============
function PillBadge({ color, abbr, name, showName, className }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-mono ${className}`}
      style={{
        padding: '2px 8px',
        fontSize: showName ? 10 : 8,
        lineHeight: 1.4,
        backgroundColor: `${color}14`,
        border: `1px solid ${color}30`,
        color: color,
      }}
    >
      <span
        className="inline-block shrink-0 rounded-full"
        style={{
          width: 6,
          height: 6,
          backgroundColor: color,
        }}
      />
      <span className="font-semibold tracking-wide">
        {showName ? name : abbr}
      </span>
    </span>
  )
}

// ============ ChainBadge Component ============
export default function ChainBadge({
  chain = 'Ethereum',
  variant = 'pill',
  showName = false,
  className = '',
}) {
  const { color, abbr } = resolveChain(chain)

  if (variant === 'dot') {
    return <DotBadge color={color} className={className} />
  }

  return (
    <PillBadge
      color={color}
      abbr={abbr}
      name={chain}
      showName={showName}
      className={className}
    />
  )
}

export { CHAIN_MAP }
