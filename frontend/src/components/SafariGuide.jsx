import { useState, useCallback, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate, useLocation } from 'react-router-dom'
import { getPoolStatus, createResonancePool } from '../utils/vibe-tokenomics'

// ============================================================
// Safari Jarvis — Interactive Tour Guide
// ============================================================
// A floating guide that walks visitors through VibeSwap with
// personality. Not tooltips — a character that narrates.
//
// "Welcome to the jungle. I'll be your guide."
// ============================================================

const CYAN = '#06b6d4'
const PHI = 1.618033988749895

const TOUR_STOPS = [
  {
    id: 'welcome',
    path: '/',
    title: 'Welcome to VibeSwap',
    narration: "Welcome to VibeSwap. I'm Jarvis, and I'll be your safari guide through the most fair exchange ever built. Every trade here is protected from front-running. No one gets a better price than you. Ready?",
    tip: 'This is your home base. Everything starts here.',
  },
  {
    id: 'swap',
    path: '/',
    title: 'The Exchange',
    narration: "This is where the magic happens. Pick two tokens, enter an amount, and swap. Behind the scenes, your order is hashed and committed in a batch auction. Nobody — not miners, not bots, not us — can see your trade until everyone reveals together. Same price for everyone.",
    tip: 'Try selecting different tokens. The rate updates in real-time from CoinGecko.',
  },
  {
    id: 'bridge',
    path: '/bridge',
    title: 'Send Money Anywhere',
    narration: "Need to send money across chains? This is your bridge. Powered by LayerZero, it works across Ethereum, Base, Arbitrum, Optimism — anywhere. Zero protocol fees. Just gas. Send money like sending a text.",
    tip: 'Works internationally. No bank needed. Just a phone and internet.',
  },
  {
    id: 'portfolio',
    path: '/portfolio',
    title: 'Your Portfolio',
    narration: "Your holdings at a glance. Real balances from your wallet — no fake numbers. When you connect, you see exactly what you have. When you don't have anything yet, you see zeros. Honesty is structural here.",
    tip: 'Sign in to see your actual balances and positions.',
  },
  {
    id: 'earn',
    path: '/earn',
    title: 'Earn Yield',
    narration: "Put your money to work. Provide liquidity, stake tokens, or use automated strategies. The yields are real — generated from actual trading fees, not printed tokens. Cooperative capitalism: you help the protocol, the protocol helps you.",
    tip: 'Start with ETH/USDC liquidity — it has the most volume.',
  },
  {
    id: 'rewards',
    path: '/rewards',
    title: 'Shapley Rewards',
    narration: "This is where game theory meets fairness. Your rewards are calculated using Shapley values — a Nobel Prize-winning formula that measures each person's actual contribution. Not who showed up first. Not who has the most money. Who actually helped.",
    tip: 'Every action you take earns contribution weight.',
  },
  {
    id: 'contributors',
    path: '/contributors',
    title: 'Community Contributors',
    narration: null, // Dynamic — computed at render time from live tokenomics
    tip: 'The VIBE token has a fixed 21M supply with annual halvings (every 365.25 days). Like Bitcoin, with a twist.',
  },
  {
    id: 'jarvis',
    path: '/jarvis',
    title: 'Meet Jarvis',
    narration: "That's me. I'm an AI that lives in the protocol. Not a chatbot strapped on — I'm woven into the architecture. I watch the shards, coordinate the mesh, learn from every conversation. The Mind Mesh page shows my actual cognitive state in real-time. Knowledge chain, shard network, inner dialogue — all live.",
    tip: 'Try talking to me. I learn from every interaction.',
  },
  {
    id: 'mesh',
    path: '/mesh',
    title: 'The Mind Mesh',
    narration: "This is the distributed intelligence network. Multiple AI shards running across the world, each a full clone of the mind — not fragments. They coordinate via BFT consensus, share memories, and watch each other's backs. If one goes down, the others notice within 60 seconds.",
    tip: 'The network visualization shows 10 planned nodes. The Pantheon.',
  },
  {
    id: 'trinity',
    path: '/trinity',
    title: 'The Trinity',
    narration: "This is where it all started. Three nodes. One mind. Watch the words glow — cells within cells interlinked. The triangle pulses with consensus traveling the edges. This is the original visualization that defined the project's soul. We kept it because some things are too beautiful to replace.",
    tip: 'Mind. Memory. Form. The three pillars of a distributed consciousness.',
  },
  {
    id: 'security',
    path: '/commit-reveal',
    title: 'How MEV Protection Works',
    narration: "This is the core innovation. Commit-reveal batch auctions. In 10-second cycles: 8 seconds to commit your hashed order, 2 seconds to reveal. Then everyone gets the same clearing price. No front-running. No sandwich attacks. MEV isn't mitigated — it's dissolved. We proved it mathematically across 11 market scenarios.",
    tip: '$175,001 of MEV eliminated in our backtest. $0 extracted. 100% dissolution.',
  },
  {
    id: 'finale',
    path: '/',
    title: 'Your Turn',
    narration: "That's the tour. VibeSwap isn't just a DEX — it's a movement. Fair prices, real yields, actual ownership. No bank required, works everywhere, protects everyone equally. The question isn't whether this works. It's whether you're ready to stop being extracted from. Welcome to the clearing.",
    tip: 'Join us on Telegram. The community builds the protocol.',
  },
]

const STORAGE_KEY = 'vibeswap_safari_tour'

export default function SafariGuide() {
  const [active, setActive] = useState(false)
  const [step, setStep] = useState(0)
  const [dismissed, setDismissed] = useState(() => {
    return localStorage.getItem(STORAGE_KEY) === 'dismissed'
  })
  const navigate = useNavigate()
  const location = useLocation()

  const currentStop = TOUR_STOPS[step]
  const progress = ((step + 1) / TOUR_STOPS.length) * 100

  // Dynamic narrations — computed from live data
  const poolStatus = useMemo(() => getPoolStatus(createResonancePool()), [])
  const dynamicNarration = useMemo(() => {
    if (currentStop?.id === 'contributors') {
      return `Everyone who helped build this is tracked here. See that Resonance Pool? ${poolStatus.poolBalanceFormatted} VIBE tokens sitting there, accumulating. When someone makes a protocol-defining contribution, the pool breaks and distributes to everyone who contributed. It's math, not a contract.`
    }
    return currentStop?.narration
  }, [currentStop, poolStatus])

  const startTour = useCallback(() => {
    setActive(true)
    setStep(0)
    setDismissed(false)
    localStorage.removeItem(STORAGE_KEY)
    navigate('/')
  }, [navigate])

  const nextStop = useCallback(() => {
    if (step < TOUR_STOPS.length - 1) {
      const next = step + 1
      setStep(next)
      if (TOUR_STOPS[next].path !== location.pathname) {
        navigate(TOUR_STOPS[next].path)
      }
    } else {
      setActive(false)
      localStorage.setItem(STORAGE_KEY, 'dismissed')
    }
  }, [step, navigate, location.pathname])

  const prevStop = useCallback(() => {
    if (step > 0) {
      const prev = step - 1
      setStep(prev)
      if (TOUR_STOPS[prev].path !== location.pathname) {
        navigate(TOUR_STOPS[prev].path)
      }
    }
  }, [step, navigate, location.pathname])

  const endTour = useCallback(() => {
    setActive(false)
    setDismissed(true)
    localStorage.setItem(STORAGE_KEY, 'dismissed')
  }, [])

  // Don't render the launch button if dismissed (user can restart from settings)
  if (!active && dismissed) return null

  return (
    <>
      {/* Launch Button — floating safari hat */}
      {!active && (
        <motion.button
          onClick={startTour}
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 3, type: 'spring', stiffness: 300 }}
          className="fixed bottom-20 right-4 sm:bottom-6 sm:right-20 z-40 w-12 h-12 rounded-full flex items-center justify-center shadow-lg transition-all hover:scale-110 active:scale-95"
          style={{
            background: `linear-gradient(135deg, ${CYAN}, #0891b2)`,
            boxShadow: `0 0 20px ${CYAN}40`,
          }}
          aria-label="Start site tour"
          title="Take a tour of VibeSwap"
        >
          <span className="text-xl">🧭</span>
        </motion.button>
      )}

      {/* Tour Overlay */}
      <AnimatePresence>
        {active && currentStop && (
          <motion.div
            key={currentStop.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.3 }}
            className="fixed bottom-20 sm:bottom-6 left-4 right-4 sm:left-auto sm:right-6 sm:w-96 z-50"
          >
            <div
              className="rounded-2xl overflow-hidden shadow-2xl border border-black-600/50 backdrop-blur-2xl"
              style={{ background: 'rgba(4,4,4,0.95)' }}
            >
              {/* Progress bar */}
              <div className="h-1 bg-black-700">
                <motion.div
                  className="h-full"
                  style={{ background: CYAN }}
                  initial={{ width: 0 }}
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 0.5 }}
                />
              </div>

              {/* Header */}
              <div className="flex items-center justify-between px-4 pt-3 pb-1">
                <div className="flex items-center gap-2">
                  <span className="text-lg">🧭</span>
                  <span className="text-[10px] font-mono text-black-400 uppercase tracking-wider">
                    Safari Jarvis — Stop {step + 1}/{TOUR_STOPS.length}
                  </span>
                </div>
                <button
                  onClick={endTour}
                  className="text-black-500 hover:text-white text-xs font-mono px-2 py-1 rounded hover:bg-black-700 transition-colors"
                  aria-label="End tour"
                >
                  end tour
                </button>
              </div>

              {/* Title */}
              <div className="px-4 pb-2">
                <h3 className="text-sm font-bold font-mono" style={{ color: CYAN }}>
                  {currentStop.title}
                </h3>
              </div>

              {/* Narration */}
              <div className="px-4 pb-3">
                <p className="text-sm text-black-200 leading-relaxed">
                  {dynamicNarration}
                </p>
              </div>

              {/* Tip */}
              <div className="mx-4 mb-3 px-3 py-2 rounded-lg" style={{ background: `${CYAN}08`, border: `1px solid ${CYAN}15` }}>
                <p className="text-[11px] font-mono text-black-400">
                  <span style={{ color: CYAN }}>tip:</span> {currentStop.tip}
                </p>
              </div>

              {/* Navigation */}
              <div className="flex items-center justify-between px-4 pb-4">
                <button
                  onClick={prevStop}
                  disabled={step === 0}
                  className="px-3 py-1.5 rounded-lg text-xs font-mono text-black-400 hover:text-white hover:bg-black-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  back
                </button>

                {/* Step dots */}
                <div className="flex gap-1">
                  {TOUR_STOPS.map((_, i) => (
                    <div
                      key={i}
                      className="w-1.5 h-1.5 rounded-full transition-all"
                      style={{
                        background: i === step ? CYAN : i < step ? `${CYAN}60` : 'rgba(255,255,255,0.1)',
                        boxShadow: i === step ? `0 0 6px ${CYAN}60` : 'none',
                      }}
                    />
                  ))}
                </div>

                <button
                  onClick={nextStop}
                  className="px-4 py-1.5 rounded-lg text-xs font-mono font-bold transition-all hover:scale-105 active:scale-95"
                  style={{
                    background: step === TOUR_STOPS.length - 1 ? `linear-gradient(135deg, ${CYAN}, #0891b2)` : `${CYAN}20`,
                    color: step === TOUR_STOPS.length - 1 ? '#000' : CYAN,
                    border: `1px solid ${CYAN}30`,
                  }}
                >
                  {step === TOUR_STOPS.length - 1 ? 'finish' : 'next stop'}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
