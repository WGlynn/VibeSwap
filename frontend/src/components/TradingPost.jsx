import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useBatchState } from '../hooks/useBatchState'

// Token rarity tiers (like item quality in games)
const TOKEN_TIERS = {
  ETH: { tier: 'legendary', color: '#627EEA', glow: 'shadow-[0_0_20px_rgba(98,126,234,0.3)]' },
  WBTC: { tier: 'legendary', color: '#F7931A', glow: 'shadow-[0_0_20px_rgba(247,147,26,0.3)]' },
  USDC: { tier: 'rare', color: '#2775CA', glow: 'shadow-[0_0_15px_rgba(39,117,202,0.2)]' },
  ARB: { tier: 'epic', color: '#28A0F0', glow: 'shadow-[0_0_18px_rgba(40,160,240,0.25)]' },
  OP: { tier: 'epic', color: '#FF0420', glow: 'shadow-[0_0_18px_rgba(255,4,32,0.25)]' },
}

const TIER_LABELS = {
  legendary: { label: 'LEGENDARY', bg: 'bg-amber-500/20', text: 'text-amber-400', border: 'border-amber-500/50' },
  epic: { label: 'EPIC', bg: 'bg-purple-500/20', text: 'text-purple-400', border: 'border-purple-500/50' },
  rare: { label: 'RARE', bg: 'bg-blue-500/20', text: 'text-blue-400', border: 'border-blue-500/50' },
  common: { label: 'COMMON', bg: 'bg-black-600', text: 'text-black-300', border: 'border-black-500' },
}

// The main trading interface - feels like a Grand Exchange
function TradingPost() {
  const { isConnected } = useWallet()
  const { phase, timeLeft, batchQueue, PHASES } = useBatchState()

  const [offering, setOffering] = useState({ token: 'ETH', amount: '' })
  const [seeking, setSeeking] = useState({ token: 'USDC', amount: '' })
  const [isStealthActive, setIsStealthActive] = useState(true)
  const [showOfferPosted, setShowOfferPosted] = useState(false)

  const isAcceptingOffers = phase === PHASES.COMMIT
  const offerTier = TOKEN_TIERS[offering.token] || { tier: 'common' }
  const seekTier = TOKEN_TIERS[seeking.token] || { tier: 'common' }

  return (
    <div className="max-w-2xl mx-auto">
      {/* Trading Post Header */}
      <div className="text-center mb-6">
        <div className="inline-flex items-center space-x-2 px-4 py-2 rounded-lg bg-black-800 border border-matrix-500/30 mb-4">
          <div className="w-2 h-2 rounded-full bg-matrix-500 animate-pulse" />
          <span className="text-sm font-bold text-matrix-500 tracking-wider">TRADING POST</span>
        </div>
        <p className="text-xs text-black-400">post your offer • wait for the bell • collect your trade</p>
      </div>

      {/* Auction Round Timer - like a game round */}
      <div className="mb-6 p-4 rounded-lg bg-black-800 border border-black-500">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-3">
            <div className={`relative ${isAcceptingOffers ? 'text-matrix-500' : 'text-warning'}`}>
              {/* Bell icon */}
              <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" />
              </svg>
              {isAcceptingOffers && (
                <div className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-matrix-500 animate-ping" />
              )}
            </div>
            <div>
              <div className="text-sm font-bold">
                {isAcceptingOffers ? 'Accepting Offers' : phase === PHASES.REVEAL ? 'Sealing Trades' : 'Matching...'}
              </div>
              <div className="text-xs text-black-500">round #{batchQueue?.batchId || '---'}</div>
            </div>
          </div>

          {/* Countdown - prominent like game timer */}
          <div className="text-right">
            <div className={`font-mono text-3xl font-bold tabular-nums ${isAcceptingOffers ? 'text-matrix-500' : 'text-warning'}`}>
              {String(timeLeft).padStart(2, '0')}
            </div>
            <div className="text-[10px] text-black-500 uppercase tracking-wider">seconds</div>
          </div>
        </div>

        {/* Progress bar styled like loading/cooldown bar */}
        <div className="h-2 bg-black-700 rounded-full overflow-hidden">
          <motion.div
            className={`h-full ${isAcceptingOffers ? 'bg-matrix-500' : 'bg-warning'}`}
            style={{ width: `${((10 - timeLeft) / 10) * 100}%` }}
            transition={{ duration: 0.5 }}
          />
        </div>

        {/* Queue stats - like player count in lobby */}
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div className="px-2 py-1 rounded bg-black-700">
            <div className="text-sm font-bold font-mono">{batchQueue?.orderCount || 0}</div>
            <div className="text-[9px] text-black-500 uppercase">offers</div>
          </div>
          <div className="px-2 py-1 rounded bg-black-700">
            <div className="text-sm font-bold font-mono text-terminal-500">
              ${((batchQueue?.totalValue || 0) / 1000).toFixed(0)}K
            </div>
            <div className="text-[9px] text-black-500 uppercase">volume</div>
          </div>
          <div className="px-2 py-1 rounded bg-black-700">
            <div className="text-sm font-bold font-mono text-matrix-500">{batchQueue?.priorityOrders || 0}</div>
            <div className="text-[9px] text-black-500 uppercase">priority</div>
          </div>
        </div>
      </div>

      {/* Trade Offer Card - styled like item exchange */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-lg bg-black-800 border border-black-500 overflow-hidden"
      >
        {/* Stealth Mode Banner */}
        <div className="px-4 py-2 bg-matrix-500/10 border-b border-matrix-500/20 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <svg className="w-4 h-4 text-matrix-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12 2L4 7v6c0 5.55 3.84 10.74 8 12 4.16-1.26 8-6.45 8-12V7l-8-5z" />
            </svg>
            <span className="text-xs font-medium text-matrix-500">Stealth Cloak Active</span>
          </div>
          <span className="text-[10px] text-black-500">your offer is hidden from others</span>
        </div>

        <div className="p-5">
          {/* OFFERING Section */}
          <div className="mb-4">
            <div className="flex items-center space-x-2 mb-2">
              <span className="text-xs text-black-400 uppercase tracking-wider">Offering</span>
              <div className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${TIER_LABELS[offerTier.tier].bg} ${TIER_LABELS[offerTier.tier].text}`}>
                {TIER_LABELS[offerTier.tier].label}
              </div>
            </div>
            <div className={`p-4 rounded-lg bg-black-900 border ${TIER_LABELS[offerTier.tier].border} ${offerTier.glow}`}>
              <div className="flex items-center justify-between">
                <input
                  type="number"
                  value={offering.amount}
                  onChange={(e) => setOffering({ ...offering, amount: e.target.value })}
                  placeholder="0.00"
                  className="bg-transparent text-2xl font-mono font-bold outline-none w-32"
                />
                <button className="flex items-center space-x-2 px-3 py-2 rounded-lg bg-black-700 border border-black-500 hover:border-black-400">
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center text-sm font-bold"
                    style={{ backgroundColor: offerTier.color + '30', color: offerTier.color }}
                  >
                    Ξ
                  </div>
                  <span className="font-medium">{offering.token}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Swap Direction Arrow */}
          <div className="flex justify-center -my-2 relative z-10">
            <div className="w-10 h-10 rounded-full bg-black-700 border border-black-500 flex items-center justify-center">
              <svg className="w-5 h-5 text-black-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 5v14M5 12l7 7 7-7" />
              </svg>
            </div>
          </div>

          {/* SEEKING Section */}
          <div className="mt-4">
            <div className="flex items-center space-x-2 mb-2">
              <span className="text-xs text-black-400 uppercase tracking-wider">Seeking</span>
              <div className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${TIER_LABELS[seekTier.tier].bg} ${TIER_LABELS[seekTier.tier].text}`}>
                {TIER_LABELS[seekTier.tier].label}
              </div>
            </div>
            <div className={`p-4 rounded-lg bg-black-900 border ${TIER_LABELS[seekTier.tier].border}`}>
              <div className="flex items-center justify-between">
                <input
                  type="number"
                  value={seeking.amount}
                  placeholder="0.00"
                  readOnly
                  className="bg-transparent text-2xl font-mono font-bold outline-none w-32 text-black-300"
                />
                <button className="flex items-center space-x-2 px-3 py-2 rounded-lg bg-black-700 border border-black-500 hover:border-black-400">
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center text-sm font-bold"
                    style={{ backgroundColor: seekTier.color + '30', color: seekTier.color }}
                  >
                    $
                  </div>
                  <span className="font-medium">{seeking.token}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Trade Summary - like item stats */}
          {offering.amount && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="mt-4 p-3 rounded-lg bg-black-900/50 border border-black-600"
            >
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="flex justify-between">
                  <span className="text-black-500">Exchange Rate</span>
                  <span className="font-mono">1:2000</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-black-500">Post Fee</span>
                  <span className="font-mono text-matrix-500">0.05%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-black-500">Est. Fill Time</span>
                  <span className="font-mono">{timeLeft}s</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-black-500">Protection</span>
                  <span className="font-mono text-matrix-500">MAX</span>
                </div>
              </div>
            </motion.div>
          )}

          {/* Post Offer Button */}
          <button
            disabled={!isAcceptingOffers || !offering.amount}
            className={`w-full mt-5 py-4 rounded-lg font-bold text-sm uppercase tracking-wider transition-all ${
              isAcceptingOffers && offering.amount
                ? 'bg-matrix-600 hover:bg-matrix-500 text-black-900 border border-matrix-500'
                : 'bg-black-700 text-black-500 border border-black-600 cursor-not-allowed'
            }`}
          >
            {!isConnected ? 'Connect Inventory' :
             !isAcceptingOffers ? 'Wait for Next Round' :
             !offering.amount ? 'Enter Offer Amount' :
             'Post Offer'}
          </button>

          {/* Keyboard shortcut hint */}
          <div className="mt-3 text-center">
            <span className="text-[10px] text-black-600">
              <kbd className="px-1 py-0.5 rounded bg-black-700 border border-black-600 font-mono">⌘</kbd>
              {' + '}
              <kbd className="px-1 py-0.5 rounded bg-black-700 border border-black-600 font-mono">↵</kbd>
              {' to quick post'}
            </span>
          </div>
        </div>
      </motion.div>

      {/* Active Offers Queue - like GE slots */}
      <div className="mt-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold">Your Offers</h3>
          <span className="text-xs text-black-500">0/4 slots</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((slot) => (
            <div
              key={slot}
              className="p-4 rounded-lg bg-black-800 border border-dashed border-black-600 text-center"
            >
              <div className="w-8 h-8 mx-auto mb-2 rounded-lg bg-black-700 flex items-center justify-center">
                <svg className="w-4 h-4 text-black-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </div>
              <span className="text-xs text-black-500">Empty Slot</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default TradingPost
