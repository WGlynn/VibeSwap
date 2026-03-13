import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Link } from 'react-router-dom'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'

// ============ Constants ============

const PHI = 1.618033988749895
const CYAN = '#06b6d4'

function seededRandom(seed) {
  let s = seed
  return () => {
    s = (s * 16807 + 0) % 2147483647
    return s / 2147483647
  }
}

// ============ Mock V1 Tokens ============

const V1_TOKENS = [
  {
    id: 'vibe-v1',
    symbol: 'VIBE',
    name: 'VibeSwap Token',
    v1Balance: 24_850,
    v2Equivalent: 24_850,
    ratio: '1:1',
    icon: '\u25C8',
    color: '#06b6d4',
    migrated: false,
  },
  {
    id: 'svibe-v1',
    symbol: 'sVIBE',
    name: 'Staked VIBE',
    v1Balance: 12_400,
    v2Equivalent: 12_897,
    ratio: '1:1.04',
    icon: '\u2726',
    color: '#a855f7',
    migrated: false,
  },
  {
    id: 'vlp-v1',
    symbol: 'VLP',
    name: 'Vibe LP Token',
    v1Balance: 5_320,
    v2Equivalent: 5_320,
    ratio: '1:1',
    icon: '\u25C9',
    color: '#22c55e',
    migrated: false,
  },
]

// ============ Mock V1 LP Positions ============

const V1_LP_POSITIONS = [
  {
    id: 'lp-eth-usdc',
    pool: 'ETH / USDC',
    v1Liquidity: 18_420,
    sharePercent: 0.34,
    tokenA: 'ETH',
    tokenB: 'USDC',
    amountA: 5.21,
    amountB: 13_200,
    migrated: false,
  },
  {
    id: 'lp-vibe-eth',
    pool: 'VIBE / ETH',
    v1Liquidity: 8_750,
    sharePercent: 1.12,
    tokenA: 'VIBE',
    tokenB: 'ETH',
    amountA: 14_200,
    amountB: 3.45,
    migrated: false,
  },
]

// ============ Migration Steps ============

const MIGRATION_STEPS = [
  {
    id: 1,
    label: 'Approve',
    description: 'Grant the migration contract permission to access your V1 tokens',
    icon: '\u2611',
  },
  {
    id: 2,
    label: 'Migrate',
    description: 'Execute the migration transaction to convert V1 tokens to V2',
    icon: '\u21C4',
  },
  {
    id: 3,
    label: 'Verify',
    description: 'Confirm your V2 tokens are received and positions are intact',
    icon: '\u2713',
  },
]

// ============ Migration Statistics ============

const MIGRATION_STATS = {
  totalMigrated: 142_800_000,
  remainingV1: 17_200_000,
  migrationRate: 89.25,
  timeRemaining: '~12 days',
}

// ============ FAQ Items ============

const FAQ_ITEMS = [
  {
    question: 'Is migration mandatory?',
    answer:
      'While V1 contracts will continue to function, V2 offers significantly improved features including lower fees, MEV protection, and cross-chain support. We strongly recommend migrating, but your V1 tokens remain safe and accessible indefinitely.',
  },
  {
    question: 'What happens to my staking rewards during migration?',
    answer:
      'All accrued staking rewards are automatically claimed and included in your V2 balance. The sVIBE to sVIBE-V2 conversion includes a 4% bonus to compensate for any brief interruption in reward accrual during the migration window.',
  },
  {
    question: 'Are there any fees for migrating?',
    answer:
      'The migration itself is completely free — you only pay the standard network gas fee for the transaction. VibeSwap subsidizes the migration contract costs to ensure a seamless transition for all users.',
  },
  {
    question: 'Can I migrate partial amounts?',
    answer:
      'Yes, you can migrate any amount of each token individually. However, LP positions must be migrated as whole units to preserve the pool share ratios and avoid rounding discrepancies.',
  },
]

// ============ V2 Benefits ============

const V2_BENEFITS = [
  {
    title: 'Lower Fees',
    description: 'Batch auction settlement reduces gas costs by up to 40% compared to V1 individual swaps',
    metric: '-40%',
    metricLabel: 'Gas Savings',
    icon: '\u26A1',
    color: '#22c55e',
  },
  {
    title: 'MEV Protection',
    description: 'Commit-reveal mechanism with deterministic shuffle eliminates frontrunning and sandwich attacks',
    metric: '0',
    metricLabel: 'MEV Extracted',
    icon: '\u{1F6E1}',
    color: '#06b6d4',
  },
  {
    title: 'Cross-Chain',
    description: 'LayerZero V2 integration enables seamless swaps across 15+ supported chains',
    metric: '15+',
    metricLabel: 'Chains',
    icon: '\u{1F310}',
    color: '#a855f7',
  },
  {
    title: 'Batch Auctions',
    description: 'Uniform clearing price ensures fair execution — every trader in a batch gets the same price',
    metric: '100%',
    metricLabel: 'Fair Pricing',
    icon: '\u2696',
    color: '#f59e0b',
  },
]

// ============ Utility Functions ============

function fmt(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toFixed(2)
}

function fmtInt(n) {
  return n.toLocaleString('en-US')
}

// ============ Component ============

export default function MigrationPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [tokens, setTokens] = useState(V1_TOKENS)
  const [lpPositions, setLpPositions] = useState(V1_LP_POSITIONS)
  const [activeStep, setActiveStep] = useState(0)
  const [migrating, setMigrating] = useState(null)
  const [expandedFaq, setExpandedFaq] = useState(null)

  // ============ Seeded background particles ============

  const particles = useMemo(() => {
    const rng = seededRandom(7719)
    return Array.from({ length: 18 }, (_, i) => ({
      x: rng() * 100,
      y: rng() * 100,
      size: 1 + rng() * 2.5,
      opacity: 0.03 + rng() * 0.06,
      duration: 12 + rng() * 20,
      delay: rng() * -25,
    }))
  }, [])

  // ============ Migration Handlers ============

  const handleMigrateToken = (tokenId) => {
    setMigrating(tokenId)
    setActiveStep(1)
    setTimeout(() => setActiveStep(2), 1200)
    setTimeout(() => {
      setActiveStep(3)
      setTokens((prev) =>
        prev.map((t) => (t.id === tokenId ? { ...t, migrated: true } : t))
      )
      setMigrating(null)
      setTimeout(() => setActiveStep(0), 1500)
    }, 2800)
  }

  const handleMigrateLP = (lpId) => {
    setMigrating(lpId)
    setActiveStep(1)
    setTimeout(() => setActiveStep(2), 1400)
    setTimeout(() => {
      setActiveStep(3)
      setLpPositions((prev) =>
        prev.map((lp) => (lp.id === lpId ? { ...lp, migrated: true } : lp))
      )
      setMigrating(null)
      setTimeout(() => setActiveStep(0), 1500)
    }, 3200)
  }

  const totalV1Value = useMemo(() => {
    const tokenVal = tokens.filter((t) => !t.migrated).reduce((s, t) => s + t.v1Balance, 0)
    const lpVal = lpPositions.filter((lp) => !lp.migrated).reduce((s, lp) => s + lp.v1Liquidity, 0)
    return tokenVal + lpVal
  }, [tokens, lpPositions])

  const migratedCount = useMemo(() => {
    return tokens.filter((t) => t.migrated).length + lpPositions.filter((lp) => lp.migrated).length
  }, [tokens, lpPositions])

  const totalItems = tokens.length + lpPositions.length

  return (
    <div className="relative min-h-screen pb-20">
      {/* ============ Background Particles ============ */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        {particles.map((p, i) => (
          <motion.div
            key={i}
            className="absolute rounded-full"
            style={{
              left: `${p.x}%`,
              top: `${p.y}%`,
              width: p.size,
              height: p.size,
              background: CYAN,
              opacity: p.opacity,
            }}
            animate={{
              y: [0, -30, 0],
              opacity: [p.opacity, p.opacity * PHI, p.opacity],
            }}
            transition={{
              duration: p.duration,
              repeat: Infinity,
              delay: p.delay,
              ease: 'easeInOut',
            }}
          />
        ))}
      </div>

      {/* ============ Page Hero ============ */}
      <PageHero
        title="Migration"
        subtitle="Seamlessly upgrade your tokens and positions from V1 to V2"
        category="system"
      />

      <div className="relative z-10 max-w-7xl mx-auto px-4 space-y-6">
        {/* ============ Status Banner ============ */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          <GlassCard className="p-4" glowColor="terminal">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-2.5 h-2.5 rounded-full bg-green-400 animate-pulse" />
                <div>
                  <span className="text-sm font-semibold text-green-400">V2 is live!</span>
                  <span className="text-sm text-gray-400 ml-2">
                    Migrate your assets for enhanced features and lower fees
                  </span>
                </div>
              </div>
              <div className="text-xs font-mono text-gray-500">
                {MIGRATION_STATS.migrationRate}% network migrated
              </div>
            </div>
          </GlassCard>
        </motion.div>

        {/* ============ Not Connected State ============ */}
        {!isConnected && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            <GlassCard className="p-8 text-center">
              <div className="text-4xl mb-3 opacity-60">\u{1F512}</div>
              <h3 className="text-lg font-semibold mb-2">Connect Wallet to Migrate</h3>
              <p className="text-sm text-gray-400 max-w-md mx-auto">
                Connect your wallet to view your V1 balances and migrate to V2 contracts.
              </p>
            </GlassCard>
          </motion.div>
        )}

        {/* ============ Your Migration Status ============ */}
        {isConnected && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            <GlassCard className="p-6">
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-lg font-semibold">Your Migration Status</h2>
                <div className="text-xs font-mono text-gray-500">
                  {migratedCount}/{totalItems} migrated
                </div>
              </div>

              {/* Progress bar */}
              <div className="w-full h-1.5 bg-gray-800 rounded-full mb-6 overflow-hidden">
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: `linear-gradient(90deg, ${CYAN}, #22c55e)` }}
                  initial={{ width: 0 }}
                  animate={{ width: `${(migratedCount / totalItems) * 100}%` }}
                  transition={{ duration: 0.8, ease: 'easeOut' }}
                />
              </div>

              {/* V1 Tokens */}
              <h3 className="text-sm font-mono text-gray-400 uppercase tracking-wider mb-3">
                V1 Tokens
              </h3>
              <div className="space-y-2 mb-6">
                {tokens.map((token) => (
                  <motion.div
                    key={token.id}
                    layout
                    className={`flex items-center justify-between p-3 rounded-xl border transition-all ${
                      token.migrated
                        ? 'border-green-500/20 bg-green-500/5'
                        : 'border-gray-800 bg-gray-900/40 hover:border-gray-700'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="w-9 h-9 rounded-full flex items-center justify-center text-lg"
                        style={{ background: `${token.color}15`, color: token.color }}
                      >
                        {token.icon}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold">{token.symbol}</span>
                          <span className="text-xs text-gray-500">{token.name}</span>
                        </div>
                        <div className="text-xs text-gray-400 mt-0.5">
                          {fmtInt(token.v1Balance)} V1 {'\u2192'} {fmtInt(token.v2Equivalent)} V2
                          <span className="text-gray-600 ml-1.5">({token.ratio})</span>
                        </div>
                      </div>
                    </div>
                    <div>
                      {token.migrated ? (
                        <span className="text-xs font-mono text-green-400 flex items-center gap-1">
                          {'\u2713'} Migrated
                        </span>
                      ) : (
                        <button
                          onClick={() => handleMigrateToken(token.id)}
                          disabled={migrating !== null}
                          className="px-4 py-1.5 text-xs font-semibold rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                          style={{
                            background: `${CYAN}18`,
                            color: CYAN,
                            border: `1px solid ${CYAN}30`,
                          }}
                        >
                          {migrating === token.id ? 'Migrating...' : 'Migrate'}
                        </button>
                      )}
                    </div>
                  </motion.div>
                ))}
              </div>

              {/* V1 LP Positions */}
              <h3 className="text-sm font-mono text-gray-400 uppercase tracking-wider mb-3">
                LP Positions
              </h3>
              <div className="space-y-2">
                {lpPositions.map((lp) => (
                  <motion.div
                    key={lp.id}
                    layout
                    className={`flex items-center justify-between p-3 rounded-xl border transition-all ${
                      lp.migrated
                        ? 'border-green-500/20 bg-green-500/5'
                        : 'border-gray-800 bg-gray-900/40 hover:border-gray-700'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-mono bg-purple-500/10 text-purple-400">
                        LP
                      </div>
                      <div>
                        <div className="text-sm font-semibold">{lp.pool}</div>
                        <div className="text-xs text-gray-400 mt-0.5">
                          ${fmtInt(lp.v1Liquidity)} liquidity
                          <span className="text-gray-600 ml-1.5">
                            {lp.sharePercent}% share
                          </span>
                        </div>
                        <div className="text-[10px] text-gray-500 mt-0.5">
                          {lp.amountA} {lp.tokenA} + {fmtInt(lp.amountB)} {lp.tokenB}
                        </div>
                      </div>
                    </div>
                    <div>
                      {lp.migrated ? (
                        <span className="text-xs font-mono text-green-400 flex items-center gap-1">
                          {'\u2713'} Migrated
                        </span>
                      ) : (
                        <button
                          onClick={() => handleMigrateLP(lp.id)}
                          disabled={migrating !== null}
                          className="px-4 py-1.5 text-xs font-semibold rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                          style={{
                            background: `${CYAN}18`,
                            color: CYAN,
                            border: `1px solid ${CYAN}30`,
                          }}
                        >
                          {migrating === lp.id ? 'Migrating...' : 'Migrate'}
                        </button>
                      )}
                    </div>
                  </motion.div>
                ))}
              </div>

              {/* Remaining value */}
              {totalV1Value > 0 && (
                <div className="mt-4 pt-4 border-t border-gray-800 flex items-center justify-between">
                  <span className="text-xs text-gray-500">Remaining V1 value</span>
                  <span className="text-sm font-mono" style={{ color: CYAN }}>
                    ${fmtInt(totalV1Value)}
                  </span>
                </div>
              )}
            </GlassCard>
          </motion.div>
        )}

        {/* ============ Migration Steps ============ */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
        >
          <GlassCard className="p-6">
            <h2 className="text-lg font-semibold mb-5">How Migration Works</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {MIGRATION_STEPS.map((step, idx) => {
                const isActive = activeStep === step.id
                const isComplete = activeStep > step.id

                return (
                  <div key={step.id} className="relative">
                    {/* Connector line (between steps on desktop) */}
                    {idx < MIGRATION_STEPS.length - 1 && (
                      <div className="hidden sm:block absolute top-6 left-[60%] right-[-40%] h-px bg-gray-800 z-0">
                        <motion.div
                          className="h-full"
                          style={{ background: CYAN }}
                          initial={{ width: 0 }}
                          animate={{ width: isComplete ? '100%' : '0%' }}
                          transition={{ duration: 0.6 }}
                        />
                      </div>
                    )}

                    <div
                      className={`relative z-10 p-4 rounded-xl border text-center transition-all ${
                        isActive
                          ? 'border-cyan-500/40 bg-cyan-500/5'
                          : isComplete
                          ? 'border-green-500/30 bg-green-500/5'
                          : 'border-gray-800 bg-gray-900/30'
                      }`}
                    >
                      <div
                        className={`w-10 h-10 rounded-full mx-auto mb-3 flex items-center justify-center text-xl transition-all ${
                          isActive
                            ? 'bg-cyan-500/20 text-cyan-400'
                            : isComplete
                            ? 'bg-green-500/20 text-green-400'
                            : 'bg-gray-800 text-gray-500'
                        }`}
                      >
                        {isComplete ? '\u2713' : step.icon}
                      </div>
                      <div className="text-sm font-semibold mb-1">
                        Step {step.id}: {step.label}
                      </div>
                      <div className="text-xs text-gray-400 leading-relaxed">
                        {step.description}
                      </div>
                      {isActive && (
                        <motion.div
                          className="mt-3 flex justify-center"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                        >
                          <div className="flex gap-1">
                            {[0, 1, 2].map((dot) => (
                              <motion.div
                                key={dot}
                                className="w-1.5 h-1.5 rounded-full"
                                style={{ background: CYAN }}
                                animate={{ opacity: [0.3, 1, 0.3] }}
                                transition={{
                                  duration: 1,
                                  repeat: Infinity,
                                  delay: dot * 0.2,
                                }}
                              />
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </GlassCard>
        </motion.div>

        {/* ============ Migration Statistics ============ */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.4 }}
        >
          <GlassCard className="p-6">
            <h2 className="text-lg font-semibold mb-4">Migration Statistics</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                {
                  label: 'Total Migrated',
                  value: '$' + fmt(MIGRATION_STATS.totalMigrated),
                  color: '#22c55e',
                },
                {
                  label: 'Remaining V1',
                  value: '$' + fmt(MIGRATION_STATS.remainingV1),
                  color: '#f59e0b',
                },
                {
                  label: 'Migration Rate',
                  value: MIGRATION_STATS.migrationRate + '%',
                  color: CYAN,
                },
                {
                  label: 'Time Remaining',
                  value: MIGRATION_STATS.timeRemaining,
                  color: '#a855f7',
                },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="p-4 rounded-xl border border-gray-800 bg-gray-900/30 text-center"
                >
                  <div
                    className="text-xl sm:text-2xl font-bold font-mono"
                    style={{ color: stat.color }}
                  >
                    {stat.value}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">{stat.label}</div>
                </div>
              ))}
            </div>

            {/* Migration progress bar */}
            <div className="mt-5">
              <div className="flex items-center justify-between text-xs text-gray-500 mb-1.5">
                <span>Network migration progress</span>
                <span className="font-mono">{MIGRATION_STATS.migrationRate}%</span>
              </div>
              <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: `linear-gradient(90deg, ${CYAN}, #22c55e)` }}
                  initial={{ width: 0 }}
                  animate={{ width: `${MIGRATION_STATS.migrationRate}%` }}
                  transition={{ duration: 1.5, ease: 'easeOut', delay: 0.6 }}
                />
              </div>
            </div>
          </GlassCard>
        </motion.div>

        {/* ============ Benefits of V2 ============ */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.5 }}
        >
          <h2 className="text-lg font-semibold mb-4">Benefits of V2</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {V2_BENEFITS.map((benefit, idx) => (
              <motion.div
                key={benefit.title}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.55 + idx * 0.08 }}
              >
                <GlassCard className="p-5 h-full">
                  <div className="flex items-start justify-between mb-3">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center text-xl"
                      style={{ background: `${benefit.color}15`, color: benefit.color }}
                    >
                      {benefit.icon}
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold font-mono" style={{ color: benefit.color }}>
                        {benefit.metric}
                      </div>
                      <div className="text-[10px] text-gray-500 uppercase tracking-wider">
                        {benefit.metricLabel}
                      </div>
                    </div>
                  </div>
                  <h3 className="text-sm font-semibold mb-1.5">{benefit.title}</h3>
                  <p className="text-xs text-gray-400 leading-relaxed">{benefit.description}</p>
                </GlassCard>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* ============ FAQ Section ============ */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.6 }}
        >
          <GlassCard className="p-6">
            <h2 className="text-lg font-semibold mb-4">Frequently Asked Questions</h2>
            <div className="space-y-2">
              {FAQ_ITEMS.map((faq, idx) => {
                const isOpen = expandedFaq === idx

                return (
                  <div
                    key={idx}
                    className={`rounded-xl border transition-all ${
                      isOpen ? 'border-gray-700 bg-gray-900/50' : 'border-gray-800 bg-gray-900/20'
                    }`}
                  >
                    <button
                      onClick={() => setExpandedFaq(isOpen ? null : idx)}
                      className="w-full flex items-center justify-between p-4 text-left"
                    >
                      <span className="text-sm font-medium pr-4">{faq.question}</span>
                      <motion.span
                        className="text-gray-500 text-lg flex-shrink-0"
                        animate={{ rotate: isOpen ? 45 : 0 }}
                        transition={{ duration: 0.2 }}
                      >
                        +
                      </motion.span>
                    </button>
                    <AnimatePresence>
                      {isOpen && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.25 }}
                          className="overflow-hidden"
                        >
                          <div className="px-4 pb-4">
                            <p className="text-sm text-gray-400 leading-relaxed">{faq.answer}</p>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )
              })}
            </div>
          </GlassCard>
        </motion.div>

        {/* ============ Migration Resources Footer ============ */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.7 }}
        >
          <GlassCard className="p-5">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="text-center sm:text-left">
                <h3 className="text-sm font-semibold mb-1">Need help with migration?</h3>
                <p className="text-xs text-gray-400">
                  Read the full migration guide or reach out to the community for support.
                </p>
              </div>
              <div className="flex gap-3">
                <Link
                  to="/docs"
                  className="px-4 py-2 text-xs font-semibold rounded-lg border border-gray-700 text-gray-300 hover:border-gray-600 hover:text-white transition-all"
                >
                  Migration Guide
                </Link>
                <Link
                  to="/faq"
                  className="px-4 py-2 text-xs font-semibold rounded-lg transition-all"
                  style={{
                    background: `${CYAN}18`,
                    color: CYAN,
                    border: `1px solid ${CYAN}30`,
                  }}
                >
                  Full FAQ
                </Link>
              </div>
            </div>
          </GlassCard>
        </motion.div>
      </div>
    </div>
  )
}
