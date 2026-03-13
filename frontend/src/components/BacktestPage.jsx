import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'

// ============ Constants ============
const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const inputStyle = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', outline: 'none' }

// ============ Seeded PRNG ============
function seededRandom(seed) {
  let s = seed
  return () => { s = (s * 16807 + 0) % 2147483647; return (s - 1) / 2147483646 }
}

// ============ Configuration Options ============
const STRATEGIES = [
  { id: 'dca', name: 'DCA', desc: 'Dollar-cost averaging at fixed intervals' },
  { id: 'grid', name: 'Grid Trading', desc: 'Buy low, sell high within a price range' },
  { id: 'mean-rev', name: 'Mean Reversion', desc: 'Trade deviations from moving average' },
  { id: 'momentum', name: 'Momentum', desc: 'Follow trend direction with trailing stops' },
  { id: 'custom', name: 'Custom', desc: 'Define your own entry/exit rules' },
]
const TOKEN_PAIRS = [
  { id: 'eth-usdc', label: 'ETH / USDC', basePrice: 3420 },
  { id: 'wbtc-eth', label: 'WBTC / ETH', basePrice: 18.2 },
  { id: 'arb-eth', label: 'ARB / ETH', basePrice: 0.00042 },
  { id: 'jul-usdc', label: 'JUL / USDC', basePrice: 0.48 },
  { id: 'op-usdc', label: 'OP / USDC', basePrice: 2.85 },
]
const TIME_PERIODS = [
  { id: '1m', label: '1M', days: 30 }, { id: '3m', label: '3M', days: 90 },
  { id: '6m', label: '6M', days: 180 }, { id: '1y', label: '1Y', days: 365 },
]

// ============ Mock Data Generators ============
function generatePortfolioValues(seed, initialCapital, points) {
  const rng = seededRandom(seed)
  let stratValue = initialCapital, holdValue = initialCapital
  return Array.from({ length: points }, (_, i) => {
    const marketMove = (rng() - 0.47) * initialCapital * 0.025
    holdValue = Math.max(holdValue + marketMove, initialCapital * 0.55)
    const stratMove = marketMove * (0.7 + rng() * 0.5) + (rng() > 0.6 ? initialCapital * 0.003 : 0)
    stratValue = Math.max(stratValue + stratMove, initialCapital * 0.6)
    return { idx: i, strategy: Math.round(stratValue * 100) / 100, buyHold: Math.round(holdValue * 100) / 100 }
  })
}

function generateTradeLog(seed, basePrice, pairLabel) {
  const rng = seededRandom(seed), now = Date.now()
  return Array.from({ length: 10 }, (_, i) => {
    const isBuy = rng() > 0.45
    const price = Math.round((basePrice + (rng() - 0.5) * basePrice * 0.15) * 100) / 100
    const amount = Math.round((0.1 + rng() * 2.4) * 1000) / 1000
    const pnl = isBuy ? 0 : Math.round((rng() - 0.38) * price * amount * 100) / 100
    const daysAgo = Math.round(30 - i * 3 + rng() * 2)
    return { id: i + 1, date: new Date(now - daysAgo * 86400000), action: isBuy ? 'BUY' : 'SELL', pair: pairLabel, price, amount, pnl }
  })
}

// ============ Formatting Helpers ============
const fmt = (n) => Math.abs(n) >= 1e6 ? '$' + (n / 1e6).toFixed(2) + 'M' : Math.abs(n) >= 1e3 ? '$' + (n / 1e3).toFixed(1) + 'K' : '$' + n.toFixed(2)
const fmtPct = (n) => (n >= 0 ? '+' : '') + n.toFixed(2) + '%'
const fmtDate = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

// ============ Section Wrapper ============
function Section({ num, title, delay = 0, children }) {
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.4 }}>
      <h2 className="text-lg font-bold font-mono text-white mb-3 flex items-center gap-2">
        <span style={{ color: CYAN }}>{num}</span><span>{title}</span>
      </h2>
      {children}
    </motion.div>
  )
}

// ============ Reusable Input ============
function ParamInput({ label, type = 'number', value, onChange, step }) {
  return (
    <div>
      <label className="text-[11px] font-mono text-white/40 uppercase mb-1 block">{label}</label>
      <input type={type} step={step} value={value} onChange={onChange}
        className="w-full px-3 py-2 rounded-lg text-sm text-white font-mono" style={inputStyle} />
    </div>
  )
}

// ============ SVG Portfolio Chart ============
function PortfolioChart({ data }) {
  const width = 640, height = 220, pad = 40
  const allValues = data.flatMap(d => [d.strategy, d.buyHold])
  const min = Math.min(...allValues) * 0.98, max = Math.max(...allValues) * 1.02
  const range = max - min || 1
  const toX = (i) => pad + (i / (data.length - 1)) * (width - pad * 2)
  const toY = (v) => height - pad - ((v - min) / range) * (height - pad * 2)
  const stratLine = data.map((d, i) => `${toX(i)},${toY(d.strategy)}`).join(' ')
  const holdLine = data.map((d, i) => `${toX(i)},${toY(d.buyHold)}`).join(' ')
  const stratWins = (data[data.length - 1]?.strategy || 0) > (data[data.length - 1]?.buyHold || 0)
  const yTicks = 5
  const yLabels = Array.from({ length: yTicks }, (_, i) => {
    const val = min + (range * i) / (yTicks - 1)
    return { val, y: toY(val) }
  })
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ maxHeight: 220 }}>
      {yLabels.map((l, i) => (
        <g key={i}>
          <line x1={pad} y1={l.y} x2={width - pad} y2={l.y} stroke="rgba(255,255,255,0.06)" strokeDasharray="4 4" />
          <text x={pad - 6} y={l.y + 4} fill="rgba(255,255,255,0.3)" fontSize="9" textAnchor="end" fontFamily="monospace">{fmt(l.val)}</text>
        </g>
      ))}
      <polyline points={holdLine} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" strokeDasharray="6 3" />
      <polyline points={stratLine} fill="none" stroke={CYAN} strokeWidth="2.5" />
      <defs>
        <linearGradient id="stratGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={CYAN} stopOpacity="0.2" />
          <stop offset="100%" stopColor={CYAN} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`${toX(0)},${toY(min)} ${stratLine} ${toX(data.length - 1)},${toY(min)}`} fill="url(#stratGrad)" />
      <line x1={width - 190} y1={16} x2={width - 170} y2={16} stroke={CYAN} strokeWidth="2.5" />
      <text x={width - 165} y={20} fill="rgba(255,255,255,0.7)" fontSize="10" fontFamily="monospace">Strategy {stratWins ? '(winner)' : ''}</text>
      <line x1={width - 190} y1={32} x2={width - 170} y2={32} stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" strokeDasharray="6 3" />
      <text x={width - 165} y={36} fill="rgba(255,255,255,0.5)" fontSize="10" fontFamily="monospace">Buy & Hold {!stratWins ? '(winner)' : ''}</text>
    </svg>
  )
}

// ============ Metric Card ============
function MetricCard({ label, value, sub, positive }) {
  return (
    <div className="text-center p-3">
      <div className="text-[11px] font-mono text-white/40 uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-xl font-bold font-mono ${positive === true ? 'text-green-400' : positive === false ? 'text-red-400' : 'text-white'}`}>{value}</div>
      {sub && <div className="text-[10px] text-white/30 mt-0.5">{sub}</div>}
    </div>
  )
}

// ============ Strategy Parameter Panels ============
function DCAParams({ params, setParams }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className="text-[11px] font-mono text-white/40 uppercase mb-1 block">Interval</label>
        <select value={params.interval || 'daily'} onChange={(e) => setParams({ ...params, interval: e.target.value })}
          className="w-full px-3 py-2 rounded-lg text-sm text-white font-mono" style={inputStyle}>
          <option value="hourly">Hourly</option><option value="daily">Daily</option>
          <option value="weekly">Weekly</option><option value="monthly">Monthly</option>
        </select>
      </div>
      <ParamInput label="Amount per Buy" value={params.dcaAmount || 100} onChange={(e) => setParams({ ...params, dcaAmount: Number(e.target.value) })} />
    </div>
  )
}

function GridParams({ params, setParams }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <ParamInput label="Lower Bound" value={params.gridLower || 2800} onChange={(e) => setParams({ ...params, gridLower: Number(e.target.value) })} />
      <ParamInput label="Upper Bound" value={params.gridUpper || 4200} onChange={(e) => setParams({ ...params, gridUpper: Number(e.target.value) })} />
      <ParamInput label="Grid Levels" value={params.gridLevels || 10} onChange={(e) => setParams({ ...params, gridLevels: Number(e.target.value) })} />
    </div>
  )
}

function MeanRevParams({ params, setParams }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <ParamInput label="MA Period" value={params.maPeriod || 20} onChange={(e) => setParams({ ...params, maPeriod: Number(e.target.value) })} />
      <ParamInput label="Deviation Threshold (%)" value={params.deviation || 3} step="0.5" onChange={(e) => setParams({ ...params, deviation: Number(e.target.value) })} />
    </div>
  )
}

function MomentumParams({ params, setParams }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <ParamInput label="Lookback (days)" value={params.lookback || 14} onChange={(e) => setParams({ ...params, lookback: Number(e.target.value) })} />
      <ParamInput label="Trailing Stop (%)" value={params.trailingStop || 5} step="0.5" onChange={(e) => setParams({ ...params, trailingStop: Number(e.target.value) })} />
    </div>
  )
}

function CustomParams({ params, setParams }) {
  return (
    <div>
      <label className="text-[11px] font-mono text-white/40 uppercase mb-1 block">Strategy Logic (pseudo-code)</label>
      <textarea value={params.customLogic || 'IF price < SMA(20) * 0.97 THEN BUY 10%\nIF price > SMA(20) * 1.03 THEN SELL 10%'}
        onChange={(e) => setParams({ ...params, customLogic: e.target.value })} rows={3}
        className="w-full px-3 py-2 rounded-lg text-sm text-white font-mono resize-none" style={inputStyle} />
    </div>
  )
}

const STRATEGY_PARAMS_MAP = { dca: DCAParams, grid: GridParams, 'mean-rev': MeanRevParams, momentum: MomentumParams, custom: CustomParams }

// ============ Main Component ============
export default function BacktestPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  // ============ Config State ============
  const [strategy, setStrategy] = useState('dca')
  const [pair, setPair] = useState('eth-usdc')
  const [period, setPeriod] = useState('3m')
  const [capital, setCapital] = useState(10000)
  const [stratParams, setStratParams] = useState({
    interval: 'daily', dcaAmount: 100, gridLower: 2800, gridUpper: 4200, gridLevels: 10,
    maPeriod: 20, deviation: 3, lookback: 14, trailingStop: 5,
    customLogic: 'IF price < SMA(20) * 0.97 THEN BUY 10%\nIF price > SMA(20) * 1.03 THEN SELL 10%',
  })
  const [hasRun, setHasRun] = useState(false)
  const [isRunning, setIsRunning] = useState(false)

  // ============ Derived Data ============
  const selectedPair = TOKEN_PAIRS.find(p => p.id === pair)
  const selectedPeriod = TIME_PERIODS.find(p => p.id === period)
  const selectedStrategy = STRATEGIES.find(s => s.id === strategy)

  const seed = useMemo(() => {
    let h = 0; const key = `${strategy}-${pair}-${period}-${capital}`
    for (let i = 0; i < key.length; i++) { h = ((h << 5) - h + key.charCodeAt(i)) | 0 }
    return Math.abs(h) + 1
  }, [strategy, pair, period, capital])

  const portfolioData = useMemo(() => generatePortfolioValues(seed, capital, 30), [seed, capital])
  const tradeLog = useMemo(
    () => generateTradeLog(seed + 777, selectedPair?.basePrice || 3420, selectedPair?.label || 'ETH / USDC'),
    [seed, selectedPair]
  )

  // ============ Result Metrics ============
  const results = useMemo(() => {
    const rng = seededRandom(seed + 42)
    const finalStrat = portfolioData[portfolioData.length - 1]?.strategy || capital
    const finalHold = portfolioData[portfolioData.length - 1]?.buyHold || capital
    const totalReturn = ((finalStrat - capital) / capital) * 100
    const holdReturn = ((finalHold - capital) / capital) * 100
    return {
      totalReturn: Math.round(totalReturn * 100) / 100,
      holdReturn: Math.round(holdReturn * 100) / 100,
      maxDrawdown: -Math.round((8 + rng() * 14) * 100) / 100,
      sharpeRatio: Math.round((0.8 + rng() * 1.8) * 100) / 100,
      winRate: Math.round((48 + rng() * 22) * 10) / 10,
      totalTrades: Math.round(15 + rng() * 85),
      finalValue: Math.round(finalStrat * 100) / 100,
      holdFinal: Math.round(finalHold * 100) / 100,
      var95: -Math.round((2 + rng() * 4) * 100) / 100,
      sortinoRatio: Math.round((1.0 + rng() * 2.2) * 100) / 100,
      calmarRatio: Math.round((0.5 + rng() * 1.5) * 100) / 100,
      avgTradeReturn: Math.round((0.2 + rng() * 1.5) * 100) / 100,
      profitFactor: Math.round((1.1 + rng() * 1.4) * 100) / 100,
    }
  }, [seed, capital, portfolioData])

  const handleRun = () => {
    setIsRunning(true)
    setTimeout(() => { setIsRunning(false); setHasRun(true) }, 1200)
  }

  const StratParamsComponent = STRATEGY_PARAMS_MAP[strategy]

  return (
    <div className="min-h-screen pb-20">
      <PageHero title="Backtester" subtitle="Test trading strategies against historical data before risking real capital" category="intelligence" />

      <div className="max-w-7xl mx-auto px-4 space-y-6">

        {/* ============ 1. Strategy Configuration ============ */}
        <Section num="01" title="Strategy Configuration" delay={0.1}>
          <GlassCard className="p-6" glowColor="terminal">
            <div className="mb-5">
              <label className="text-[11px] font-mono text-white/40 uppercase tracking-wider mb-2 block">Strategy</label>
              <div className="flex flex-wrap gap-2">
                {STRATEGIES.map((s) => (
                  <button key={s.id} onClick={() => setStrategy(s.id)}
                    className={`px-4 py-2 rounded-lg text-sm font-mono transition-all ${strategy === s.id ? 'text-white border' : 'text-white/50 border border-white/5 hover:border-white/15 hover:text-white/70'}`}
                    style={strategy === s.id ? { background: 'rgba(6,182,212,0.12)', borderColor: CYAN, color: CYAN } : { background: 'rgba(255,255,255,0.02)' }}>
                    {s.name}
                  </button>
                ))}
              </div>
              {selectedStrategy && <p className="text-[11px] text-white/30 mt-2 font-mono">{selectedStrategy.desc}</p>}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
              <div>
                <label className="text-[11px] font-mono text-white/40 uppercase mb-1 block">Token Pair</label>
                <select value={pair} onChange={(e) => setPair(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-sm text-white font-mono" style={inputStyle}>
                  {TOKEN_PAIRS.map((tp) => <option key={tp.id} value={tp.id}>{tp.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-mono text-white/40 uppercase mb-1 block">Time Period</label>
                <div className="flex gap-1">
                  {TIME_PERIODS.map((tp) => (
                    <button key={tp.id} onClick={() => setPeriod(tp.id)}
                      className={`flex-1 px-2 py-2 rounded-lg text-sm font-mono transition-all ${period === tp.id ? 'text-white' : 'text-white/40 hover:text-white/60'}`}
                      style={period === tp.id
                        ? { background: 'rgba(6,182,212,0.15)', border: `1px solid ${CYAN}` }
                        : { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                      {tp.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[11px] font-mono text-white/40 uppercase mb-1 block">Initial Capital</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 text-sm font-mono">$</span>
                  <input type="number" value={capital} onChange={(e) => setCapital(Math.max(100, Number(e.target.value)))}
                    className="w-full pl-7 pr-3 py-2 rounded-lg text-sm text-white font-mono" style={inputStyle} />
                </div>
              </div>
            </div>

            <div className="mb-5">
              <label className="text-[11px] font-mono text-white/40 uppercase tracking-wider mb-2 block">{selectedStrategy?.name} Parameters</label>
              {StratParamsComponent && <StratParamsComponent params={stratParams} setParams={setStratParams} />}
            </div>

            <button onClick={handleRun} disabled={isRunning}
              className="w-full py-3 rounded-xl text-sm font-bold font-mono tracking-wider transition-all"
              style={{ background: isRunning ? 'rgba(6,182,212,0.15)' : `linear-gradient(135deg, ${CYAN}, #0891b2)`, color: isRunning ? CYAN : '#000', opacity: isRunning ? 0.7 : 1 }}>
              {isRunning ? (
                <span className="flex items-center justify-center gap-2">
                  <motion.span animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
                    className="inline-block w-4 h-4 border-2 rounded-full" style={{ borderColor: `${CYAN} transparent transparent transparent` }} />
                  Running Simulation...
                </span>
              ) : 'Run Backtest'}
            </button>
          </GlassCard>
        </Section>

        {/* ============ Results (shown after run) ============ */}
        <AnimatePresence>
          {hasRun && (
            <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} transition={{ duration: 0.5 }} className="space-y-6">

              {/* ============ 2. Portfolio Value Chart ============ */}
              <Section num="02" title="Portfolio Performance" delay={0.15}>
                <GlassCard className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <div className="text-[11px] font-mono text-white/40 uppercase">{selectedPair?.label} -- {selectedStrategy?.name} -- {selectedPeriod?.label}</div>
                      <div className="text-2xl font-bold font-mono text-white mt-1">
                        {fmt(results.finalValue)}
                        <span className={`text-sm ml-2 ${results.totalReturn >= 0 ? 'text-green-400' : 'text-red-400'}`}>{fmtPct(results.totalReturn)}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[11px] font-mono text-white/40 uppercase">Buy & Hold</div>
                      <div className="text-lg font-mono text-white/60">
                        {fmt(results.holdFinal)}
                        <span className={`text-sm ml-1 ${results.holdReturn >= 0 ? 'text-green-400/60' : 'text-red-400/60'}`}>{fmtPct(results.holdReturn)}</span>
                      </div>
                    </div>
                  </div>
                  <PortfolioChart data={portfolioData} />
                </GlassCard>
              </Section>

              {/* ============ 3. Key Metrics ============ */}
              <Section num="03" title="Key Metrics" delay={0.2}>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  {[
                    { label: 'Total Return', value: fmtPct(results.totalReturn), positive: results.totalReturn >= 0, sub: `vs ${fmtPct(results.holdReturn)} B&H` },
                    { label: 'Max Drawdown', value: fmtPct(results.maxDrawdown), positive: false, sub: 'Peak to trough' },
                    { label: 'Sharpe Ratio', value: results.sharpeRatio.toFixed(2), positive: results.sharpeRatio > 1, sub: 'Risk-adjusted' },
                    { label: 'Win Rate', value: results.winRate.toFixed(1) + '%', positive: results.winRate > 50, sub: `${results.totalTrades} trades` },
                    { label: 'Profit Factor', value: results.profitFactor.toFixed(2) + 'x', positive: results.profitFactor > 1, sub: 'Gross P / Gross L' },
                  ].map((m) => (
                    <GlassCard key={m.label} className="p-1"><MetricCard {...m} /></GlassCard>
                  ))}
                </div>
              </Section>

              {/* ============ 4. Strategy vs Buy & Hold Comparison ============ */}
              <Section num="04" title="Strategy vs Buy & Hold" delay={0.25}>
                <GlassCard className="p-6">
                  <div className="grid grid-cols-2 gap-6">
                    {[
                      { title: selectedStrategy?.name + ' Strategy', color: CYAN, textClass: 'text-white', rows: [
                        ['Final Value', fmt(results.finalValue)], ['Return', fmtPct(results.totalReturn)],
                        ['Max Drawdown', fmtPct(results.maxDrawdown)], ['Sharpe Ratio', results.sharpeRatio.toFixed(2)],
                        ['Total Trades', results.totalTrades.toString()],
                      ]},
                      { title: 'Buy & Hold', color: null, textClass: 'text-white/60', rows: [
                        ['Final Value', fmt(results.holdFinal)], ['Return', fmtPct(results.holdReturn)],
                        ['Max Drawdown', fmtPct(results.maxDrawdown * 1.3)], ['Sharpe Ratio', (results.sharpeRatio * 0.7).toFixed(2)],
                        ['Total Trades', '1'],
                      ]},
                    ].map(({ title, color, textClass, rows }) => (
                      <div key={title} className="space-y-3">
                        <div className="text-sm font-mono font-bold" style={color ? { color } : { opacity: 0.5, color: '#fff' }}>{title}</div>
                        <div className="space-y-2">
                          {rows.map(([k, v]) => (
                            <div key={k} className="flex justify-between text-sm font-mono">
                              <span className="text-white/40">{k}</span><span className={textClass}>{v}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  {results.totalReturn > results.holdReturn && (
                    <div className="mt-4 px-4 py-2 rounded-lg text-center text-sm font-mono"
                      style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)' }}>
                      <span className="text-green-400">Strategy outperformed Buy & Hold by </span>
                      <span className="text-green-300 font-bold">{fmtPct(results.totalReturn - results.holdReturn)}</span>
                    </div>
                  )}
                </GlassCard>
              </Section>

              {/* ============ 5. Trade Log ============ */}
              <Section num="05" title="Trade Log" delay={0.3}>
                <GlassCard className="p-4 overflow-x-auto">
                  <table className="w-full text-sm font-mono">
                    <thead>
                      <tr className="text-white/30 text-[11px] uppercase tracking-wider border-b border-white/5">
                        {['#', 'Date', 'Action', 'Pair', 'Price', 'Amount', 'PnL'].map((h, i) => (
                          <th key={h} className={`py-2 px-2 ${i >= 4 ? 'text-right' : 'text-left'}`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {tradeLog.map((t) => (
                        <tr key={t.id} className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
                          <td className="py-2 px-2 text-white/30">{t.id}</td>
                          <td className="py-2 px-2 text-white/60">{fmtDate(t.date)}</td>
                          <td className="py-2 px-2">
                            <span className="px-2 py-0.5 rounded text-[11px] font-bold"
                              style={{ background: t.action === 'BUY' ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)', color: t.action === 'BUY' ? '#22c55e' : '#ef4444' }}>
                              {t.action}
                            </span>
                          </td>
                          <td className="py-2 px-2 text-white/60">{t.pair}</td>
                          <td className="py-2 px-2 text-right text-white">${t.price.toLocaleString()}</td>
                          <td className="py-2 px-2 text-right text-white/70">{t.amount}</td>
                          <td className={`py-2 px-2 text-right font-bold ${t.pnl > 0 ? 'text-green-400' : t.pnl < 0 ? 'text-red-400' : 'text-white/30'}`}>
                            {t.pnl === 0 ? '--' : (t.pnl > 0 ? '+' : '') + '$' + t.pnl.toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="text-center mt-3 text-[11px] text-white/20 font-mono">Showing 10 of {results.totalTrades} total trades</div>
                </GlassCard>
              </Section>

              {/* ============ 6. Risk Metrics ============ */}
              <Section num="06" title="Risk Metrics" delay={0.35}>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {[
                    { label: 'Value at Risk (95%)', value: fmtPct(results.var95), color: 'text-amber-400', glow: 'warning', sub: 'Max daily loss at 95% confidence', barW: Math.abs(results.var95) * 15, barGrad: 'linear-gradient(90deg, #f59e0b, #ef4444)' },
                    { label: 'Sortino Ratio', value: results.sortinoRatio.toFixed(2), color: '', glow: 'terminal', sub: 'Downside risk-adjusted return', barW: results.sortinoRatio * 30, barGrad: `linear-gradient(90deg, ${CYAN}, #22c55e)`, useColor: CYAN },
                    { label: 'Calmar Ratio', value: results.calmarRatio.toFixed(2), color: 'text-green-400', glow: 'matrix', sub: 'Return / Max Drawdown', barW: results.calmarRatio * 40, barGrad: 'linear-gradient(90deg, #22c55e, #10b981)' },
                  ].map((r) => (
                    <GlassCard key={r.label} className="p-5" glowColor={r.glow}>
                      <div className="text-[11px] font-mono text-white/40 uppercase tracking-wider mb-1">{r.label}</div>
                      <div className={`text-2xl font-bold font-mono ${r.color}`} style={r.useColor ? { color: r.useColor } : undefined}>{r.value}</div>
                      <div className="text-[10px] text-white/25 mt-1">{r.sub}</div>
                      <div className="mt-3 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                        <div className="h-full rounded-full" style={{ width: `${Math.min(100, r.barW)}%`, background: r.barGrad }} />
                      </div>
                    </GlassCard>
                  ))}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
                  {[
                    { label: 'Avg Trade Return', value: fmtPct(results.avgTradeReturn), cls: 'text-white' },
                    { label: 'Max Drawdown', value: fmtPct(results.maxDrawdown), cls: 'text-red-400' },
                    { label: 'Recovery Factor', value: (results.totalReturn / Math.abs(results.maxDrawdown)).toFixed(2) + 'x', cls: 'text-white' },
                    { label: 'Expectancy', value: fmt(results.avgTradeReturn * capital / 100), cls: 'text-green-400' },
                  ].map((m) => (
                    <GlassCard key={m.label} className="p-3">
                      <div className="text-center">
                        <div className="text-[10px] font-mono text-white/30 uppercase">{m.label}</div>
                        <div className={`text-lg font-bold font-mono ${m.cls}`}>{m.value}</div>
                      </div>
                    </GlassCard>
                  ))}
                </div>
              </Section>

              {/* ============ 7. Deploy Strategy ============ */}
              <Section num="07" title="Deploy Strategy" delay={0.4}>
                <GlassCard className="p-6">
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div>
                      <h3 className="text-base font-bold font-mono text-white">Ready to go live?</h3>
                      <p className="text-sm text-white/40 font-mono mt-1">Deploy this {selectedStrategy?.name} strategy on {selectedPair?.label} with real capital</p>
                    </div>
                    <Link to="/automation"
                      className="px-8 py-3 rounded-xl text-sm font-bold font-mono tracking-wider transition-all whitespace-nowrap"
                      style={{ background: isConnected ? `linear-gradient(135deg, ${CYAN}, #0891b2)` : 'rgba(255,255,255,0.06)', color: isConnected ? '#000' : 'rgba(255,255,255,0.3)', pointerEvents: isConnected ? 'auto' : 'none' }}>
                      Deploy Strategy
                    </Link>
                  </div>
                  {!isConnected && <div className="mt-3 text-center text-[11px] font-mono text-white/25">Connect wallet to deploy strategies with real capital</div>}
                </GlassCard>
              </Section>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ============ Not-yet-run placeholder ============ */}
        {!hasRun && !isRunning && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}>
            <GlassCard className="p-12">
              <div className="text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center"
                  style={{ background: 'rgba(6,182,212,0.08)', border: '1px solid rgba(6,182,212,0.15)' }}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={CYAN} strokeWidth="1.5">
                    <path d="M3 3v18h18" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M7 16l4-8 4 4 5-9" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <h3 className="text-lg font-bold font-mono text-white mb-2">Configure & Run</h3>
                <p className="text-sm text-white/40 font-mono max-w-md mx-auto">
                  Select a strategy, configure parameters, and hit Run Backtest to simulate
                  performance against historical data. Results include PnL, risk metrics,
                  and comparison against buy & hold.
                </p>
                <div className="flex justify-center gap-6 mt-6">
                  {[['5 Strategies', 'DCA, Grid, Mean Rev, Momentum, Custom'], ['Risk Analysis', 'VaR, Sortino, Calmar, Drawdown'], ['Trade Log', 'Entry/exit details with PnL tracking']].map(([title, desc]) => (
                    <div key={title} className="text-center">
                      <div className="text-sm font-mono font-bold" style={{ color: CYAN }}>{title}</div>
                      <div className="text-[10px] text-white/30 mt-0.5 max-w-[120px]">{desc}</div>
                    </div>
                  ))}
                </div>
              </div>
            </GlassCard>
          </motion.div>
        )}
      </div>
    </div>
  )
}
