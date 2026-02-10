import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useBatchState } from '../hooks/useBatchState'
import TradingPost from './TradingPost'
import Inventory from './Inventory'
import LootChest from './LootChest'
import PlayerStats from './PlayerStats'

// Sound effects hook (optional - can be enabled by user)
function useSoundEffects(enabled) {
  const playSound = (type) => {
    if (!enabled) return
    // In production, these would be actual audio files
    const sounds = {
      batch_start: '/sounds/bell.mp3',
      trade_complete: '/sounds/success.mp3',
      loot_drop: '/sounds/chest.mp3',
      level_up: '/sounds/fanfare.mp3',
    }
    // console.log('Playing sound:', type)
  }
  return { playSound }
}

function GameSwapPage() {
  const { isConnected, connect, isConnecting } = useWallet()
  const { phase, PHASES } = useBatchState()
  const [soundEnabled, setSoundEnabled] = useState(false)
  const [showMobileInventory, setShowMobileInventory] = useState(false)
  const [showMobileLoot, setShowMobileLoot] = useState(false)
  const [showMobileProfile, setShowMobileProfile] = useState(false)

  const { playSound } = useSoundEffects(soundEnabled)

  // Play sound on phase change
  useEffect(() => {
    if (phase === PHASES.COMMIT) {
      playSound('batch_start')
    }
  }, [phase])

  return (
    <div className="w-full max-w-7xl mx-auto px-4 py-4">
      {/* Top Bar - Player Status */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          {isConnected ? (
            <>
              {/* Mini player badge */}
              <div className="flex items-center space-x-2 px-3 py-2 rounded-lg bg-black-800 border border-black-500">
                <div className="w-6 h-6 rounded-full bg-matrix-500/30 flex items-center justify-center text-xs font-bold text-matrix-500">
                  12
                </div>
                <div>
                  <div className="text-xs font-mono">0x1234...5678</div>
                  <div className="text-[10px] text-black-500">Trader • 2,847 XP</div>
                </div>
              </div>
              <div className="hidden sm:flex items-center space-x-1 px-2 py-1 rounded bg-amber-500/10 border border-amber-500/30">
                <span className="text-sm">🔥</span>
                <span className="text-xs font-bold text-amber-400">12</span>
              </div>
            </>
          ) : (
            <button
              onClick={connect}
              disabled={isConnecting}
              className="px-4 py-2 rounded-lg bg-matrix-600 hover:bg-matrix-500 text-black-900 font-bold text-sm"
            >
              {isConnecting ? 'Connecting...' : 'Enter Trading Post'}
            </button>
          )}
        </div>

        {/* Settings */}
        <div className="flex items-center space-x-2">
          {/* Sound toggle */}
          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className={`p-2 rounded-lg border transition-colors ${
              soundEnabled
                ? 'bg-matrix-500/20 border-matrix-500/30 text-matrix-500'
                : 'bg-black-800 border-black-500 text-black-400'
            }`}
            title={soundEnabled ? 'Mute sounds' : 'Enable sounds'}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
              {soundEnabled ? (
                <path d="M15.536 8.464a5 5 0 010 7.072M17.95 6.05a8 8 0 010 11.9M6.5 8.5l5-5v17l-5-5H3v-7h3.5z" />
              ) : (
                <path d="M5.586 15.414l12.828-12.828M6.5 8.5l5-5v17l-5-5H3v-7h3.5z" />
              )}
            </svg>
          </button>

          {/* Mobile inventory toggle */}
          <button
            onClick={() => setShowMobileInventory(!showMobileInventory)}
            className="lg:hidden p-2 rounded-lg bg-black-800 border border-black-500 text-black-400"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M3 9h18M9 3v18" />
            </svg>
          </button>
        </div>
      </div>

      {/* Main Game Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Sidebar - Player & Inventory */}
        <div className="hidden lg:block lg:col-span-3 space-y-4">
          <PlayerStats isConnected={isConnected} />
          <Inventory />
        </div>

        {/* Center - Trading Post */}
        <div className="lg:col-span-6">
          <TradingPost />
        </div>

        {/* Right Sidebar - Loot & Activity */}
        <div className="hidden lg:block lg:col-span-3 space-y-4">
          <LootChest isConnected={isConnected} />

          {/* Recent Trades Feed */}
          <div className="surface rounded-lg overflow-hidden">
            <div className="p-4 border-b border-black-600">
              <h3 className="text-sm font-bold flex items-center space-x-2">
                <svg className="w-4 h-4 text-matrix-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <span>Live Trades</span>
              </h3>
            </div>
            <div className="p-3 space-y-2 max-h-48 overflow-y-auto">
              {[
                { from: 'ETH', to: 'USDC', amount: '1.5', time: '2s' },
                { from: 'USDC', to: 'ARB', amount: '500', time: '5s' },
                { from: 'WBTC', to: 'ETH', amount: '0.02', time: '8s' },
              ].map((trade, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.1 }}
                  className="flex items-center justify-between p-2 rounded bg-black-700/50"
                >
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-mono">{trade.amount}</span>
                    <span className="text-xs text-black-500">{trade.from}</span>
                    <svg className="w-3 h-3 text-black-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                    </svg>
                    <span className="text-xs text-black-500">{trade.to}</span>
                  </div>
                  <span className="text-[10px] text-black-500">{trade.time}</span>
                </motion.div>
              ))}
            </div>
          </div>

          {/* Daily Quests Teaser */}
          <div className="surface rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold flex items-center space-x-2">
                <span className="text-lg">📜</span>
                <span>Daily Quests</span>
              </h3>
              <span className="text-xs text-matrix-500">2/3</span>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between p-2 rounded bg-matrix-500/10 border border-matrix-500/30">
                <span className="text-xs">Complete 3 trades</span>
                <span className="text-xs text-matrix-500">✓</span>
              </div>
              <div className="flex items-center justify-between p-2 rounded bg-matrix-500/10 border border-matrix-500/30">
                <span className="text-xs">Trade $100+ volume</span>
                <span className="text-xs text-matrix-500">✓</span>
              </div>
              <div className="flex items-center justify-between p-2 rounded bg-black-700/50 border border-black-600">
                <span className="text-xs text-black-400">Use priority bid</span>
                <span className="text-xs text-black-500">0/1</span>
              </div>
            </div>
            <div className="mt-3 text-center">
              <span className="text-[10px] text-black-500">Complete all for +100 XP bonus</span>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Inventory Drawer */}
      <AnimatePresence>
        {showMobileInventory && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 lg:hidden"
            onClick={() => setShowMobileInventory(false)}
          >
            <div className="absolute inset-0 bg-black-900/80" />
            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 25 }}
              className="absolute left-0 top-0 bottom-0 w-80 bg-black-800 border-r border-black-600 overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-4 border-b border-black-600 flex items-center justify-between">
                <h2 className="font-bold">Your Inventory</h2>
                <button
                  onClick={() => setShowMobileInventory(false)}
                  className="p-1 rounded hover:bg-black-700"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="p-4 space-y-4">
                <Inventory />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile Loot Drawer */}
      <AnimatePresence>
        {showMobileLoot && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 lg:hidden"
            onClick={() => setShowMobileLoot(false)}
          >
            <div className="absolute inset-0 bg-black-900/80" />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25 }}
              className="absolute right-0 top-0 bottom-0 w-80 bg-black-800 border-l border-black-600 overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-4 border-b border-black-600 flex items-center justify-between">
                <h2 className="font-bold flex items-center space-x-2">
                  <svg className="w-5 h-5 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                  <span>Loot Drops</span>
                </h2>
                <button
                  onClick={() => setShowMobileLoot(false)}
                  className="p-1 rounded hover:bg-black-700"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="p-4">
                <LootChest isConnected={isConnected} />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile Profile Drawer */}
      <AnimatePresence>
        {showMobileProfile && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 lg:hidden"
            onClick={() => setShowMobileProfile(false)}
          >
            <div className="absolute inset-0 bg-black-900/80" />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25 }}
              className="absolute left-0 right-0 bottom-0 max-h-[85vh] bg-black-800 border-t border-black-600 rounded-t-2xl overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-4 border-b border-black-600 flex items-center justify-between">
                <h2 className="font-bold flex items-center space-x-2">
                  <svg className="w-5 h-5 text-matrix-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                  <span>Your Profile</span>
                </h2>
                <button
                  onClick={() => setShowMobileProfile(false)}
                  className="p-1 rounded hover:bg-black-700"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="p-4 pb-20">
                <PlayerStats isConnected={isConnected} />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom Mobile Nav */}
      <div className="fixed bottom-0 left-0 right-0 lg:hidden bg-black-800 border-t border-black-600 p-2 z-40">
        <div className="flex items-center justify-around">
          <button className="flex flex-col items-center p-2 text-matrix-500">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M7 10l5-5 5 5M7 14l5 5 5-5" />
            </svg>
            <span className="text-[10px] mt-1">Trade</span>
          </button>
          <button
            onClick={() => setShowMobileInventory(true)}
            className="flex flex-col items-center p-2 text-black-400"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M3 9h18M9 3v18" />
            </svg>
            <span className="text-[10px] mt-1">Inventory</span>
          </button>
          <button
            onClick={() => setShowMobileLoot(true)}
            className="flex flex-col items-center p-2 text-black-400"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
            <span className="text-[10px] mt-1">Loot</span>
          </button>
          <button
            onClick={() => setShowMobileProfile(true)}
            className="flex flex-col items-center p-2 text-black-400"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            <span className="text-[10px] mt-1">Profile</span>
          </button>
        </div>
      </div>
    </div>
  )
}

export default GameSwapPage
