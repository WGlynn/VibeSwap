import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'

// Player level thresholds
const LEVELS = [
  { level: 1, xp: 0, title: 'Newcomer', color: '#6b7280' },
  { level: 2, xp: 100, title: 'Apprentice', color: '#3b82f6' },
  { level: 3, xp: 500, title: 'Trader', color: '#22c55e' },
  { level: 4, xp: 1500, title: 'Merchant', color: '#a855f7' },
  { level: 5, xp: 5000, title: 'Master', color: '#f59e0b' },
  { level: 6, xp: 15000, title: 'Grandmaster', color: '#ef4444' },
  { level: 7, xp: 50000, title: 'Legend', color: '#00ff41' },
]

// Achievements
const ACHIEVEMENTS = [
  { id: 'first_trade', name: 'First Steps', desc: 'Complete your first trade', icon: '◇', earned: true },
  { id: 'batch_veteran', name: 'Batch Veteran', desc: 'Participate in 100 batches', icon: '≡', earned: true },
  { id: 'diamond_hands', name: 'Diamond Hands', desc: 'Hold LP for 30 days', icon: '◆', earned: true },
  { id: 'whale_watcher', name: 'Whale Watcher', desc: 'Trade over $10,000 in one batch', icon: '◎', earned: false },
  { id: 'guild_master', name: 'Guild Master', desc: 'Refer 10 active traders', icon: '★', earned: false },
  { id: 'perfect_reveal', name: 'Perfect Reveal', desc: '100% reveal rate', icon: '✓', earned: true },
]

// Mock player data
const PLAYER_DATA = {
  address: '0x1234...5678',
  xp: 2847,
  tradesCount: 156,
  volumeUsd: 124500,
  savingsTotal: 312.45,
  winRate: 94,
  avgBatchPosition: 3.2,
  streakDays: 12,
  guild: 'Alpha Traders',
}

function PlayerStats({ isConnected }) {
  const [showAchievements, setShowAchievements] = useState(false)

  // Calculate level
  const currentLevelData = LEVELS.reduce((acc, l) => PLAYER_DATA.xp >= l.xp ? l : acc, LEVELS[0])
  const nextLevelData = LEVELS.find(l => l.xp > PLAYER_DATA.xp) || LEVELS[LEVELS.length - 1]
  const xpProgress = nextLevelData.xp > currentLevelData.xp
    ? ((PLAYER_DATA.xp - currentLevelData.xp) / (nextLevelData.xp - currentLevelData.xp)) * 100
    : 100

  const earnedAchievements = ACHIEVEMENTS.filter(a => a.earned).length

  if (!isConnected) {
    return (
      <div className="surface rounded-lg p-6 text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-black-700 border border-black-500 flex items-center justify-center">
          <svg className="w-8 h-8 text-black-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
        </div>
        <p className="text-sm text-black-400">Connect wallet to view stats</p>
      </div>
    )
  }

  return (
    <div className="surface rounded-lg overflow-hidden">
      {/* Player Header */}
      <div className="p-4 border-b border-black-600">
        <div className="flex items-center space-x-4">
          {/* Avatar with level ring */}
          <div className="relative">
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center text-2xl font-bold"
              style={{ backgroundColor: currentLevelData.color + '30', color: currentLevelData.color }}
            >
              {PLAYER_DATA.address.slice(2, 4).toUpperCase()}
            </div>
            <div
              className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold bg-black-800 border-2"
              style={{ borderColor: currentLevelData.color, color: currentLevelData.color }}
            >
              {currentLevelData.level}
            </div>
          </div>

          <div className="flex-1">
            <div className="flex items-center space-x-2">
              <span className="font-mono text-sm">{PLAYER_DATA.address}</span>
              <span
                className="px-1.5 py-0.5 rounded text-[9px] font-bold"
                style={{ backgroundColor: currentLevelData.color + '30', color: currentLevelData.color }}
              >
                {currentLevelData.title.toUpperCase()}
              </span>
            </div>
            <div className="text-xs text-black-500 mt-0.5">{PLAYER_DATA.guild}</div>

            {/* XP Bar */}
            <div className="mt-2">
              <div className="flex items-center justify-between text-[10px] mb-1">
                <span className="text-black-500">XP: {PLAYER_DATA.xp.toLocaleString()}</span>
                <span className="text-black-500">{nextLevelData.xp.toLocaleString()}</span>
              </div>
              <div className="h-1.5 bg-black-700 rounded-full overflow-hidden">
                <motion.div
                  className="h-full rounded-full"
                  style={{ backgroundColor: currentLevelData.color }}
                  initial={{ width: 0 }}
                  animate={{ width: `${xpProgress}%` }}
                  transition={{ duration: 1, ease: 'easeOut' }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="p-4 grid grid-cols-2 gap-3">
        <div className="p-3 rounded-lg bg-black-700/50">
          <div className="text-[10px] text-black-500 uppercase">Trades</div>
          <div className="text-lg font-bold font-mono">{PLAYER_DATA.tradesCount}</div>
        </div>
        <div className="p-3 rounded-lg bg-black-700/50">
          <div className="text-[10px] text-black-500 uppercase">Volume</div>
          <div className="text-lg font-bold font-mono">${(PLAYER_DATA.volumeUsd / 1000).toFixed(1)}K</div>
        </div>
        <div className="p-3 rounded-lg bg-matrix-500/10 border border-matrix-500/30">
          <div className="text-[10px] text-black-500 uppercase">Total Saved</div>
          <div className="text-lg font-bold font-mono text-matrix-500">${PLAYER_DATA.savingsTotal}</div>
        </div>
        <div className="p-3 rounded-lg bg-black-700/50">
          <div className="text-[10px] text-black-500 uppercase">Win Rate</div>
          <div className="text-lg font-bold font-mono">{PLAYER_DATA.winRate}%</div>
        </div>
      </div>

      {/* Streak */}
      <div className="px-4 pb-4">
        <div className="p-3 rounded-lg bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-500/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <span className="text-xl">🔥</span>
              <div>
                <div className="text-sm font-bold">{PLAYER_DATA.streakDays} Day Streak</div>
                <div className="text-[10px] text-black-500">Keep trading to maintain</div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-amber-400">+{PLAYER_DATA.streakDays * 5} XP/trade</div>
            </div>
          </div>
        </div>
      </div>

      {/* Achievements Preview */}
      <div className="px-4 pb-4">
        <button
          onClick={() => setShowAchievements(!showAchievements)}
          className="w-full p-3 rounded-lg bg-black-700/50 hover:bg-black-700 transition-colors"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <span className="text-lg">🏆</span>
              <span className="text-sm font-medium">Achievements</span>
            </div>
            <div className="flex items-center space-x-2">
              <span className="text-xs text-black-400">{earnedAchievements}/{ACHIEVEMENTS.length}</span>
              <svg
                className={`w-4 h-4 text-black-400 transition-transform ${showAchievements ? 'rotate-180' : ''}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>
        </button>

        {/* Achievements list */}
        {showAchievements && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="mt-2 space-y-2"
          >
            {ACHIEVEMENTS.map((achievement) => (
              <div
                key={achievement.id}
                className={`p-3 rounded-lg border ${
                  achievement.earned
                    ? 'bg-matrix-500/10 border-matrix-500/30'
                    : 'bg-black-800 border-black-600 opacity-50'
                }`}
              >
                <div className="flex items-center space-x-3">
                  <div className={`w-8 h-8 rounded flex items-center justify-center text-lg ${
                    achievement.earned ? 'bg-matrix-500/20 text-matrix-500' : 'bg-black-700 text-black-500'
                  }`}>
                    {achievement.icon}
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-medium">{achievement.name}</div>
                    <div className="text-[10px] text-black-500">{achievement.desc}</div>
                  </div>
                  {achievement.earned && (
                    <svg className="w-5 h-5 text-matrix-500" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </div>
              </div>
            ))}
          </motion.div>
        )}
      </div>
    </div>
  )
}

export default PlayerStats
