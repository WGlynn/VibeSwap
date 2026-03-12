import { useState, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import { useBalances } from '../hooks/useBalances'
import { useVault } from '../hooks/useVault'
import toast from 'react-hot-toast'
import GlassCard from './ui/GlassCard'
import InteractiveButton from './ui/InteractiveButton'
import { StaggerContainer, StaggerItem } from './ui/StaggerContainer'
import ProgressRing from './ui/ProgressRing'
import AnimatedNumber from './ui/AnimatedNumber'

/**
 * Savings Vault Page
 * Implements "separation of concerns" - different wallets for different purposes
 *
 * Vault vs Spending:
 * - Spending: instant access, lower security, for daily use
 * - Vault: 30-day timelock, higher security, for savings
 *
 * Features: strategy cards, deposit/withdraw modal with share calc,
 * SVG performance chart, auto-compound toggle, risk metrics per vault.
 *
 * @version 2.0.0
 */

// ============ Constants ============
const PHI = 1.618033988749895
const CYAN = '#06b6d4'

// Token metadata only — prices come from CoinGecko via global cache
const TOKENS = [
  { symbol: 'ETH', name: 'Ethereum', logo: '\u27E0' },
  { symbol: 'USDC', name: 'USD Coin', logo: '$' },
  { symbol: 'USDT', name: 'Tether', logo: '$' },
  { symbol: 'WBTC', name: 'Wrapped Bitcoin', logo: '\u20BF' },
]

function getTokenPrice(symbol) {
  const live = window.__vibePriceCache?.[symbol]
  if (live && live > 0) return live
  const fallback = { ETH: 2800, USDC: 1, USDT: 1, WBTC: 96000 }
  return fallback[symbol] || 0
}

// ============ Seeded PRNG ============
function seededRandom(seed) {
  let s = seed
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646 }
}

// ============ Vault Strategies ============
const VAULT_STRATEGIES = [
  { id: 'conservative', name: 'Conservative Yield', assets: 'USDC/USDT', tvl: 423e6, apy: 6.2, risk: 'Low', riskLevel: 1, sharpe: 2.41, maxDrawdown: 1.2, volatility: 3.1, benchmarkDelta: 1.8, desc: 'Stable-pair lending with principal protection' },
  { id: 'balanced', name: 'Balanced Growth', assets: 'ETH/USDC', tvl: 287e6, apy: 11.5, risk: 'Medium', riskLevel: 3, sharpe: 1.87, maxDrawdown: 8.4, volatility: 12.6, benchmarkDelta: 3.2, desc: 'Diversified LP positions with auto-rebalancing' },
  { id: 'aggressive', name: 'Alpha Seeker', assets: 'ETH/WBTC', tvl: 142e6, apy: 19.8, risk: 'High', riskLevel: 5, sharpe: 1.24, maxDrawdown: 18.7, volatility: 24.3, benchmarkDelta: 7.1, desc: 'Leveraged strategies targeting maximum yield' },
  { id: 'delta-neutral', name: 'Delta Neutral', assets: 'ETH/USDC', tvl: 198e6, apy: 8.9, risk: 'Low', riskLevel: 2, sharpe: 2.18, maxDrawdown: 3.1, volatility: 5.8, benchmarkDelta: 2.4, desc: 'Hedged positions capturing funding rate differentials' },
]

// ============ Generate Deterministic Yield History ============
function generateYieldHistory(strategyId, baseApy, vol) {
  const seed = strategyId.split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7)
  const rng = seededRandom(seed)
  const pts = []
  let cur = baseApy * 0.85
  for (let i = 0; i < 60; i++) {
    cur += (rng() - 0.46) * vol
    cur = Math.max(baseApy * 0.5, Math.min(baseApy * 1.5, cur))
    pts.push({ day: i + 1, yield: +cur.toFixed(2) })
  }
  return pts
}

function generateBenchmarkHistory(baseApy) {
  const rng = seededRandom(9999)
  const pts = []
  let cur = baseApy * 0.7
  for (let i = 0; i < 60; i++) {
    cur += (rng() - 0.48) * 0.3
    cur = Math.max(baseApy * 0.4, Math.min(baseApy * 1.1, cur))
    pts.push({ day: i + 1, yield: +cur.toFixed(2) })
  }
  return pts
}

const YIELD_HISTORIES = Object.fromEntries(
  VAULT_STRATEGIES.map(s => [s.id, generateYieldHistory(s.id, s.apy, s.riskLevel * 0.6)])
)
const BENCHMARK_HISTORIES = Object.fromEntries(
  VAULT_STRATEGIES.map(s => [s.id, generateBenchmarkHistory(s.apy)])
)

// ============ Animation Variants ============
const sectionVariants = {
  hidden: () => ({ opacity: 0, y: 30, filter: 'blur(4px)' }),
  visible: (i) => ({
    opacity: 1, y: 0, filter: 'blur(0px)',
    transition: { delay: i * 0.12 / PHI, duration: 0.5, ease: 'easeOut' },
  }),
}

// ============ Utility Functions ============
const formatUsd = (n) => {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${n.toFixed(2)}`
}

const RISK_COLORS = { Low: '#22c55e', Medium: '#eab308', High: '#ef4444' }
const RISK_BG = { Low: 'bg-green-500/10 border-green-500/30 text-green-400', Medium: 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400', High: 'bg-red-500/10 border-red-500/30 text-red-400' }

// ============ Small Components ============

function RiskBadge({ level }) {
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${RISK_BG[level]}`}>
      {level}
    </span>
  )
}

function PerformanceChart({ strategyId }) {
  const data = YIELD_HISTORIES[strategyId] || []
  const bench = BENCHMARK_HISTORIES[strategyId] || []
  if (!data.length) return null
  const allValues = [...data.map(d => d.yield), ...bench.map(d => d.yield)]
  const max = Math.max(...allValues), min = Math.min(...allValues)
  const range = max - min || 1, W = 400, H = 140, pad = 12
  const toY = (v) => H - pad - ((v - min) / range) * (H - 2 * pad)
  const dataPts = data.map((d, i) => `${(i / (data.length - 1)) * W},${toY(d.yield)}`).join(' ')
  const benchPts = bench.map((d, i) => `${(i / (bench.length - 1)) * W},${toY(d.yield)}`).join(' ')
  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-32" preserveAspectRatio="none">
        <defs>
          <linearGradient id={`vc-${strategyId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CYAN} stopOpacity="0.25" />
            <stop offset="100%" stopColor={CYAN} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={`0,${H} ${dataPts} ${W},${H}`} fill={`url(#vc-${strategyId})`} />
        <polyline points={benchPts} fill="none" stroke="#6b7280" strokeWidth="1.5" strokeDasharray="4 3" strokeLinejoin="round" />
        <polyline points={dataPts} fill="none" stroke={CYAN} strokeWidth="2" strokeLinejoin="round" />
      </svg>
      <div className="flex justify-between text-[10px] text-black-500 mt-1 px-1">
        <span>60d ago</span>
        <div className="flex items-center space-x-3">
          <span className="flex items-center space-x-1"><span className="w-3 h-px inline-block" style={{ background: CYAN }} /><span>Vault</span></span>
          <span className="flex items-center space-x-1"><span className="w-3 h-px inline-block border-t border-dashed border-gray-500" /><span>Benchmark</span></span>
        </div>
        <span>Today</span>
      </div>
    </div>
  )
}

function AutoCompoundToggle({ enabled, onToggle, apy }) {
  const principal = 10000
  const daily = (apy / 100) / 365
  const simpleYear = principal * apy / 100
  const compoundYear = principal * (Math.pow(1 + daily, 365) - 1)
  const savings = compoundYear - simpleYear
  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex-1">
        <div className="flex items-center space-x-2">
          <span className="text-xs text-black-400">Auto-compound</span>
          {enabled && savings > 0 && (
            <span className="text-[10px] font-mono text-green-400">+${savings.toFixed(0)}/yr per $10K</span>
          )}
        </div>
      </div>
      <button onClick={onToggle} className="relative w-9 h-5 rounded-full transition-colors"
        style={{ backgroundColor: enabled ? CYAN : 'rgba(55,55,55,1)' }}>
        <motion.div className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow"
          animate={{ left: enabled ? 18 : 2 }} transition={{ type: 'spring', stiffness: 500, damping: 30 }} />
      </button>
    </div>
  )
}

function RiskMetrics({ strategy }) {
  const metrics = [
    { label: 'Sharpe Ratio', value: strategy.sharpe.toFixed(2), good: strategy.sharpe > 1.5 },
    { label: 'Max Drawdown', value: `-${strategy.maxDrawdown}%`, good: strategy.maxDrawdown < 10 },
    { label: 'Volatility', value: `${strategy.volatility}%`, good: strategy.volatility < 15 },
  ]
  return (
    <div className="grid grid-cols-3 gap-2 mt-3">
      {metrics.map(m => (
        <div key={m.label} className="text-center p-2 rounded-lg bg-black-800/60">
          <div className="text-[10px] text-black-500 uppercase tracking-wider mb-0.5">{m.label}</div>
          <div className={`text-xs font-mono font-medium ${m.good ? 'text-green-400' : 'text-yellow-400'}`}>{m.value}</div>
        </div>
      ))}
    </div>
  )
}

function TokenSelector({ tokens, selected, onSelect }) {
  return (
    <div>
      <label className="block text-sm text-black-400 mb-2">Token</label>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {tokens.map((token) => (
          <button key={token.symbol} onClick={() => onSelect(token)}
            className={`p-3 rounded-lg text-center transition-colors ${
              selected.symbol === token.symbol ? 'border-2' : 'bg-black-700 border-2 border-transparent hover:border-black-500'
            }`}
            style={selected.symbol === token.symbol ? { background: `${CYAN}15`, borderColor: CYAN } : undefined}>
            <span className="text-xl">{token.logo}</span>
            <div className="text-xs mt-1">{token.symbol}</div>
          </button>
        ))}
      </div>
    </div>
  )
}

function SlippageSelector({ value, onChange }) {
  return (
    <div>
      <label className="text-xs text-black-400 block mb-2">Slippage Tolerance</label>
      <div className="flex items-center space-x-2">
        {[0.1, 0.5, 1.0].map(v => (
          <button key={v} onClick={() => onChange(v)}
            className="flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{
              background: value === v ? `${CYAN}20` : 'rgba(40,40,40,1)',
              color: value === v ? CYAN : 'rgba(160,160,160,1)',
              border: `1px solid ${value === v ? `${CYAN}40` : 'transparent'}`,
            }}>{v}%</button>
        ))}
        <input type="number" value={value} onChange={e => onChange(parseFloat(e.target.value) || 0)}
          className="w-16 bg-black-700 border border-black-600 rounded-lg px-2 py-1.5 text-xs text-center outline-none focus:border-cyan-500"
          step="0.1" min="0" max="50" />
      </div>
    </div>
  )
}

// ============ Main Component ============

function VaultPage() {
  const { isConnected: isExternalConnected, connect } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const { getFormattedBalance, getBalance, simulateSend } = useBalances()
  const {
    isVaultSetup,
    vaultBalances,
    pendingWithdrawals,
    vaultConfig,
    getFormattedVaultBalance,
    getTotalVaultValue,
    shouldRecommendHardwareWallet,
    getWithdrawalTimeRemaining,
    initializeVault,
    depositToVault,
    initiateWithdrawal,
    cancelWithdrawal,
    completeWithdrawal,
    VAULT_CONFIG,
    HARDWARE_WALLET_THRESHOLD,
  } = useVault()

  const isConnected = isExternalConnected || isDeviceConnected

  const [showDepositModal, setShowDepositModal] = useState(false)
  const [showWithdrawModal, setShowWithdrawModal] = useState(false)
  const [selectedToken, setSelectedToken] = useState(TOKENS[0])
  const [amount, setAmount] = useState('')
  const [slippage, setSlippage] = useState(0.5)
  const [chartStrategy, setChartStrategy] = useState(VAULT_STRATEGIES[0].id)
  const [acToggles, setAcToggles] = useState(
    Object.fromEntries(VAULT_STRATEGIES.map(s => [s.id, true]))
  )
  const toggleAC = useCallback((id) => setAcToggles(p => ({ ...p, [id]: !p[id] })), [])

  // ============ Handlers ============

  const handleSetupVault = () => {
    initializeVault()
    toast.success('Savings Vault created!')
  }

  const handleDeposit = () => {
    if (!amount || parseFloat(amount) <= 0) {
      toast.error('Enter an amount')
      return
    }
    const spendingBal = getBalance(selectedToken.symbol)
    if (parseFloat(amount) > spendingBal) {
      toast.error('Insufficient spending balance')
      return
    }
    simulateSend(selectedToken.symbol, amount)
    depositToVault(selectedToken.symbol, amount)
    toast.success(`Moved ${amount} ${selectedToken.symbol} to vault`)
    setAmount('')
    setShowDepositModal(false)
  }

  const handleInitiateWithdrawal = () => {
    if (!amount || parseFloat(amount) <= 0) {
      toast.error('Enter an amount')
      return
    }
    const vaultBal = vaultBalances[selectedToken.symbol] || 0
    if (parseFloat(amount) > vaultBal) {
      toast.error('Insufficient vault balance')
      return
    }
    const withdrawal = initiateWithdrawal(selectedToken.symbol, amount)
    if (withdrawal) {
      toast.success(`Withdrawal initiated. Available in ${VAULT_CONFIG.timelockDays} days.`)
      setAmount('')
      setShowWithdrawModal(false)
    }
  }

  const formatTimeRemaining = (withdrawalId) => {
    const time = getWithdrawalTimeRemaining(withdrawalId)
    if (!time) return ''
    if (time.ready) return 'Ready'
    if (time.days > 0) return `${time.days}d ${time.hours}h`
    if (time.hours > 0) return `${time.hours}h ${time.minutes}m`
    return `${time.minutes}m`
  }

  const getTotalSpendingValue = () => {
    let total = 0
    for (const token of TOKENS) {
      total += getBalance(token.symbol) * getTokenPrice(token.symbol)
    }
    return total
  }

  // ============ Share Calculation ============
  const depositShares = useMemo(() => {
    const amt = parseFloat(amount) || 0
    if (amt <= 0) return { shares: 0, fee: 0, net: 0 }
    const price = getTokenPrice(selectedToken.symbol)
    const usdValue = amt * price
    const fee = usdValue * 0.001 // 0.1% deposit fee
    const net = usdValue - fee
    const sharePrice = 1.034 // mock share price > $1 from accumulated yield
    const shares = net / sharePrice
    return { shares, fee, net }
  }, [amount, selectedToken])

  const withdrawShares = useMemo(() => {
    const amt = parseFloat(amount) || 0
    if (amt <= 0) return { received: 0, fee: 0 }
    const price = getTokenPrice(selectedToken.symbol)
    const usdValue = amt * price
    const fee = usdValue * 0.001
    const received = amt - (amt * 0.001)
    return { received, fee }
  }, [amount, selectedToken])

  // ============ Not Connected ============
  if (!isConnected) {
    return (
      <div className="max-w-lg mx-auto px-4 py-12">
        <GlassCard className="p-8 text-center">
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-terminal-500/20 border border-terminal-500/30 flex items-center justify-center">
            <span className="text-4xl">{'\uD83C\uDFE6'}</span>
          </div>
          <h1 className="text-2xl font-bold mb-2">Savings Vault</h1>
          <p className="text-black-400 mb-6">
            Separate your savings from spending money for better security.
          </p>
          <InteractiveButton
            variant="primary"
            onClick={connect}
            className="px-6 py-3"
          >
            Connect Wallet
          </InteractiveButton>
        </GlassCard>
      </div>
    )
  }

  // ============ Vault Setup ============
  if (!isVaultSetup) {
    return (
      <div className="max-w-lg mx-auto px-4 py-8">
        <GlassCard className="p-6">
          <div className="text-center mb-6">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-terminal-500/20 border border-terminal-500/30 flex items-center justify-center">
              <span className="text-3xl">{'\uD83C\uDFE6'}</span>
            </div>
            <h1 className="text-xl font-bold mb-2">Create Your Savings Vault</h1>
            <p className="text-black-400 text-sm">
              Separate your spending from your savings. Different wallets for different purposes.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
            <div className="p-4 rounded-xl bg-black-700/50 border border-black-600">
              <div className="text-sm font-medium mb-2">Spending Wallet</div>
              <ul className="text-xs text-black-400 space-y-1">
                <li>Instant access</li>
                <li>7-day recovery timelock</li>
                <li>3 of 5 guardians</li>
                <li>For daily transactions</li>
              </ul>
            </div>
            <div className="p-4 rounded-xl bg-terminal-500/10 border border-terminal-500/30">
              <div className="text-sm font-medium text-terminal-400 mb-2">Savings Vault</div>
              <ul className="text-xs text-black-300 space-y-1">
                <li>30-day withdrawal delay</li>
                <li>30-day recovery timelock</li>
                <li>4 of 5 guardians</li>
                <li>For long-term savings</li>
              </ul>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 mb-6">
            <div className="flex items-start space-x-3">
              <span className="text-amber-500">{'\uD83D\uDCDC'}</span>
              <div>
                <div className="text-sm font-medium text-amber-400">From Your 2018 Paper</div>
                <p className="text-xs text-black-400 mt-1">
                  "Generate a different wallet for expenses that you pay using bitcoins, and use different ones for long term storage of bitcoins."
                </p>
              </div>
            </div>
          </div>

          <InteractiveButton
            variant="primary"
            onClick={handleSetupVault}
            className="w-full py-4 text-lg"
          >
            Create Savings Vault
          </InteractiveButton>
        </GlassCard>
      </div>
    )
  }

  // ============ Main Vault View ============
  const totalVaultValue = getTotalVaultValue()
  const totalSpendingValue = getTotalSpendingValue()

  return (
    <div className="min-h-screen pb-20">
      {/* Background Particles */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        {Array.from({ length: 8 }).map((_, i) => (
          <motion.div key={i} className="absolute w-px h-px rounded-full"
            style={{ background: CYAN, left: `${(i * PHI * 19) % 100}%`, top: `${(i * PHI * 29) % 100}%` }}
            animate={{ opacity: [0, 0.2, 0], scale: [0, 1, 0], y: [0, -40 - (i % 3) * 20] }}
            transition={{ duration: 5 + (i % 3) * PHI, repeat: Infinity, delay: i * 0.7, ease: 'easeInOut' }} />
        ))}
      </div>

      <div className="relative z-10 max-w-3xl mx-auto px-4 space-y-5">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="pt-2 pb-1">
          <h1 className="text-2xl md:text-3xl font-bold text-white">Savings Vault</h1>
          <p className="text-black-400 text-sm mt-1">Long-term storage with extra security</p>
        </motion.div>

        {/* Hardware wallet recommendation */}
        {shouldRecommendHardwareWallet() && (
          <motion.div custom={0} variants={sectionVariants} initial="hidden" animate="visible"
            className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
            <div className="flex items-start space-x-3">
              <span className="text-xl">{'\u26A0\uFE0F'}</span>
              <div>
                <div className="font-medium text-amber-400">Hardware Wallet Recommended</div>
                <p className="text-sm text-black-400 mt-1">
                  Your vault holds over ${HARDWARE_WALLET_THRESHOLD.toLocaleString()}. For maximum security, consider moving large holdings to a hardware wallet (Ledger, Trezor) for true cold storage.
                </p>
                <p className="text-xs text-black-500 mt-2">
                  "Keeping your private keys entirely offline is the best way to protect them" - Your 2018 Paper
                </p>
              </div>
            </div>
          </motion.div>
        )}

        {/* Balance overview */}
        <motion.div custom={0} variants={sectionVariants} initial="hidden" animate="visible">
          <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <StaggerItem>
              <GlassCard className="p-4">
                <div className="text-sm text-black-400 mb-1">Spending Balance</div>
                <div className="text-2xl font-bold">
                  <AnimatedNumber value={totalSpendingValue} prefix="$" decimals={0} />
                </div>
                <div className="text-xs text-black-500 mt-1">Instant access</div>
              </GlassCard>
            </StaggerItem>
            <StaggerItem>
              <GlassCard glowColor="terminal" className="p-4">
                <div className="text-sm mb-1" style={{ color: CYAN }}>Vault Balance</div>
                <div className="text-2xl font-bold" style={{ color: CYAN }}>
                  <AnimatedNumber value={totalVaultValue} prefix="$" decimals={0} className="text-terminal-400" />
                </div>
                <div className="text-xs text-black-400 mt-1">{VAULT_CONFIG.timelockDays}-day timelock</div>
              </GlassCard>
            </StaggerItem>
          </StaggerContainer>
        </motion.div>

        {/* Actions */}
        <div className="flex gap-3">
          <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            onClick={() => setShowDepositModal(true)}
            className="flex-1 py-3 rounded-xl font-medium text-sm transition-colors"
            style={{ background: `linear-gradient(135deg, ${CYAN}, #0891b2)`, color: '#000' }}>
            Deposit to Vault
          </motion.button>
          <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            onClick={() => setShowWithdrawModal(true)}
            className="flex-1 py-3 rounded-xl font-medium text-sm transition-colors"
            style={{ background: `${CYAN}15`, color: CYAN, border: `1px solid ${CYAN}30` }}>
            Withdraw
          </motion.button>
        </div>

        {/* ============ Vault Strategy Cards ============ */}
        <motion.div custom={1} variants={sectionVariants} initial="hidden" animate="visible">
          <GlassCard glowColor="terminal" spotlight hover={false} className="p-5 md:p-6">
            <div className="mb-4">
              <h2 className="text-sm md:text-base font-bold tracking-wider uppercase" style={{ color: CYAN }}>Vault Strategies</h2>
              <p className="text-xs font-mono text-black-400 mt-1 italic">Risk-adjusted yield vaults secured by circuit breakers</p>
              <div className="h-px mt-3" style={{ background: `linear-gradient(90deg, ${CYAN}40, transparent)` }} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {VAULT_STRATEGIES.map((s) => (
                <motion.div key={s.id} whileHover={{ y: -3 }} transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                  className="p-4 rounded-xl bg-black-700/40 border border-black-600/50 hover:border-cyan-500/30 transition-colors">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="font-medium text-sm text-white">{s.name}</div>
                      <div className="text-xs text-black-400 mt-0.5">{s.assets}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold font-mono" style={{ color: CYAN }}>{s.apy}%</div>
                      <div className="text-[10px] text-black-500 uppercase tracking-wider">APY</div>
                    </div>
                  </div>
                  <p className="text-xs text-black-400 mb-3 leading-relaxed">{s.desc}</p>
                  <div className="flex items-center justify-between mb-2">
                    <div><div className="text-[10px] text-black-500 uppercase mb-0.5">TVL</div><div className="text-xs font-mono text-black-300">{formatUsd(s.tvl)}</div></div>
                    <div><div className="text-[10px] text-black-500 uppercase mb-0.5">Risk</div><RiskBadge level={s.risk} /></div>
                  </div>
                  <AutoCompoundToggle enabled={acToggles[s.id]} onToggle={() => toggleAC(s.id)} apy={s.apy} />
                  <RiskMetrics strategy={s} />
                </motion.div>
              ))}
            </div>
          </GlassCard>
        </motion.div>

        {/* ============ Performance Chart ============ */}
        <motion.div custom={2} variants={sectionVariants} initial="hidden" animate="visible">
          <GlassCard glowColor="terminal" spotlight hover={false} className="p-5 md:p-6">
            <div className="mb-4">
              <h2 className="text-sm md:text-base font-bold tracking-wider uppercase" style={{ color: CYAN }}>Performance</h2>
              <p className="text-xs font-mono text-black-400 mt-1 italic">60-day historical yield vs benchmark</p>
              <div className="h-px mt-3" style={{ background: `linear-gradient(90deg, ${CYAN}40, transparent)` }} />
            </div>
            <div className="mb-4 flex flex-wrap gap-2">
              {VAULT_STRATEGIES.map(s => (
                <button key={s.id} onClick={() => setChartStrategy(s.id)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                  style={{
                    background: chartStrategy === s.id ? `${CYAN}20` : 'rgba(40,40,40,1)',
                    color: chartStrategy === s.id ? CYAN : 'rgba(160,160,160,1)',
                    border: `1px solid ${chartStrategy === s.id ? `${CYAN}40` : 'transparent'}`,
                  }}>{s.name}</button>
              ))}
            </div>
            <PerformanceChart strategyId={chartStrategy} />
            <div className="mt-3 flex items-center justify-between text-xs text-black-500">
              <span>Current: <span style={{ color: CYAN }} className="font-mono font-medium">{VAULT_STRATEGIES.find(s => s.id === chartStrategy)?.apy}% APY</span></span>
              <span>vs Benchmark: <span className="font-mono text-black-400">+{VAULT_STRATEGIES.find(s => s.id === chartStrategy)?.benchmarkDelta}%</span></span>
            </div>
          </GlassCard>
        </motion.div>

        {/* ============ Vault Assets ============ */}
        <motion.div custom={3} variants={sectionVariants} initial="hidden" animate="visible">
          <GlassCard className="overflow-hidden">
            <div className="p-4 border-b border-black-700">
              <h2 className="font-semibold">Vault Assets</h2>
            </div>
            <div className="divide-y divide-black-700">
              {TOKENS.map((token) => {
                const vaultBal = vaultBalances[token.symbol] || 0
                const spendingBal = getBalance(token.symbol)
                const vaultValue = vaultBal * getTokenPrice(token.symbol)

                return (
                  <div key={token.symbol} className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div className="flex items-center space-x-3">
                      <span className="text-2xl">{token.logo}</span>
                      <div>
                        <div className="font-medium">{token.symbol}</div>
                        <div className="text-xs text-black-500">{token.name}</div>
                      </div>
                    </div>
                    <div className="text-right sm:text-right">
                      <div className="flex items-center justify-end space-x-4">
                        <div className="text-right">
                          <div className="text-xs text-black-500">Spending</div>
                          <AnimatedNumber value={spendingBal} decimals={4} className="text-sm text-black-300" />
                        </div>
                        <div className="text-right">
                          <div className="text-xs" style={{ color: CYAN }}>Vault</div>
                          <AnimatedNumber value={vaultBal} decimals={4} className="font-medium text-terminal-400" />
                        </div>
                      </div>
                      {vaultValue > 0 && (
                        <div className="text-xs text-black-500 mt-1">
                          <AnimatedNumber value={vaultValue} prefix="$" decimals={0} />
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </GlassCard>
        </motion.div>

        {/* ============ Pending Withdrawals ============ */}
        {pendingWithdrawals.length > 0 && (
          <motion.div custom={4} variants={sectionVariants} initial="hidden" animate="visible">
            <GlassCard className="overflow-hidden">
              <div className="p-4 border-b border-black-700">
                <h2 className="font-semibold">Pending Withdrawals</h2>
              </div>
              <div className="divide-y divide-black-700">
                {pendingWithdrawals.map((w) => {
                  const time = getWithdrawalTimeRemaining(w.id)
                  const isReady = time?.ready
                  const totalDuration = w.availableAt - w.initiatedAt
                  const elapsed = Date.now() - w.initiatedAt
                  const timelockProgress = Math.min(100, Math.max(0, (elapsed / totalDuration) * 100))

                  return (
                    <div key={w.id} className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <div className="flex items-center space-x-3">
                        <ProgressRing
                          progress={timelockProgress}
                          size={48}
                          strokeWidth={3}
                          color={isReady ? '#00ff41' : '#f59e0b'}
                        >
                          {isReady ? (
                            <svg className="w-5 h-5 text-matrix-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                          ) : (
                            <span className="text-[10px] font-bold text-amber-400">
                              {time?.days > 0 ? `${time.days}d` : `${time?.hours || 0}h`}
                            </span>
                          )}
                        </ProgressRing>
                        <div>
                          <div className="font-medium">
                            <AnimatedNumber value={w.amount} decimals={4} className="font-medium" />{' '}
                            {w.symbol}
                          </div>
                          <div className="text-xs text-black-500">
                            Initiated {new Date(w.initiatedAt).toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center space-x-3 self-end sm:self-auto">
                        {isReady ? (
                          <button
                            onClick={() => {
                              completeWithdrawal(w.id)
                              toast.success(`${w.amount} ${w.symbol} moved to spending`)
                            }}
                            className="px-4 py-2 rounded-lg bg-matrix-600 hover:bg-matrix-500 text-black-900 font-medium text-sm transition-colors"
                          >
                            Complete
                          </button>
                        ) : (
                          <div className="text-right">
                            <div className="text-sm font-medium text-amber-400">{formatTimeRemaining(w.id)}</div>
                            <div className="text-xs text-black-500">remaining</div>
                          </div>
                        )}
                        <button
                          onClick={() => {
                            cancelWithdrawal(w.id)
                            toast.success('Withdrawal cancelled')
                          }}
                          className="p-2 rounded-lg hover:bg-black-700 text-black-400 hover:text-white transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </GlassCard>
          </motion.div>
        )}

        {/* ============ Security Info ============ */}
        <motion.div custom={5} variants={sectionVariants} initial="hidden" animate="visible">
          <GlassCard className="p-4">
            <div className="flex items-center space-x-2 mb-3">
              <svg className="w-5 h-5" style={{ color: CYAN }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              <span className="font-medium">Vault Security</span>
            </div>
            <ul className="text-sm text-black-400 space-y-2">
              <li className="flex items-center space-x-2">
                <span style={{ color: CYAN }}>{'\u2022'}</span>
                <span>{VAULT_CONFIG.timelockDays}-day timelock on all withdrawals</span>
              </li>
              <li className="flex items-center space-x-2">
                <span style={{ color: CYAN }}>{'\u2022'}</span>
                <span>Requires {VAULT_CONFIG.guardianThreshold} of {VAULT_CONFIG.minGuardians} guardians for recovery</span>
              </li>
              <li className="flex items-center space-x-2">
                <span style={{ color: CYAN }}>{'\u2022'}</span>
                <span>Cancel any withdrawal during timelock period</span>
              </li>
              <li className="flex items-center space-x-2">
                <span style={{ color: CYAN }}>{'\u2022'}</span>
                <span>Non-custodial vaults secured by VibeSwap circuit breakers</span>
              </li>
            </ul>
          </GlassCard>
        </motion.div>
      </div>

      {/* ============ Deposit Modal ============ */}
      <AnimatePresence>
        {showDepositModal && (
          <Modal title="Deposit to Vault" onClose={() => { setShowDepositModal(false); setAmount('') }}>
            <div className="space-y-4">
              <TokenSelector tokens={TOKENS} selected={selectedToken} onSelect={setSelectedToken} />
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm text-black-400">Amount</label>
                  <span className="text-xs text-black-500">Available: {getFormattedBalance(selectedToken.symbol)} {selectedToken.symbol}</span>
                </div>
                <div className="flex items-center space-x-2">
                  <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00"
                    className="w-full min-w-0 flex-1 bg-black-700 border border-black-600 rounded-lg px-4 py-3 text-lg font-medium outline-none focus:border-cyan-500" />
                  <button onClick={() => setAmount(getBalance(selectedToken.symbol).toString())}
                    className="px-3 py-3 rounded-lg bg-black-600 hover:bg-black-500 text-sm font-medium transition-colors shrink-0">MAX</button>
                </div>
              </div>
              {parseFloat(amount) > 0 && (
                <div className="p-3 rounded-xl bg-black-900/50 space-y-2">
                  <div className="text-xs text-black-400 mb-1 font-medium uppercase tracking-wider">Deposit Preview</div>
                  {[['Vault Shares', depositShares.shares.toFixed(4), CYAN],
                    ['Fee (0.1%)', `$${depositShares.fee.toFixed(2)}`, null],
                  ].map(([l, v, c]) => (
                    <div key={l} className="flex items-center justify-between text-sm">
                      <span className="text-black-400">{l}</span>
                      <span className={`font-mono ${c ? '' : 'text-black-300'}`} style={c ? { color: c } : undefined}>{v}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between text-sm border-t border-black-700 pt-2">
                    <span className="text-black-400">Net Value</span>
                    <span className="font-mono font-medium text-white">${depositShares.net.toFixed(2)}</span>
                  </div>
                </div>
              )}
              <SlippageSelector value={slippage} onChange={setSlippage} />
              <div className="p-3 rounded-lg bg-terminal-500/10 border border-terminal-500/20">
                <p className="text-xs text-black-300">Deposits are instant. Withdrawals require a {VAULT_CONFIG.timelockDays}-day waiting period.</p>
              </div>
              <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                onClick={handleDeposit} disabled={!amount || parseFloat(amount) <= 0}
                className="w-full py-4 rounded-xl font-semibold transition-colors disabled:bg-black-600 disabled:text-black-500"
                style={amount && parseFloat(amount) > 0 ? { background: `linear-gradient(135deg, ${CYAN}, #0891b2)`, color: '#000' } : undefined}>
                Move to Vault
              </motion.button>
            </div>
          </Modal>
        )}
      </AnimatePresence>

      {/* ============ Withdraw Modal ============ */}
      <AnimatePresence>
        {showWithdrawModal && (
          <Modal title="Withdraw from Vault" onClose={() => { setShowWithdrawModal(false); setAmount('') }}>
            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <div className="flex items-start space-x-2">
                  <span className="text-amber-500">{'\u23F0'}</span>
                  <div>
                    <div className="font-medium text-amber-400 text-sm">{VAULT_CONFIG.timelockDays}-Day Waiting Period</div>
                    <p className="text-xs text-black-400 mt-1">Withdrawals take {VAULT_CONFIG.timelockDays} days. You can cancel anytime.</p>
                  </div>
                </div>
              </div>
              <TokenSelector tokens={TOKENS} selected={selectedToken} onSelect={setSelectedToken} />
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm text-black-400">Amount</label>
                  <span className="text-xs text-black-500">In vault: {getFormattedVaultBalance(selectedToken.symbol)} {selectedToken.symbol}</span>
                </div>
                <div className="flex items-center space-x-2">
                  <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00"
                    className="w-full min-w-0 flex-1 bg-black-700 border border-black-600 rounded-lg px-4 py-3 text-lg font-medium outline-none focus:border-cyan-500" />
                  <button onClick={() => setAmount((vaultBalances[selectedToken.symbol] || 0).toString())}
                    className="px-3 py-3 rounded-lg bg-black-600 hover:bg-black-500 text-sm font-medium transition-colors shrink-0">MAX</button>
                </div>
              </div>
              {parseFloat(amount) > 0 && (
                <div className="p-3 rounded-xl bg-black-900/50 space-y-2">
                  <div className="text-xs text-black-400 mb-1 font-medium uppercase tracking-wider">Withdrawal Preview</div>
                  {[['You Receive', `${withdrawShares.received.toFixed(4)} ${selectedToken.symbol}`, 'text-white'],
                    ['Fee (0.1%)', `$${withdrawShares.fee.toFixed(2)}`, 'text-black-300'],
                    ['Available After', `${VAULT_CONFIG.timelockDays} days`, 'text-amber-400'],
                  ].map(([l, v, cls]) => (
                    <div key={l} className="flex items-center justify-between text-sm">
                      <span className="text-black-400">{l}</span>
                      <span className={`font-mono ${cls}`}>{v}</span>
                    </div>
                  ))}
                </div>
              )}
              <SlippageSelector value={slippage} onChange={setSlippage} />
              <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                onClick={handleInitiateWithdrawal} disabled={!amount || parseFloat(amount) <= 0}
                className="w-full py-4 rounded-xl font-semibold transition-colors disabled:bg-black-600 disabled:text-black-500 bg-amber-600 hover:bg-amber-500 text-black-900">
                Start {VAULT_CONFIG.timelockDays}-Day Withdrawal
              </motion.button>
            </div>
          </Modal>
        )}
      </AnimatePresence>
    </div>
  )
}

// ============ Modal Component ============

function Modal({ title, children, onClose }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 20, filter: 'blur(4px)' }}
        animate={{ scale: 1, opacity: 1, y: 0, filter: 'blur(0px)' }}
        exit={{ scale: 0.95, opacity: 0, y: 20, filter: 'blur(4px)' }}
        className="relative w-full max-w-md glass-card rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
      >
        <div className="flex items-center justify-between p-4 border-b border-black-700 shrink-0">
          <h3 className="font-semibold">{title}</h3>
          <button onClick={onClose} className="p-2 hover:bg-black-700 rounded-lg transition-colors">
            <svg className="w-5 h-5 text-black-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-4 overflow-y-auto">
          {children}
        </div>
      </motion.div>
    </motion.div>
  )
}

export default VaultPage
