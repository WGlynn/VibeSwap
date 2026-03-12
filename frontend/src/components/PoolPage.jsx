import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'
import StatCard from './ui/StatCard'
import Sparkline, { generateSparklineData } from './ui/Sparkline'

// ============ Constants ============
const PHI = 1.618033988749895
const STAGGER = 1 / (PHI * PHI * PHI)
const EASE = [0.25, 0.1, 1 / PHI, 1]

// ============ Seeded PRNG ============
function seededRandom(seed) {
  let s = seed
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646 }
}

// ============ Mock Data ============
const TK = {
  ETH: { symbol: 'ETH', icon: '\u039E' }, USDC: { symbol: 'USDC', icon: '\uD83D\uDCB5' },
  WBTC: { symbol: 'WBTC', icon: '\u20BF' }, DAI: { symbol: 'DAI', icon: '\u25C8' },
  LINK: { symbol: 'LINK', icon: '\u26D3' }, UNI: { symbol: 'UNI', icon: '\uD83E\uDD84' },
  ARB: { symbol: 'ARB', icon: '\u2B21' }, OP: { symbol: 'OP', icon: '\u2B24' },
  MATIC: { symbol: 'MATIC', icon: '\u2B23' }, AAVE: { symbol: 'AAVE', icon: '\u25B2' },
}

function buildPools() {
  return [
    ['ETH','USDC',7001],['WBTC','ETH',7002],['ETH','DAI',7003],['LINK','ETH',7004],
    ['UNI','USDC',7005],['ARB','ETH',7006],['OP','ETH',7007],['MATIC','USDC',7008],
    ['AAVE','ETH',7009],['WBTC','USDC',7010],
  ].map(([a, b, seed]) => {
    const r = seededRandom(seed)
    const tvl = 1e6 + r() * 18e6, vol = tvl * (0.05 + r() * 0.25)
    return { id: `${a}-${b}`, tokenA: TK[a], tokenB: TK[b], tvl, volume24h: vol,
      apr: 8 + r() * 37, fees24h: vol * 0.003, feeTier: r() > 0.5 ? 0.3 : 0.05,
      sparkData: generateSparklineData(seed, 24, 0.04), seed }
  })
}

const POSITIONS = [
  { id:'pos-1', tokenA:TK.ETH, tokenB:TK.USDC, share:0.0042, value:12480,
    unclaimedFees:34.21, ilPercent:-0.8, ilProtected:true, coveragePct:85, loyaltyTier:'Gold' },
  { id:'pos-2', tokenA:TK.WBTC, tokenB:TK.ETH, share:0.0018, value:5230,
    unclaimedFees:12.55, ilPercent:-2.1, ilProtected:false, coveragePct:0, loyaltyTier:'Bronze' },
]

// ============ Helpers ============
function fmt(n) {
  if (n >= 1e6) return `$${(n/1e6).toFixed(1)}M`
  if (n >= 1e3) return `$${(n/1e3).toFixed(1)}K`
  return `$${n.toFixed(2)}`
}
const fmtPct = (n) => `${n.toFixed(1)}%`

// ============ Sub-components ============
function SortBtn({ label, sortKey, sort, onSort }) {
  const active = sort.key === sortKey
  return (
    <button onClick={() => onSort(sortKey)}
      className={`text-right text-xs font-mono uppercase tracking-wider transition-colors ${active ? 'text-green-400' : 'text-black-500 hover:text-black-300'}`}>
      {label}{active ? (sort.dir === 'desc' ? ' \u2193' : ' \u2191') : ''}
    </button>
  )
}

function PositionCard({ p, i }) {
  const { tokenA, tokenB, share, value, unclaimedFees, ilPercent, ilProtected, coveragePct, loyaltyTier } = p
  return (
    <motion.div initial={{ opacity:0, y:12 }} animate={{ opacity:1, y:0 }}
      transition={{ delay: i * STAGGER, duration: STAGGER * PHI }}>
      <GlassCard glowColor={ilProtected ? 'matrix' : 'warning'} spotlight className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="flex -space-x-2">
              <span className="text-2xl">{tokenA.icon}</span>
              <span className="text-2xl">{tokenB.icon}</span>
            </div>
            <div>
              <span className="font-semibold text-sm">{tokenA.symbol}/{tokenB.symbol}</span>
              <div className="text-[10px] text-black-500 font-mono">{(share*100).toFixed(4)}% share</div>
            </div>
          </div>
          {ilProtected ? (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-500/10 border border-green-500/20">
              <svg className="w-3 h-3 text-green-400" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <span className="text-[10px] text-green-400 font-medium">{coveragePct}% IL covered</span>
            </div>
          ) : (
            <div className="px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20">
              <span className="text-[10px] text-amber-400 font-medium">Unprotected</span>
            </div>
          )}
        </div>
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div><div className="text-[10px] text-black-500 mb-0.5">Value</div>
            <div className="text-sm font-semibold font-mono">{fmt(value)}</div></div>
          <div><div className="text-[10px] text-black-500 mb-0.5">Unclaimed Fees</div>
            <div className="text-sm font-semibold font-mono text-green-400">{fmt(unclaimedFees)}</div></div>
          <div><div className="text-[10px] text-black-500 mb-0.5">IL Impact</div>
            <div className={`text-sm font-semibold font-mono ${ilPercent < 0 ? 'text-red-400' : 'text-green-400'}`}>
              {ilPercent > 0 ? '+' : ''}{fmtPct(ilPercent)}</div></div>
        </div>
        <div className="flex items-center justify-between pt-3 border-t border-black-700/50">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-black-500 font-mono">Loyalty:</span>
            <span className={`text-[10px] font-semibold ${loyaltyTier === 'Gold' ? 'text-amber-400' : loyaltyTier === 'Silver' ? 'text-gray-300' : 'text-orange-400'}`}>{loyaltyTier}</span>
          </div>
          <button className="px-3 py-1.5 text-xs font-medium rounded-lg bg-green-500/10 text-green-400 hover:bg-green-500/20 border border-green-500/20 transition-colors">
            Manage
          </button>
        </div>
      </GlassCard>
    </motion.div>
  )
}

function PoolRow({ pool, i, onAdd }) {
  const { tokenA, tokenB, tvl, volume24h, apr, fees24h, feeTier, sparkData } = pool
  return (
    <motion.tr initial={{ opacity:0, x:-8 }} animate={{ opacity:1, x:0 }}
      transition={{ delay: i * STAGGER * 0.5, duration: STAGGER * PHI }}
      className="group border-b border-black-700/30 last:border-0 hover:bg-white/[0.02] transition-colors">
      <td className="py-3.5 px-4">
        <div className="flex items-center gap-3">
          <div className="flex -space-x-1.5"><span className="text-xl">{tokenA.icon}</span><span className="text-xl">{tokenB.icon}</span></div>
          <div><span className="text-sm font-semibold">{tokenA.symbol}/{tokenB.symbol}</span>
            <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-400 font-mono">{feeTier}%</span></div>
        </div>
      </td>
      <td className="py-3.5 px-4 text-right"><span className="text-sm font-mono">{fmt(tvl)}</span></td>
      <td className="py-3.5 px-4 text-right hidden md:table-cell"><span className="text-sm font-mono text-black-300">{fmt(volume24h)}</span></td>
      <td className="py-3.5 px-4 text-right hidden lg:table-cell"><span className="text-sm font-mono text-black-300">{fmt(fees24h)}</span></td>
      <td className="py-3.5 px-4 text-right">
        <div className="flex items-center justify-end gap-2">
          <Sparkline data={sparkData} width={48} height={16} color="#22c55e" />
          <span className="text-sm font-semibold font-mono text-green-400">{fmtPct(apr)}</span>
        </div>
      </td>
      <td className="py-3.5 px-4 text-right">
        <button onClick={() => onAdd(pool)}
          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-green-500/10 text-green-400 hover:bg-green-500/20 border border-green-500/20 transition-all opacity-60 group-hover:opacity-100">
          Add Liquidity
        </button>
      </td>
    </motion.tr>
  )
}

function MobilePoolCard({ pool, i, onAdd }) {
  const { tokenA, tokenB, tvl, volume24h, apr, sparkData, feeTier } = pool
  return (
    <motion.div initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }}
      transition={{ delay: i * STAGGER * 0.5, duration: STAGGER * PHI }}
      className="border-b border-black-700/30 last:border-0 p-4 hover:bg-white/[0.02] transition-colors">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex -space-x-1.5"><span className="text-xl">{tokenA.icon}</span><span className="text-xl">{tokenB.icon}</span></div>
          <span className="text-sm font-semibold">{tokenA.symbol}/{tokenB.symbol}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-400 font-mono">{feeTier}%</span>
        </div>
        <div className="flex items-center gap-2">
          <Sparkline data={sparkData} width={36} height={12} color="#22c55e" />
          <span className="text-sm font-semibold font-mono text-green-400">{fmtPct(apr)}</span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div><div className="text-[10px] text-black-500 mb-0.5">TVL</div><div className="text-sm font-mono">{fmt(tvl)}</div></div>
        <div className="text-right"><div className="text-[10px] text-black-500 mb-0.5">24h Volume</div><div className="text-sm font-mono text-black-300">{fmt(volume24h)}</div></div>
      </div>
      <button onClick={() => onAdd(pool)}
        className="w-full py-2 text-xs font-medium rounded-lg bg-green-500/10 text-green-400 hover:bg-green-500/20 border border-green-500/20 transition-colors">
        Add Liquidity
      </button>
    </motion.div>
  )
}

// ============ Add Liquidity Modal ============
function AddLiquidityModal({ pool, onClose }) {
  const [amtA, setAmtA] = useState(''), [amtB, setAmtB] = useState('')
  const [pMin, setPMin] = useState(''), [pMax, setPMax] = useState('')
  const tA = pool?.tokenA || TK.ETH, tB = pool?.tokenB || TK.USDC, base = pool?.apr || 22.5

  const estApr = useMemo(() => {
    if (!pMin || !pMax || +pMax <= +pMin) return base
    return Math.min(base * Math.sqrt(Math.max(1, 1000 / (+pMax - +pMin))), base * 4)
  }, [pMin, pMax, base])

  const ilRisk = useMemo(() => {
    if (!pMin || !pMax) return 'Low'
    const w = +pMax - +pMin
    return w < 200 ? 'High' : w < 800 ? 'Medium' : 'Low'
  }, [pMin, pMax])

  const riskColor = { Low:'text-green-400', Medium:'text-amber-400', High:'text-red-400' }

  const TokenInput = ({ label, value, onChange, token }) => (
    <div className="p-4 rounded-xl bg-black-900/80 border border-black-700/50">
      <div className="flex justify-between mb-2">
        <span className="text-[10px] text-black-500 font-mono uppercase tracking-wider">{label}</span>
        <span className="text-[10px] text-black-500">Balance: --</span>
      </div>
      <div className="flex items-center gap-3">
        <input type="number" value={value} onChange={onChange} placeholder="0.00"
          className="flex-1 bg-transparent text-xl font-mono font-medium outline-none placeholder-black-600" />
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-black-700/80 border border-black-600/50">
          <span className="text-lg">{token.icon}</span>
          <span className="text-sm font-semibold">{token.symbol}</span>
        </div>
      </div>
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} transition={{ duration: STAGGER }}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ opacity:0, scale:0.95, y:16 }} animate={{ opacity:1, scale:1, y:0 }}
        transition={{ duration: STAGGER * PHI, ease: EASE }}
        className="relative w-full max-w-lg glass-card rounded-2xl border border-black-700 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-black-700/50">
          <div>
            <h3 className="text-lg font-semibold">Add Liquidity</h3>
            <p className="text-[10px] text-black-500 font-mono mt-0.5">{tA.symbol}/{tB.symbol}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-black-700 transition-colors">
            <svg className="w-5 h-5 text-black-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          <TokenInput label="Token A" value={amtA} onChange={(e) => setAmtA(e.target.value)} token={tA} />
          <div className="flex justify-center -my-1">
            <div className="p-1.5 rounded-lg bg-black-800 border border-black-700/50">
              <svg className="w-4 h-4 text-black-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v12m6-6H6" /></svg>
            </div>
          </div>
          <TokenInput label="Token B" value={amtB} onChange={(e) => setAmtB(e.target.value)} token={tB} />

          {/* Price range */}
          <div className="p-4 rounded-xl bg-black-900/80 border border-black-700/50">
            <span className="text-[10px] text-black-500 font-mono uppercase tracking-wider block mb-3">Price Range (concentrated liquidity)</span>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-black-500 mb-1 block">Min Price</label>
                <input type="number" value={pMin} onChange={(e) => setPMin(e.target.value)} placeholder="0"
                  className="w-full px-3 py-2 bg-black-800 border border-black-700/50 rounded-lg text-sm font-mono outline-none focus:border-green-500/30 transition-colors" />
              </div>
              <div>
                <label className="text-[10px] text-black-500 mb-1 block">Max Price</label>
                <input type="number" value={pMax} onChange={(e) => setPMax(e.target.value)} placeholder="\u221E"
                  className="w-full px-3 py-2 bg-black-800 border border-black-700/50 rounded-lg text-sm font-mono outline-none focus:border-green-500/30 transition-colors" />
              </div>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <button onClick={() => { setPMin(''); setPMax('') }}
                className="text-[10px] px-2 py-1 rounded bg-black-700 text-black-400 hover:text-white transition-colors">Full Range</button>
              <span className="text-[10px] text-black-500 font-mono">{tB.symbol} per {tA.symbol}</span>
            </div>
          </div>

          {/* Estimates */}
          <div className="p-4 rounded-xl bg-black-800/60 border border-black-700/30 space-y-2">
            {[['Estimated APR', <span className="font-semibold font-mono text-green-400">{fmtPct(estApr)}</span>],
              ['IL Risk', <span className={`font-semibold font-mono ${riskColor[ilRisk]}`}>{ilRisk}</span>],
              ['Fee Tier', <span className="font-mono">{pool?.feeTier || 0.3}%</span>],
              ['Shapley Rewards', <span className="font-mono text-green-400">Active</span>],
            ].map(([l, v]) => (
              <div key={l} className="flex justify-between text-sm"><span className="text-black-500">{l}</span>{v}</div>
            ))}
          </div>

          <motion.button whileHover={{ scale:1.01 }} whileTap={{ scale:0.98 }} disabled={!amtA || !amtB}
            className="w-full py-3.5 rounded-xl font-semibold text-sm transition-all bg-gradient-to-r from-green-500 to-emerald-500 text-black hover:from-green-400 hover:to-emerald-400 disabled:opacity-30 disabled:cursor-not-allowed">
            Supply Liquidity
          </motion.button>
        </div>
      </motion.div>
    </div>
  )
}

// ============ Create Pool Modal ============
function CreatePoolModal({ onClose }) {
  const [tokenA, setTokenA] = useState(''), [tokenB, setTokenB] = useState(''), [fee, setFee] = useState(0.3)
  const tiers = [{ v:0.01, l:'0.01%', d:'Stables' },{ v:0.05, l:'0.05%', d:'Correlated' },{ v:0.3, l:'0.3%', d:'Standard' },{ v:1, l:'1%', d:'Exotic' }]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} transition={{ duration: STAGGER }}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ opacity:0, scale:0.95, y:16 }} animate={{ opacity:1, scale:1, y:0 }}
        transition={{ duration: STAGGER * PHI, ease: EASE }}
        className="relative w-full max-w-md glass-card rounded-2xl border border-black-700 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-black-700/50">
          <h3 className="text-lg font-semibold">Create New Pool</h3>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-black-700 transition-colors">
            <svg className="w-5 h-5 text-black-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {[['Token A', tokenA, setTokenA, null], ['Token B', tokenB, setTokenB, tokenA]].map(([label, val, set, exclude]) => (
              <div key={label} className="p-3 rounded-xl bg-black-900/80 border border-black-700/50">
                <label className="text-[10px] text-black-500 font-mono uppercase mb-1 block">{label}</label>
                <select value={val} onChange={(e) => set(e.target.value)} className="w-full bg-transparent text-sm font-semibold outline-none">
                  <option value="">Select</option>
                  {Object.keys(TK).filter(t => t !== exclude).map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            ))}
          </div>
          <div>
            <label className="text-[10px] text-black-500 font-mono uppercase tracking-wider mb-2 block">Fee Tier</label>
            <div className="grid grid-cols-4 gap-2">
              {tiers.map((t) => (
                <button key={t.v} onClick={() => setFee(t.v)}
                  className={`p-2 rounded-lg border text-center transition-all ${fee === t.v ? 'border-green-500/40 bg-green-500/10 text-green-400' : 'border-black-700/50 bg-black-900/50 text-black-400 hover:border-black-600'}`}>
                  <div className="text-sm font-semibold font-mono">{t.l}</div>
                  <div className="text-[9px] mt-0.5">{t.d}</div>
                </button>
              ))}
            </div>
          </div>
          <div className="p-3 rounded-xl bg-green-500/5 border border-green-500/10 flex items-start gap-2">
            <svg className="w-4 h-4 text-green-400 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" /></svg>
            <p className="text-[11px] text-black-400 leading-relaxed">
              After creation you will need to add initial liquidity. Shapley rewards activate at $10K TVL.</p>
          </div>
          <motion.button whileHover={{ scale:1.01 }} whileTap={{ scale:0.98 }} disabled={!tokenA || !tokenB}
            className="w-full py-3.5 rounded-xl font-semibold text-sm transition-all bg-gradient-to-r from-green-500 to-emerald-500 text-black hover:from-green-400 hover:to-emerald-400 disabled:opacity-30 disabled:cursor-not-allowed">
            Create Pool
          </motion.button>
        </div>
      </motion.div>
    </div>
  )
}

// ============ Main Component ============
function PoolPage() {
  const [sort, setSort] = useState({ key: 'tvl', dir: 'desc' })
  const [selectedPool, setSelectedPool] = useState(null)
  const [showAdd, setShowAdd] = useState(false)
  const [showCreate, setShowCreate] = useState(false)

  const pools = useMemo(() => buildPools(), [])
  const userTotal = useMemo(() => POSITIONS.reduce((s, p) => s + p.value, 0), [])

  const sorted = useMemo(() => [...pools].sort((a, b) => {
    const m = sort.dir === 'desc' ? -1 : 1
    return m * (a[sort.key === 'volume' ? 'volume24h' : sort.key === 'fees' ? 'fees24h' : sort.key] -
                b[sort.key === 'volume' ? 'volume24h' : sort.key === 'fees' ? 'fees24h' : sort.key])
  }), [pools, sort])

  const onSort = (k) => setSort(p => p.key === k ? { key:k, dir: p.dir === 'desc' ? 'asc' : 'desc' } : { key:k, dir:'desc' })
  const onAdd = (pool) => { setSelectedPool(pool); setShowAdd(true) }

  return (
    <div className="min-h-screen">
      <PageHero category="defi" title="Liquidity Pools"
        subtitle="Provide liquidity, earn fees, get Shapley-distributed rewards"
        badge="Live" badgeColor="#22c55e">
        <motion.button whileHover={{ scale:1.03 }} whileTap={{ scale:0.97 }} onClick={() => setShowCreate(true)}
          className="px-4 py-2 text-xs font-medium rounded-lg border border-green-500/20 text-green-400 hover:bg-green-500/10 transition-colors">
          + Create New Pool
        </motion.button>
      </PageHero>

      <div className="max-w-7xl mx-auto px-4 pb-12">
        {/* Stat Cards */}
        <motion.div initial={{ opacity:0, y:12 }} animate={{ opacity:1, y:0 }}
          transition={{ delay: STAGGER, duration: STAGGER * PHI }}
          className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
          <StatCard label="Total TVL" value={48.2} prefix="$" suffix="M" decimals={1} change={3.42} sparkSeed={9001} />
          <StatCard label="Your Liquidity" value={userTotal > 0 ? userTotal/1000 : 0} prefix="$"
            suffix={userTotal > 0 ? 'K' : ''} decimals={userTotal > 0 ? 1 : 0} sparkSeed={9002} />
          <StatCard label="24h Fees" value={142} prefix="$" suffix="K" decimals={0} change={8.71} sparkSeed={9003} />
          <StatCard label="APR Range" value={8} suffix="-45%" decimals={0} sparkSeed={9004} />
        </motion.div>

        {/* Your Positions */}
        {POSITIONS.length > 0 && (
          <motion.section initial={{ opacity:0, y:12 }} animate={{ opacity:1, y:0 }}
            transition={{ delay: STAGGER * 2, duration: STAGGER * PHI }} className="mb-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Your Positions</h2>
              <span className="text-[10px] font-mono text-black-500">{POSITIONS.length} active</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {POSITIONS.map((pos, i) => <PositionCard key={pos.id} p={pos} i={i} />)}
            </div>
          </motion.section>
        )}

        {/* Available Pools */}
        <motion.section initial={{ opacity:0, y:12 }} animate={{ opacity:1, y:0 }}
          transition={{ delay: STAGGER * 3, duration: STAGGER * PHI }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Available Pools</h2>
            <span className="text-[10px] font-mono text-black-500">{pools.length} pools</span>
          </div>

          {/* Desktop */}
          <GlassCard className="hidden md:block overflow-hidden">
            <table className="w-full">
              <thead><tr className="border-b border-black-700/50">
                <th className="py-3 px-4 text-left text-[10px] font-mono uppercase tracking-wider text-black-500">Pool</th>
                <th className="py-3 px-4 text-right"><SortBtn label="TVL" sortKey="tvl" sort={sort} onSort={onSort} /></th>
                <th className="py-3 px-4 text-right hidden md:table-cell"><SortBtn label="24h Volume" sortKey="volume" sort={sort} onSort={onSort} /></th>
                <th className="py-3 px-4 text-right hidden lg:table-cell"><SortBtn label="24h Fees" sortKey="fees" sort={sort} onSort={onSort} /></th>
                <th className="py-3 px-4 text-right"><SortBtn label="7d APR" sortKey="apr" sort={sort} onSort={onSort} /></th>
                <th className="py-3 px-4 text-right text-[10px] font-mono uppercase tracking-wider text-black-500">Action</th>
              </tr></thead>
              <tbody>{sorted.map((p, i) => <PoolRow key={p.id} pool={p} i={i} onAdd={onAdd} />)}</tbody>
            </table>
          </GlassCard>

          {/* Mobile */}
          <GlassCard className="md:hidden overflow-hidden">
            {sorted.map((p, i) => <MobilePoolCard key={p.id} pool={p} i={i} onAdd={onAdd} />)}
          </GlassCard>
        </motion.section>

        {/* Create Pool CTA */}
        <motion.div initial={{ opacity:0, y:12 }} animate={{ opacity:1, y:0 }}
          transition={{ delay: STAGGER * 4, duration: STAGGER * PHI }} className="mt-8">
          <GlassCard glowColor="matrix" spotlight className="p-6 text-center">
            <h3 className="text-sm font-semibold mb-1">Got an exotic pair?</h3>
            <p className="text-[11px] text-black-400 mb-4 max-w-md mx-auto">
              Create a new liquidity pool for any token pair. Set your own fee tier, seed initial liquidity,
              and start earning from trade volume immediately.</p>
            <motion.button whileHover={{ scale:1.03 }} whileTap={{ scale:0.97 }} onClick={() => setShowCreate(true)}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-green-500 to-emerald-500 text-black hover:from-green-400 hover:to-emerald-400 transition-all">
              Create New Pool
            </motion.button>
          </GlassCard>
        </motion.div>
      </div>

      {showAdd && <AddLiquidityModal pool={selectedPool} onClose={() => { setShowAdd(false); setSelectedPool(null) }} />}
      {showCreate && <CreatePoolModal onClose={() => setShowCreate(false)} />}
    </div>
  )
}

export default PoolPage
