import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// ============ Mario Kart-Style Fairness Training ============
// Users race as traders. Each round demonstrates a VibeSwap fairness primitive.
// The "track" is a batch auction. MEV bots try to cheat. The protocol stops them.

const TRACK_LENGTH = 100 // percentage units

const RACERS = [
  { id: 'you', name: 'You', color: '#10b981', emoji: '🏎️' },
  { id: 'alice', name: 'Alice', color: '#3b82f6', emoji: '🚗' },
  { id: 'bob', name: 'Bob', color: '#f59e0b', emoji: '🚙' },
  { id: 'mev_bot', name: 'MEV Bot', color: '#ef4444', emoji: '🤖' },
]

const LESSONS = [
  {
    id: 'frontrun',
    title: 'Lesson 1: Front-Running',
    subtitle: 'The MEV Bot sees your trade and jumps ahead',
    scenario: 'traditional',
    description: 'On a traditional DEX, the MEV bot sees your pending swap in the mempool. It places a buy order BEFORE yours, driving up the price. You get a worse deal. The bot profits from your loss.',
    vibeswapFix: 'Commit-Reveal: Your order is encrypted (hashed) during the commit phase. Nobody — not even the MEV bot — can see what you\'re trading until the reveal phase. The bot is racing blind.',
    primitive: 'P-001: Temporal decoupling eliminates information advantage',
    // In traditional: MEV bot races ahead. In VibeSwap: all finish together.
    traditional: { mevAdvantage: 30, yourPenalty: -15 },
  },
  {
    id: 'sandwich',
    title: 'Lesson 2: Sandwich Attack',
    subtitle: 'The MEV Bot surrounds your trade',
    scenario: 'traditional',
    description: 'The MEV bot places a buy BEFORE your trade (front-run) and a sell AFTER (back-run). Your trade is "sandwiched" — you buy at an inflated price, and the bot immediately sells for profit.',
    vibeswapFix: 'Batch Auctions: All orders in a 10-second batch are shuffled using Fisher-Yates (with XORed user secrets as randomness). There is no "before" or "after" — all trades execute simultaneously at the same clearing price.',
    primitive: 'P-005: Defense-in-depth is composition, not redundancy',
    traditional: { mevAdvantage: 40, yourPenalty: -20 },
  },
  {
    id: 'ordering',
    title: 'Lesson 3: Transaction Ordering',
    subtitle: 'Miners pick who goes first',
    scenario: 'traditional',
    description: 'On traditional DEXes, miners/validators decide transaction order. They can be bribed to put specific transactions first. This is "priority gas auctions" — a pay-to-win mechanic.',
    vibeswapFix: 'Deterministic Shuffle: After the reveal phase, all orders are shuffled using Fisher-Yates with combined secrets. The order is deterministic (verifiable) but unpredictable before reveals. No one controls the sequence.',
    primitive: 'P-070: Deterministic randomness from untrusted sources',
    traditional: { mevAdvantage: 25, yourPenalty: -10 },
  },
  {
    id: 'clearing',
    title: 'Lesson 4: Price Manipulation',
    subtitle: 'Big traders get better prices',
    scenario: 'traditional',
    description: 'On AMMs, each swap moves the price. First swapper gets the best price, last swapper gets the worst. Large orders cause massive slippage for everyone after them.',
    vibeswapFix: 'Uniform Clearing Price: ALL traders in a batch get the SAME price. It doesn\'t matter if you\'re swapping $10 or $10M — same price, same fairness. The price is computed from aggregate supply and demand.',
    primitive: 'P-011: Shapley fairness replaces politics',
    traditional: { mevAdvantage: 35, yourPenalty: -25 },
  },
  {
    id: 'flash',
    title: 'Lesson 5: Flash Loan Attacks',
    subtitle: 'Infinite capital, zero risk',
    scenario: 'traditional',
    description: 'Flash loans let attackers borrow millions for one transaction, manipulate prices, and repay — all atomically. Zero risk, pure extraction.',
    vibeswapFix: 'EOA-Only Commits: Only externally owned accounts (real wallets) can commit orders. Smart contracts can\'t participate in the commit phase. Flash loans require contract execution, so they\'re structurally impossible.',
    primitive: 'P-038: Flash loans are the test of every mechanism',
    traditional: { mevAdvantage: 50, yourPenalty: -30 },
  },
]

function RaceTrack({ positions, phase, showResult }) {
  return (
    <div className="relative w-full rounded-xl overflow-hidden bg-black-900 border border-black-600 p-4">
      {/* Track header */}
      <div className="flex justify-between text-[10px] text-black-500 mb-1 px-1">
        <span>START</span>
        <span>FINISH</span>
      </div>

      {/* Track lanes */}
      <div className="space-y-2">
        {RACERS.map((racer) => {
          const pos = positions[racer.id] || 0
          const isMEV = racer.id === 'mev_bot'
          const isYou = racer.id === 'you'

          return (
            <div key={racer.id} className="relative">
              {/* Lane */}
              <div className="h-10 rounded-lg bg-black-800 border border-black-700 relative overflow-hidden">
                {/* Lane stripes */}
                <div className="absolute inset-0 flex">
                  {Array.from({ length: 20 }).map((_, i) => (
                    <div key={i} className="flex-1 border-r border-black-700/30" />
                  ))}
                </div>

                {/* Finish line */}
                <div className="absolute right-0 top-0 bottom-0 w-1 bg-white/20" style={{
                  background: 'repeating-linear-gradient(0deg, white 0px, white 4px, black 4px, black 8px)',
                  opacity: 0.3,
                }} />

                {/* Racer */}
                <motion.div
                  className="absolute top-1 bottom-1 flex items-center"
                  animate={{ left: `${Math.min(pos, 95)}%` }}
                  transition={{ type: 'spring', stiffness: 100, damping: 20 }}
                >
                  <div className={`
                    flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-bold whitespace-nowrap
                    ${isMEV && pos > 50 ? 'bg-red-500/20 border border-red-500/50' : ''}
                    ${isYou ? 'bg-emerald-500/20 border border-emerald-500/50' : ''}
                    ${!isMEV && !isYou ? 'bg-black-700 border border-black-600' : ''}
                  `}>
                    <span>{racer.emoji}</span>
                    <span style={{ color: racer.color }}>{racer.name}</span>
                  </div>
                </motion.div>

                {/* Blocked indicator for MEV bot */}
                {isMEV && showResult === 'vibeswap' && pos < 10 && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-red-400 text-xs font-bold flex items-center gap-1"
                  >
                    <span>🛡️</span> BLOCKED
                  </motion.div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Phase indicator */}
      <div className="mt-3 flex justify-center">
        <div className={`
          px-3 py-1 rounded-full text-xs font-bold tracking-wider
          ${phase === 'commit' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' : ''}
          ${phase === 'reveal' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : ''}
          ${phase === 'settle' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : ''}
          ${phase === 'idle' ? 'bg-black-700 text-black-400 border border-black-600' : ''}
          ${phase === 'racing' ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30' : ''}
        `}>
          {phase === 'commit' && '🔒 COMMIT PHASE — Orders encrypted'}
          {phase === 'reveal' && '🔓 REVEAL PHASE — Secrets revealed'}
          {phase === 'settle' && '⚖️ SETTLEMENT — Uniform clearing price'}
          {phase === 'idle' && 'Ready to race'}
          {phase === 'racing' && '🏁 Traditional DEX — No protection'}
        </div>
      </div>
    </div>
  )
}

export default function FairnessRace() {
  const [currentLesson, setCurrentLesson] = useState(0)
  const [mode, setMode] = useState(null) // null | 'traditional' | 'vibeswap'
  const [phase, setPhase] = useState('idle')
  const [positions, setPositions] = useState({ you: 0, alice: 0, bob: 0, mev_bot: 0 })
  const [showResult, setShowResult] = useState(null)
  const [score, setScore] = useState({ traditional: 0, vibeswap: 0 })
  const [isRunning, setIsRunning] = useState(false)
  const intervalRef = useRef(null)

  const lesson = LESSONS[currentLesson]

  const resetRace = useCallback(() => {
    setPositions({ you: 0, alice: 0, bob: 0, mev_bot: 0 })
    setPhase('idle')
    setShowResult(null)
    setMode(null)
    setIsRunning(false)
    if (intervalRef.current) clearInterval(intervalRef.current)
  }, [])

  const runTraditional = useCallback(() => {
    resetRace()
    setMode('traditional')
    setIsRunning(true)
    setPhase('racing')

    const { mevAdvantage, yourPenalty } = lesson.traditional
    let tick = 0

    intervalRef.current = setInterval(() => {
      tick++
      setPositions(prev => ({
        you: Math.min(prev.you + 2 + yourPenalty * 0.05, TRACK_LENGTH),
        alice: Math.min(prev.alice + 2.5, TRACK_LENGTH),
        bob: Math.min(prev.bob + 2.2, TRACK_LENGTH),
        mev_bot: Math.min(prev.mev_bot + 3 + mevAdvantage * 0.08, TRACK_LENGTH),
      }))

      if (tick >= 25) {
        clearInterval(intervalRef.current)
        setPositions({ mev_bot: 100, alice: 75, bob: 70, you: 55 + yourPenalty })
        setShowResult('traditional')
        setIsRunning(false)
        setScore(prev => ({ ...prev, traditional: prev.traditional + yourPenalty }))
      }
    }, 120)
  }, [lesson, resetRace])

  const runVibeSwap = useCallback(() => {
    resetRace()
    setMode('vibeswap')
    setIsRunning(true)

    // Phase 1: Commit (orders encrypted)
    setPhase('commit')
    setTimeout(() => {
      setPositions({ you: 20, alice: 20, bob: 20, mev_bot: 5 })
    }, 500)

    // Phase 2: Reveal
    setTimeout(() => {
      setPhase('reveal')
      setPositions({ you: 50, alice: 50, bob: 50, mev_bot: 5 })
    }, 2000)

    // Phase 3: Settlement (everyone gets same price)
    setTimeout(() => {
      setPhase('settle')
      setPositions({ you: 100, alice: 100, bob: 100, mev_bot: 5 })
      setShowResult('vibeswap')
      setIsRunning(false)
      setScore(prev => ({ ...prev, vibeswap: prev.vibeswap + 10 }))
    }, 3500)
  }, [resetRace])

  // Cleanup interval on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  return (
    <div className="w-full max-w-3xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="text-center mb-6">
        <h1 className="text-2xl font-bold text-white mb-1">Fairness Race</h1>
        <p className="text-sm text-black-400">Learn how VibeSwap protects you — Mario Kart style</p>
      </div>

      {/* Lesson selector */}
      <div className="flex gap-1 mb-6 overflow-x-auto pb-2">
        {LESSONS.map((l, i) => (
          <button
            key={l.id}
            onClick={() => { setCurrentLesson(i); resetRace() }}
            disabled={isRunning}
            className={`
              flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold transition-all
              ${i === currentLesson
                ? 'bg-matrix-500/20 text-matrix-400 border border-matrix-500/50'
                : 'bg-black-800 text-black-400 border border-black-600 hover:border-black-500'
              }
              ${isRunning ? 'opacity-50 cursor-not-allowed' : ''}
            `}
          >
            {i + 1}
          </button>
        ))}
      </div>

      {/* Current lesson info */}
      <div className="mb-4 p-4 rounded-xl bg-black-800 border border-black-600">
        <h2 className="text-lg font-bold text-white mb-1">{lesson.title}</h2>
        <p className="text-sm text-black-400 mb-3">{lesson.subtitle}</p>
        <p className="text-xs text-black-300 leading-relaxed">{lesson.description}</p>
      </div>

      {/* Race Track */}
      <RaceTrack positions={positions} phase={phase} showResult={showResult} />

      {/* Race controls */}
      <div className="mt-4 flex gap-3 justify-center">
        <button
          onClick={runTraditional}
          disabled={isRunning}
          className={`
            px-5 py-2.5 rounded-xl text-sm font-bold transition-all
            ${isRunning
              ? 'bg-black-700 text-black-500 cursor-not-allowed'
              : 'bg-red-500/20 text-red-400 border border-red-500/40 hover:bg-red-500/30 active:scale-95'
            }
          `}
        >
          Race on Traditional DEX
        </button>
        <button
          onClick={runVibeSwap}
          disabled={isRunning}
          className={`
            px-5 py-2.5 rounded-xl text-sm font-bold transition-all
            ${isRunning
              ? 'bg-black-700 text-black-500 cursor-not-allowed'
              : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 hover:bg-emerald-500/30 active:scale-95'
            }
          `}
        >
          Race on VibeSwap
        </button>
      </div>

      {/* Result panel */}
      <AnimatePresence>
        {showResult && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className={`
              mt-4 p-4 rounded-xl border
              ${showResult === 'traditional'
                ? 'bg-red-500/5 border-red-500/30'
                : 'bg-emerald-500/5 border-emerald-500/30'
              }
            `}
          >
            {showResult === 'traditional' ? (
              <>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-red-400 font-bold text-sm">MEV Bot wins. You lose value.</span>
                </div>
                <p className="text-xs text-black-300 mb-3">
                  The MEV bot saw your trade, front-ran it, and extracted {Math.abs(lesson.traditional.yourPenalty)}% of your value.
                  This happens on every traditional DEX, every single block.
                </p>
                <p className="text-xs text-black-400 italic">
                  Now try racing on VibeSwap to see the difference.
                </p>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-emerald-400 font-bold text-sm">Fair finish. Everyone gets the same price.</span>
                </div>
                <p className="text-xs text-black-300 mb-3">
                  {lesson.vibeswapFix}
                </p>
                <div className="mt-2 px-3 py-2 rounded-lg bg-black-800 border border-black-600">
                  <p className="text-[10px] text-matrix-400 font-mono">{lesson.primitive}</p>
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Score */}
      <div className="mt-6 flex justify-center gap-6">
        <div className="text-center">
          <div className="text-xs text-black-500 mb-1">Traditional DEX</div>
          <div className={`text-lg font-bold ${score.traditional < 0 ? 'text-red-400' : 'text-black-300'}`}>
            {score.traditional > 0 ? '+' : ''}{score.traditional}
          </div>
        </div>
        <div className="text-center">
          <div className="text-xs text-black-500 mb-1">VibeSwap</div>
          <div className="text-lg font-bold text-emerald-400">
            +{score.vibeswap}
          </div>
        </div>
      </div>

      {/* Navigation */}
      <div className="mt-6 flex justify-between">
        <button
          onClick={() => { setCurrentLesson(Math.max(0, currentLesson - 1)); resetRace() }}
          disabled={currentLesson === 0 || isRunning}
          className="px-4 py-2 rounded-lg text-xs font-bold bg-black-800 text-black-400 border border-black-600 disabled:opacity-30"
        >
          Previous
        </button>
        <span className="text-xs text-black-500 self-center">{currentLesson + 1} / {LESSONS.length}</span>
        <button
          onClick={() => { setCurrentLesson(Math.min(LESSONS.length - 1, currentLesson + 1)); resetRace() }}
          disabled={currentLesson === LESSONS.length - 1 || isRunning}
          className="px-4 py-2 rounded-lg text-xs font-bold bg-matrix-500/20 text-matrix-400 border border-matrix-500/40 disabled:opacity-30"
        >
          Next Lesson
        </button>
      </div>
    </div>
  )
}
