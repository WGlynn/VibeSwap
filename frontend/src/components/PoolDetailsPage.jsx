import { useState, useMemo, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'

// ============ Constants ============
const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const STAGGER = 1 / (PHI * PHI * PHI)
const EASE = [0.25, 0.1, 1 / PHI, 1]

// ============ Seeded PRNG (seed 1515) ============
function seededRandom(seed) {
  let s = seed
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646 }
}

// ============ Token & Pool Registry ============
const TK = {
  ETH: { symbol: 'ETH', icon: '\u039E', color: '#627eea' },
  USDC: { symbol: 'USDC', icon: '\uD83D\uDCB5', color: '#2775ca' },
  WBTC: { symbol: 'WBTC', icon: '\u20BF', color: '#f7931a' },
  DAI: { symbol: 'DAI', icon: '\u25C8', color: '#f5ac37' },
  LINK: { symbol: 'LINK', icon: '\u26D3', color: '#2a5ada' },
  UNI: { symbol: 'UNI', icon: '\uD83E\uDD84', color: '#ff007a' },
  ARB: { symbol: 'ARB', icon: '\u2B21', color: '#28a0f0' },
  OP: { symbol: 'OP', icon: '\u2B24', color: '#ff0420' },
  MATIC: { symbol: 'MATIC', icon: '\u2B23', color: '#8247e5' },
  AAVE: { symbol: 'AAVE', icon: '\u25B2', color: '#b6509e' },
}

const POOLS = {
  'ETH-USDC':  { a: 'ETH',  b: 'USDC', fee: 0.3  },
  'WBTC-ETH':  { a: 'WBTC', b: 'ETH',  fee: 0.3  },
  'ETH-DAI':   { a: 'ETH',  b: 'DAI',  fee: 0.3  },
  'LINK-ETH':  { a: 'LINK', b: 'ETH',  fee: 0.05 },
  'UNI-USDC':  { a: 'UNI',  b: 'USDC', fee: 0.3  },
  'ARB-ETH':   { a: 'ARB',  b: 'ETH',  fee: 0.05 },
  'OP-ETH':    { a: 'OP',   b: 'ETH',  fee: 0.05 },
  'MATIC-USDC':{ a: 'MATIC',b: 'USDC', fee: 0.3  },
  'AAVE-ETH':  { a: 'AAVE', b: 'ETH',  fee: 0.3  },
  'WBTC-USDC': { a: 'WBTC', b: 'USDC', fee: 0.3  },
}

const FEE_TIERS = [
  { v: 0.05, l: '0.05%', d: 'Correlated pairs' },
  { v: 0.3,  l: '0.3%',  d: 'Standard pairs' },
  { v: 1.0,  l: '1%',    d: 'Exotic pairs' },
]

// ============ Helpers ============
function fmt(n) {
  if (n >= 1e9) return `$${(n/1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n/1e6).toFixed(2)}M`
  if (n >= 1e3) return `$${(n/1e3).toFixed(1)}K`
  return `$${n.toFixed(2)}`
}
const fmtC = (n) => n >= 1e6 ? `${(n/1e6).toFixed(2)}M` : n >= 1e3 ? `${(n/1e3).toFixed(1)}K` : n.toFixed(2)
const fmtPct = (n) => `${n.toFixed(2)}%`
function timeAgo(m) {
  if (m < 1) return 'just now'
  if (m < 60) return `${Math.floor(m)}m ago`
  return m < 1440 ? `${Math.floor(m/60)}h ago` : `${Math.floor(m/1440)}d ago`
}

// ============ Generate Pool Data (seeded 1515) ============
function buildPool(id) {
  const entry = POOLS[id]
  if (!entry) return null
  const rng = seededRandom(1515)
  const tA = TK[entry.a], tB = TK[entry.b]
  const tvl = 2e6 + rng() * 16e6, vol24 = tvl * (0.08 + rng() * 0.22)
  const fees24 = vol24 * (entry.fee / 100), apr = 6 + rng() * 38
  const vol7d = vol24 * (5.5 + rng() * 3), fees7d = fees24 * (5.5 + rng() * 3)
  const pA = entry.a === 'ETH' ? 1800+rng()*600 : entry.a === 'WBTC' ? 42000+rng()*18000 : 1+rng()*200
  const pB = entry.b === 'USDC' || entry.b === 'DAI' ? 1 : entry.b === 'ETH' ? 1800+rng()*600 : 1+rng()*100
  const half = tvl/2, amtA = half/pA, amtB = half/pB, price = pA/pB

  // TVL history (30 pts)
  const tvlH = []; let tv = tvl*(0.7+rng()*0.2)
  for (let i=0;i<30;i++) { tv *= 0.97+rng()*0.07; tvlH.push(tv) }
  tvlH.push(tvl)

  // Recent swaps (12)
  const swaps = Array.from({length:12},(_,i)=>{
    const dir = rng()>0.5?'buy':'sell', amt = 0.1+rng()*15, sp = pA*(0.995+rng()*0.01)
    return { id:`s${i}`, dir, tIn: dir==='buy'?tB:tA, tOut: dir==='buy'?tA:tB,
      aIn: dir==='buy'?amt*sp:amt, aOut: dir==='buy'?amt:amt*sp,
      impact: rng()*0.3, ago: rng()*240 }
  }).sort((a,b)=>a.ago-b.ago)

  const uShare = 0.0042+rng()*0.008, uVal = tvl*uShare
  const insCov = rng()>0.35 ? 75+rng()*20 : 0

  return { id, tA, tB, fee: entry.fee, tvl, vol24, fees24, apr, vol7d, fees7d,
    pA, pB, price, amtA, amtB, tvlH, swaps, uShare, uVal,
    earnedFees: uVal*(0.004+rng()*0.012), il: -(rng()*3.5),
    insCov, insPrem: insCov>0 ? uVal*0.026 : 0,
    pLow: price*(0.7+rng()*0.15), pHigh: price*(1.15+rng()*0.3),
    txns: Math.floor(1200+rng()*8000), lps: Math.floor(40+rng()*260),
    age: Math.floor(30+rng()*300) }
}

// ============ TVL Chart (SVG) ============
function TVLChart({ data, w=600, h=180 }) {
  const { pts, area } = useMemo(()=>{
    if (!data||data.length<2) return { pts:'', area:'' }
    const mn=Math.min(...data)*0.95, mx=Math.max(...data)*1.05, rg=mx-mn||1
    const coords = data.map((v,i)=>{
      const x=(i/(data.length-1))*w, y=h-((v-mn)/rg)*(h-20)-10
      return `${x},${y}`
    })
    return { pts: coords.join(' '),
      area: `M${coords[0]} L${coords.join(' L')} L${w},${h} L0,${h} Z` }
  },[data,w,h])

  const chg = data[0]>0 ? ((data[data.length-1]-data[0])/data[0])*100 : 0
  return (
    <div className="relative w-full">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto" preserveAspectRatio="none">
        <defs>
          <linearGradient id="tvlG" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CYAN} stopOpacity="0.25"/>
            <stop offset="100%" stopColor={CYAN} stopOpacity="0.01"/>
          </linearGradient>
        </defs>
        {[0,1,2,3].map(i=><line key={i} x1="0" y1={10+i*((h-20)/3)} x2={w} y2={10+i*((h-20)/3)} stroke="rgba(255,255,255,0.04)" strokeWidth="1"/>)}
        <path d={area} fill="url(#tvlG)"/>
        <polyline points={pts} fill="none" stroke={CYAN} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
      <div className={`absolute top-2 right-2 px-2 py-1 rounded-full text-[10px] font-mono font-semibold ${chg>=0?'bg-green-500/10 text-green-400':'bg-red-500/10 text-red-400'}`}>
        {chg>=0?'+':''}{chg.toFixed(1)}% (30d)
      </div>
    </div>
  )
}

// ============ Price Range Bar ============
function PriceRangeBar({ cur, lo, hi }) {
  const mn=lo*0.8, mx=hi*1.2, rg=mx-mn||1
  const lP=((lo-mn)/rg)*100, hP=((hi-mn)/rg)*100, cP=((cur-mn)/rg)*100
  const inR = cur>=lo && cur<=hi
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-[10px] font-mono text-black-500">
        <span>{lo.toFixed(2)}</span>
        <span className={inR?'text-green-400':'text-amber-400'}>Current: {cur.toFixed(2)}</span>
        <span>{hi.toFixed(2)}</span>
      </div>
      <div className="relative h-3 rounded-full bg-black-800 overflow-hidden">
        <div className="absolute top-0 h-full rounded-full" style={{left:`${lP}%`,width:`${hP-lP}%`,background:`linear-gradient(90deg,${CYAN}33,${CYAN}66,${CYAN}33)`}}/>
        <div className="absolute top-0 h-full w-0.5" style={{left:`${Math.min(Math.max(cP,0),100)}%`,backgroundColor:inR?'#22c55e':'#f59e0b'}}/>
      </div>
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${inR?'bg-green-400 animate-pulse':'bg-amber-400'}`}/>
        <span className={`text-[11px] font-medium ${inR?'text-green-400':'text-amber-400'}`}>
          {inR?'In Range \u2014 Earning Fees':'Out of Range \u2014 Not Earning'}
        </span>
      </div>
    </div>
  )
}

// ============ Pool Composition ============
function Composition({ tA, tB, amtA, amtB, pA, pB }) {
  const vA=amtA*pA, vB=amtB*pB, tot=vA+vB||1, pctA=(vA/tot)*100, pctB=(vB/tot)*100
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 h-4 rounded-full overflow-hidden">
        <motion.div initial={{width:0}} animate={{width:`${pctA}%`}} transition={{duration:STAGGER*PHI*2,ease:EASE}}
          className="h-full rounded-l-full" style={{backgroundColor:tA.color||CYAN}}/>
        <motion.div initial={{width:0}} animate={{width:`${pctB}%`}} transition={{duration:STAGGER*PHI*2,delay:STAGGER,ease:EASE}}
          className="h-full rounded-r-full" style={{backgroundColor:tB.color||'#22c55e'}}/>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{tA.icon}</span>
          <div>
            <div className="text-sm font-semibold">{tA.symbol}</div>
            <div className="text-[10px] text-black-500 font-mono">{fmtC(amtA)} ({pctA.toFixed(1)}%)</div>
            <div className="text-[11px] font-mono" style={{color:CYAN}}>{fmt(vA)}</div>
          </div>
        </div>
        <div className="flex items-center gap-3 justify-end text-right">
          <div>
            <div className="text-sm font-semibold">{tB.symbol}</div>
            <div className="text-[10px] text-black-500 font-mono">{fmtC(amtB)} ({pctB.toFixed(1)}%)</div>
            <div className="text-[11px] font-mono" style={{color:CYAN}}>{fmt(vB)}</div>
          </div>
          <span className="text-2xl">{tB.icon}</span>
        </div>
      </div>
    </div>
  )
}

// ============ Swap Row ============
function SwapRow({ s, i }) {
  const buy = s.dir==='buy'
  return (
    <motion.tr initial={{opacity:0,x:-6}} animate={{opacity:1,x:0}}
      transition={{delay:i*STAGGER*0.3,duration:STAGGER*PHI}}
      className="border-b border-black-700/20 last:border-0 hover:bg-white/[0.015] transition-colors">
      <td className="py-2.5 px-3"><div className="flex items-center gap-2">
        <div className={`w-1.5 h-1.5 rounded-full ${buy?'bg-green-400':'bg-red-400'}`}/>
        <span className={`text-xs font-medium ${buy?'text-green-400':'text-red-400'}`}>{buy?'Buy':'Sell'}</span>
      </div></td>
      <td className="py-2.5 px-3 text-right"><span className="text-xs font-mono">{s.aIn.toFixed(4)} {s.tIn.symbol}</span></td>
      <td className="py-2.5 px-3 text-center text-black-600">&rarr;</td>
      <td className="py-2.5 px-3"><span className="text-xs font-mono">{s.aOut.toFixed(4)} {s.tOut.symbol}</span></td>
      <td className="py-2.5 px-3 text-right hidden sm:table-cell"><span className="text-[10px] text-black-500 font-mono">{s.impact.toFixed(3)}%</span></td>
      <td className="py-2.5 px-3 text-right"><span className="text-[10px] text-black-500">{timeAgo(s.ago)}</span></td>
    </motion.tr>
  )
}

// ============ Liquidity Form ============
function LiquidityForm({ pool }) {
  const [mode, setMode] = useState('add')
  const [amtA, setAmtA] = useState(''), [amtB, setAmtB] = useState('')
  const [rmPct, setRmPct] = useState(50)

  const handleA = useCallback((e)=>{
    setAmtA(e.target.value)
    if (e.target.value && mode==='add') setAmtB((parseFloat(e.target.value)*pool.pA/pool.pB).toFixed(6))
  },[mode,pool.pA,pool.pB])

  const TokInput = ({label,val,onChange,tok}) => (
    <div className="p-4 rounded-xl bg-black-900/80 border border-black-700/50">
      <div className="flex justify-between mb-2">
        <span className="text-[10px] text-black-500 font-mono uppercase tracking-wider">{label}</span>
        <span className="text-[10px] text-black-500">Balance: --</span>
      </div>
      <div className="flex items-center gap-3">
        <input type="number" value={val} onChange={onChange} placeholder="0.00"
          className="flex-1 bg-transparent text-xl font-mono font-medium outline-none placeholder-black-600"/>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-black-700/80 border border-black-600/50">
          <span className="text-lg">{tok.icon}</span><span className="text-sm font-semibold">{tok.symbol}</span>
        </div>
      </div>
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex rounded-xl overflow-hidden border border-black-700/50">
        {['add','remove'].map(m=>(
          <button key={m} onClick={()=>setMode(m)}
            className={`flex-1 py-2.5 text-xs font-semibold uppercase tracking-wider transition-all ${
              mode===m ? 'bg-gradient-to-r from-cyan-500/15 to-cyan-500/5 text-cyan-400' : 'bg-black-900/40 text-black-500 hover:text-black-300'}`}>
            {m==='add'?'Add Liquidity':'Remove Liquidity'}
          </button>
        ))}
      </div>
      <AnimatePresence mode="wait">
        {mode==='add' ? (
          <motion.div key="add" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-8}}
            transition={{duration:STAGGER*PHI,ease:EASE}} className="space-y-3">
            <TokInput label={`Deposit ${pool.tA.symbol}`} val={amtA} onChange={handleA} tok={pool.tA}/>
            <div className="flex justify-center -my-1">
              <div className="p-1.5 rounded-lg bg-black-800 border border-black-700/50">
                <svg className="w-4 h-4 text-black-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v12m6-6H6"/></svg>
              </div>
            </div>
            <TokInput label={`Deposit ${pool.tB.symbol}`} val={amtB} onChange={e=>setAmtB(e.target.value)} tok={pool.tB}/>
            <motion.button whileHover={{scale:1.01}} whileTap={{scale:0.98}} disabled={!amtA||!amtB}
              className="w-full py-3.5 rounded-xl font-semibold text-sm transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              style={{background:amtA&&amtB?`linear-gradient(135deg,${CYAN},#0891b2)`:undefined,color:amtA&&amtB?'#000':undefined}}>
              Supply Liquidity
            </motion.button>
          </motion.div>
        ) : (
          <motion.div key="rm" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-8}}
            transition={{duration:STAGGER*PHI,ease:EASE}} className="space-y-4">
            <div className="p-4 rounded-xl bg-black-900/80 border border-black-700/50">
              <div className="flex justify-between mb-3">
                <span className="text-[10px] text-black-500 font-mono uppercase tracking-wider">Remove Amount</span>
                <span className="text-lg font-semibold font-mono" style={{color:CYAN}}>{rmPct}%</span>
              </div>
              <input type="range" min="0" max="100" value={rmPct} onChange={e=>setRmPct(parseInt(e.target.value))}
                className="w-full h-1.5 rounded-full appearance-none bg-black-700 cursor-pointer" style={{accentColor:CYAN}}/>
              <div className="flex justify-between mt-3 gap-2">
                {[25,50,75,100].map(p=>(
                  <button key={p} onClick={()=>setRmPct(p)}
                    className={`flex-1 py-1.5 text-xs font-mono rounded-lg border transition-all ${rmPct===p?'border-cyan-500/40 bg-cyan-500/10 text-cyan-400':'border-black-700/50 text-black-500 hover:text-black-300'}`}>
                    {p}%
                  </button>
                ))}
              </div>
            </div>
            <div className="p-4 rounded-xl bg-black-800/60 border border-black-700/30 space-y-2">
              <span className="text-[10px] text-black-500 font-mono uppercase tracking-wider">You will receive</span>
              {[pool.tA,pool.tB].map((t,i)=>(
                <div key={t.symbol} className="flex justify-between items-center">
                  <div className="flex items-center gap-2"><span className="text-lg">{t.icon}</span><span className="text-sm font-semibold">{t.symbol}</span></div>
                  <span className="text-sm font-mono">{((i===0?pool.amtA:pool.amtB)*pool.uShare*rmPct/100).toFixed(4)}</span>
                </div>
              ))}
            </div>
            <motion.button whileHover={{scale:1.01}} whileTap={{scale:0.98}} disabled={rmPct===0}
              className="w-full py-3.5 rounded-xl font-semibold text-sm transition-all bg-red-500/20 text-red-400 border border-red-500/20 hover:bg-red-500/30 disabled:opacity-30 disabled:cursor-not-allowed">
              Remove Liquidity
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ============ Insurance Badge ============
function InsuranceBadge({ cov, prem, val }) {
  const ok = cov>0
  return (
    <div className={`p-4 rounded-xl border ${ok?'bg-green-500/5 border-green-500/15':'bg-amber-500/5 border-amber-500/15'}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <svg className={`w-4 h-4 ${ok?'text-green-400':'text-amber-400'}`} fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/>
          </svg>
          <span className={`text-xs font-semibold ${ok?'text-green-400':'text-amber-400'}`}>
            {ok?'IL Protection Active':'Unprotected Position'}
          </span>
        </div>
        {ok && <span className="text-[10px] font-mono text-green-400/70">{cov.toFixed(0)}% covered</span>}
      </div>
      {ok ? (
        <div className="grid grid-cols-2 gap-3">
          <div><div className="text-[10px] text-black-500 mb-0.5">Covered Amount</div>
            <div className="text-sm font-semibold font-mono text-green-400">{fmt(val*cov/100)}</div></div>
          <div><div className="text-[10px] text-black-500 mb-0.5">Annual Premium</div>
            <div className="text-sm font-semibold font-mono">{fmt(prem)}</div></div>
        </div>
      ) : (
        <div>
          <p className="text-[11px] text-black-400 mb-3">Protect your position from impermanent loss with VibeSwap Insurance.</p>
          <button className="w-full py-2 text-xs font-medium rounded-lg border border-amber-500/20 text-amber-400 hover:bg-amber-500/10 transition-colors">Get Coverage</button>
        </div>
      )}
    </div>
  )
}

// ============ Main Component ============
function PoolDetailsPage() {
  const { poolId } = useParams()
  const [showAll, setShowAll] = useState(false)
  const rid = poolId || 'ETH-USDC'
  const pool = useMemo(() => buildPool(rid), [rid])

  if (!pool) return (
    <div className="min-h-screen flex items-center justify-center">
      <GlassCard glowColor="warning" className="p-8 text-center max-w-md">
        <span className="text-4xl mb-4 block">&#x26A0;</span>
        <h2 className="text-lg font-semibold mb-2">Pool Not Found</h2>
        <p className="text-sm text-black-400">The pool "{poolId}" does not exist or has not been created yet.</p>
      </GlassCard>
    </div>
  )

  const vis = showAll ? pool.swaps : pool.swaps.slice(0, 6)

  return (
    <div className="min-h-screen">
      {/* 1. PageHero */}
      <PageHero category="defi" title="Pool Details"
        subtitle={`${pool.tA.symbol}/${pool.tB.symbol} liquidity pool \u2014 commit-reveal batch auction settlement`}
        badge="Live" badgeColor={CYAN}/>

      <div className="max-w-7xl mx-auto px-4 pb-12">

        {/* 2. Pool Header */}
        <motion.div initial={{opacity:0,y:12}} animate={{opacity:1,y:0}}
          transition={{delay:STAGGER,duration:STAGGER*PHI,ease:EASE}} className="mb-8">
          <GlassCard glowColor="terminal" spotlight className="p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
              <div className="flex items-center gap-4">
                <div className="flex -space-x-3"><span className="text-4xl">{pool.tA.icon}</span><span className="text-4xl">{pool.tB.icon}</span></div>
                <div>
                  <h2 className="text-2xl font-bold tracking-tight">{pool.tA.symbol}/{pool.tB.symbol}</h2>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-mono font-semibold"
                      style={{backgroundColor:`${CYAN}15`,color:CYAN,border:`1px solid ${CYAN}30`}}>{pool.fee}% fee</span>
                    <span className="text-[10px] text-black-500 font-mono">{pool.lps} LPs &middot; {pool.age}d old</span>
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10px] text-black-500 font-mono mb-0.5">Current Price</div>
                <div className="text-lg font-semibold font-mono" style={{color:CYAN}}>{pool.price.toFixed(4)}</div>
                <div className="text-[10px] text-black-500 font-mono">{pool.tB.symbol} per {pool.tA.symbol}</div>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 pt-5 border-t border-black-700/40">
              {[['TVL',fmt(pool.tvl)],['Volume 24h',fmt(pool.vol24)],['Fees 24h',fmt(pool.fees24)],
                ['7d Fees',fmtPct(pool.apr),'text-green-400'],['Transactions',pool.txns.toLocaleString()]
              ].map(([l,v,c])=>(
                <div key={l}><div className="text-[10px] text-black-500 font-mono uppercase tracking-wider mb-0.5">{l}</div>
                  <div className={`text-sm font-semibold font-mono ${c||''}`}>{v}</div></div>
              ))}
            </div>
          </GlassCard>
        </motion.div>

        {/* Two Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column (2/3) */}
          <div className="lg:col-span-2 space-y-6">

            {/* 3. TVL Chart */}
            <motion.div initial={{opacity:0,y:12}} animate={{opacity:1,y:0}}
              transition={{delay:STAGGER*2,duration:STAGGER*PHI,ease:EASE}}>
              <GlassCard className="overflow-hidden">
                <div className="px-5 pt-5 pb-2">
                  <h3 className="text-sm font-semibold mb-1">Total Value Locked</h3>
                  <div className="flex items-baseline gap-3">
                    <span className="text-2xl font-bold font-mono">{fmt(pool.tvl)}</span>
                    <span className="text-[10px] text-black-500 font-mono">30 day history</span>
                  </div>
                </div>
                <div className="px-2 pb-3"><TVLChart data={pool.tvlH}/></div>
              </GlassCard>
            </motion.div>

            {/* 8. Pool Composition */}
            <motion.div initial={{opacity:0,y:12}} animate={{opacity:1,y:0}}
              transition={{delay:STAGGER*3,duration:STAGGER*PHI,ease:EASE}}>
              <GlassCard className="p-5">
                <h3 className="text-sm font-semibold mb-4">Pool Composition</h3>
                <Composition tA={pool.tA} tB={pool.tB} amtA={pool.amtA} amtB={pool.amtB} pA={pool.pA} pB={pool.pB}/>
              </GlassCard>
            </motion.div>

            {/* 9. Price Range */}
            <motion.div initial={{opacity:0,y:12}} animate={{opacity:1,y:0}}
              transition={{delay:STAGGER*4,duration:STAGGER*PHI,ease:EASE}}>
              <GlassCard className="p-5">
                <h3 className="text-sm font-semibold mb-4">Price Range (Concentrated Liquidity)</h3>
                <PriceRangeBar cur={pool.price} lo={pool.pLow} hi={pool.pHigh}/>
              </GlassCard>
            </motion.div>

            {/* 7. Recent Swaps */}
            <motion.div initial={{opacity:0,y:12}} animate={{opacity:1,y:0}}
              transition={{delay:STAGGER*5,duration:STAGGER*PHI,ease:EASE}}>
              <GlassCard className="overflow-hidden">
                <div className="px-5 pt-5 pb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Recent Swaps</h3>
                  <span className="text-[10px] font-mono text-black-500">{pool.swaps.length} trades</span>
                </div>
                <div className="hidden sm:block">
                  <table className="w-full"><thead><tr className="border-b border-black-700/40">
                    {['Type','In','','Out','Impact','Time'].map((h,i)=>(
                      <th key={h} className={`py-2 px-3 text-[10px] font-mono uppercase tracking-wider text-black-500 ${
                        i===0?'text-left':i===2?'text-center':i===3?'text-left':'text-right'} ${h==='Impact'?'hidden sm:table-cell':''}`}>{h}</th>
                    ))}</tr></thead>
                    <tbody>{vis.map((s,i)=><SwapRow key={s.id} s={s} i={i}/>)}</tbody>
                  </table>
                </div>
                <div className="sm:hidden px-4 pb-4 space-y-2">
                  {vis.map((s,i)=>(
                    <motion.div key={s.id} initial={{opacity:0}} animate={{opacity:1}} transition={{delay:i*STAGGER*0.3}}
                      className="flex items-center justify-between p-3 rounded-lg bg-black-900/50 border border-black-700/30">
                      <div className="flex items-center gap-2">
                        <div className={`w-1.5 h-1.5 rounded-full ${s.dir==='buy'?'bg-green-400':'bg-red-400'}`}/>
                        <div><div className="text-xs font-mono">{s.aIn.toFixed(2)} {s.tIn.symbol}</div>
                          <div className="text-[10px] text-black-500">{timeAgo(s.ago)}</div></div>
                      </div>
                      <div className="text-xs font-mono text-right">{s.aOut.toFixed(2)} {s.tOut.symbol}</div>
                    </motion.div>
                  ))}
                </div>
                {pool.swaps.length>6 && (
                  <div className="px-5 pb-4"><button onClick={()=>setShowAll(!showAll)}
                    className="w-full py-2 text-xs font-medium text-black-400 hover:text-black-200 transition-colors rounded-lg border border-black-700/30 hover:border-black-600">
                    {showAll?'Show Less':`View All ${pool.swaps.length} Trades`}
                  </button></div>
                )}
              </GlassCard>
            </motion.div>

            {/* 6. Fee Tier Display */}
            <motion.div initial={{opacity:0,y:12}} animate={{opacity:1,y:0}}
              transition={{delay:STAGGER*6,duration:STAGGER*PHI,ease:EASE}}>
              <GlassCard className="p-5">
                <h3 className="text-sm font-semibold mb-4">Fee Tiers</h3>
                <div className="grid grid-cols-3 gap-3">
                  {FEE_TIERS.map(t=>{
                    const on = t.v===pool.fee
                    return (
                      <div key={t.v} className={`p-3 rounded-xl border text-center transition-all ${on?'border-cyan-500/40 bg-cyan-500/10':'border-black-700/40 bg-black-900/40'}`}>
                        <div className={`text-lg font-bold font-mono ${on?'text-cyan-400':'text-black-400'}`}>{t.l}</div>
                        <div className="text-[10px] text-black-500 mt-1">{t.d}</div>
                        {on && <div className="mt-2 text-[9px] font-mono uppercase tracking-wider" style={{color:CYAN}}>Active</div>}
                      </div>
                    )
                  })}
                </div>
                <div className="mt-4 grid grid-cols-2 gap-4 pt-4 border-t border-black-700/30">
                  <div><div className="text-[10px] text-black-500 mb-0.5">7d Fees</div>
                    <div className="text-sm font-semibold font-mono" style={{color:CYAN}}>{fmt(pool.fees7d)}</div></div>
                  <div><div className="text-[10px] text-black-500 mb-0.5">7d Volume</div>
                    <div className="text-sm font-semibold font-mono">{fmt(pool.vol7d)}</div></div>
                </div>
              </GlassCard>
            </motion.div>
          </div>

          {/* Right Column (1/3) */}
          <div className="space-y-6">

            {/* 4. Your Position */}
            <motion.div initial={{opacity:0,y:12}} animate={{opacity:1,y:0}}
              transition={{delay:STAGGER*2.5,duration:STAGGER*PHI,ease:EASE}}>
              <GlassCard glowColor="terminal" spotlight className="p-5">
                <h3 className="text-sm font-semibold mb-4">Your Position</h3>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div><div className="text-[10px] text-black-500 font-mono mb-0.5">Liquidity</div>
                      <div className="text-lg font-bold font-mono" style={{color:CYAN}}>{fmt(pool.uVal)}</div></div>
                    <div className="text-right"><div className="text-[10px] text-black-500 font-mono mb-0.5">Pool Share</div>
                      <div className="text-lg font-bold font-mono">{(pool.uShare*100).toFixed(4)}%</div></div>
                  </div>
                  <div className="h-px bg-black-700/40"/>
                  <div className="grid grid-cols-2 gap-4">
                    <div><div className="text-[10px] text-black-500 font-mono mb-0.5">Earned Fees</div>
                      <div className="text-sm font-semibold font-mono text-green-400">+{fmt(pool.earnedFees)}</div></div>
                    <div className="text-right"><div className="text-[10px] text-black-500 font-mono mb-0.5">IL Estimate</div>
                      <div className={`text-sm font-semibold font-mono ${pool.il<-2?'text-red-400':pool.il<-0.5?'text-amber-400':'text-green-400'}`}>
                        {pool.il>0?'+':''}{fmtPct(pool.il)}</div></div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div><div className="text-[10px] text-black-500 font-mono mb-0.5">{pool.tA.symbol}</div>
                      <div className="text-sm font-mono">{(pool.amtA*pool.uShare).toFixed(4)}</div></div>
                    <div className="text-right"><div className="text-[10px] text-black-500 font-mono mb-0.5">{pool.tB.symbol}</div>
                      <div className="text-sm font-mono">{(pool.amtB*pool.uShare).toFixed(4)}</div></div>
                  </div>
                  <div className="h-px bg-black-700/40"/>
                  <div><div className="text-[10px] text-black-500 font-mono mb-0.5">Net P&L (Fees - IL)</div>
                    {(()=>{const n=pool.earnedFees+(pool.uVal*pool.il/100);return(
                      <div className={`text-sm font-semibold font-mono ${n>=0?'text-green-400':'text-red-400'}`}>
                        {n>=0?'+':''}{fmt(Math.abs(n))}{n<0?' (loss)':''}
                      </div>)})()}
                  </div>
                </div>
              </GlassCard>
            </motion.div>

            {/* 10. Insurance Coverage */}
            <motion.div initial={{opacity:0,y:12}} animate={{opacity:1,y:0}}
              transition={{delay:STAGGER*3.5,duration:STAGGER*PHI,ease:EASE}}>
              <GlassCard className="p-5">
                <h3 className="text-sm font-semibold mb-4">Insurance Coverage</h3>
                <InsuranceBadge cov={pool.insCov} prem={pool.insPrem} val={pool.uVal}/>
              </GlassCard>
            </motion.div>

            {/* 5. Add/Remove Liquidity */}
            <motion.div initial={{opacity:0,y:12}} animate={{opacity:1,y:0}}
              transition={{delay:STAGGER*4.5,duration:STAGGER*PHI,ease:EASE}}>
              <GlassCard className="p-5">
                <h3 className="text-sm font-semibold mb-4">Manage Liquidity</h3>
                <LiquidityForm pool={pool}/>
              </GlassCard>
            </motion.div>

            {/* Pool Info Summary */}
            <motion.div initial={{opacity:0,y:12}} animate={{opacity:1,y:0}}
              transition={{delay:STAGGER*5.5,duration:STAGGER*PHI,ease:EASE}}>
              <GlassCard className="p-5">
                <h3 className="text-sm font-semibold mb-4">Pool Info</h3>
                <div className="space-y-3">
                  {[['Protocol','VibeSwap AMM'],['Settlement','Commit-Reveal Batch'],['Batch Duration','10s (8s commit + 2s reveal)'],
                    ['MEV Protection','Active'],['Oracle','Kalman Filter TWAP'],['Fee Tier',`${pool.fee}%`],
                    ['Unique LPs',pool.lps.toString()],['Pool Age',`${pool.age} days`],['Shapley Rewards','Enabled'],
                    ['Circuit Breakers','Active'],
                  ].map(([l,v])=>(
                    <div key={l} className="flex justify-between items-center">
                      <span className="text-[11px] text-black-500">{l}</span>
                      <span className="text-[11px] font-mono font-medium">{v}</span>
                    </div>
                  ))}
                </div>
              </GlassCard>
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default PoolDetailsPage
