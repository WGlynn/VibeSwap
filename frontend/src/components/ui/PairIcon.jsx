// ============================================================
// PairIcon — Token pair display with overlapping circles
// Used for pool pairs, LP positions, trading pairs
// ============================================================

const TOKEN_COLORS = {
  ETH: '#627eea',
  USDC: '#2775ca',
  USDT: '#26a17b',
  WBTC: '#f7931a',
  JUL: '#06b6d4',
  DAI: '#f5ac37',
  LINK: '#2a5ada',
  UNI: '#ff007a',
  AAVE: '#b6509e',
  CRV: '#ff4d4f',
}

function getColor(symbol) {
  return TOKEN_COLORS[symbol?.toUpperCase()] || '#6b7280'
}

function getInitial(symbol) {
  return symbol ? symbol.charAt(0).toUpperCase() : '?'
}

export default function PairIcon({
  tokenA = 'ETH',
  tokenB = 'USDC',
  size = 28,
  className = '',
}) {
  const colorA = getColor(tokenA)
  const colorB = getColor(tokenB)
  const overlap = size * 0.3

  return (
    <div
      className={`inline-flex items-center ${className}`}
      style={{ width: size * 2 - overlap, height: size }}
    >
      <div
        className="rounded-full flex items-center justify-center border-2 border-black-900"
        style={{
          width: size,
          height: size,
          background: colorA,
          zIndex: 2,
          position: 'relative',
        }}
      >
        <span className="text-white font-mono font-bold" style={{ fontSize: size * 0.36 }}>
          {getInitial(tokenA)}
        </span>
      </div>
      <div
        className="rounded-full flex items-center justify-center border-2 border-black-900"
        style={{
          width: size,
          height: size,
          background: colorB,
          marginLeft: -overlap,
          zIndex: 1,
          position: 'relative',
        }}
      >
        <span className="text-white font-mono font-bold" style={{ fontSize: size * 0.36 }}>
          {getInitial(tokenB)}
        </span>
      </div>
    </div>
  )
}
