import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// Loot types with rarity
const LOOT_TYPES = {
  trading_fees: { label: 'Trading Fees', icon: '◇', color: '#00ff41', tier: 'common' },
  shapley_bonus: { label: 'Shapley Bonus', icon: '≡', color: '#00d4ff', tier: 'rare' },
  lp_rewards: { label: 'LP Rewards', icon: '◈', color: '#a855f7', tier: 'epic' },
  loyalty_drop: { label: 'Loyalty Drop', icon: '★', color: '#f59e0b', tier: 'legendary' },
  il_protection: { label: 'IL Shield', icon: '◆', color: '#22c55e', tier: 'rare' },
}

const TIER_GLOW = {
  common: '',
  rare: 'shadow-[0_0_30px_rgba(0,212,255,0.3)]',
  epic: 'shadow-[0_0_40px_rgba(168,85,247,0.4)]',
  legendary: 'shadow-[0_0_50px_rgba(245,158,11,0.5)]',
}

// Mock pending loot
const PENDING_LOOT = [
  { id: 1, type: 'trading_fees', amount: 12.45, token: 'USDC' },
  { id: 2, type: 'shapley_bonus', amount: 3.21, token: 'USDC' },
  { id: 3, type: 'lp_rewards', amount: 0.0015, token: 'ETH' },
  { id: 4, type: 'loyalty_drop', amount: 25.00, token: 'ARB' },
]

function ChestOpenAnimation({ loot, onComplete }) {
  const [stage, setStage] = useState('closed') // closed, opening, revealing, done

  const lootInfo = LOOT_TYPES[loot.type]

  const startOpen = () => {
    setStage('opening')
    setTimeout(() => setStage('revealing'), 800)
    setTimeout(() => setStage('done'), 1500)
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black-900/95"
      onClick={stage === 'done' ? onComplete : undefined}
    >
      <div className="text-center">
        {/* Chest */}
        <motion.div
          className="relative w-32 h-32 mx-auto mb-8"
          animate={
            stage === 'opening' ? { scale: [1, 1.1, 1.2, 1.1], rotate: [0, -5, 5, 0] } :
            stage === 'revealing' ? { scale: 1.3, y: -20 } :
            {}
          }
          transition={{ duration: 0.8 }}
        >
          {/* Chest body */}
          <div className={`w-full h-full rounded-lg bg-gradient-to-br from-amber-700 to-amber-900 border-2 border-amber-600 ${
            stage === 'revealing' || stage === 'done' ? TIER_GLOW[lootInfo.tier] : ''
          }`}>
            {/* Chest lid */}
            <motion.div
              className="absolute -top-4 left-0 right-0 h-10 bg-gradient-to-br from-amber-600 to-amber-800 rounded-t-lg border-2 border-amber-500"
              animate={stage === 'opening' || stage === 'revealing' || stage === 'done' ? { rotateX: -120, y: -20 } : {}}
              style={{ transformOrigin: 'top', transformStyle: 'preserve-3d' }}
            />
            {/* Lock */}
            {stage === 'closed' && (
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 bg-amber-500 rounded-full flex items-center justify-center">
                <svg className="w-4 h-4 text-amber-900" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                </svg>
              </div>
            )}
          </div>

          {/* Glow rays when revealing */}
          {(stage === 'revealing' || stage === 'done') && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="absolute inset-0 flex items-center justify-center"
            >
              {[...Array(8)].map((_, i) => (
                <motion.div
                  key={i}
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 2, opacity: [0, 1, 0] }}
                  transition={{ delay: i * 0.1, duration: 1 }}
                  className="absolute w-1 h-16 rounded-full"
                  style={{
                    background: `linear-gradient(to top, ${lootInfo.color}, transparent)`,
                    transform: `rotate(${i * 45}deg)`,
                  }}
                />
              ))}
            </motion.div>
          )}
        </motion.div>

        {/* Loot reveal */}
        <AnimatePresence>
          {stage === 'done' && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-4"
            >
              <div
                className="inline-flex items-center justify-center w-16 h-16 rounded-xl text-3xl mx-auto"
                style={{ backgroundColor: lootInfo.color + '30', color: lootInfo.color }}
              >
                {lootInfo.icon}
              </div>
              <div>
                <div className="text-xs text-black-500 uppercase tracking-wider">{lootInfo.label}</div>
                <div className="text-3xl font-bold font-mono mt-1">{loot.amount} {loot.token}</div>
              </div>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={onComplete}
                className="px-8 py-3 rounded-lg bg-matrix-600 hover:bg-matrix-500 text-black-900 font-bold"
              >
                Collect
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Open prompt */}
        {stage === 'closed' && (
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={startOpen}
            className="px-8 py-3 rounded-lg bg-amber-600 hover:bg-amber-500 text-black font-bold"
          >
            Open Chest
          </motion.button>
        )}

        {stage === 'opening' && (
          <div className="text-black-400">Opening...</div>
        )}
      </div>
    </motion.div>
  )
}

function LootChest({ isConnected }) {
  const [openingLoot, setOpeningLoot] = useState(null)
  const [claimedIds, setClaimedIds] = useState([])

  const pendingLoot = PENDING_LOOT.filter(l => !claimedIds.includes(l.id))
  const totalPending = pendingLoot.reduce((sum, l) => {
    // Convert to USD equivalent (mock)
    const usdValue = l.token === 'ETH' ? l.amount * 2000 :
                     l.token === 'ARB' ? l.amount * 1.2 :
                     l.amount
    return sum + usdValue
  }, 0)

  const handleClaim = (loot) => {
    setOpeningLoot(loot)
  }

  const handleCollected = () => {
    if (openingLoot) {
      setClaimedIds([...claimedIds, openingLoot.id])
    }
    setOpeningLoot(null)
  }

  if (!isConnected) return null

  return (
    <>
      <div className="surface rounded-lg overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-black-600">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <svg className="w-5 h-5 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
              <h3 className="text-sm font-bold">Loot Drops</h3>
            </div>
            {pendingLoot.length > 0 && (
              <div className="px-2 py-1 rounded bg-matrix-500/20 border border-matrix-500/30">
                <span className="text-xs font-mono text-matrix-500">{pendingLoot.length} pending</span>
              </div>
            )}
          </div>
          {totalPending > 0 && (
            <div className="mt-2 text-xs text-black-500">
              ~${totalPending.toFixed(2)} ready to claim
            </div>
          )}
        </div>

        {/* Loot list */}
        <div className="p-3 space-y-2 max-h-64 overflow-y-auto">
          {pendingLoot.length === 0 ? (
            <div className="text-center py-6">
              <div className="w-12 h-12 mx-auto mb-3 rounded-lg bg-black-700 flex items-center justify-center">
                <svg className="w-6 h-6 text-black-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
              </div>
              <p className="text-sm text-black-400 font-medium">No rewards yet</p>
              <p className="text-xs text-black-500 mt-1 mb-4">Complete your first exchange to start earning</p>
              <a
                href="/swap"
                className="inline-flex items-center space-x-2 px-4 py-2 rounded-lg bg-matrix-600 hover:bg-matrix-500 text-black-900 font-medium text-sm transition-colors"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M7 10l5-5 5 5M7 14l5 5 5-5" />
                </svg>
                <span>Start Trading</span>
              </a>
            </div>
          ) : (
            pendingLoot.map((loot) => {
              const info = LOOT_TYPES[loot.type]
              return (
                <motion.div
                  key={loot.id}
                  whileHover={{ scale: 1.02 }}
                  className={`p-3 rounded-lg bg-black-700/50 border border-black-600 hover:border-black-500 cursor-pointer ${TIER_GLOW[info.tier]}`}
                  onClick={() => handleClaim(loot)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div
                        className="w-8 h-8 rounded flex items-center justify-center text-lg"
                        style={{ backgroundColor: info.color + '20', color: info.color }}
                      >
                        {info.icon}
                      </div>
                      <div>
                        <div className="text-sm font-medium">{info.label}</div>
                        <div className="text-[10px] text-black-500">Tap to claim</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-mono font-bold">{loot.amount}</div>
                      <div className="text-[10px] text-black-500">{loot.token}</div>
                    </div>
                  </div>
                </motion.div>
              )
            })
          )}
        </div>

        {/* Claim all button */}
        {pendingLoot.length > 1 && (
          <div className="p-3 border-t border-black-600">
            <button className="w-full py-2 rounded-lg bg-black-700 hover:bg-black-600 border border-black-500 text-sm font-medium">
              Claim All ({pendingLoot.length})
            </button>
          </div>
        )}
      </div>

      {/* Chest opening animation */}
      <AnimatePresence>
        {openingLoot && (
          <ChestOpenAnimation loot={openingLoot} onComplete={handleCollected} />
        )}
      </AnimatePresence>
    </>
  )
}

export default LootChest
