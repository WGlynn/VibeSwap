// ============================================================
// TokenPair — Overlapping token icon pair display
// Used for pool identifiers, trading pairs, LP tokens
// ============================================================

const TOKEN_COLORS = {
  ETH: '#627EEA',
  BTC: '#F7931A',
  USDC: '#2775CA',
  USDT: '#26A17B',
  DAI: '#F5AC37',
  SOL: '#9945FF',
  AVAX: '#E84142',
  MATIC: '#8247E5',
  CKB: '#3CC68A',
  JUL: '#06b6d4',
  VIBE: '#22c55e',
  OP: '#FF0420',
  ARB: '#28A0F0',
  BNB: '#F0B90B',
}

function getColor(symbol) {
  return TOKEN_COLORS[symbol?.toUpperCase()] || '#6b7280'
}

export default function TokenPair({
  tokenA,
  tokenB,
  size = 24,
  className = '',
}) {
  const colorA = getColor(tokenA)
  const colorB = getColor(tokenB)
  const overlap = size * 0.35

  return (
    <div className={`flex items-center ${className}`} style={{ width: size * 2 - overlap }}>
      <div
        className="rounded-full flex items-center justify-center border-2 border-black-900 shrink-0"
        style={{ width: size, height: size, background: colorA, zIndex: 2 }}
      >
        <span className="text-white font-mono font-bold" style={{ fontSize: size * 0.3 }}>
          {tokenA?.charAt(0)}
        </span>
      </div>
      <div
        className="rounded-full flex items-center justify-center border-2 border-black-900 shrink-0"
        style={{ width: size, height: size, background: colorB, marginLeft: -overlap, zIndex: 1 }}
      >
        <span className="text-white font-mono font-bold" style={{ fontSize: size * 0.3 }}>
          {tokenB?.charAt(0)}
        </span>
      </div>
    </div>
  )
}
