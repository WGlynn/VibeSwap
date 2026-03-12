import { useState, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'
import StatCard from './ui/StatCard'

// ============ Constants ============

const PHI = 1.618033988749895
const MATRIX = '#00ff41'
const CYAN = '#06b6d4'
const AMBER = '#f59e0b'
const ease = [0.25, 0.1, 1 / PHI, 1]

// ============ Seeded PRNG ============

function seededRandom(seed) {
  let s = seed
  return () => {
    s = (s * 16807 + 0) % 2147483647
    return (s - 1) / 2147483646
  }
}

// ============ Animation Variants ============

const tabV = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease } },
  exit: { opacity: 0, y: -12, transition: { duration: 0.2 } },
}

// ============ Tab Definitions ============

const TABS = [
  { id: 'prisoners', label: "Prisoner's Dilemma", icon: '\u2694' },
  { id: 'nash', label: 'Nash Equilibrium', icon: '\u2696' },
  { id: 'auctions', label: 'Auction Types', icon: '\u26a1' },
  { id: 'titfortat', label: 'Tit for Tat', icon: '\u2b50' },
  { id: 'shapley', label: 'Shapley Value', icon: '\u03c6' },
  { id: 'mev', label: 'MEV Proof', icon: '\ud83d\udee1' },
]

// ============ Strategies for Iterated PD ============

function titForTat(history) {
  if (history.length === 0) return 'C'
  return history[history.length - 1].opponent
}

function alwaysDefect() {
  return 'D'
}

function alwaysCooperate() {
  return 'C'
}

function randomStrategy(rng) {
  return rng() > 0.5 ? 'C' : 'D'
}

function grimTrigger(history) {
  if (history.some((h) => h.opponent === 'D')) return 'D'
  return 'C'
}

const STRATEGIES = {
  'Tit for Tat': { fn: titForTat, desc: 'Cooperate first, then copy opponent' },
  'Always Defect': { fn: alwaysDefect, desc: 'Never cooperate' },
  'Always Cooperate': { fn: alwaysCooperate, desc: 'Always cooperate' },
  Random: { fn: randomStrategy, desc: '50/50 random choice', needsRng: true },
  'Grim Trigger': { fn: grimTrigger, desc: 'Cooperate until betrayed, then defect forever' },
}

const PD_PAYOFFS = { CC: [3, 3], CD: [0, 5], DC: [5, 0], DD: [1, 1] }

// ============ 1. Prisoner's Dilemma Section ============

function PrisonersDilemmaTab() {
  const [mode, setMode] = useState('single') // 'single' | 'iterated'
  const [p1Choice, setP1Choice] = useState(null)
  const [p2Choice, setP2Choice] = useState(null)
  const [p1Strat, setP1Strat] = useState('Tit for Tat')
  const [p2Strat, setP2Strat] = useState('Always Defect')
  const [results, setResults] = useState(null)

  const singleOutcome = useMemo(() => {
    if (!p1Choice || !p2Choice) return null
    const key = p1Choice + p2Choice
    return PD_PAYOFFS[key]
  }, [p1Choice, p2Choice])

  const runIterated = useCallback(() => {
    const rng = seededRandom(42)
    const rounds = 100
    const histA = []
    const histB = []
    const scores = { a: [], b: [] }
    let totalA = 0
    let totalB = 0

    for (let i = 0; i < rounds; i++) {
      const stratA = STRATEGIES[p1Strat]
      const stratB = STRATEGIES[p2Strat]
      const moveA = stratA.needsRng ? stratA.fn(rng) : stratA.fn(histA)
      const moveB = stratB.needsRng ? stratB.fn(rng) : stratB.fn(histB)
      const key = moveA + moveB
      const [pA, pB] = PD_PAYOFFS[key]
      totalA += pA
      totalB += pB
      histA.push({ mine: moveA, opponent: moveB })
      histB.push({ mine: moveB, opponent: moveA })
      scores.a.push(totalA)
      scores.b.push(totalB)
    }
    setResults({ scores, totalA, totalB, rounds })
  }, [p1Strat, p2Strat])

  const payoffMatrix = [
    [PD_PAYOFFS.CC, PD_PAYOFFS.CD],
    [PD_PAYOFFS.DC, PD_PAYOFFS.DD],
  ]

  return (
    <div className="space-y-6">
      {/* Mode Toggle */}
      <div className="flex gap-2 justify-center">
        {['single', 'iterated'].map((m) => (
          <button
            key={m}
            onClick={() => { setMode(m); setResults(null); setP1Choice(null); setP2Choice(null) }}
            className={`px-4 py-2 rounded-lg text-xs font-mono uppercase tracking-wider transition-all ${
              mode === m
                ? 'bg-green-500/20 text-green-400 border border-green-500/40'
                : 'bg-black/30 text-gray-500 border border-white/5 hover:text-gray-300'
            }`}
          >
            {m === 'single' ? 'One-Shot Game' : 'Iterated (100 Rounds)'}
          </button>
        ))}
      </div>

      {mode === 'single' ? (
        <>
          {/* Payoff Matrix */}
          <GlassCard glowColor="matrix" className="p-5">
            <p className="text-xs font-mono text-gray-500 uppercase tracking-wider mb-4 text-center">
              Payoff Matrix (Player A, Player B)
            </p>
            <div className="grid grid-cols-3 gap-1.5 max-w-sm mx-auto">
              <div />
              <div className="text-center py-2 text-xs font-mono text-cyan-400">B: Cooperate</div>
              <div className="text-center py-2 text-xs font-mono text-cyan-400">B: Defect</div>
              {['C', 'D'].map((rowMove, r) => (
                <>
                  <div key={`label-${r}`} className="flex items-center justify-end pr-2">
                    <span className="text-xs font-mono text-green-400">
                      A: {rowMove === 'C' ? 'Cooperate' : 'Defect'}
                    </span>
                  </div>
                  {payoffMatrix[r].map((cell, c) => {
                    const colMove = c === 0 ? 'C' : 'D'
                    const isSelected = p1Choice === rowMove && p2Choice === colMove
                    const isNash = r === 1 && c === 1
                    return (
                      <motion.button
                        key={`${r}-${c}`}
                        onClick={() => { setP1Choice(rowMove); setP2Choice(colMove) }}
                        className="rounded-lg p-3 text-center cursor-pointer relative"
                        style={{
                          background: isSelected ? 'rgba(0,255,65,0.15)' : isNash ? 'rgba(239,68,68,0.08)' : 'rgba(0,0,0,0.4)',
                          border: isSelected ? `2px solid ${MATRIX}` : isNash ? '1px solid rgba(239,68,68,0.3)' : '1px solid rgba(255,255,255,0.06)',
                        }}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.97 }}
                      >
                        <span className="text-sm font-mono font-bold text-white">
                          ({cell[0]}, {cell[1]})
                        </span>
                        {isNash && (
                          <span className="absolute top-0.5 right-1 text-[8px] text-red-400 font-mono">NE</span>
                        )}
                      </motion.button>
                    )
                  })}
                </>
              ))}
            </div>
          </GlassCard>

          {/* Outcome */}
          <AnimatePresence mode="wait">
            {singleOutcome && (
              <motion.div
                key={`${p1Choice}-${p2Choice}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="rounded-xl p-4 text-center"
                style={{ background: 'rgba(0,255,65,0.06)', border: `1px solid ${MATRIX}33` }}
              >
                <p className="text-xs font-mono text-gray-400 mb-1">
                  A: {p1Choice === 'C' ? 'Cooperate' : 'Defect'} | B: {p2Choice === 'C' ? 'Cooperate' : 'Defect'}
                </p>
                <p className="text-lg font-mono font-bold">
                  <span className="text-green-400">{singleOutcome[0]}</span>
                  <span className="text-gray-600 mx-2">|</span>
                  <span className="text-cyan-400">{singleOutcome[1]}</span>
                </p>
                <p className="text-[10px] font-mono text-gray-500 mt-2">
                  {p1Choice === 'C' && p2Choice === 'C' && 'Mutual cooperation: socially optimal. Both gain 3.'}
                  {p1Choice === 'C' && p2Choice === 'D' && "Sucker's payoff. A cooperated, B exploited. This is why cooperation collapses in one-shot games."}
                  {p1Choice === 'D' && p2Choice === 'C' && 'Temptation payoff. A defected, B got exploited.'}
                  {p1Choice === 'D' && p2Choice === 'D' && 'Nash Equilibrium of the one-shot game. Both defect. Both lose. Rational self-interest destroys surplus.'}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      ) : (
        <>
          {/* Strategy Selectors */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              { label: 'Player A Strategy', value: p1Strat, set: setP1Strat, color: 'green' },
              { label: 'Player B Strategy', value: p2Strat, set: setP2Strat, color: 'cyan' },
            ].map(({ label, value, set, color }) => (
              <GlassCard key={label} glowColor={color === 'green' ? 'matrix' : 'terminal'} className="p-4">
                <p className={`text-xs font-mono text-${color}-400 uppercase tracking-wider mb-3`}>{label}</p>
                <div className="space-y-1.5">
                  {Object.entries(STRATEGIES).map(([name, { desc }]) => (
                    <button
                      key={name}
                      onClick={() => { set(name); setResults(null) }}
                      className={`w-full text-left rounded-lg px-3 py-2 text-xs font-mono transition-all ${
                        value === name
                          ? `bg-${color}-500/15 text-${color}-400 border border-${color}-500/30`
                          : 'text-gray-500 hover:text-gray-300 border border-transparent'
                      }`}
                      style={value === name ? {
                        background: color === 'green' ? 'rgba(0,255,65,0.1)' : 'rgba(6,182,212,0.1)',
                        borderColor: color === 'green' ? 'rgba(0,255,65,0.25)' : 'rgba(6,182,212,0.25)',
                        color: color === 'green' ? MATRIX : CYAN,
                      } : {}}
                    >
                      <span className="font-bold">{name}</span>
                      <span className="text-gray-600 ml-2">- {desc}</span>
                    </button>
                  ))}
                </div>
              </GlassCard>
            ))}
          </div>

          {/* Run Button */}
          <div className="text-center">
            <motion.button
              onClick={runIterated}
              className="px-8 py-3 rounded-xl text-sm font-mono font-bold uppercase tracking-wider"
              style={{ background: `${MATRIX}22`, border: `1px solid ${MATRIX}55`, color: MATRIX }}
              whileHover={{ scale: 1.05, boxShadow: `0 0 30px ${MATRIX}33` }}
              whileTap={{ scale: 0.97 }}
            >
              Run 100 Rounds
            </motion.button>
          </div>

          {/* Results Chart */}
          <AnimatePresence>
            {results && (
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <GlassCard glowColor="matrix" className="p-5">
                  <div className="flex justify-between items-center mb-4">
                    <p className="text-xs font-mono text-gray-500 uppercase tracking-wider">Cumulative Score Over 100 Rounds</p>
                    <div className="flex gap-4 text-xs font-mono">
                      <span className="text-green-400">A: {results.totalA}</span>
                      <span className="text-cyan-400">B: {results.totalB}</span>
                    </div>
                  </div>
                  {/* SVG Score Chart */}
                  <svg viewBox="0 0 500 160" className="w-full" preserveAspectRatio="xMidYMid meet">
                    <defs>
                      <linearGradient id="gradA" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={MATRIX} stopOpacity="0.3" />
                        <stop offset="100%" stopColor={MATRIX} stopOpacity="0" />
                      </linearGradient>
                      <linearGradient id="gradB" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={CYAN} stopOpacity="0.3" />
                        <stop offset="100%" stopColor={CYAN} stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    {/* Grid lines */}
                    {[0, 40, 80, 120, 160].map((y) => (
                      <line key={y} x1="0" y1={y} x2="500" y2={y} stroke="rgba(255,255,255,0.04)" />
                    ))}
                    {(() => {
                      const maxVal = Math.max(results.totalA, results.totalB, 1)
                      const scaleY = (v) => 155 - (v / maxVal) * 145
                      const scaleX = (i) => (i / (results.rounds - 1)) * 500
                      const lineA = results.scores.a.map((v, i) => `${scaleX(i)},${scaleY(v)}`).join(' ')
                      const lineB = results.scores.b.map((v, i) => `${scaleX(i)},${scaleY(v)}`).join(' ')
                      const areaA = `0,155 ${lineA} 500,155`
                      const areaB = `0,155 ${lineB} 500,155`
                      return (
                        <>
                          <polygon points={areaA} fill="url(#gradA)" />
                          <polygon points={areaB} fill="url(#gradB)" />
                          <polyline points={lineA} fill="none" stroke={MATRIX} strokeWidth="2" />
                          <polyline points={lineB} fill="none" stroke={CYAN} strokeWidth="2" />
                        </>
                      )
                    })()}
                  </svg>
                  <div className="flex justify-center gap-6 mt-3">
                    <span className="flex items-center gap-2 text-[10px] font-mono text-gray-500">
                      <span className="w-3 h-0.5 rounded" style={{ background: MATRIX }} /> Player A ({p1Strat})
                    </span>
                    <span className="flex items-center gap-2 text-[10px] font-mono text-gray-500">
                      <span className="w-3 h-0.5 rounded" style={{ background: CYAN }} /> Player B ({p2Strat})
                    </span>
                  </div>
                  {/* Insight */}
                  <div className="mt-4 rounded-lg p-3" style={{ background: `${MATRIX}0a`, border: `1px solid ${MATRIX}22` }}>
                    <p className="text-[11px] font-mono text-green-400/80 text-center">
                      {results.totalA > results.totalB
                        ? `${p1Strat} wins by ${results.totalA - results.totalB} points. `
                        : results.totalA < results.totalB
                        ? `${p2Strat} wins by ${results.totalB - results.totalA} points. `
                        : 'Tie game. '}
                      {p1Strat === 'Tit for Tat' && p2Strat === 'Tit for Tat'
                        ? 'Two cooperative strategies produce maximum joint welfare.'
                        : p1Strat === 'Tit for Tat' || p2Strat === 'Tit for Tat'
                        ? 'Tit for Tat is never the outright winner, but maximizes total welfare. Nice, provocable, forgiving, clear.'
                        : 'Try Tit for Tat vs Always Defect to see Axelrod\'s key insight.'}
                    </p>
                  </div>
                </GlassCard>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  )
}

// ============ 2. Nash Equilibrium Finder ============

function NashEquilibriumTab() {
  const [matrix, setMatrix] = useState([
    [{ a: 3, b: 3 }, { a: 0, b: 5 }],
    [{ a: 5, b: 0 }, { a: 1, b: 1 }],
  ])
  const [rowLabels] = useState(['Cooperate', 'Defect'])
  const [colLabels] = useState(['Cooperate', 'Defect'])

  const updateCell = useCallback((r, c, player, value) => {
    setMatrix((prev) => {
      const next = prev.map((row) => row.map((cell) => ({ ...cell })))
      next[r][c][player] = Number(value) || 0
      return next
    })
  }, [])

  // Find pure strategy Nash Equilibria
  const nashCells = useMemo(() => {
    const results = []
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 2; c++) {
        const otherRow = 1 - r
        const otherCol = 1 - c
        const aBestResponse = matrix[r][c].a >= matrix[otherRow][c].a
        const bBestResponse = matrix[r][c].b >= matrix[r][otherCol].b
        if (aBestResponse && bBestResponse) {
          results.push({ r, c })
        }
      }
    }
    return results
  }, [matrix])

  // Mixed strategy Nash Equilibrium
  const mixedNE = useMemo(() => {
    const a00 = matrix[0][0].a, a01 = matrix[0][1].a, a10 = matrix[1][0].a, a11 = matrix[1][1].a
    const b00 = matrix[0][0].b, b01 = matrix[0][1].b, b10 = matrix[1][0].b, b11 = matrix[1][1].b

    // Player B's mix (q = prob of col 0) to make A indifferent
    const denomA = (a00 - a01) - (a10 - a11)
    const q = denomA !== 0 ? (a11 - a01) / denomA : null

    // Player A's mix (p = prob of row 0) to make B indifferent
    const denomB = (b00 - b10) - (b01 - b11)
    const p = denomB !== 0 ? (b11 - b10) / denomB : null

    if (p !== null && q !== null && p >= 0 && p <= 1 && q >= 0 && q <= 1) {
      return { p: p.toFixed(3), q: q.toFixed(3) }
    }
    return null
  }, [matrix])

  const isNash = (r, c) => nashCells.some((n) => n.r === r && n.c === c)

  return (
    <div className="space-y-6">
      <GlassCard glowColor="terminal" className="p-5">
        <p className="text-xs font-mono text-gray-500 uppercase tracking-wider mb-1 text-center">
          Editable 2x2 Payoff Matrix
        </p>
        <p className="text-[10px] font-mono text-gray-600 text-center mb-5">
          Click any value to edit. Nash Equilibria are highlighted.
        </p>

        <div className="grid grid-cols-3 gap-2 max-w-md mx-auto">
          <div />
          {colLabels.map((col, c) => (
            <div key={c} className="text-center py-2 text-xs font-mono text-cyan-400">B: {col}</div>
          ))}
          {rowLabels.map((row, r) => (
            <>
              <div key={`lbl-${r}`} className="flex items-center justify-end pr-2">
                <span className="text-xs font-mono text-green-400">A: {row}</span>
              </div>
              {matrix[r].map((cell, c) => (
                <div
                  key={`${r}-${c}`}
                  className="rounded-xl p-3 text-center relative"
                  style={{
                    background: isNash(r, c) ? 'rgba(0,255,65,0.12)' : 'rgba(0,0,0,0.4)',
                    border: isNash(r, c) ? `2px solid ${MATRIX}88` : '1px solid rgba(255,255,255,0.06)',
                    boxShadow: isNash(r, c) ? `0 0 20px ${MATRIX}22` : 'none',
                  }}
                >
                  {isNash(r, c) && (
                    <span className="absolute -top-1.5 -right-1.5 bg-green-500 text-black text-[7px] font-bold px-1.5 py-0.5 rounded-full">
                      NE
                    </span>
                  )}
                  <div className="flex items-center justify-center gap-1">
                    <span className="text-[10px] text-gray-600">(</span>
                    <input
                      type="number"
                      value={cell.a}
                      onChange={(e) => updateCell(r, c, 'a', e.target.value)}
                      className="w-8 bg-transparent text-center text-sm font-mono font-bold text-green-400 outline-none border-b border-green-500/20 focus:border-green-500/60"
                    />
                    <span className="text-gray-600">,</span>
                    <input
                      type="number"
                      value={cell.b}
                      onChange={(e) => updateCell(r, c, 'b', e.target.value)}
                      className="w-8 bg-transparent text-center text-sm font-mono font-bold text-cyan-400 outline-none border-b border-cyan-500/20 focus:border-cyan-500/60"
                    />
                    <span className="text-[10px] text-gray-600">)</span>
                  </div>
                </div>
              ))}
            </>
          ))}
        </div>
      </GlassCard>

      {/* Results */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <GlassCard glowColor="matrix" className="p-4">
          <p className="text-[10px] font-mono text-gray-500 uppercase tracking-wider mb-3">Pure Strategy NE</p>
          {nashCells.length > 0 ? (
            <div className="space-y-2">
              {nashCells.map(({ r, c }, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-green-400" />
                  <span className="text-sm font-mono text-white">
                    ({rowLabels[r]}, {colLabels[c]})
                  </span>
                  <span className="text-xs font-mono text-gray-500">
                    = ({matrix[r][c].a}, {matrix[r][c].b})
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs font-mono text-gray-500 italic">No pure strategy Nash Equilibrium exists.</p>
          )}
        </GlassCard>

        <GlassCard glowColor="terminal" className="p-4">
          <p className="text-[10px] font-mono text-gray-500 uppercase tracking-wider mb-3">Mixed Strategy NE</p>
          {mixedNE ? (
            <div className="space-y-2">
              <div className="text-sm font-mono">
                <span className="text-green-400">A</span>
                <span className="text-gray-500"> plays {rowLabels[0]} with p = </span>
                <span className="text-white font-bold">{mixedNE.p}</span>
              </div>
              <div className="text-sm font-mono">
                <span className="text-cyan-400">B</span>
                <span className="text-gray-500"> plays {colLabels[0]} with q = </span>
                <span className="text-white font-bold">{mixedNE.q}</span>
              </div>
            </div>
          ) : (
            <p className="text-xs font-mono text-gray-500 italic">No interior mixed equilibrium (check for dominant strategies).</p>
          )}
        </GlassCard>
      </div>

      <div className="rounded-xl p-4" style={{ background: `${CYAN}0a`, border: `1px solid ${CYAN}22` }}>
        <p className="text-[11px] font-mono text-cyan-400/80 text-center">
          A Nash Equilibrium is a strategy profile where no player can improve their payoff by unilaterally changing strategy.
          In the classic Prisoner's Dilemma, (Defect, Defect) is the only NE -- yet both players would prefer (Cooperate, Cooperate).
          This gap between individual rationality and collective welfare is precisely what VibeSwap's mechanism design solves.
        </p>
      </div>
    </div>
  )
}

// ============ 3. Auction Types Comparison ============

const AUCTION_TYPES = [
  {
    name: 'English (Ascending)',
    how: 'Open ascending bids. Highest bidder wins at their bid price.',
    strategy: 'Bid up to your true value, stop when price exceeds it.',
    mev: 'high',
    mevNote: 'Fully visible bids enable front-running and bid manipulation.',
  },
  {
    name: 'Dutch (Descending)',
    how: 'Price starts high and drops. First to accept wins at current price.',
    strategy: 'Accept when price reaches your value. Risk: someone else accepts first.',
    mev: 'medium',
    mevNote: 'Price is visible. Bots can time acceptance to extract surplus.',
  },
  {
    name: 'First-Price Sealed',
    how: 'Submit sealed bid. Highest bidder wins, pays their bid.',
    strategy: 'Shade bid below true value. Optimal shading depends on unknown competition.',
    mev: 'medium',
    mevNote: 'Sealed bids help, but submission ordering on-chain is still manipulable.',
  },
  {
    name: 'Second-Price (Vickrey)',
    how: 'Submit sealed bid. Highest bidder wins, pays second-highest bid.',
    strategy: 'Bid your true value (dominant strategy). Truthful revelation is optimal.',
    mev: 'medium',
    mevNote: 'Truthful in theory, but on-chain sealed bids can be observed in mempool.',
  },
  {
    name: 'VibeSwap Batch Auction',
    how: 'Commit hash(order|secret), reveal after deadline, settle at uniform clearing price with Fisher-Yates shuffle.',
    strategy: 'Bid true value. Commit-reveal makes strategic manipulation impossible.',
    mev: 'none',
    mevNote: 'Orders hidden until reveal. Uniform price + random ordering = zero MEV surface.',
  },
]

function AuctionTypesTab() {
  const [expanded, setExpanded] = useState(null)

  return (
    <div className="space-y-3">
      {AUCTION_TYPES.map((auction, i) => {
        const isVibe = auction.mev === 'none'
        return (
          <motion.div
            key={auction.name}
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.06 * PHI }}
          >
            <GlassCard
              glowColor={isVibe ? 'matrix' : 'none'}
              spotlight={isVibe}
              className="cursor-pointer"
              onClick={() => setExpanded(expanded === i ? null : i)}
            >
              <div className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <h3 className={`text-sm font-mono font-bold ${isVibe ? 'text-green-400' : 'text-white'}`}>
                      {auction.name}
                    </h3>
                    <span
                      className="text-[9px] font-mono font-bold uppercase px-2 py-0.5 rounded-full"
                      style={{
                        background: auction.mev === 'none' ? 'rgba(0,255,65,0.15)' : auction.mev === 'high' ? 'rgba(239,68,68,0.15)' : 'rgba(245,158,11,0.15)',
                        color: auction.mev === 'none' ? MATRIX : auction.mev === 'high' ? '#ef4444' : AMBER,
                        border: `1px solid ${auction.mev === 'none' ? MATRIX + '44' : auction.mev === 'high' ? '#ef444444' : AMBER + '44'}`,
                      }}
                    >
                      MEV: {auction.mev}
                    </span>
                  </div>
                  <motion.span
                    animate={{ rotate: expanded === i ? 180 : 0 }}
                    className="text-gray-600 text-xs"
                  >
                    &#9662;
                  </motion.span>
                </div>
                <p className="text-xs font-mono text-gray-500">{auction.how}</p>
              </div>
              <AnimatePresence>
                {expanded === i && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3 }}
                    className="overflow-hidden"
                  >
                    <div className="px-4 pb-4 space-y-3">
                      <div className="h-px" style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent)' }} />
                      <div className="rounded-lg p-3" style={{ background: 'rgba(0,0,0,0.3)' }}>
                        <p className="text-[10px] font-mono text-gray-500 uppercase tracking-wider mb-1">Dominant Strategy</p>
                        <p className="text-xs font-mono text-gray-300">{auction.strategy}</p>
                      </div>
                      <div className="rounded-lg p-3" style={{
                        background: auction.mev === 'none' ? `${MATRIX}0a` : 'rgba(239,68,68,0.05)',
                        border: `1px solid ${auction.mev === 'none' ? MATRIX + '22' : 'rgba(239,68,68,0.15)'}`,
                      }}>
                        <p className="text-[10px] font-mono text-gray-500 uppercase tracking-wider mb-1">MEV Vulnerability</p>
                        <p className={`text-xs font-mono ${auction.mev === 'none' ? 'text-green-400' : 'text-red-400/80'}`}>
                          {auction.mevNote}
                        </p>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </GlassCard>
          </motion.div>
        )
      })}
    </div>
  )
}

// ============ 4. Tit for Tat = VibeSwap ============

const AXELROD_TRAITS = [
  {
    trait: 'Nice',
    desc: 'Never the first to defect',
    vibeswap: 'Cooperative default: uniform clearing price gives all traders the same fair price. No advantage to early movers or large orders.',
    icon: '\u2764',
    color: MATRIX,
  },
  {
    trait: 'Provocable',
    desc: 'Immediately retaliates against defection',
    vibeswap: '50% slashing for invalid reveals. Submit garbage? Lose half your deposit instantly. No warnings, no appeals.',
    icon: '\u26a1',
    color: '#ef4444',
  },
  {
    trait: 'Forgiving',
    desc: 'Returns to cooperation after retaliation',
    vibeswap: 'Per-batch state reset. Every 10 seconds is a fresh start. Past slashing does not prevent future participation.',
    icon: '\u21bb',
    color: CYAN,
  },
  {
    trait: 'Clear',
    desc: 'Strategy is transparent and predictable',
    vibeswap: 'Deterministic, auditable smart contracts. Every rule is visible on-chain. Players know exactly what will happen for any action.',
    icon: '\u2609',
    color: AMBER,
  },
]

function TitForTatTab() {
  const [activeTrait, setActiveTrait] = useState(0)

  return (
    <div className="space-y-6">
      {/* Axelrod Quote */}
      <div className="rounded-xl p-5 text-center" style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${MATRIX}22` }}>
        <p className="text-sm font-mono text-gray-300 italic leading-relaxed">
          "What accounts for TIT FOR TAT's robust success is its combination of being nice, retaliatory, forgiving, and clear."
        </p>
        <p className="text-[10px] font-mono text-gray-600 mt-2">-- Robert Axelrod, The Evolution of Cooperation (1984)</p>
      </div>

      {/* Four Traits Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {AXELROD_TRAITS.map((t, i) => (
          <motion.button
            key={t.trait}
            onClick={() => setActiveTrait(i)}
            className="rounded-xl p-4 text-center cursor-pointer transition-all"
            style={{
              background: activeTrait === i ? `${t.color}18` : 'rgba(0,0,0,0.3)',
              border: activeTrait === i ? `2px solid ${t.color}66` : '1px solid rgba(255,255,255,0.06)',
              boxShadow: activeTrait === i ? `0 0 25px ${t.color}15` : 'none',
            }}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
          >
            <span className="text-2xl block mb-2">{t.icon}</span>
            <span className="text-sm font-mono font-bold block" style={{ color: t.color }}>{t.trait}</span>
            <span className="text-[9px] font-mono text-gray-600 block mt-1">{t.desc}</span>
          </motion.button>
        ))}
      </div>

      {/* Active Trait Detail */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTrait}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.3 }}
        >
          <GlassCard glowColor="matrix" spotlight className="p-5">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-xl">{AXELROD_TRAITS[activeTrait].icon}</span>
              <div>
                <h3 className="text-base font-mono font-bold" style={{ color: AXELROD_TRAITS[activeTrait].color }}>
                  {AXELROD_TRAITS[activeTrait].trait}
                </h3>
                <p className="text-[10px] font-mono text-gray-500">{AXELROD_TRAITS[activeTrait].desc}</p>
              </div>
            </div>
            <div className="h-px mb-3" style={{ background: `linear-gradient(90deg, ${AXELROD_TRAITS[activeTrait].color}44, transparent)` }} />
            <div className="flex items-start gap-2">
              <span className="text-green-400 text-xs font-mono font-bold flex-shrink-0 mt-0.5">VIBESWAP:</span>
              <p className="text-sm font-mono text-gray-300 leading-relaxed">
                {AXELROD_TRAITS[activeTrait].vibeswap}
              </p>
            </div>
          </GlassCard>
        </motion.div>
      </AnimatePresence>

      {/* Tournament Insight */}
      <div className="rounded-xl p-4" style={{ background: `${MATRIX}08`, border: `1px solid ${MATRIX}20` }}>
        <p className="text-xs font-mono text-green-400/80 text-center leading-relaxed">
          In Axelrod's 1980 computer tournament, Tit for Tat won against 62 competing strategies.
          It never beats any individual opponent -- but it maximizes total welfare across all interactions.
          VibeSwap's mechanism design encodes these exact four properties into immutable smart contract logic.
          The protocol does not hope for cooperation. It makes defection structurally irrational.
        </p>
      </div>
    </div>
  )
}

// ============ 5. Shapley Value Interactive ============

const SHAPLEY_PLAYERS = [
  { id: 'LP', label: 'Liquidity Provider', color: '#60a5fa' },
  { id: 'TR', label: 'Trader', color: MATRIX },
  { id: 'OR', label: 'Oracle Reporter', color: '#a855f7' },
  { id: 'AR', label: 'Arbitrageur', color: AMBER },
]

// Coalition values for 4 players: v(S) for all 2^4 - 1 non-empty subsets
const COALITION_VALUES = {
  LP: 10, TR: 0, OR: 0, AR: 0,
  'LP,TR': 50, 'LP,OR': 20, 'LP,AR': 15,
  'TR,OR': 5, 'TR,AR': 8, 'OR,AR': 3,
  'LP,TR,OR': 85, 'LP,TR,AR': 70, 'LP,OR,AR': 30, 'TR,OR,AR': 12,
  'LP,TR,OR,AR': 100,
}

function getCoalitionValue(members) {
  const key = [...members].sort().join(',')
  return COALITION_VALUES[key] || 0
}

function computeShapley(players) {
  // Generate all permutations
  function permutations(arr) {
    if (arr.length <= 1) return [arr]
    const result = []
    for (let i = 0; i < arr.length; i++) {
      const rest = [...arr.slice(0, i), ...arr.slice(i + 1)]
      for (const perm of permutations(rest)) {
        result.push([arr[i], ...perm])
      }
    }
    return result
  }

  const ids = players.map((p) => p.id)
  const perms = permutations(ids)
  const marginals = {}
  ids.forEach((id) => { marginals[id] = [] })

  for (const perm of perms) {
    const coalition = []
    for (const player of perm) {
      const before = getCoalitionValue(coalition)
      coalition.push(player)
      const after = getCoalitionValue(coalition)
      marginals[player].push(after - before)
    }
  }

  const shapley = {}
  ids.forEach((id) => {
    shapley[id] = marginals[id].reduce((a, b) => a + b, 0) / perms.length
  })

  return { shapley, marginals, perms }
}

function ShapleyValueTab() {
  const [animStep, setAnimStep] = useState(-1)
  const [isAnimating, setIsAnimating] = useState(false)

  const { shapley, marginals, perms } = useMemo(() => computeShapley(SHAPLEY_PLAYERS), [])

  const animate = useCallback(() => {
    setIsAnimating(true)
    setAnimStep(0)
    let step = 0
    const interval = setInterval(() => {
      step++
      if (step >= perms.length) {
        clearInterval(interval)
        setIsAnimating(false)
        setAnimStep(perms.length - 1)
      } else {
        setAnimStep(step)
      }
    }, 120)
  }, [perms.length])

  // Current permutation being shown
  const currentPerm = animStep >= 0 ? perms[Math.min(animStep, perms.length - 1)] : null

  return (
    <div className="space-y-6">
      {/* Player Badges */}
      <div className="flex flex-wrap justify-center gap-4">
        {SHAPLEY_PLAYERS.map((p) => (
          <div key={p.id} className="text-center">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center text-sm font-mono font-bold mx-auto mb-1"
              style={{ background: `${p.color}20`, border: `2px solid ${p.color}`, color: p.color }}
            >
              {p.id}
            </div>
            <span className="text-[9px] font-mono text-gray-500">{p.label}</span>
          </div>
        ))}
      </div>

      {/* Animate Button */}
      <div className="text-center">
        <motion.button
          onClick={animate}
          disabled={isAnimating}
          className="px-6 py-2.5 rounded-xl text-xs font-mono font-bold uppercase tracking-wider"
          style={{
            background: isAnimating ? 'rgba(100,100,100,0.2)' : `${MATRIX}22`,
            border: `1px solid ${isAnimating ? 'rgba(100,100,100,0.3)' : MATRIX + '55'}`,
            color: isAnimating ? '#666' : MATRIX,
          }}
          whileHover={isAnimating ? {} : { scale: 1.05 }}
          whileTap={isAnimating ? {} : { scale: 0.97 }}
        >
          {isAnimating ? `Computing... (${animStep + 1}/${perms.length})` : 'Compute Shapley Values'}
        </motion.button>
        <p className="text-[9px] font-mono text-gray-600 mt-2">
          Iterates all {perms.length} orderings and computes marginal contributions
        </p>
      </div>

      {/* Current Permutation Visualization */}
      {currentPerm && (
        <GlassCard glowColor="terminal" className="p-4">
          <p className="text-[10px] font-mono text-gray-500 uppercase tracking-wider mb-3">
            Ordering {Math.min(animStep + 1, perms.length)} of {perms.length}
          </p>
          <div className="flex items-center justify-center gap-2 flex-wrap">
            {currentPerm.map((id, idx) => {
              const player = SHAPLEY_PLAYERS.find((p) => p.id === id)
              const coalition = currentPerm.slice(0, idx + 1)
              const prevCoalition = currentPerm.slice(0, idx)
              const mc = getCoalitionValue(coalition) - getCoalitionValue(prevCoalition)
              return (
                <div key={idx} className="flex items-center gap-2">
                  {idx > 0 && <span className="text-gray-700 text-xs">&rarr;</span>}
                  <div className="text-center">
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-mono font-bold"
                      style={{ background: `${player.color}20`, border: `1.5px solid ${player.color}`, color: player.color }}
                    >
                      {id}
                    </div>
                    <span className="text-[9px] font-mono text-gray-400 block mt-1">+{mc}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </GlassCard>
      )}

      {/* Shapley Results */}
      {animStep >= perms.length - 1 && (
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
          <GlassCard glowColor="matrix" spotlight className="p-5">
            <p className="text-[10px] font-mono text-gray-500 uppercase tracking-wider mb-4 text-center">
              Shapley Values (Fair Distribution of 100)
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {SHAPLEY_PLAYERS.map((p) => (
                <div key={p.id} className="text-center">
                  <motion.span
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: SHAPLEY_PLAYERS.indexOf(p) * 0.1 * PHI }}
                    className="text-2xl font-mono font-bold block"
                    style={{ color: p.color }}
                  >
                    {shapley[p.id].toFixed(1)}
                  </motion.span>
                  <span className="text-[9px] font-mono text-gray-500">{p.label}</span>
                  {/* Mini bar */}
                  <div className="mt-2 h-1 rounded-full bg-white/5 mx-auto max-w-[60px]">
                    <motion.div
                      className="h-full rounded-full"
                      style={{ background: p.color }}
                      initial={{ width: 0 }}
                      animate={{ width: `${shapley[p.id]}%` }}
                      transition={{ duration: 0.8, delay: 0.3 + SHAPLEY_PLAYERS.indexOf(p) * 0.1 }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-5 rounded-lg p-3" style={{ background: `${MATRIX}0a`, border: `1px solid ${MATRIX}22` }}>
              <p className="text-[11px] font-mono text-green-400/80 text-center">
                Rewards split by marginal contribution across all possible orderings.
                This is how VibeSwap's ShapleyDistributor allocates LP rewards -- not by pool share, but by actual value added.
              </p>
            </div>
          </GlassCard>
        </motion.div>
      )}
    </div>
  )
}

// ============ 6. MEV Elimination Proof ============

const MEV_TIMELINE = [
  { time: '0.0s', label: 'Batch Opens', desc: 'New 10-second batch begins. Commit phase starts.', phase: 'commit', side: 'protocol' },
  { time: '0.2s', label: 'Attacker Sees Mempool', desc: 'MEV bot sees a pending large buy order for ETH/USDC.', phase: 'commit', side: 'attacker' },
  { time: '0.3s', label: 'Front-Run Attempt', desc: 'Attacker submits hash(buy_order || secret_A). But the target order is ALSO just a hash.', phase: 'commit', side: 'attacker' },
  { time: '3.0s', label: 'More Commits', desc: '47 other traders submit their hashed orders. All are opaque.', phase: 'commit', side: 'protocol' },
  { time: '8.0s', label: 'Reveal Phase', desc: 'All traders reveal orders + secrets. Invalid reveals slashed 50%.', phase: 'reveal', side: 'protocol' },
  { time: '8.1s', label: 'Attacker Reveals', desc: 'Attacker reveals their buy order. But they had NO INFORMATION about other orders when committing.', phase: 'reveal', side: 'attacker' },
  { time: '9.0s', label: 'Shuffle', desc: 'Fisher-Yates shuffle using XOR of all secrets. Order execution sequence is deterministic but unpredictable.', phase: 'settle', side: 'protocol' },
  { time: '9.5s', label: 'Uniform Price', desc: 'ALL orders settle at a single clearing price. There is no spread to capture.', phase: 'settle', side: 'protocol' },
  { time: '10.0s', label: 'Settlement', desc: 'Attacker bought at the same price as everyone else. Sandwich attack = impossible. Profit = 0.', phase: 'settle', side: 'attacker' },
]

function MEVProofTab() {
  const [activeStep, setActiveStep] = useState(null)

  const phaseColor = (phase) => {
    if (phase === 'commit') return '#3b82f6'
    if (phase === 'reveal') return '#a855f7'
    return MATRIX
  }

  return (
    <div className="space-y-6">
      {/* Attack Scenario Header */}
      <GlassCard glowColor="warning" className="p-5">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-xl">{'\ud83e\udd69'}</span>
          <div>
            <h3 className="text-sm font-mono font-bold text-amber-400">Sandwich Attack Attempt</h3>
            <p className="text-[10px] font-mono text-gray-500">Attacker tries to front-run a large trade on VibeSwap</p>
          </div>
        </div>
        <p className="text-xs font-mono text-gray-400">
          In a traditional AMM, the attacker would: (1) buy before the victim, (2) let victim's trade push price up,
          (3) sell at higher price. On VibeSwap, watch what happens...
        </p>
      </GlassCard>

      {/* Timeline */}
      <div className="relative pl-6">
        {/* Vertical line */}
        <div className="absolute left-2.5 top-0 bottom-0 w-px" style={{ background: 'linear-gradient(to bottom, rgba(255,255,255,0.1), rgba(255,255,255,0.02))' }} />

        <div className="space-y-2">
          {MEV_TIMELINE.map((step, i) => {
            const isAttacker = step.side === 'attacker'
            const color = phaseColor(step.phase)
            const isActive = activeStep === i

            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 * PHI }}
              >
                <button
                  onClick={() => setActiveStep(isActive ? null : i)}
                  className="w-full text-left"
                >
                  <div
                    className="rounded-xl p-3 ml-3 transition-all relative"
                    style={{
                      background: isActive ? `${color}12` : isAttacker ? 'rgba(239,68,68,0.04)' : 'rgba(0,0,0,0.3)',
                      border: isActive ? `1px solid ${color}44` : isAttacker ? '1px solid rgba(239,68,68,0.12)' : '1px solid rgba(255,255,255,0.04)',
                    }}
                  >
                    {/* Timeline dot */}
                    <div
                      className="absolute -left-[18px] top-4 w-2.5 h-2.5 rounded-full"
                      style={{
                        background: isActive ? color : isAttacker ? '#ef4444' : 'rgba(255,255,255,0.15)',
                        boxShadow: isActive ? `0 0 8px ${color}88` : 'none',
                      }}
                    />

                    <div className="flex items-center gap-3 mb-1">
                      <span className="text-[10px] font-mono text-gray-600 flex-shrink-0 w-10">{step.time}</span>
                      <span className={`text-xs font-mono font-bold ${isAttacker ? 'text-red-400' : 'text-white'}`}>
                        {step.label}
                      </span>
                      <span
                        className="text-[8px] font-mono uppercase px-1.5 py-0.5 rounded-full ml-auto flex-shrink-0"
                        style={{ background: `${color}22`, color, border: `1px solid ${color}33` }}
                      >
                        {step.phase}
                      </span>
                    </div>

                    <AnimatePresence>
                      {isActive && (
                        <motion.p
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="text-xs font-mono text-gray-400 ml-[52px] leading-relaxed"
                        >
                          {step.desc}
                        </motion.p>
                      )}
                    </AnimatePresence>
                    {!isActive && (
                      <p className="text-[10px] font-mono text-gray-600 ml-[52px] truncate">{step.desc}</p>
                    )}
                  </div>
                </button>
              </motion.div>
            )
          })}
        </div>
      </div>

      {/* Verdict */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-xl p-4 text-center" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)' }}>
          <p className="text-[10px] font-mono text-gray-500 uppercase tracking-wider mb-1">Traditional AMM</p>
          <p className="text-lg font-mono font-bold text-red-400">$47k</p>
          <p className="text-[9px] font-mono text-gray-600">MEV extracted/day</p>
        </div>
        <div className="rounded-xl p-4 text-center" style={{ background: `${MATRIX}08`, border: `1px solid ${MATRIX}22` }}>
          <p className="text-[10px] font-mono text-gray-500 uppercase tracking-wider mb-1">VibeSwap</p>
          <p className="text-lg font-mono font-bold text-green-400">$0</p>
          <p className="text-[9px] font-mono text-gray-600">MEV extractable</p>
        </div>
        <div className="rounded-xl p-4 text-center" style={{ background: 'rgba(6,182,212,0.06)', border: '1px solid rgba(6,182,212,0.2)' }}>
          <p className="text-[10px] font-mono text-gray-500 uppercase tracking-wider mb-1">Mechanism</p>
          <p className="text-lg font-mono font-bold text-cyan-400">3-Layer</p>
          <p className="text-[9px] font-mono text-gray-600">Commit + Shuffle + Uniform</p>
        </div>
      </div>

      <div className="rounded-xl p-4" style={{ background: `${MATRIX}08`, border: `1px solid ${MATRIX}20` }}>
        <p className="text-xs font-mono text-green-400/80 text-center leading-relaxed">
          MEV elimination is not a feature. It is an emergent property of three interlocking mechanisms:
          cryptographic commitment (hides intent), Fisher-Yates shuffle (randomizes execution order),
          and uniform clearing price (eliminates price discrimination). The cancer never forms.
        </p>
      </div>
    </div>
  )
}

// ============ Stats Data ============

const STATS = [
  { label: 'Axelrod Tournament Strategies', value: 62, prefix: '', suffix: '+', decimals: 0, sparkSeed: 7 },
  { label: 'MEV Extracted Daily (Ethereum)', value: 4.7, prefix: '$', suffix: 'M', decimals: 1, sparkSeed: 13 },
  { label: 'Shapley Orderings (4 players)', value: 24, prefix: '', suffix: '', decimals: 0, sparkSeed: 19 },
  { label: 'Batch Settlement Time', value: 10, prefix: '', suffix: 's', decimals: 0, sparkSeed: 23 },
]

// ============ Main Component ============

function GameTheoryPage() {
  const [activeTab, setActiveTab] = useState('prisoners')

  const renderTab = useCallback(() => {
    switch (activeTab) {
      case 'prisoners': return <PrisonersDilemmaTab />
      case 'nash': return <NashEquilibriumTab />
      case 'auctions': return <AuctionTypesTab />
      case 'titfortat': return <TitForTatTab />
      case 'shapley': return <ShapleyValueTab />
      case 'mev': return <MEVProofTab />
      default: return null
    }
  }, [activeTab])

  return (
    <div className="min-h-screen pb-20">
      {/* ============ Background Particles ============ */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        {Array.from({ length: 18 }).map((_, i) => {
          const rng = seededRandom(i * 137)
          return (
            <motion.div
              key={i}
              className="absolute w-px h-px rounded-full"
              style={{
                background: i % 3 === 0 ? MATRIX : i % 3 === 1 ? CYAN : AMBER,
                left: `${(rng() * 100)}%`,
                top: `${(rng() * 100)}%`,
              }}
              animate={{
                opacity: [0, 0.4, 0],
                scale: [0, 1.5, 0],
                y: [0, -60 - (i % 5) * 30],
              }}
              transition={{
                duration: 3 + (i % 4) * PHI,
                repeat: Infinity,
                delay: rng() * 4,
                ease: 'easeOut',
              }}
            />
          )
        })}
      </div>

      <div className="relative z-10 max-w-4xl mx-auto px-4">
        {/* ============ Hero ============ */}
        <PageHero
          title="Game Theory"
          subtitle="Why cooperation emerges from selfish actors -- and how VibeSwap makes defection structurally irrational."
          category="knowledge"
          badge="Interactive"
          badgeColor={MATRIX}
        />

        {/* ============ Stats Row ============ */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          {STATS.map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 + i * 0.08 * PHI }}
            >
              <StatCard
                label={stat.label}
                value={stat.value}
                prefix={stat.prefix}
                suffix={stat.suffix}
                decimals={stat.decimals}
                sparkSeed={stat.sparkSeed}
                size="sm"
              />
            </motion.div>
          ))}
        </div>

        {/* ============ Tab Navigation ============ */}
        <div className="flex flex-wrap gap-1.5 mb-6 p-1 rounded-xl" style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.04)' }}>
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-mono transition-all ${
                activeTab === tab.id
                  ? 'bg-green-500/15 text-green-400 font-bold'
                  : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
              }`}
              style={activeTab === tab.id ? { border: `1px solid ${MATRIX}33`, boxShadow: `0 0 12px ${MATRIX}11` } : { border: '1px solid transparent' }}
            >
              <span className="text-sm">{tab.icon}</span>
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          ))}
        </div>

        {/* ============ Active Tab Content ============ */}
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            variants={tabV}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            {renderTab()}
          </motion.div>
        </AnimatePresence>

        {/* ============ Footer ============ */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.5, duration: 1 }}
          className="mt-16 text-center pb-8"
        >
          <div className="flex items-center justify-center gap-4 mb-6">
            <div className="flex-1 h-px max-w-[120px]" style={{ background: `linear-gradient(90deg, transparent, ${MATRIX}4d)` }} />
            <div className="w-2 h-2 rounded-full" style={{ background: `${MATRIX}66` }} />
            <div className="flex-1 h-px max-w-[120px]" style={{ background: `linear-gradient(90deg, ${MATRIX}4d, transparent)` }} />
          </div>
          <blockquote className="max-w-lg mx-auto">
            <p className="text-sm text-gray-400 italic leading-relaxed font-mono">
              "To remove wasteful 3rd parties but still achieve trust benefits,
              you need to program markets based on selfish behavior."
            </p>
            <footer className="mt-4">
              <div className="w-16 h-px mx-auto mb-3" style={{ background: `linear-gradient(90deg, transparent, ${MATRIX}66, transparent)` }} />
              <p className="text-[10px] font-mono text-gray-600 tracking-widest uppercase">
                Cooperative Capitalism
              </p>
            </footer>
          </blockquote>
        </motion.div>
      </div>
    </div>
  )
}

export default GameTheoryPage