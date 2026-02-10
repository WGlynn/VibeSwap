import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// Token data with game-like attributes
const INVENTORY_ITEMS = [
  {
    symbol: 'ETH',
    name: 'Ethereum',
    balance: '2.5000',
    valueUsd: 5000,
    tier: 'legendary',
    icon: 'Ξ',
    color: '#627EEA',
    description: 'The native currency of the Ethereum realm',
    stats: { liquidity: 'MAX', volatility: 'HIGH', utility: 'MAX' },
  },
  {
    symbol: 'WBTC',
    name: 'Wrapped Bitcoin',
    balance: '0.1500',
    valueUsd: 6300,
    tier: 'legendary',
    icon: '₿',
    color: '#F7931A',
    description: 'Ancient digital gold, wrapped for travel',
    stats: { liquidity: 'HIGH', volatility: 'MED', utility: 'MED' },
  },
  {
    symbol: 'USDC',
    name: 'USD Coin',
    balance: '5,000.00',
    valueUsd: 5000,
    tier: 'rare',
    icon: '$',
    color: '#2775CA',
    description: 'Stable currency backed by the old world',
    stats: { liquidity: 'MAX', volatility: 'NONE', utility: 'HIGH' },
  },
  {
    symbol: 'ARB',
    name: 'Arbitrum',
    balance: '1,200.00',
    valueUsd: 1440,
    tier: 'epic',
    icon: '◆',
    color: '#28A0F0',
    description: 'Token of the Arbitrum layer',
    stats: { liquidity: 'MED', volatility: 'HIGH', utility: 'MED' },
  },
  {
    symbol: 'OP',
    name: 'Optimism',
    balance: '500.00',
    valueUsd: 1250,
    tier: 'epic',
    icon: '◯',
    color: '#FF0420',
    description: 'Currency of the Optimistic realm',
    stats: { liquidity: 'MED', volatility: 'HIGH', utility: 'MED' },
  },
]

const TIER_CONFIG = {
  legendary: {
    label: 'LEGENDARY',
    bg: 'bg-gradient-to-br from-amber-500/20 to-orange-600/20',
    border: 'border-amber-500/50',
    text: 'text-amber-400',
    glow: 'shadow-[0_0_30px_rgba(245,158,11,0.2)]',
    headerBg: 'bg-gradient-to-r from-amber-500/30 to-transparent',
  },
  epic: {
    label: 'EPIC',
    bg: 'bg-gradient-to-br from-purple-500/20 to-pink-600/20',
    border: 'border-purple-500/50',
    text: 'text-purple-400',
    glow: 'shadow-[0_0_25px_rgba(168,85,247,0.15)]',
    headerBg: 'bg-gradient-to-r from-purple-500/30 to-transparent',
  },
  rare: {
    label: 'RARE',
    bg: 'bg-gradient-to-br from-blue-500/20 to-cyan-600/20',
    border: 'border-blue-500/50',
    text: 'text-blue-400',
    glow: 'shadow-[0_0_20px_rgba(59,130,246,0.15)]',
    headerBg: 'bg-gradient-to-r from-blue-500/30 to-transparent',
  },
  common: {
    label: 'COMMON',
    bg: 'bg-black-800',
    border: 'border-black-500',
    text: 'text-black-400',
    glow: '',
    headerBg: 'bg-black-700',
  },
}

function InventoryItem({ item, onSelect, isSelected }) {
  const tier = TIER_CONFIG[item.tier]

  return (
    <motion.div
      whileHover={{ scale: 1.02, y: -2 }}
      whileTap={{ scale: 0.98 }}
      onClick={() => onSelect(item)}
      className={`relative cursor-pointer rounded-lg border overflow-hidden transition-all ${tier.border} ${tier.bg} ${tier.glow} ${
        isSelected ? 'ring-2 ring-matrix-500' : ''
      }`}
    >
      {/* Tier header */}
      <div className={`px-3 py-1.5 ${tier.headerBg} border-b ${tier.border}`}>
        <span className={`text-[9px] font-bold tracking-wider ${tier.text}`}>{tier.label}</span>
      </div>

      {/* Item content */}
      <div className="p-3">
        <div className="flex items-start justify-between mb-2">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center text-xl font-bold"
            style={{ backgroundColor: item.color + '30', color: item.color }}
          >
            {item.icon}
          </div>
          <div className="text-right">
            <div className="text-sm font-mono font-bold">{item.balance}</div>
            <div className="text-[10px] text-black-500">${item.valueUsd.toLocaleString()}</div>
          </div>
        </div>

        <div className="mt-2">
          <div className="text-sm font-bold">{item.symbol}</div>
          <div className="text-[10px] text-black-500">{item.name}</div>
        </div>
      </div>
    </motion.div>
  )
}

function ItemDetailModal({ item, onClose }) {
  if (!item) return null
  const tier = TIER_CONFIG[item.tier]

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black-900/90"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className={`max-w-sm w-full rounded-lg border overflow-hidden ${tier.border} ${tier.bg} ${tier.glow}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`px-4 py-3 ${tier.headerBg} border-b ${tier.border} flex items-center justify-between`}>
          <span className={`text-xs font-bold tracking-wider ${tier.text}`}>{tier.label}</span>
          <button onClick={onClose} className="text-black-400 hover:text-white">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Item display */}
        <div className="p-6 text-center">
          <motion.div
            animate={{ rotate: [0, 5, -5, 0] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="w-20 h-20 mx-auto rounded-xl flex items-center justify-center text-4xl font-bold mb-4"
            style={{ backgroundColor: item.color + '30', color: item.color }}
          >
            {item.icon}
          </motion.div>

          <h3 className="text-xl font-bold">{item.symbol}</h3>
          <p className="text-sm text-black-400">{item.name}</p>
          <p className="text-xs text-black-500 mt-2 italic">"{item.description}"</p>
        </div>

        {/* Stats */}
        <div className="px-6 pb-4">
          <div className="text-[10px] text-black-500 uppercase tracking-wider mb-2">Attributes</div>
          <div className="space-y-2">
            {Object.entries(item.stats).map(([stat, value]) => (
              <div key={stat} className="flex items-center justify-between text-xs">
                <span className="text-black-400 capitalize">{stat}</span>
                <div className="flex items-center space-x-1">
                  {['MAX', 'HIGH', 'MED', 'LOW', 'NONE'].map((level, i) => (
                    <div
                      key={level}
                      className={`w-3 h-1.5 rounded-sm ${
                        ['MAX', 'HIGH', 'MED', 'LOW'].slice(0, ['MAX', 'HIGH', 'MED', 'LOW', 'NONE'].indexOf(value) + 1).includes(level)
                          ? 'bg-matrix-500'
                          : 'bg-black-600'
                      }`}
                    />
                  ))}
                  <span className="text-black-300 font-mono ml-1">{value}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Balance */}
        <div className="px-6 py-4 border-t border-black-600 bg-black-900/50">
          <div className="flex items-center justify-between">
            <span className="text-xs text-black-500">Your Holdings</span>
            <div className="text-right">
              <div className="font-mono font-bold">{item.balance} {item.symbol}</div>
              <div className="text-xs text-black-500">${item.valueUsd.toLocaleString()}</div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="p-4 border-t border-black-600 grid grid-cols-2 gap-3">
          <button className="py-2 rounded-lg bg-matrix-600 hover:bg-matrix-500 text-black-900 text-sm font-bold">
            Trade
          </button>
          <button className="py-2 rounded-lg bg-black-700 hover:bg-black-600 border border-black-500 text-sm font-medium">
            Stake
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

function Inventory() {
  const [selectedItem, setSelectedItem] = useState(null)
  const [filter, setFilter] = useState('all')

  const totalValue = INVENTORY_ITEMS.reduce((sum, item) => sum + item.valueUsd, 0)

  const filteredItems = INVENTORY_ITEMS.filter((item) => {
    if (filter === 'all') return true
    return item.tier === filter
  })

  return (
    <div className="surface rounded-lg overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-black-600">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-2">
            <svg className="w-5 h-5 text-matrix-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M3 9h18M9 3v18" />
            </svg>
            <h3 className="text-sm font-bold">Inventory</h3>
          </div>
          <div className="text-right">
            <div className="text-sm font-mono font-bold text-matrix-500">${totalValue.toLocaleString()}</div>
            <div className="text-[10px] text-black-500">total value</div>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex items-center space-x-1">
          {['all', 'legendary', 'epic', 'rare'].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2 py-1 text-[10px] rounded transition-colors capitalize ${
                filter === f
                  ? f === 'legendary' ? 'bg-amber-500/20 text-amber-400' :
                    f === 'epic' ? 'bg-purple-500/20 text-purple-400' :
                    f === 'rare' ? 'bg-blue-500/20 text-blue-400' :
                    'bg-black-600 text-white'
                  : 'text-black-400 hover:text-black-300'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Items grid */}
      <div className="p-4 grid grid-cols-2 gap-3 max-h-96 overflow-y-auto">
        {filteredItems.map((item) => (
          <InventoryItem
            key={item.symbol}
            item={item}
            onSelect={setSelectedItem}
            isSelected={selectedItem?.symbol === item.symbol}
          />
        ))}
      </div>

      {/* Item detail modal */}
      <AnimatePresence>
        {selectedItem && (
          <ItemDetailModal item={selectedItem} onClose={() => setSelectedItem(null)} />
        )}
      </AnimatePresence>
    </div>
  )
}

export default Inventory
