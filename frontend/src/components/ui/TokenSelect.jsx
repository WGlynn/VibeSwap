import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// ============================================================
// TokenSelect — Token picker dropdown with search
// Used for swap, bridge, staking token selection
// ============================================================

const CYAN = '#06b6d4'

const POPULAR_TOKENS = [
  { symbol: 'ETH', name: 'Ethereum', icon: 'E' },
  { symbol: 'USDC', name: 'USD Coin', icon: 'U' },
  { symbol: 'USDT', name: 'Tether', icon: 'T' },
  { symbol: 'WBTC', name: 'Wrapped Bitcoin', icon: 'B' },
  { symbol: 'JUL', name: 'JUL Token', icon: 'J' },
  { symbol: 'DAI', name: 'Dai', icon: 'D' },
  { symbol: 'LINK', name: 'Chainlink', icon: 'L' },
  { symbol: 'UNI', name: 'Uniswap', icon: 'U' },
]

export default function TokenSelect({
  tokens = POPULAR_TOKENS,
  selected,
  onSelect,
  placeholder = 'Select token',
  className = '',
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const filtered = tokens.filter(
    (t) =>
      t.symbol.toLowerCase().includes(search.toLowerCase()) ||
      t.name.toLowerCase().includes(search.toLowerCase())
  )

  const selectedToken = tokens.find((t) => t.symbol === selected)

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-2 rounded-xl border transition-all duration-200 hover:border-cyan-500/30"
        style={{
          background: 'rgba(255,255,255,0.03)',
          borderColor: open ? `${CYAN}40` : 'rgba(255,255,255,0.06)',
        }}
      >
        {selectedToken ? (
          <>
            <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-mono font-bold text-white" style={{ background: `${CYAN}30` }}>
              {selectedToken.icon}
            </span>
            <span className="text-sm font-mono font-bold text-white">{selectedToken.symbol}</span>
          </>
        ) : (
          <span className="text-sm font-mono text-black-500">{placeholder}</span>
        )}
        <svg width="12" height="12" viewBox="0 0 12 12" className="text-black-500 ml-1">
          <path d="M3 5l3 3 3-3" stroke="currentColor" fill="none" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full mt-2 left-0 w-64 rounded-xl border overflow-hidden z-50"
            style={{
              background: 'rgba(10,10,10,0.95)',
              borderColor: `${CYAN}20`,
              WebkitBackdropFilter: 'blur(20px)',
              backdropFilter: 'blur(20px)',
              boxShadow: `0 8px 32px rgba(0,0,0,0.5)`,
            }}
          >
            <div className="p-2">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search tokens..."
                className="w-full px-3 py-2 text-xs font-mono bg-white/5 rounded-lg text-white placeholder-black-500 outline-none border border-transparent focus:border-cyan-500/30"
                autoFocus
              />
            </div>
            <div className="max-h-48 overflow-y-auto">
              {filtered.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs font-mono text-black-500">
                  No tokens found
                </div>
              ) : (
                filtered.map((token) => (
                  <button
                    key={token.symbol}
                    onClick={() => {
                      onSelect && onSelect(token.symbol)
                      setOpen(false)
                      setSearch('')
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/5 transition-colors"
                    style={{
                      background: selected === token.symbol ? `${CYAN}08` : 'transparent',
                    }}
                  >
                    <span className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-mono font-bold text-white" style={{ background: `${CYAN}20` }}>
                      {token.icon}
                    </span>
                    <div className="flex-1 text-left">
                      <div className="text-xs font-mono font-bold text-white">{token.symbol}</div>
                      <div className="text-[10px] font-mono text-black-500">{token.name}</div>
                    </div>
                    {selected === token.symbol && (
                      <div className="w-1.5 h-1.5 rounded-full" style={{ background: CYAN }} />
                    )}
                  </button>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
