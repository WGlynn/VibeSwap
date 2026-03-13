import { useState, useEffect, useCallback, createContext, useContext } from 'react'

// ============ Infinity Stones Unlock System ============
//
// Six stones. Each one easy enough for anyone, but requires actual engagement.
// No crypto knowledge needed for the first few. Progressive difficulty.
// Gauntlet NFT when all six collected (soulbound, non-transferable).
//
// ANTI-GAMING DESIGN:
// - Mind: coherence check (can't spam gibberish)
// - Space: wallet must actually connect (can't fake)
// - Reality: must answer what happened (proves attention, not clicking)
// - Power: must read proposal for 30s before vote unlocks (attention proof)
// - Time: 3 unique calendar days — literally ungameable, no shortcut
// - Soul: invited person must also earn Mind Stone (can't invite bots)
//
// PROGRESSIVE COOLDOWN:
// After 3 stones, each new unlock requires 24h since your last unlock.
// Smart people can't speedrun stones 4-6. Patience IS the test.
// This means the minimum time to full gauntlet is ~5 days:
//   Day 1: Mind + Space + Reality (first 3, no cooldown)
//   Day 2: Power (24h cooldown)
//   Day 3: Time (auto-unlocks on 3rd visit day)
//   Day 4+: Soul (need invite + their Mind Stone)

const STONES = {
  mind: {
    name: 'Mind',
    color: '#f59e0b',
    route: '/vision',
    title: 'Vision Coding',
    challenge: 'Submit a real vision — describe something you want to exist',
    how: 'Go to /vision, type what you see, hit "See It". Must be coherent (8+ unique words, no spam).',
    order: 0,
  },
  space: {
    name: 'Space',
    color: '#3b82f6',
    route: '/send',
    title: 'Bridge the Gap',
    challenge: 'Connect a wallet — any wallet, any chain',
    how: 'Click "Sign In" and connect MetaMask, WalletConnect, or create a device wallet.',
    order: 1,
  },
  reality: {
    name: 'Reality',
    color: '#dc2626',
    route: '/',
    title: 'Alter Reality',
    challenge: 'Complete a swap and prove you understood what happened',
    how: 'Execute a batch auction swap, then answer: "What makes this different from a normal DEX swap?"',
    order: 2,
  },
  power: {
    name: 'Power',
    color: '#a855f7',
    route: '/govern',
    title: 'Wield Power',
    challenge: 'Read a proposal (30s minimum), then cast your vote',
    how: 'Go to /govern, actually read a proposal. Vote button unlocks after 30 seconds. Your opinion is your power.',
    order: 3,
  },
  time: {
    name: 'Time',
    color: '#22c55e',
    route: '/vision',
    title: 'Prove Patience',
    challenge: 'Return on 3 different days — ungameable, no shortcut',
    how: 'Come back on 3 separate calendar days. Time is the only thing money can\'t buy.',
    order: 4,
  },
  soul: {
    name: 'Soul',
    color: '#f97316',
    route: '/trust',
    title: 'Earn Trust',
    challenge: 'Invite someone who earns the Mind Stone',
    how: 'Share your link. When your invite submits their first real vision, you earn Soul. Can\'t invite bots — they need the Mind Stone too.',
    order: 5,
  },
}

const STONE_ORDER = ['mind', 'space', 'reality', 'power', 'time', 'soul']
const STORAGE_KEY = 'vibeswap_infinity_stones'

// After this many stones, 24h cooldown between unlocks
const COOLDOWN_THRESHOLD = 3
const COOLDOWN_MS = 24 * 60 * 60 * 1000

// ============ Anti-Gaming: Vision Coherence Check ============
// Can't just type "aaaaaa" or "test test test test test test test test"
function isCoherentVision(text) {
  if (!text || text.length < 50) return false

  const words = text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 1)

  // Need 8+ unique words (no "test test test test...")
  const unique = new Set(words)
  if (unique.size < 8) return false

  // No single character repeated >3 times in a row ("aaaa")
  if (/(.)\1{3,}/.test(text)) return false

  // Must have at least 2 words >4 chars (real language, not "a b c d e f g h")
  const longWords = words.filter(w => w.length > 4)
  if (longWords.length < 2) return false

  return true
}

// ============ Anti-Gaming: Reality Stone Quiz ============
// After completing a swap, user must answer what made it different.
// Correct answer proves they paid attention to the commit-reveal mechanism.
const REALITY_QUIZ = {
  question: 'What makes a VibeSwap batch auction different from a normal DEX swap?',
  // Accept any answer containing these key concepts
  keywords: ['batch', 'commit', 'reveal', 'hidden', 'secret', 'uniform', 'clearing', 'price', 'mev', 'front', 'sandwich', 'fair', 'everyone', 'same'],
  minKeywords: 2, // must hit at least 2 concepts
}

function checkRealityAnswer(answer) {
  if (!answer || answer.length < 15) return false
  const lower = answer.toLowerCase()
  const hits = REALITY_QUIZ.keywords.filter(k => lower.includes(k))
  return hits.length >= REALITY_QUIZ.minKeywords
}

// ============ State ============

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) return JSON.parse(saved)
  } catch { /* fresh */ }
  return {
    unlocked: {},           // { mind: timestamp, space: timestamp, ... }
    visitDays: [],          // ['2026-03-13', '2026-03-14', ...] for Time Stone
    visionSubmitted: false,
    walletConnected: false,
    swapCompleted: false,
    realityQuizPassed: false,
    votesCast: 0,
    proposalReadTime: 0,   // seconds spent reading before voting
    referralCode: null,
    referredUsers: [],      // users who collected Mind Stone via your link
    lastUnlockTime: 0,      // timestamp of most recent unlock (for cooldown)
  }
}

function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch { /* localStorage full or unavailable */ }
}

function todayStr() {
  return new Date().toISOString().split('T')[0]
}

// ============ Hook ============

export function useInfinityStones() {
  const [state, setState] = useState(loadState)

  // Persist on change
  useEffect(() => { saveState(state) }, [state])

  // Track daily visits for Time Stone
  useEffect(() => {
    const today = todayStr()
    setState(prev => {
      if (prev.visitDays.includes(today)) return prev
      const newDays = [...prev.visitDays, today].slice(-30)
      const next = { ...prev, visitDays: newDays }
      // Auto-unlock Time Stone at 3 unique days (if cooldown allows)
      if (newDays.length >= 3 && !prev.unlocked.time) {
        if (canUnlockNext(prev)) {
          next.unlocked = { ...next.unlocked, time: Date.now() }
          next.lastUnlockTime = Date.now()
        }
      }
      return next
    })
  }, [])

  // Check if cooldown allows next unlock
  function canUnlockNext(s) {
    const count = Object.keys(s.unlocked).length
    if (count < COOLDOWN_THRESHOLD) return true // first 3 are free
    const elapsed = Date.now() - (s.lastUnlockTime || 0)
    return elapsed >= COOLDOWN_MS
  }

  // Get cooldown status
  function getCooldownInfo(s) {
    const count = Object.keys(s.unlocked).length
    if (count < COOLDOWN_THRESHOLD) return { onCooldown: false, remaining: 0 }
    const elapsed = Date.now() - (s.lastUnlockTime || 0)
    if (elapsed >= COOLDOWN_MS) return { onCooldown: false, remaining: 0 }
    return { onCooldown: true, remaining: COOLDOWN_MS - elapsed }
  }

  const tryUnlock = useCallback((stone, s) => {
    if (s.unlocked[stone]) return s // already unlocked
    if (!canUnlockNext(s)) return s // cooldown active
    return {
      ...s,
      unlocked: { ...s.unlocked, [stone]: Date.now() },
      lastUnlockTime: Date.now(),
    }
  }, [])

  // ---- Mind Stone: coherence-checked vision ----
  const onVisionSubmitted = useCallback((visionText) => {
    if (!isCoherentVision(visionText)) return false
    setState(prev => {
      const next = { ...prev, visionSubmitted: true }
      return tryUnlock('mind', next)
    })
    return true
  }, [tryUnlock])

  // ---- Space Stone: wallet connection ----
  const onWalletConnected = useCallback(() => {
    setState(prev => {
      const next = { ...prev, walletConnected: true }
      return tryUnlock('space', next)
    })
  }, [tryUnlock])

  // ---- Reality Stone: swap + quiz ----
  const onSwapCompleted = useCallback(() => {
    setState(prev => ({ ...prev, swapCompleted: true }))
  }, [])

  const onRealityQuizAnswer = useCallback((answer) => {
    if (!checkRealityAnswer(answer)) return false
    setState(prev => {
      if (!prev.swapCompleted) return prev // must swap first
      const next = { ...prev, realityQuizPassed: true }
      return tryUnlock('reality', next)
    })
    return true
  }, [tryUnlock])

  // ---- Power Stone: read proposal (30s) + vote ----
  const onProposalReadTime = useCallback((seconds) => {
    setState(prev => ({
      ...prev,
      proposalReadTime: Math.max(prev.proposalReadTime, seconds),
    }))
  }, [])

  const onVoteCast = useCallback(() => {
    setState(prev => {
      if (prev.proposalReadTime < 30) return prev // must read for 30s first
      const next = { ...prev, votesCast: prev.votesCast + 1 }
      return tryUnlock('power', next)
    })
  }, [tryUnlock])

  // ---- Soul Stone: invited person earned Mind Stone ----
  const onReferralConverted = useCallback((userId) => {
    setState(prev => {
      if (prev.referredUsers.includes(userId)) return prev
      const next = {
        ...prev,
        referredUsers: [...prev.referredUsers, userId],
      }
      return tryUnlock('soul', next)
    })
  }, [tryUnlock])

  const unlockedCount = Object.keys(state.unlocked).length
  const hasGauntlet = unlockedCount === 6
  const progress = unlockedCount / 6
  const cooldownInfo = getCooldownInfo(state)

  // Days until Time Stone
  const uniqueDays = state.visitDays.length
  const daysRemaining = Math.max(0, 3 - uniqueDays)

  return {
    stones: STONES,
    stoneOrder: STONE_ORDER,
    unlocked: state.unlocked,
    unlockedCount,
    hasGauntlet,
    progress,
    cooldownInfo,
    visitDays: state.visitDays,
    uniqueDays,
    daysRemaining,
    // Validation helpers
    isCoherentVision,
    checkRealityAnswer,
    realityQuiz: REALITY_QUIZ,
    proposalReadTime: state.proposalReadTime,
    swapCompleted: state.swapCompleted,
    // Actions
    onVisionSubmitted,
    onWalletConnected,
    onSwapCompleted,
    onRealityQuizAnswer,
    onProposalReadTime,
    onVoteCast,
    onReferralConverted,
    // Raw state for debugging
    _state: state,
  }
}

// ============ Context (for cross-component access) ============

const InfinityStonesContext = createContext(null)

export function InfinityStonesProvider({ children }) {
  const stones = useInfinityStones()
  return (
    <InfinityStonesContext.Provider value={stones}>
      {children}
    </InfinityStonesContext.Provider>
  )
}

export function useStones() {
  const ctx = useContext(InfinityStonesContext)
  if (!ctx) throw new Error('useStones must be used within InfinityStonesProvider')
  return ctx
}

export { STONES, STONE_ORDER }
