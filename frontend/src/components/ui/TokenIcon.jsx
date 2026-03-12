import { memo } from 'react'

// ============================================================
// Token Icon — Reusable token avatar with consistent colors
// Used across Portfolio, Trading, Swap, Pool, and all DeFi pages
// ============================================================

const TOKEN_COLORS = {
  ETH: '#627eea', BTC: '#f7931a', JUL: '#06b6d4', USDC: '#2775ca',
  USDT: '#26a17b', SOL: '#9945ff', AVAX: '#e84142', MATIC: '#8247e5',
  ARB: '#28a0f0', OP: '#ff0420', BASE: '#0052ff', LINK: '#2a5ada',
  UNI: '#ff007a', AAVE: '#b6509e', CRV: '#ffed4a', MKR: '#1bab9b',
  DOGE: '#c3a634', DOT: '#e6007a', ATOM: '#2e3148', NEAR: '#00c08b',
  FTM: '#1969ff', CKB: '#3cc68a', DAI: '#f5ac37', WBTC: '#f09242',
}

const TOKEN_NAMES = {
  ETH: 'Ethereum', BTC: 'Bitcoin', JUL: 'Joule', USDC: 'USD Coin',
  USDT: 'Tether', SOL: 'Solana', AVAX: 'Avalanche', MATIC: 'Polygon',
  ARB: 'Arbitrum', OP: 'Optimism', BASE: 'Base', LINK: 'Chainlink',
  UNI: 'Uniswap', AAVE: 'Aave', CRV: 'Curve', MKR: 'Maker',
  DOGE: 'Dogecoin', DOT: 'Polkadot', ATOM: 'Cosmos', NEAR: 'NEAR',
  FTM: 'Fantom', CKB: 'Nervos', DAI: 'Dai', WBTC: 'Wrapped BTC',
}

function TokenIcon({ symbol, size = 32, showName = false, className = '' }) {
  const color = TOKEN_COLORS[symbol] || '#666'
  const name = TOKEN_NAMES[symbol] || symbol

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div
        className="rounded-full flex items-center justify-center shrink-0 font-mono font-bold"
        style={{
          width: size,
          height: size,
          fontSize: size * 0.35,
          backgroundColor: `${color}20`,
          border: `1px solid ${color}40`,
          color,
        }}
      >
        {symbol.slice(0, size >= 24 ? 3 : 1)}
      </div>
      {showName && (
        <div className="min-w-0">
          <div className="text-sm text-white font-medium truncate">{symbol}</div>
          <div className="text-[10px] text-black-500 truncate">{name}</div>
        </div>
      )}
    </div>
  )
}

export default memo(TokenIcon)
export { TOKEN_COLORS, TOKEN_NAMES }
