import { useState, useMemo, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { TOKEN_COLORS, TOKEN_NAMES } from './TokenIcon'

// ============================================================
// SearchOverlay — Token search with glassmorphic overlay
// Commit-reveal aesthetic: dark, monospace, precision.
// ============================================================

const PHI = 1.618033988749895
const CYAN = '#06b6d4'

// Chain icon identifiers for badge display
const CHAINS = {
  ethereum: { label: 'ETH', color: '#627eea' },
  arbitrum: { label: 'ARB', color: '#28a0f0' },
  optimism: { label: 'OP', color: '#ff0420' },
  polygon: { label: 'POL', color: '#8247e5' },
  base: { label: 'BASE', color: '#0052ff' },
}

// 20 mock tokens with prices, 24h changes, and chain assignments
const MOCK_TOKENS = [
  { symbol: 'ETH',    name: 'Ethereum',   price: 3842.17,   change: 2.34,   chain: 'ethereum' },
  { symbol: 'BTC',    name: 'Bitcoin',     price: 97215.80,  change: 1.12,   chain: 'ethereum' },
  { symbol: 'USDC',   name: 'USD Coin',    price: 1.00,      change: 0.01,   chain: 'ethereum' },
  { symbol: 'USDT',   name: 'Tether',      price: 1.00,      change: -0.02,  chain: 'ethereum' },
  { symbol: 'VIBE',   name: 'VibeSwap',    price: 0.4218,    change: 14.73,  chain: 'arbitrum' },
  { symbol: 'JUL',    name: 'Joule',       price: 1.847,     change: 8.41,   chain: 'arbitrum' },
  { symbol: 'MATIC',  name: 'Polygon',     price: 0.5124,    change: -3.18,  chain: 'polygon' },
  { symbol: 'ARB',    name: 'Arbitrum',    price: 1.142,     change: 5.67,   chain: 'arbitrum' },
  { symbol: 'OP',     name: 'Optimism',    price: 2.314,     change: -1.45,  chain: 'optimism' },
  { symbol: 'LINK',   name: 'Chainlink',   price: 18.92,     change: 3.21,   chain: 'ethereum' },
  { symbol: 'UNI',    name: 'Uniswap',     price: 12.47,     change: -0.89,  chain: 'ethereum' },
  { symbol: 'AAVE',   name: 'Aave',        price: 284.30,    change: 4.56,   chain: 'ethereum' },
  { symbol: 'CRV',    name: 'Curve',       price: 0.6218,    change: -2.33,  chain: 'ethereum' },
  { symbol: 'MKR',    name: 'Maker',       price: 1847.50,   change: 1.78,   chain: 'ethereum' },
  { symbol: 'SNX',    name: 'Synthetix',   price: 3.142,     change: -4.12,  chain: 'optimism' },
  { symbol: 'COMP',   name: 'Compound',    price: 67.83,     change: 0.94,   chain: 'ethereum' },
  { symbol: 'LDO',    name: 'Lido',        price: 2.418,     change: 6.23,   chain: 'ethereum' },
  { symbol: 'RPL',    name: 'Rocket Pool', price: 24.67,     change: -1.87,  chain: 'ethereum' },
  { symbol: 'GMX',    name: 'GMX',         price: 41.92,     change: 3.45,   chain: 'arbitrum' },
  { symbol: 'PENDLE', name: 'Pendle',      price: 5.314,     change: 11.28,  chain: 'arbitrum' },
]

const POPULAR_SYMBOLS = ['ETH', 'BTC', 'USDC', 'VIBE', 'JUL']
const RECENT_SYMBOLS = ['VIBE', 'ETH', 'ARB']

// ============================================================
// Animation Variants
// ============================================================

const backdropVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0, transition: { delay: 0.1, duration: 0.2 } },
}

const panelVariants = {
  hidden: { opacity: 0, y: -20, scale: 0.97 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: 'spring', stiffness: 420, damping: 30 },
  },
  exit: {
    opacity: 0,
    y: -12,
    scale: 0.97,
    transition: { duration: 0.18 },
  },
}

const rowVariants = {
  hidden: { opacity: 0, x: -8 },
  visible: (i) => ({
    opacity: 1,
    x: 0,
    transition: { delay: i * 0.025, duration: 0.2 },
  }),
}

// ============================================================
// Sub-Components
// ============================================================

function SearchIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-neutral-500"
    >
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}

function ChainBadge({ chain }) {
  const info = CHAINS[chain]
  if (!info) return null
  return (
    <span
      className="font-mono text-[8px] leading-none px-1 py-[1px] rounded"
      style={{
        backgroundColor: `${info.color}18`,
        color: info.color,
        border: `1px solid ${info.color}30`,
      }}
    >
      {info.label}
    </span>
  )
}

function TokenRow({ token, index, onSelect }) {
  const color = TOKEN_COLORS[token.symbol] || '#666'
  const isPositive = token.change >= 0
  const changeColor = isPositive ? '#22c55e' : '#ef4444'
  const changePrefix = isPositive ? '+' : ''

  return (
    <motion.button
      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors"
      style={{ background: 'transparent' }}
      whileHover={{ backgroundColor: 'rgba(255,255,255,0.04)' }}
      variants={rowVariants}
      custom={index}
      initial="hidden"
      animate="visible"
      onClick={() => onSelect(token)}
    >
      {/* Token icon — colored circle with symbol */}
      <div
        className="rounded-full flex items-center justify-center shrink-0 font-mono font-bold"
        style={{
          width: 28,
          height: 28,
          fontSize: 10,
          backgroundColor: `${color}20`,
          border: `1px solid ${color}40`,
          color,
        }}
      >
        {token.symbol.slice(0, 2)}
      </div>

      {/* Name + chain badge */}
      <div className="flex flex-col items-start min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[11px] text-white font-medium">
            {token.symbol}
          </span>
          <ChainBadge chain={token.chain} />
        </div>
        <span className="font-mono text-[10px] text-neutral-500 truncate max-w-[120px]">
          {token.name}
        </span>
      </div>

      {/* Price */}
      <div className="flex flex-col items-end shrink-0">
        <span className="font-mono text-[11px] text-white">
          ${token.price < 1 ? token.price.toFixed(4) : token.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
        <span
          className="font-mono text-[10px]"
          style={{ color: changeColor }}
        >
          {changePrefix}{token.change.toFixed(2)}%
        </span>
      </div>
    </motion.button>
  )
}

function SectionLabel({ children }) {
  return (
    <div
      className="font-mono text-[10px] uppercase tracking-wider px-3 pt-3 pb-1"
      style={{ color: `${CYAN}99` }}
    >
      {children}
    </div>
  )
}

// ============================================================
// SearchOverlay (Main)
// ============================================================

export default function SearchOverlay({ isOpen, onClose, onSelectToken }) {
  const [query, setQuery] = useState('')
  const inputRef = useRef(null)

  // Focus input when overlay opens
  useEffect(() => {
    if (isOpen) {
      setQuery('')
      // Small delay to let animation start before focusing
      const t = setTimeout(() => inputRef.current?.focus(), 80)
      return () => clearTimeout(t)
    }
  }, [isOpen])

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return
    const handler = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  // Filtered token list
  const filteredTokens = useMemo(() => {
    if (!query.trim()) return null // null = show curated sections
    const q = query.toLowerCase()
    return MOCK_TOKENS.filter(
      (t) =>
        t.symbol.toLowerCase().includes(q) ||
        t.name.toLowerCase().includes(q)
    )
  }, [query])

  const popularTokens = useMemo(
    () => MOCK_TOKENS.filter((t) => POPULAR_SYMBOLS.includes(t.symbol)),
    []
  )

  const recentTokens = useMemo(
    () =>
      RECENT_SYMBOLS.map((s) => MOCK_TOKENS.find((t) => t.symbol === s)).filter(
        Boolean
      ),
    []
  )

  const handleSelect = (token) => {
    onSelectToken?.(token)
    onClose()
  }

  // Derive panel max-height from PHI for aesthetic proportion
  const panelMaxHeight = `${Math.round(100 / PHI)}vh`

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh]"
          variants={backdropVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          style={{
            backgroundColor: 'rgba(0,0,0,0.65)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
          }}
          onClick={(e) => {
            // Close on backdrop click (not panel click)
            if (e.target === e.currentTarget) onClose()
          }}
        >
          {/* Panel */}
          <motion.div
            className="w-full max-w-md mx-4 rounded-2xl overflow-hidden flex flex-col"
            style={{
              maxHeight: panelMaxHeight,
              background:
                'linear-gradient(180deg, rgba(15,15,15,0.95) 0%, rgba(10,10,10,0.98) 100%)',
              border: '1px solid rgba(255,255,255,0.06)',
              boxShadow: `0 24px 80px rgba(0,0,0,0.6), 0 0 40px -10px ${CYAN}15, inset 0 1px 0 rgba(255,255,255,0.04)`,
            }}
            variants={panelVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Search input */}
            <div
              className="flex items-center gap-2 px-4 py-3"
              style={{
                borderBottom: '1px solid rgba(255,255,255,0.06)',
                background: 'rgba(255,255,255,0.02)',
              }}
            >
              <SearchIcon />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search tokens..."
                className="flex-1 bg-transparent outline-none font-mono text-[12px] text-white placeholder-neutral-600"
                autoComplete="off"
                spellCheck="false"
              />
              {query && (
                <button
                  onClick={() => setQuery('')}
                  className="text-neutral-600 hover:text-neutral-400 transition-colors font-mono text-[10px]"
                >
                  ESC
                </button>
              )}
            </div>

            {/* Scrollable content */}
            <div
              className="overflow-y-auto flex-1 py-1"
              style={{
                scrollbarWidth: 'thin',
                scrollbarColor: 'rgba(255,255,255,0.08) transparent',
              }}
            >
              {filteredTokens !== null ? (
                // Search results
                filteredTokens.length > 0 ? (
                  <div>
                    <SectionLabel>
                      {filteredTokens.length} result{filteredTokens.length !== 1 ? 's' : ''}
                    </SectionLabel>
                    {filteredTokens.map((token, i) => (
                      <TokenRow
                        key={token.symbol}
                        token={token}
                        index={i}
                        onSelect={handleSelect}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-10">
                    <span className="font-mono text-[11px] text-neutral-600">
                      No tokens found for "{query}"
                    </span>
                    <span className="font-mono text-[10px] text-neutral-700 mt-1">
                      Try a different symbol or name
                    </span>
                  </div>
                )
              ) : (
                // Default view: Recent + Popular
                <>
                  {/* Recent Searches */}
                  <div>
                    <SectionLabel>Recent Searches</SectionLabel>
                    {recentTokens.map((token, i) => (
                      <TokenRow
                        key={token.symbol}
                        token={token}
                        index={i}
                        onSelect={handleSelect}
                      />
                    ))}
                  </div>

                  {/* Divider */}
                  <div
                    className="mx-3 my-1"
                    style={{
                      height: 1,
                      background:
                        'linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent)',
                    }}
                  />

                  {/* Popular Tokens */}
                  <div>
                    <SectionLabel>Popular Tokens</SectionLabel>
                    {popularTokens.map((token, i) => (
                      <TokenRow
                        key={token.symbol}
                        token={token}
                        index={i + recentTokens.length}
                        onSelect={handleSelect}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Footer hint */}
            <div
              className="flex items-center justify-between px-4 py-2"
              style={{
                borderTop: '1px solid rgba(255,255,255,0.04)',
                background: 'rgba(255,255,255,0.015)',
              }}
            >
              <span className="font-mono text-[9px] text-neutral-700">
                <kbd
                  className="px-1 py-0.5 rounded text-[8px]"
                  style={{
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    color: 'rgba(255,255,255,0.3)',
                  }}
                >
                  ESC
                </kbd>{' '}
                to close
              </span>
              <span
                className="font-mono text-[9px]"
                style={{ color: `${CYAN}50` }}
              >
                {MOCK_TOKENS.length} tokens
              </span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
