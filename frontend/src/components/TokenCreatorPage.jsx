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
const GREEN = '#34d399'
const AMBER = '#fbbf24'
const RED = '#f87171'
const PURPLE = '#a78bfa'

const ESTIMATED_GAS = 0.015
const MAX_SYMBOL_LENGTH = 8
const TOTAL_STEPS = 4

// ============ Seeded PRNG ============

function seededRandom(seed) {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

// ============ Helpers ============

function fmt(n) {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'B'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toLocaleString()
}

function fmtUSD(n) { return '$' + fmt(n) }

function timeAgo(ts) {
  const d = Date.now() - ts
  if (d < 3600000) return Math.round(d / 60000) + 'm ago'
  if (d < 86400000) return Math.round(d / 3600000) + 'h ago'
  return Math.round(d / 86400000) + 'd ago'
}

// ============ Step Definitions ============

const STEPS = [
  { id: 1, label: 'Token Details', icon: '◈' },
  { id: 2, label: 'Distribution', icon: '◐' },
  { id: 3, label: 'Safety', icon: '⛨' },
  { id: 4, label: 'Review & Deploy', icon: '⟐' },
]

// ============ Default Form State ============

const DEFAULT_FORM = {
  name: '',
  symbol: '',
  description: '',
  logoFile: null,
  totalSupply: '1000000000',
  teamPct: 10,
  communityPct: 40,
  liquidityPct: 35,
  treasuryPct: 15,
  antiBot: true,
  maxWallet: true,
  gradualUnlock: true,
  circuitBreaker: false,
}

// ============ Recent Launches (Mock) ============

function generateRecentLaunches() {
  const rng = seededRandom(7777)
  const names = [
    'Nebula Finance', 'Quantum Pulse', 'SilkRoute DAO',
    'IronClad Protocol', 'EchoVerse',
  ]
  const symbols = ['NEBU', 'QPLS', 'SILK', 'IRON', 'ECHO']
  const chains = ['Ethereum', 'Arbitrum', 'Base', 'Optimism', 'Polygon']
  const chainColors = ['#627EEA', '#28A0F0', '#0052FF', '#FF0420', '#8247E5']
  const logos = ['◆', '✦', '⬡', '⛨', '◎']

  return names.map((name, i) => {
    const supply = Math.floor(rng() * 9_000_000_000 + 1_000_000_000)
    const price = rng() * 0.08 + 0.001
    const mcap = supply * price
    const holders = Math.floor(rng() * 4500 + 200)
    const hoursAgo = Math.floor(rng() * 168 + 1)
    return {
      name,
      symbol: symbols[i],
      logo: logos[i],
      chain: chains[i],
      chainColor: chainColors[i],
      totalSupply: supply,
      price,
      mcap,
      holders,
      launchedAt: Date.now() - hoursAgo * 3600000,
      safetyScore: Math.floor(rng() * 30 + 70),
      liquidityLocked: rng() > 0.3,
    }
  })
}

// ============ Progress Stepper ============

function ProgressStepper({ currentStep }) {
  return (
    <div className="flex items-center justify-between mb-8">
      {STEPS.map((step, idx) => {
        const isActive = currentStep === step.id
        const isComplete = currentStep > step.id
        return (
          <div key={step.id} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center">
              <motion.div
                className={`w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold border-2 transition-colors duration-300 ${
                  isComplete
                    ? 'bg-cyan-500/20 border-cyan-500 text-cyan-400'
                    : isActive
                    ? 'bg-cyan-500/10 border-cyan-400 text-cyan-300'
                    : 'bg-black-800/50 border-black-600 text-black-500'
                }`}
                animate={isActive ? { scale: [1, 1.08, 1] } : {}}
                transition={{ duration: PHI, repeat: isActive ? Infinity : 0, repeatType: 'reverse' }}
              >
                {isComplete ? '✓' : step.icon}
              </motion.div>
              <span className={`text-xs mt-1.5 font-mono whitespace-nowrap ${
                isActive ? 'text-cyan-400' : isComplete ? 'text-cyan-500/60' : 'text-black-500'
              }`}>
                {step.label}
              </span>
            </div>
            {idx < STEPS.length - 1 && (
              <div className={`flex-1 h-px mx-3 mt-[-18px] transition-colors duration-300 ${
                currentStep > step.id ? 'bg-cyan-500/40' : 'bg-black-700'
              }`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ============ Allocation Pie Chart (SVG) ============

function AllocationChart({ team, community, liquidity, treasury }) {
  const slices = [
    { label: 'Team', pct: team, color: PURPLE },
    { label: 'Community', pct: community, color: CYAN },
    { label: 'Liquidity', pct: liquidity, color: GREEN },
    { label: 'Treasury', pct: treasury, color: AMBER },
  ]

  const total = team + community + liquidity + treasury
  let cumulative = 0
  const paths = slices.map((slice) => {
    const pct = total > 0 ? slice.pct / total : 0.25
    const startAngle = cumulative * 2 * Math.PI - Math.PI / 2
    cumulative += pct
    const endAngle = cumulative * 2 * Math.PI - Math.PI / 2
    const largeArc = pct > 0.5 ? 1 : 0
    const x1 = 50 + 40 * Math.cos(startAngle)
    const y1 = 50 + 40 * Math.sin(startAngle)
    const x2 = 50 + 40 * Math.cos(endAngle)
    const y2 = 50 + 40 * Math.sin(endAngle)
    const d = pct >= 1
      ? `M 50 10 A 40 40 0 1 1 49.999 10`
      : pct <= 0
      ? ''
      : `M 50 50 L ${x1} ${y1} A 40 40 0 ${largeArc} 1 ${x2} ${y2} Z`
    return { ...slice, d, pct }
  })

  return (
    <div className="flex items-center gap-6">
      <svg viewBox="0 0 100 100" className="w-40 h-40 flex-shrink-0">
        {paths.map((p, i) => p.d && (
          <motion.path
            key={i}
            d={p.d}
            fill={p.color}
            fillOpacity={0.7}
            stroke="rgba(0,0,0,0.4)"
            strokeWidth={0.5}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.1, duration: 0.4 }}
          />
        ))}
        <circle cx="50" cy="50" r="18" fill="rgba(10,10,10,0.9)" />
        <text x="50" y="50" textAnchor="middle" dominantBaseline="central" fill="white" fontSize="7" fontWeight="bold">
          {total}%
        </text>
      </svg>
      <div className="flex flex-col gap-2">
        {slices.map((s, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: s.color, opacity: 0.8 }} />
            <span className="text-black-400 w-24">{s.label}</span>
            <span className="font-mono text-white">{s.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ============ Toggle Switch ============

function Toggle({ label, description, checked, onChange }) {
  return (
    <div className="flex items-start justify-between py-3 border-b border-black-700/50 last:border-b-0">
      <div className="flex-1 mr-4">
        <div className="text-sm font-medium text-white">{label}</div>
        <div className="text-xs text-black-400 mt-0.5">{description}</div>
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative w-11 h-6 rounded-full transition-colors duration-200 flex-shrink-0 ${
          checked ? 'bg-cyan-500/30' : 'bg-black-700'
        }`}
      >
        <motion.div
          className={`absolute top-0.5 w-5 h-5 rounded-full shadow-md ${
            checked ? 'bg-cyan-400' : 'bg-black-500'
          }`}
          animate={{ left: checked ? '22px' : '2px' }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        />
      </button>
    </div>
  )
}

// ============ Allocation Slider ============

function AllocationSlider({ label, color, value, onChange, remaining }) {
  const maxAllowed = value + remaining
  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: color }} />
          <span className="text-sm text-black-300">{label}</span>
        </div>
        <span className="text-sm font-mono text-white">{value}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={Math.min(100, maxAllowed)}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value))}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
        style={{
          background: `linear-gradient(to right, ${color} 0%, ${color} ${value}%, rgba(50,50,50,0.8) ${value}%, rgba(50,50,50,0.8) 100%)`,
        }}
      />
    </div>
  )
}

// ============ Step 1: Token Details ============

function StepTokenDetails({ form, setForm }) {
  const handleChange = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 1 / (PHI * PHI) }}
    >
      <h3 className="text-lg font-semibold mb-1">Token Details</h3>
      <p className="text-sm text-black-400 mb-6">Define the identity of your token. Choose a memorable name and symbol.</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        {/* Token Name */}
        <div>
          <label className="block text-xs font-mono text-black-400 uppercase tracking-wider mb-1.5">Token Name</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => handleChange('name', e.target.value)}
            placeholder="e.g. VibeSwap Token"
            className="w-full bg-black-800/60 border border-black-600 rounded-xl px-4 py-2.5 text-sm text-white placeholder-black-500 focus:outline-none focus:border-cyan-500/50 transition-colors"
          />
        </div>

        {/* Token Symbol */}
        <div>
          <label className="block text-xs font-mono text-black-400 uppercase tracking-wider mb-1.5">
            Symbol <span className="text-black-500">({MAX_SYMBOL_LENGTH} chars max)</span>
          </label>
          <input
            type="text"
            value={form.symbol}
            onChange={(e) => handleChange('symbol', e.target.value.toUpperCase().slice(0, MAX_SYMBOL_LENGTH))}
            placeholder="e.g. VIBE"
            maxLength={MAX_SYMBOL_LENGTH}
            className="w-full bg-black-800/60 border border-black-600 rounded-xl px-4 py-2.5 text-sm text-white placeholder-black-500 focus:outline-none focus:border-cyan-500/50 transition-colors font-mono uppercase"
          />
        </div>
      </div>

      {/* Description */}
      <div className="mb-4">
        <label className="block text-xs font-mono text-black-400 uppercase tracking-wider mb-1.5">Description</label>
        <textarea
          value={form.description}
          onChange={(e) => handleChange('description', e.target.value)}
          placeholder="Describe your token's purpose, utility, and vision..."
          rows={3}
          className="w-full bg-black-800/60 border border-black-600 rounded-xl px-4 py-2.5 text-sm text-white placeholder-black-500 focus:outline-none focus:border-cyan-500/50 transition-colors resize-none"
        />
      </div>

      {/* Logo Upload Placeholder */}
      <div className="mb-4">
        <label className="block text-xs font-mono text-black-400 uppercase tracking-wider mb-1.5">Token Logo</label>
        <div className="border-2 border-dashed border-black-600 rounded-xl p-6 flex flex-col items-center justify-center hover:border-cyan-500/30 transition-colors cursor-pointer">
          <div className="w-16 h-16 rounded-full bg-black-800 border border-black-600 flex items-center justify-center text-2xl text-black-500 mb-3">
            {form.symbol ? form.symbol.charAt(0) : '?'}
          </div>
          <p className="text-sm text-black-400">Click to upload or drag and drop</p>
          <p className="text-xs text-black-500 mt-1">PNG, JPG, SVG up to 1MB (256x256 recommended)</p>
        </div>
      </div>

      {/* Total Supply */}
      <div>
        <label className="block text-xs font-mono text-black-400 uppercase tracking-wider mb-1.5">Total Supply</label>
        <div className="relative">
          <input
            type="text"
            value={form.totalSupply}
            onChange={(e) => {
              const v = e.target.value.replace(/[^0-9]/g, '')
              handleChange('totalSupply', v)
            }}
            placeholder="1000000000"
            className="w-full bg-black-800/60 border border-black-600 rounded-xl px-4 py-2.5 text-sm text-white placeholder-black-500 focus:outline-none focus:border-cyan-500/50 transition-colors font-mono"
          />
          {form.totalSupply && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-black-400 font-mono">
              {fmt(parseInt(form.totalSupply) || 0)} tokens
            </div>
          )}
        </div>
      </div>
    </motion.div>
  )
}

// ============ Step 2: Distribution ============

function StepDistribution({ form, setForm }) {
  const allocated = form.teamPct + form.communityPct + form.liquidityPct + form.treasuryPct
  const remaining = 100 - allocated

  const handleSlider = (field) => (value) => {
    const others = ['teamPct', 'communityPct', 'liquidityPct', 'treasuryPct'].filter(f => f !== field)
    const othersTotal = others.reduce((sum, f) => sum + form[f], 0)
    const newValue = Math.min(value, 100 - othersTotal)
    setForm(prev => ({ ...prev, [field]: Math.max(0, newValue) }))
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 1 / (PHI * PHI) }}
    >
      <h3 className="text-lg font-semibold mb-1">Token Distribution</h3>
      <p className="text-sm text-black-400 mb-6">Allocate your total supply across stakeholder groups. Fair distribution builds trust.</p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Sliders */}
        <div>
          <AllocationSlider label="Team" color={PURPLE} value={form.teamPct} onChange={handleSlider('teamPct')} remaining={remaining} />
          <AllocationSlider label="Community" color={CYAN} value={form.communityPct} onChange={handleSlider('communityPct')} remaining={remaining} />
          <AllocationSlider label="Liquidity" color={GREEN} value={form.liquidityPct} onChange={handleSlider('liquidityPct')} remaining={remaining} />
          <AllocationSlider label="Treasury" color={AMBER} value={form.treasuryPct} onChange={handleSlider('treasuryPct')} remaining={remaining} />

          {/* Remaining indicator */}
          <div className={`flex items-center justify-between mt-3 px-3 py-2 rounded-lg text-xs font-mono ${
            remaining === 0
              ? 'bg-green-500/10 text-green-400 border border-green-500/20'
              : remaining < 0
              ? 'bg-red-500/10 text-red-400 border border-red-500/20'
              : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
          }`}>
            <span>{remaining === 0 ? '✓ Fully allocated' : remaining > 0 ? 'Unallocated' : 'Over-allocated'}</span>
            <span>{remaining}% remaining</span>
          </div>
        </div>

        {/* Pie Chart */}
        <div className="flex items-center justify-center">
          <AllocationChart
            team={form.teamPct}
            community={form.communityPct}
            liquidity={form.liquidityPct}
            treasury={form.treasuryPct}
          />
        </div>
      </div>

      {/* Distribution Tips */}
      <GlassCard className="p-4 mt-6" glowColor="terminal">
        <div className="flex items-start gap-3">
          <span className="text-cyan-400 text-lg">◇</span>
          <div>
            <div className="text-xs font-mono text-cyan-400 mb-1">Fair Launch Recommendation</div>
            <p className="text-xs text-black-400 leading-relaxed">
              Projects with &ge;30% community allocation and &ge;20% locked liquidity
              tend to build stronger holder bases. VibeSwap's cooperative economics
              model recommends keeping team allocation under 15% with vesting.
            </p>
          </div>
        </div>
      </GlassCard>
    </motion.div>
  )
}

// ============ Step 3: Safety Features ============

function StepSafety({ form, setForm }) {
  const handleToggle = (field) => (value) => {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  const enabledCount = [form.antiBot, form.maxWallet, form.gradualUnlock, form.circuitBreaker].filter(Boolean).length
  const safetyScore = enabledCount * 25

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 1 / (PHI * PHI) }}
    >
      <h3 className="text-lg font-semibold mb-1">Safety Features</h3>
      <p className="text-sm text-black-400 mb-6">Enable protections that build investor confidence and prevent exploits.</p>

      {/* Safety Score */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-mono text-black-400 uppercase tracking-wider">Safety Score</span>
          <span className={`text-sm font-mono font-bold ${
            safetyScore >= 75 ? 'text-green-400' : safetyScore >= 50 ? 'text-amber-400' : 'text-red-400'
          }`}>
            {safetyScore}/100
          </span>
        </div>
        <div className="w-full h-2 bg-black-800 rounded-full overflow-hidden">
          <motion.div
            className="h-full rounded-full"
            style={{
              backgroundColor: safetyScore >= 75 ? GREEN : safetyScore >= 50 ? AMBER : RED,
            }}
            initial={{ width: 0 }}
            animate={{ width: `${safetyScore}%` }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
          />
        </div>
      </div>

      {/* Toggle List */}
      <GlassCard className="p-4" glowColor="none">
        <Toggle
          label="Anti-Bot Protection"
          description="Block sniper bots during the first 3 blocks after launch. Limits buy size and frequency to prevent front-running."
          checked={form.antiBot}
          onChange={handleToggle('antiBot')}
        />
        <Toggle
          label="Max Wallet Limit"
          description="Cap individual wallet holdings at 2% of total supply. Prevents whale concentration and promotes fair distribution."
          checked={form.maxWallet}
          onChange={handleToggle('maxWallet')}
        />
        <Toggle
          label="Gradual Unlock"
          description="Team and treasury tokens unlock linearly over 12 months. Signals long-term commitment and prevents early dumps."
          checked={form.gradualUnlock}
          onChange={handleToggle('gradualUnlock')}
        />
        <Toggle
          label="Circuit Breaker Integration"
          description="Integrate with VibeSwap's circuit breaker system. Auto-pauses trading if price drops >30% in 5 minutes."
          checked={form.circuitBreaker}
          onChange={handleToggle('circuitBreaker')}
        />
      </GlassCard>

      {/* Safety Note */}
      <div className="mt-4 flex items-start gap-2 text-xs text-black-400">
        <span className="text-cyan-500 mt-0.5">⛨</span>
        <p>All safety features are enforced on-chain and cannot be disabled after deployment. Choose carefully.</p>
      </div>
    </motion.div>
  )
}

// ============ Step 4: Review & Deploy ============

function StepReview({ form, onDeploy, isDeploying }) {
  const allocated = form.teamPct + form.communityPct + form.liquidityPct + form.treasuryPct
  const enabledSafety = [
    form.antiBot && 'Anti-Bot Protection',
    form.maxWallet && 'Max Wallet Limit',
    form.gradualUnlock && 'Gradual Unlock',
    form.circuitBreaker && 'Circuit Breaker',
  ].filter(Boolean)

  const supply = parseInt(form.totalSupply) || 0

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 1 / (PHI * PHI) }}
    >
      <h3 className="text-lg font-semibold mb-1">Review & Deploy</h3>
      <p className="text-sm text-black-400 mb-6">Double-check everything before deploying. This action is irreversible.</p>

      {/* Summary Card */}
      <GlassCard className="p-5 mb-4" glowColor="terminal">
        <div className="flex items-center gap-4 mb-4 pb-4 border-b border-black-700/50">
          <div className="w-14 h-14 rounded-full bg-black-800 border border-cyan-500/30 flex items-center justify-center text-2xl font-bold text-cyan-400">
            {form.symbol ? form.symbol.charAt(0) : '?'}
          </div>
          <div>
            <div className="text-lg font-semibold">{form.name || 'Unnamed Token'}</div>
            <div className="text-sm font-mono text-cyan-400">${form.symbol || '???'}</div>
          </div>
        </div>

        {form.description && (
          <p className="text-sm text-black-400 mb-4 leading-relaxed">{form.description}</p>
        )}

        {/* Details Grid */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="bg-black-800/40 rounded-lg p-3">
            <div className="text-xs text-black-500 font-mono mb-0.5">Total Supply</div>
            <div className="font-mono text-white">{fmt(supply)}</div>
          </div>
          <div className="bg-black-800/40 rounded-lg p-3">
            <div className="text-xs text-black-500 font-mono mb-0.5">Allocation</div>
            <div className={`font-mono ${allocated === 100 ? 'text-green-400' : 'text-amber-400'}`}>
              {allocated}% allocated
            </div>
          </div>
          <div className="bg-black-800/40 rounded-lg p-3">
            <div className="text-xs text-black-500 font-mono mb-0.5">Safety Score</div>
            <div className="font-mono text-white">{enabledSafety.length * 25}/100</div>
          </div>
          <div className="bg-black-800/40 rounded-lg p-3">
            <div className="text-xs text-black-500 font-mono mb-0.5">Est. Gas</div>
            <div className="font-mono text-white">{ESTIMATED_GAS} ETH</div>
          </div>
        </div>
      </GlassCard>

      {/* Distribution Breakdown */}
      <GlassCard className="p-4 mb-4" glowColor="none">
        <div className="text-xs font-mono text-black-400 uppercase tracking-wider mb-3">Distribution</div>
        <div className="space-y-2">
          {[
            { label: 'Team', pct: form.teamPct, color: PURPLE },
            { label: 'Community', pct: form.communityPct, color: CYAN },
            { label: 'Liquidity', pct: form.liquidityPct, color: GREEN },
            { label: 'Treasury', pct: form.treasuryPct, color: AMBER },
          ].map(({ label, pct, color }) => (
            <div key={label} className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: color }} />
                <span className="text-black-300">{label}</span>
              </div>
              <div className="flex items-center gap-3 font-mono">
                <span className="text-black-500">{fmt(Math.floor(supply * pct / 100))}</span>
                <span className="text-white w-10 text-right">{pct}%</span>
              </div>
            </div>
          ))}
        </div>
      </GlassCard>

      {/* Safety Features List */}
      <GlassCard className="p-4 mb-6" glowColor="none">
        <div className="text-xs font-mono text-black-400 uppercase tracking-wider mb-3">Safety Features</div>
        {enabledSafety.length > 0 ? (
          <div className="space-y-1.5">
            {enabledSafety.map((feat) => (
              <div key={feat} className="flex items-center gap-2 text-sm">
                <span className="text-green-400">✓</span>
                <span className="text-black-300">{feat}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-black-500 italic">No safety features enabled</p>
        )}
      </GlassCard>

      {/* Warnings */}
      {allocated !== 100 && (
        <div className="mb-4 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-sm text-amber-400 flex items-center gap-2">
          <span>⚠</span>
          <span>Token allocation does not equal 100%. Currently at {allocated}%.</span>
        </div>
      )}

      {(!form.name || !form.symbol) && (
        <div className="mb-4 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-400 flex items-center gap-2">
          <span>✕</span>
          <span>Token name and symbol are required before deploying.</span>
        </div>
      )}

      {/* Deploy Button */}
      <motion.button
        onClick={onDeploy}
        disabled={isDeploying || !form.name || !form.symbol || allocated !== 100}
        className={`w-full py-3.5 rounded-xl font-semibold text-sm transition-all duration-200 ${
          isDeploying || !form.name || !form.symbol || allocated !== 100
            ? 'bg-black-700 text-black-500 cursor-not-allowed'
            : 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/30 hover:border-cyan-400/50'
        }`}
        whileHover={!isDeploying && form.name && form.symbol && allocated === 100 ? { scale: 1.01 } : {}}
        whileTap={!isDeploying && form.name && form.symbol && allocated === 100 ? { scale: 0.99 } : {}}
      >
        {isDeploying ? (
          <span className="flex items-center justify-center gap-2">
            <motion.span
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
              className="inline-block"
            >
              ◌
            </motion.span>
            Deploying Contract...
          </span>
        ) : (
          `Deploy Token — ${ESTIMATED_GAS} ETH`
        )}
      </motion.button>

      <p className="text-xs text-black-500 text-center mt-3">
        By deploying, you agree to VibeSwap's <Link to="/legal" className="text-cyan-500/60 hover:text-cyan-400 underline">terms of service</Link>.
        Token contracts are immutable once deployed.
      </p>
    </motion.div>
  )
}

// ============ Not Connected State ============

function NotConnectedState() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 1 / (PHI * PHI) }}
      className="text-center py-16"
    >
      <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-black-800 border border-black-600 flex items-center justify-center text-3xl text-black-500">
        ◈
      </div>
      <h3 className="text-xl font-semibold mb-2 text-white">Connect Wallet to Create a Token</h3>
      <p className="text-sm text-black-400 max-w-md mx-auto mb-6">
        Connect your wallet to access the token creator. You'll need ETH for gas fees
        to deploy your token contract on-chain.
      </p>
      <div className="flex items-center justify-center gap-4 text-xs text-black-500">
        <div className="flex items-center gap-1.5">
          <span className="text-green-500">✓</span> Fair launch guarantee
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-green-500">✓</span> No hidden fees
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-green-500">✓</span> Open source contracts
        </div>
      </div>
    </motion.div>
  )
}

// ============ Recent Launches Section ============

function RecentLaunches({ launches }) {
  return (
    <div className="mt-10">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">Recent Launches</h3>
        <span className="text-xs font-mono text-black-500">{launches.length} tokens</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
        {launches.map((token, i) => (
          <motion.div
            key={token.symbol}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08, duration: 0.4 }}
          >
            <GlassCard className="p-4" glowColor="none">
              <div className="flex items-center gap-3 mb-3">
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-lg font-bold"
                  style={{ backgroundColor: token.chainColor + '20', color: token.chainColor }}
                >
                  {token.logo}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold truncate">{token.name}</div>
                  <div className="text-xs font-mono text-black-400">${token.symbol}</div>
                </div>
              </div>

              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-black-500">Market Cap</span>
                  <span className="font-mono text-white">{fmtUSD(token.mcap)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-black-500">Holders</span>
                  <span className="font-mono text-white">{fmt(token.holders)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-black-500">Chain</span>
                  <span className="font-mono text-black-300">{token.chain}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-black-500">Launched</span>
                  <span className="font-mono text-black-300">{timeAgo(token.launchedAt)}</span>
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between">
                <div className={`flex items-center gap-1 text-xs font-mono ${
                  token.safetyScore >= 80 ? 'text-green-400' : token.safetyScore >= 60 ? 'text-amber-400' : 'text-red-400'
                }`}>
                  <span>⛨</span> {token.safetyScore}
                </div>
                {token.liquidityLocked && (
                  <div className="text-xs text-green-500/60 font-mono flex items-center gap-1">
                    <span>⊟</span> Locked
                  </div>
                )}
              </div>
            </GlassCard>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

// ============ Main Component ============

export default function TokenCreatorPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [currentStep, setCurrentStep] = useState(1)
  const [form, setForm] = useState(DEFAULT_FORM)
  const [isDeploying, setIsDeploying] = useState(false)
  const [deployComplete, setDeployComplete] = useState(false)

  const recentLaunches = useMemo(() => generateRecentLaunches(), [])

  // ============ Navigation ============

  const goNext = () => setCurrentStep(s => Math.min(s + 1, TOTAL_STEPS))
  const goBack = () => setCurrentStep(s => Math.max(s - 1, 1))

  // ============ Mock Deploy ============

  const handleDeploy = () => {
    setIsDeploying(true)
    setTimeout(() => {
      setIsDeploying(false)
      setDeployComplete(true)
    }, 3000)
  }

  // ============ Deploy Success ============

  if (deployComplete) {
    return (
      <div className="min-h-screen">
        <PageHero
          title="Token Creator"
          subtitle="Launch your token with fair distribution, built-in safety, and cooperative economics"
          category="defi"
        />
        <div className="max-w-2xl mx-auto px-4 pb-12">
          <GlassCard className="p-8 text-center" glowColor="terminal">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 200, damping: 15 }}
              className="w-20 h-20 mx-auto mb-6 rounded-full flex items-center justify-center text-3xl"
              style={{ backgroundColor: 'rgba(6, 182, 212, 0.15)', border: '2px solid rgba(6, 182, 212, 0.3)' }}
            >
              ✓
            </motion.div>
            <h2 className="text-2xl font-bold mb-2 text-white">Token Deployed!</h2>
            <p className="text-sm text-black-400 mb-4">
              <span className="font-mono text-cyan-400">${form.symbol}</span> has been deployed successfully.
            </p>
            <div className="bg-black-800/50 rounded-xl p-4 mb-6 font-mono text-xs text-black-400 break-all">
              Contract: 0x{Array.from({ length: 40 }, (_, i) => '0123456789abcdef'[Math.floor(seededRandom(i + 42)() * 16)]).join('')}
            </div>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => { setDeployComplete(false); setCurrentStep(1); setForm(DEFAULT_FORM) }}
                className="px-6 py-2.5 rounded-xl text-sm font-medium bg-black-800 text-black-300 border border-black-600 hover:border-black-500 transition-colors"
              >
                Create Another
              </button>
              <Link
                to="/tokens"
                className="px-6 py-2.5 rounded-xl text-sm font-medium bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/30 transition-colors"
              >
                View Token
              </Link>
            </div>
          </GlassCard>
        </div>
      </div>
    )
  }

  // ============ Render ============

  return (
    <div className="min-h-screen">
      <PageHero
        title="Token Creator"
        subtitle="Launch your token with fair distribution, built-in safety, and cooperative economics"
        category="defi"
      />

      <div className="max-w-3xl mx-auto px-4 pb-12">
        {isConnected ? (
          <>
            {/* Progress Stepper */}
            <ProgressStepper currentStep={currentStep} />

            {/* Step Content */}
            <GlassCard className="p-6 mb-6" glowColor="terminal">
              <AnimatePresence mode="wait">
                {currentStep === 1 && <StepTokenDetails key="step1" form={form} setForm={setForm} />}
                {currentStep === 2 && <StepDistribution key="step2" form={form} setForm={setForm} />}
                {currentStep === 3 && <StepSafety key="step3" form={form} setForm={setForm} />}
                {currentStep === 4 && (
                  <StepReview key="step4" form={form} onDeploy={handleDeploy} isDeploying={isDeploying} />
                )}
              </AnimatePresence>
            </GlassCard>

            {/* Navigation Buttons */}
            {currentStep < TOTAL_STEPS && (
              <div className="flex items-center justify-between">
                <button
                  onClick={goBack}
                  disabled={currentStep === 1}
                  className={`px-5 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                    currentStep === 1
                      ? 'text-black-600 cursor-not-allowed'
                      : 'text-black-300 hover:text-white bg-black-800/50 border border-black-700 hover:border-black-500'
                  }`}
                >
                  Back
                </button>

                <div className="flex items-center gap-1.5">
                  {STEPS.map((s) => (
                    <div
                      key={s.id}
                      className={`w-1.5 h-1.5 rounded-full transition-colors ${
                        s.id === currentStep ? 'bg-cyan-400' : s.id < currentStep ? 'bg-cyan-500/40' : 'bg-black-700'
                      }`}
                    />
                  ))}
                </div>

                <motion.button
                  onClick={goNext}
                  className="px-5 py-2.5 rounded-xl text-sm font-medium bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/30 hover:border-cyan-400/50 transition-colors"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  Next
                </motion.button>
              </div>
            )}
          </>
        ) : (
          <GlassCard className="p-6" glowColor="none">
            <NotConnectedState />
          </GlassCard>
        )}

        {/* Recent Launches */}
        <RecentLaunches launches={recentLaunches} />
      </div>
    </div>
  )
}
