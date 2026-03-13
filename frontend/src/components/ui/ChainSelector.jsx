import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// ============================================================
// ChainSelector — Dropdown for selecting blockchain network
// Used for bridge, cross-chain swaps, network switching
// ============================================================

const CYAN = '#06b6d4'

const CHAINS = [
  { id: 1, name: 'Ethereum', icon: 'E', color: '#627eea' },
  { id: 42161, name: 'Arbitrum', icon: 'A', color: '#28a0f0' },
  { id: 10, name: 'Optimism', icon: 'O', color: '#ff0420' },
  { id: 8453, name: 'Base', icon: 'B', color: '#0052ff' },
  { id: 137, name: 'Polygon', icon: 'P', color: '#8247e5' },
  { id: 43114, name: 'Avalanche', icon: 'A', color: '#e84142' },
  { id: 56, name: 'BSC', icon: 'B', color: '#f0b90b' },
]

export default function ChainSelector({
  chains = CHAINS,
  selected,
  onSelect,
  label,
  className = '',
}) {
  const [open, setOpen] = useState(false)
  const current = chains.find((c) => c.id === selected)

  return (
    <div className={`relative ${className}`}>
      {label && (
        <span className="text-[9px] font-mono text-black-500 uppercase tracking-wider block mb-1">
          {label}
        </span>
      )}
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-2 rounded-xl border transition-all w-full"
        style={{
          background: 'rgba(255,255,255,0.03)',
          borderColor: open ? `${CYAN}40` : 'rgba(255,255,255,0.06)',
        }}
      >
        {current ? (
          <>
            <span
              className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-mono font-bold text-white"
              style={{ background: current.color }}
            >
              {current.icon}
            </span>
            <span className="text-xs font-mono font-bold text-white flex-1 text-left">
              {current.name}
            </span>
          </>
        ) : (
          <span className="text-xs font-mono text-black-500 flex-1 text-left">Select chain</span>
        )}
        <svg width="10" height="10" viewBox="0 0 10 10" className="text-black-500">
          <path d="M2.5 4L5 6.5 7.5 4" stroke="currentColor" fill="none" strokeWidth="1.2" />
        </svg>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="absolute top-full mt-1 left-0 right-0 rounded-xl border overflow-hidden z-50"
            style={{
              background: 'rgba(10,10,10,0.95)',
              borderColor: `${CYAN}20`,
              backdropFilter: 'blur(20px)',
            }}
          >
            {chains.map((chain) => (
              <button
                key={chain.id}
                onClick={() => {
                  onSelect?.(chain.id)
                  setOpen(false)
                }}
                className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/5 transition-colors"
                style={{
                  background: selected === chain.id ? `${CYAN}08` : 'transparent',
                }}
              >
                <span
                  className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-mono font-bold text-white"
                  style={{ background: chain.color }}
                >
                  {chain.icon}
                </span>
                <span className="text-xs font-mono text-white">{chain.name}</span>
                {selected === chain.id && (
                  <span className="ml-auto text-[9px]" style={{ color: CYAN }}>✓</span>
                )}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
