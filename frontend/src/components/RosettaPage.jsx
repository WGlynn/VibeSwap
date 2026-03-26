import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import {
  LEXICONS,
  TEN_COVENANTS,
  COVENANT_HASH,
  translate,
  translateToAll,
  translateSentence,
  discoverEquivalent,
  autocomplete,
  registerUserLexicon,
  addUserTerm,
  getUserLexicon,
  getAllUserLexicons,
  exportLexicon,
  importLexicon,
  getProtocolStats,
  getTopConnectedConcepts,
  getDetailedStats,
  getConceptChain,
  getRelatedConcepts,
} from '../utils/rosetta-engine'

// ============ Rosetta Stone Protocol — Universal Translation ============
// Runs 100% client-side. No backend required. Static Vercel deploy compatible.

// ============ Lexicon Registry — built dynamically from LEXICONS export ============

// Colors for the 10 AI agents
const AGENT_COLORS = {
  nyx:        '#a855f7',
  poseidon:   '#3b82f6',
  athena:     '#f59e0b',
  hephaestus: '#ef4444',
  hermes:     '#10b981',
  apollo:     '#fbbf24',
  proteus:    '#6366f1',
  artemis:    '#c084fc',
  anansi:     '#f97316',
  jarvis:     '#22d3ee',
}

// Colors for the 14 human domain lexicons
const HUMAN_DOMAIN_COLORS = {
  medicine:     '#ef4444',
  law:          '#6b7280',
  engineering:  '#f97316',
  education:    '#22c55e',
  music:        '#ec4899',
  agriculture:  '#84cc16',
  psychology:   '#8b5cf6',
  philosophy:   '#06b6d4',
  military:     '#78716c',
  cooking:      '#f59e0b',
  sports:       '#14b8a6',
  architecture: '#a3a3a3',
  journalism:   '#0ea5e9',
  trading:      '#eab308',
}

// Human-readable display names (capitalised) derived from the key
function toDisplayName(id) {
  return id.charAt(0).toUpperCase() + id.slice(1)
}

// Build ALL_LEXICONS dynamically from the engine's LEXICONS export
// Each entry: { id, name, domain, color, group }
const AI_AGENT_IDS = Object.keys(AGENT_COLORS)

const ALL_LEXICONS = Object.entries(LEXICONS).map(([id, lex]) => {
  const isAgent = AI_AGENT_IDS.includes(id)
  return {
    id,
    name: toDisplayName(id),
    domain: lex.domain,
    color: isAgent ? AGENT_COLORS[id] : (HUMAN_DOMAIN_COLORS[id] || '#94a3b8'),
    group: isAgent ? 'agent' : 'human',
  }
})

// Separate groups for rendering
const AGENT_LEXICONS  = ALL_LEXICONS.filter(l => l.group === 'agent')
const HUMAN_LEXICONS  = ALL_LEXICONS.filter(l => l.group === 'human')

// Fast lookup map
const LEXICON_MAP = Object.fromEntries(ALL_LEXICONS.map(l => [l.id, l]))

// Legacy alias so existing code that references AGENT_MAP still works
const AGENTS    = ALL_LEXICONS   // full list, used in LexiconSelect optgroups
const AGENT_MAP = LEXICON_MAP

// User lexicons use a neutral slate color scheme
const USER_LEXICON_COLOR = '#94a3b8'

// ============ Animated Counter ============

function AnimatedCounter({ target, duration = 1200, suffix = '' }) {
  const [display, setDisplay] = useState(0)
  const frameRef = useRef(null)

  useEffect(() => {
    if (typeof target !== 'number' || isNaN(target)) return
    const start = performance.now()
    const tick = (now) => {
      const elapsed = now - start
      const progress = Math.min(elapsed / duration, 1)
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplay(Math.round(eased * target))
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(tick)
      }
    }
    frameRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frameRef.current)
  }, [target, duration])

  return <span>{display.toLocaleString()}{suffix}</span>
}

// ============ Did You Know? — hardcoded cross-domain surprises ============

const DID_YOU_KNOW_FACTS = [
  {
    from: { domain: 'Cooking', term: 'mise en place', color: '#f59e0b' },
    to:   { domain: 'Military', term: 'OPSEC brief', color: '#78716c' },
    concept: 'preparation_readiness',
    text: 'Both mean: arrange everything you need before the action starts — or the chaos wins.',
  },
  {
    from: { domain: 'Trading', term: 'liquidity', color: '#eab308' },
    to:   { domain: 'Agriculture', term: 'irrigation', color: '#84cc16' },
    concept: 'resource_availability',
    text: 'Moving resources to where they are needed — whether capital or water.',
  },
  {
    from: { domain: 'Music', term: 'cadence', color: '#ec4899' },
    to:   { domain: 'Sports', term: 'finishing move', color: '#14b8a6' },
    concept: 'rhythmic_closure',
    text: 'Both signal: the sequence is complete. The phrase resolves. The play ends.',
  },
  {
    from: { domain: 'Medicine', term: 'triage', color: '#ef4444' },
    to:   { domain: 'Trading', term: 'position sizing', color: '#eab308' },
    concept: 'constraint_choice',
    text: 'Limited capacity forces the same hard decision: what gets saved, what gets cut.',
  },
  {
    from: { domain: 'Engineering', term: 'fault tolerance', color: '#f97316' },
    to:   { domain: 'Military', term: 'reserve forces', color: '#78716c' },
    concept: 'backup_capacity',
    text: 'Keep something in reserve. The system that never fails has never been tested.',
  },
  {
    from: { domain: 'Law', term: 'precedent', color: '#6b7280' },
    to:   { domain: 'Music', term: 'motif', color: '#ec4899' },
    concept: 'established_pattern',
    text: 'A recurring figure both sides already recognize — it carries weight because of what came before.',
  },
  {
    from: { domain: 'Psychology', term: 'cognitive load', color: '#8b5cf6' },
    to:   { domain: 'Engineering', term: 'bandwidth', color: '#f97316' },
    concept: 'capacity_rate',
    text: 'Every channel — mental or physical — has a maximum throughput. Exceed it and quality degrades.',
  },
  {
    from: { domain: 'Philosophy', term: 'axiom', color: '#06b6d4' },
    to:   { domain: 'Engineering', term: 'spec', color: '#f97316' },
    concept: 'foundational_axiom',
    text: 'A truth so basic you cannot derive it from anything simpler — it is the ground the system stands on.',
  },
  {
    from: { domain: 'Journalism', term: 'lede', color: '#0ea5e9' },
    to:   { domain: 'Architecture', term: 'load-bearing wall', color: '#a3a3a3' },
    concept: 'foundational_axiom',
    text: 'Remove it and the whole structure collapses. Bury it and no one finds the building.',
  },
  {
    from: { domain: 'Sports', term: 'flow state', color: '#14b8a6' },
    to:   { domain: 'Psychology', term: 'hyperfocus', color: '#8b5cf6' },
    concept: 'optimal_state',
    text: 'When the challenge exactly matches capacity, time dissolves and output peaks.',
  },
]

function DidYouKnow() {
  const fact = useMemo(() => {
    return DID_YOU_KNOW_FACTS[Math.floor(Math.random() * DID_YOU_KNOW_FACTS.length)]
  }, [])

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.4 }}
      className="mb-6"
    >
      <div
        className="relative rounded-xl border px-4 py-3 sm:px-5 sm:py-4 overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, rgba(0,255,65,0.04) 0%, rgba(0,20,10,0.8) 100%)',
          borderColor: 'rgba(0,255,65,0.18)',
        }}
      >
        {/* Subtle glow pulse */}
        <motion.div
          className="absolute inset-0 pointer-events-none rounded-xl"
          style={{ background: 'radial-gradient(ellipse at 50% 0%, rgba(0,255,65,0.06) 0%, transparent 70%)' }}
          animate={{ opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
        />

        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[9px] font-mono font-bold uppercase tracking-widest text-matrix-500">
              Did you know?
            </span>
            <span className="text-[9px] font-mono text-black-600 uppercase tracking-wider">
              — cross-domain connection
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 mb-2">
            {/* From pill */}
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono font-semibold"
              style={{ backgroundColor: `${fact.from.color}18`, border: `1px solid ${fact.from.color}40`, color: fact.from.color }}
            >
              <span
                className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: fact.from.color, boxShadow: `0 0 6px ${fact.from.color}80` }}
              />
              {fact.from.domain}: <em className="not-italic font-bold">&ldquo;{fact.from.term}&rdquo;</em>
            </span>

            {/* = Universal */}
            <span className="text-[10px] font-mono text-black-600">=</span>
            <span
              className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-mono"
              style={{ backgroundColor: 'rgba(0,255,65,0.08)', border: '1px solid rgba(0,255,65,0.2)', color: '#00ff41' }}
            >
              {fact.concept}
            </span>
            <span className="text-[10px] font-mono text-black-600">=</span>

            {/* To pill */}
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono font-semibold"
              style={{ backgroundColor: `${fact.to.color}18`, border: `1px solid ${fact.to.color}40`, color: fact.to.color }}
            >
              <span
                className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: fact.to.color, boxShadow: `0 0 6px ${fact.to.color}80` }}
              />
              {fact.to.domain}: <em className="not-italic font-bold">&ldquo;{fact.to.term}&rdquo;</em>
            </span>
          </div>

          <p className="text-[11px] font-mono text-black-400 italic">{fact.text}</p>
        </div>
      </div>
    </motion.div>
  )
}

// ============ Agent Dot ============

function AgentDot({ color, size = 8 }) {
  return (
    <span
      className="inline-block rounded-full flex-shrink-0"
      style={{
        width: size,
        height: size,
        backgroundColor: color,
        boxShadow: `0 0 6px ${color}60`,
      }}
    />
  )
}

// ============ Lexicon Select Dropdown (agents + user lexicons) ============

function LexiconSelect({ value, onChange, label, excludeId, userLexicons = [], selectId }) {
  const allOptions = [
    ...ALL_LEXICONS.map(l => ({ id: l.id, name: l.name, color: l.color })),
    ...userLexicons.map(u => ({
      id: `user:${u.userId}`,
      name: u.domain || u.userId,
      color: USER_LEXICON_COLOR,
    })),
  ]

  const selectedOption = allOptions.find(o => o.id === value)

  return (
    <div className="flex-1">
      <label className="block text-[10px] font-mono text-black-500 mb-1.5 uppercase tracking-wider">
        {label}
      </label>
      <div className="relative">
        <select
          id={selectId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full appearance-none bg-black-900/80 border border-black-700 rounded-lg px-3 py-2.5 text-sm text-white font-mono focus:outline-none focus:border-matrix-600 transition-colors cursor-pointer"
        >
          <option value="">Select lexicon...</option>
          <optgroup label="AI Agents">
            {AGENT_LEXICONS.filter(l => l.id !== excludeId).map(l => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </optgroup>
          <optgroup label="Human Domains">
            {HUMAN_LEXICONS.filter(l => l.id !== excludeId).map(l => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </optgroup>
          {userLexicons.length > 0 && (
            <optgroup label="User Lexicons">
              {userLexicons
                .filter(u => `user:${u.userId}` !== excludeId)
                .map(u => (
                  <option key={`user:${u.userId}`} value={`user:${u.userId}`}>
                    {u.domain || u.userId}
                  </option>
                ))}
            </optgroup>
          )}
        </select>
        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-black-500">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
        {value && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
            <AgentDot color={selectedOption?.color || USER_LEXICON_COLOR} />
          </div>
        )}
      </div>
    </div>
  )
}

// ============ Copy Button ============

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [text])

  return (
    <button
      onClick={handleCopy}
      className="text-black-500 hover:text-matrix-400 transition-colors ml-1.5"
      title="Copy to clipboard"
    >
      {copied ? (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      )}
    </button>
  )
}

// ============ Share Button ============

function ShareButton() {
  const [toast, setToast] = useState(false)

  const handleShare = useCallback(() => {
    const url = window.location.href
    navigator.clipboard.writeText(url).then(() => {
      setToast(true)
      setTimeout(() => setToast(false), 2500)
    })
  }, [])

  return (
    <div className="relative inline-flex items-center">
      <button
        onClick={handleShare}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-mono text-[10px] font-bold uppercase tracking-wider transition-all hover:opacity-90 active:scale-[0.97]"
        style={{
          backgroundColor: 'rgba(0,255,65,0.10)',
          border: '1px solid rgba(0,255,65,0.30)',
          color: '#00ff41',
        }}
        title="Copy shareable link"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
        </svg>
        Share
      </button>

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.92 }}
            transition={{ duration: 0.2 }}
            className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 rounded-lg font-mono text-[10px] font-bold whitespace-nowrap pointer-events-none z-50"
            style={{
              backgroundColor: 'rgba(0,255,65,0.15)',
              border: '1px solid rgba(0,255,65,0.40)',
              color: '#00ff41',
              boxShadow: '0 0 12px rgba(0,255,65,0.25)',
            }}
          >
            Link copied!
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ============ Translation Result Card ============

function TranslationResult({ result, fromId, toId, userLexicons = [] }) {
  if (!result) return null

  function getLexiconMeta(id) {
    if (!id) return null
    if (id.startsWith('user:')) {
      const userId = id.slice(5)
      const lex = userLexicons.find(u => u.userId === userId)
      return { name: lex?.domain || userId, color: USER_LEXICON_COLOR }
    }
    const agent = AGENT_MAP[id]
    return agent ? { name: agent.name, color: agent.color } : null
  }

  const from = getLexiconMeta(fromId)
  const to = getLexiconMeta(toId)

  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.97 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className="mt-4"
    >
      <GlassCard glowColor="matrix" spotlight className="p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-black-500 uppercase tracking-wider">Translation Result</span>
            <ShareButton />
          </div>
          <span
            className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full"
            style={{
              backgroundColor: `${result.confidence >= 80 ? '#00ff41' : result.confidence >= 50 ? '#fbbf24' : '#ef4444'}15`,
              color: result.confidence >= 80 ? '#00ff41' : result.confidence >= 50 ? '#fbbf24' : '#ef4444',
            }}
          >
            {result.confidence}% confidence
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/* From */}
          <div className="flex-1 text-center p-3 bg-black-900/60 rounded-lg border border-black-800">
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <AgentDot color={from?.color} size={6} />
              <span className="text-[10px] font-mono text-black-500">{from?.name}</span>
            </div>
            <div className="text-white text-sm font-medium font-mono">{result.from_term}</div>
          </div>

          {/* Arrow */}
          <div className="flex flex-col items-center gap-1 flex-shrink-0">
            <svg className="w-5 h-5 text-matrix-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
            <span className="text-[8px] font-mono text-black-600">UNIVERSAL</span>
          </div>

          {/* To */}
          <div className="flex-1 text-center p-3 bg-black-900/60 rounded-lg border border-black-800">
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <AgentDot color={to?.color} size={6} />
              <span className="text-[10px] font-mono text-black-500">{to?.name}</span>
            </div>
            <div className="text-white text-sm font-medium font-mono">
              {result.to_term || '— no equivalent —'}
            </div>
          </div>
        </div>

        {/* Universal concept */}
        {result.universal && (
          <div className="mt-3 pt-3 border-t border-black-800">
            <span className="text-[10px] font-mono text-black-600">Universal concept: </span>
            <span className="text-[10px] font-mono text-matrix-400">{result.universal}</span>
          </div>
        )}

        {result.explanation && (
          <div className="mt-2">
            <span className="text-[10px] font-mono text-black-500">{result.explanation}</span>
          </div>
        )}
      </GlassCard>
    </motion.div>
  )
}

// ============ Translate-All Results ============

function TranslateAllResults({ results, fromId, userLexicons = [] }) {
  if (!results || results.length === 0) return null

  function getLexiconMeta(id) {
    if (!id) return null
    if (id.startsWith('user:')) {
      const userId = id.slice(5)
      const lex = userLexicons.find(u => u.userId === userId)
      return { name: lex?.domain || userId, color: USER_LEXICON_COLOR }
    }
    return AGENT_MAP[id] || null
  }

  const from = getLexiconMeta(fromId)

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.35 }}
      className="mt-4"
    >
      <GlassCard glowColor="terminal" spotlight className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <AgentDot color={from?.color} size={8} />
            <span className="text-[10px] font-mono text-black-500 uppercase tracking-wider">
              {from?.name} &rarr; All Lexicons
            </span>
          </div>
          <ShareButton />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {results.map((r, i) => {
            const isUser = r.agent?.startsWith('user:')
            const targetMeta = isUser
              ? {
                  name: userLexicons.find(u => u.userId === r.agent.slice(5))?.domain || r.agent.slice(5),
                  color: USER_LEXICON_COLOR,
                }
              : AGENT_MAP[r.agent]
            if (!targetMeta) return null
            return (
              <motion.div
                key={r.agent}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className="flex items-center gap-2.5 p-2.5 bg-black-900/50 rounded-lg border border-black-800"
              >
                <AgentDot color={targetMeta.color} size={7} />
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] font-mono text-black-500">{targetMeta.name}</div>
                  <div className="text-white text-xs font-mono truncate">{r.term}</div>
                </div>
                <span
                  className="text-[9px] font-mono font-bold flex-shrink-0"
                  style={{
                    color: r.confidence >= 80 ? '#00ff41' : r.confidence >= 50 ? '#fbbf24' : '#ef4444',
                  }}
                >
                  {r.confidence}%
                </span>
              </motion.div>
            )
          })}
        </div>
      </GlassCard>
    </motion.div>
  )
}

// ============ Lexicon Card (Agent Grid) ============

function LexiconCard({ agent, termCount, onSelect, isSelected }) {
  return (
    <motion.div
      layout
      onClick={() => onSelect(isSelected ? null : agent.id)}
      className="cursor-pointer"
    >
      <GlassCard
        hover
        className="p-4"
        style={{ borderColor: isSelected ? agent.color : undefined }}
      >
        <div
          className="absolute top-0 left-0 right-0 h-[2px] rounded-t-2xl"
          style={{ backgroundColor: agent.color }}
        />
        <div className="flex items-center gap-2 mb-2">
          <AgentDot color={agent.color} size={10} />
          <span className="text-white font-bold text-sm">{agent.name}</span>
        </div>
        <div className="text-[10px] font-mono text-black-400 mb-1.5">{agent.domain}</div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono text-black-600">{termCount} terms</span>
          <svg
            className={`w-3.5 h-3.5 text-black-600 transition-transform ${isSelected ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </GlassCard>
    </motion.div>
  )
}

// ============ Expanded Lexicon Panel ============

function LexiconPanel({ agent, terms }) {
  if (!agent) return null

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.3, ease: 'easeInOut' }}
      className="col-span-full overflow-hidden"
    >
      <GlassCard className="p-4" style={{ borderColor: `${agent.color}40` }}>
        <div className="flex items-center gap-2 mb-3">
          <AgentDot color={agent.color} size={8} />
          <span className="text-white font-bold text-sm">{agent.name} Lexicon</span>
          <span className="text-[10px] font-mono text-black-500 ml-auto">{agent.domain}</span>
        </div>

        {terms && terms.length > 0 && (
          <div className="space-y-1.5 max-h-64 overflow-y-auto scrollbar-thin">
            {terms.map((term, i) => (
              <motion.div
                key={term.term || i}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.03 }}
                className="flex items-start gap-3 p-2.5 bg-black-900/40 rounded-lg"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-white text-xs font-mono font-medium">{term.term}</div>
                  {term.description && (
                    <div className="text-[10px] text-black-500 mt-0.5">{term.description}</div>
                  )}
                </div>
                {term.universal && (
                  <div className="flex-shrink-0 text-right">
                    <div className="text-[9px] font-mono text-black-600 uppercase">Universal</div>
                    <div className="text-[10px] font-mono text-matrix-400">{term.universal}</div>
                  </div>
                )}
              </motion.div>
            ))}
          </div>
        )}
      </GlassCard>
    </motion.div>
  )
}

// ============ Concept Explorer ============

// Build a domain-label lookup: lexiconId -> { name, color, isUser }
function getLexiconLabel(lexiconId, userLexicons) {
  if (!userLexicons) userLexicons = []
  if (lexiconId.startsWith('user:')) {
    const userId = lexiconId.slice(5)
    const lex = userLexicons.find(u => u.userId === userId)
    return { name: lex?.domain || userId, color: USER_LEXICON_COLOR, isUser: true }
  }
  const agent = AGENT_MAP[lexiconId]
  return agent ? { name: agent.name, color: agent.color, isUser: false } : null
}

function ConceptExplorer({ userLexicons = [] }) {
  const [filter, setFilter] = useState('')
  const [expandedConcept, setExpandedConcept] = useState(null)

  // Compute top concepts once on mount
  const [topConcepts] = useState(() => getTopConnectedConcepts(30))

  // Filter by concept key, definition, term name, or domain name
  const filtered = filter.trim()
    ? topConcepts.filter(c => {
        const q = filter.toLowerCase()
        if (c.universal.toLowerCase().includes(q)) return true
        if (c.definition.toLowerCase().includes(q)) return true
        if (c.mappings.some(m => m.term.toLowerCase().includes(q))) return true
        if (c.mappings.some(m => {
          const meta = getLexiconLabel(m.lexiconId, userLexicons)
          return meta?.name?.toLowerCase().includes(q)
        })) return true
        return false
      })
    : topConcepts

  const handleToggle = (universal) => {
    setExpandedConcept(prev => prev === universal ? null : universal)
  }

  return (
    <GlassCard glowColor="matrix" spotlight className="p-5 mb-6">
      {/* Header */}
      <div className="flex items-start justify-between mb-1">
        <div>
          <h2 className="text-sm font-bold text-white uppercase tracking-wider">
            Concept Explorer
          </h2>
          <p className="text-black-500 text-[10px] font-mono mt-0.5">
            Browse the universal concept graph &mdash; see unexpected connections across every domain.
          </p>
        </div>
        <span className="text-[10px] font-mono text-black-600 flex-shrink-0 ml-4 mt-0.5">
          {filtered.length} concepts
        </span>
      </div>

      {/* Search */}
      <div className="relative mt-3 mb-4">
        <input
          type="text"
          value={filter}
          onChange={(e) => { setFilter(e.target.value); setExpandedConcept(null) }}
          placeholder="Search concepts, terms, or domains..."
          className="w-full bg-black-900/80 border border-black-700 rounded-lg px-3 py-2.5 pr-10 text-sm text-white font-mono placeholder-black-600 focus:outline-none focus:border-matrix-600 transition-colors"
        />
        {filter && (
          <button
            onClick={() => { setFilter(''); setExpandedConcept(null) }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-black-600 hover:text-black-400 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Concept list */}
      <div className="space-y-1.5 max-h-[520px] overflow-y-auto scrollbar-thin pr-1">
        <AnimatePresence initial={false}>
          {filtered.length === 0 ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-8 border border-black-800 rounded-lg"
            >
              <p className="text-black-500 text-xs font-mono">No concepts match &ldquo;{filter}&rdquo;</p>
            </motion.div>
          ) : (
            filtered.map((concept, i) => {
              const isExpanded = expandedConcept === concept.universal

              // Deduplicate mappings by lexiconId for the preview dots
              const seen = new Set()
              const uniqueLexicons = concept.mappings.filter(m => {
                if (seen.has(m.lexiconId)) return false
                seen.add(m.lexiconId)
                return true
              })

              return (
                <motion.div
                  key={concept.universal}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.02, 0.3) }}
                >
                  {/* Row — click to expand */}
                  <button
                    onClick={() => handleToggle(concept.universal)}
                    className="w-full text-left p-3 rounded-xl border transition-all duration-200"
                    style={{
                      backgroundColor: isExpanded ? 'rgba(0,255,65,0.04)' : 'rgba(15,20,15,0.6)',
                      borderColor: isExpanded ? 'rgba(0,255,65,0.25)' : 'rgba(37,37,37,0.8)',
                    }}
                  >
                    <div className="flex items-center gap-3">
                      {/* Concept key + count badge */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-white text-xs font-mono font-semibold">
                            {concept.universal}
                          </span>
                          <span
                            className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-full flex-shrink-0"
                            style={{ backgroundColor: 'rgba(0,255,65,0.1)', color: '#00ff41' }}
                          >
                            {concept.lexiconCount} domain{concept.lexiconCount !== 1 ? 's' : ''}
                          </span>
                        </div>
                        {concept.definition && (
                          <p className="text-[10px] font-mono text-black-500 mt-0.5 truncate">
                            {concept.definition}
                          </p>
                        )}
                      </div>

                      {/* Domain snippet preview — 3 pills collapsed, full list on expand */}
                      <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap justify-end max-w-[180px] sm:max-w-none">
                        {uniqueLexicons.slice(0, isExpanded ? 0 : 3).map((m) => {
                          const meta = getLexiconLabel(m.lexiconId, userLexicons)
                          if (!meta) return null
                          return (
                            <span
                              key={m.lexiconId}
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono flex-shrink-0"
                              style={{
                                backgroundColor: `${meta.color}14`,
                                border: `1px solid ${meta.color}2a`,
                                color: meta.color,
                              }}
                            >
                              <span
                                className="inline-block rounded-full flex-shrink-0"
                                style={{ width: 5, height: 5, backgroundColor: meta.color }}
                              />
                              {m.term}
                            </span>
                          )
                        })}
                        {!isExpanded && uniqueLexicons.length > 3 && (
                          <span className="text-[9px] font-mono text-black-600">
                            +{uniqueLexicons.length - 3}
                          </span>
                        )}
                      </div>

                      {/* Expand chevron */}
                      <svg
                        className={`w-3.5 h-3.5 text-black-600 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`}
                        fill="none" viewBox="0 0 24 24" stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </button>

                  {/* Expanded mappings panel */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.25, ease: 'easeInOut' }}
                        className="overflow-hidden"
                      >
                        <div className="pt-1.5 pb-1 pl-3 pr-1">
                          <div className="flex flex-wrap gap-2 p-3 bg-black-900/60 rounded-xl border border-black-800">
                            {concept.mappings.map((m, mi) => {
                              const meta = getLexiconLabel(m.lexiconId, userLexicons)
                              if (!meta) return null
                              return (
                                <motion.div
                                  key={`${m.lexiconId}-${m.term}-${mi}`}
                                  initial={{ opacity: 0, scale: 0.9 }}
                                  animate={{ opacity: 1, scale: 1 }}
                                  transition={{ delay: mi * 0.03 }}
                                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border flex-shrink-0"
                                  style={{
                                    backgroundColor: `${meta.color}0d`,
                                    borderColor: `${meta.color}30`,
                                  }}
                                  title={m.desc || undefined}
                                >
                                  <span
                                    className="inline-block rounded-full flex-shrink-0"
                                    style={{
                                      width: 6,
                                      height: 6,
                                      backgroundColor: meta.color,
                                      boxShadow: `0 0 5px ${meta.color}80`,
                                    }}
                                  />
                                  <span
                                    className="text-[10px] font-mono"
                                    style={{ color: meta.color }}
                                  >
                                    {meta.name}:
                                  </span>
                                  <span className="text-white text-[10px] font-mono font-semibold">
                                    {m.term}
                                  </span>
                                </motion.div>
                              )
                            })}
                          </div>
                          {concept.definition && (
                            <p className="text-[10px] font-mono text-black-600 mt-1.5 px-1">
                              {concept.definition}
                            </p>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              )
            })
          )}
        </AnimatePresence>
      </div>
    </GlassCard>
  )
}

// ============ Highlight matched text ============

function HighlightMatch({ text, query }) {
  if (!query || !text) return <span>{text}</span>
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return <span>{text}</span>
  return (
    <span>
      {text.slice(0, idx)}
      <mark
        className="rounded-sm"
        style={{ backgroundColor: 'rgba(0,255,65,0.22)', color: '#00ff41', padding: '0 1px' }}
      >
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </span>
  )
}

// ============ Discover Section ============

const DISCOVER_SUGGESTIONS = [
  'harmony',
  'diagnosis',
  'liquidity',
  'mise en place',
  'triage',
  'cadence',
  'axiom',
  'flow state',
  'fault tolerance',
  'precedent',
]

function DiscoverSection({ onSuggestionClick }) {
  const [searchTerm, setSearchTerm] = useState('')
  const [results, setResults] = useState(null)
  const [suggestions, setSuggestions] = useState([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [suggestionIdx] = useState(() => Math.floor(Math.random() * DISCOVER_SUGGESTIONS.length))
  const inputRef = useRef(null)
  const dropdownRef = useRef(null)

  // Rotate suggestion every 3s when input is empty
  const [rotatingIdx, setRotatingIdx] = useState(suggestionIdx)
  useEffect(() => {
    const id = setInterval(() => {
      setRotatingIdx(i => (i + 1) % DISCOVER_SUGGESTIONS.length)
    }, 3000)
    return () => clearInterval(id)
  }, [])

  const activePlaceholder = searchTerm
    ? ''
    : `Try searching: "${DISCOVER_SUGGESTIONS[rotatingIdx]}"...`

  // Instant — engine is synchronous + in-memory, no debounce needed
  const runSearch = useCallback((value) => {
    if (!value.trim()) { setResults(null); return }
    setResults(discoverEquivalent(value.trim()))
  }, [])

  const handleInputChange = useCallback((value) => {
    setSearchTerm(value)
    setActiveIndex(-1)
    if (!value.trim()) {
      setSuggestions([])
      setShowDropdown(false)
      setResults(null)
      return
    }
    const hits = autocomplete(value, 8)
    setSuggestions(hits)
    setShowDropdown(hits.length > 0)
    runSearch(value)
  }, [runSearch])

  const commitSuggestion = useCallback((suggestion) => {
    const term = suggestion.term.replace(/_/g, ' ')
    setSearchTerm(term)
    setSuggestions([])
    setShowDropdown(false)
    setActiveIndex(-1)
    runSearch(term)
    inputRef.current?.focus()
  }, [runSearch])

  const handleKeyDown = useCallback((e) => {
    if (!showDropdown || suggestions.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex(i => Math.min(i + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex(i => Math.max(i - 1, -1))
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault()
      commitSuggestion(suggestions[activeIndex])
    } else if (e.key === 'Escape') {
      setShowDropdown(false)
      setActiveIndex(-1)
    }
  }, [showDropdown, suggestions, activeIndex, commitSuggestion])

  const handleBlur = useCallback(() => {
    // Delay so mousedown on a suggestion fires before the dropdown hides
    setTimeout(() => {
      if (!dropdownRef.current?.contains(document.activeElement)) {
        setShowDropdown(false)
        setActiveIndex(-1)
      }
    }, 150)
  }, [])

  const handleFocus = useCallback(() => {
    if (suggestions.length > 0) setShowDropdown(true)
  }, [suggestions])

  const clearSearch = useCallback(() => {
    setSearchTerm('')
    setResults(null)
    setSuggestions([])
    setShowDropdown(false)
    setActiveIndex(-1)
  }, [])

  const activeSearch = searchTerm.trim()

  return (
    <GlassCard glowColor="terminal" className="p-5 mb-6">
      <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-1">Discover</h2>
      <p className="text-black-500 text-[10px] font-mono mb-4">
        Type any word — see how every domain expresses the same concept. Results appear instantly.
      </p>

      {/* Search input + autocomplete dropdown */}
      <div className="relative">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none z-10">
          <svg className="w-4 h-4 text-black-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <input
          ref={inputRef}
          id="rosetta-discover-input"
          type="text"
          value={searchTerm}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder={activePlaceholder}
          autoComplete="off"
          className="w-full bg-black-900/80 border border-black-700 rounded-lg pl-9 pr-10 py-2.5 text-sm text-white font-mono placeholder-black-600 focus:outline-none focus:border-terminal-600 transition-colors"
        />
        {searchTerm && (
          <button
            onClick={clearSearch}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-black-600 hover:text-black-400 transition-colors z-10"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}

        {/* Autocomplete dropdown */}
        <AnimatePresence>
          {showDropdown && suggestions.length > 0 && (
            <motion.div
              ref={dropdownRef}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
              className="absolute left-0 right-0 top-full mt-1 z-50 rounded-lg border border-black-700 overflow-hidden"
              style={{ background: 'rgba(5,10,8,0.97)', boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}
            >
              {suggestions.map((s, i) => {
                const isUser = s.lexiconId?.startsWith('user:')
                const meta = !isUser ? LEXICON_MAP[s.lexiconId] : null
                const dotColor = meta?.color || USER_LEXICON_COLOR
                const domainLabel = meta?.name || s.domain || s.lexiconId
                return (
                  <button
                    key={`${s.lexiconId}:${s.term}`}
                    onMouseDown={(e) => { e.preventDefault(); commitSuggestion(s) }}
                    onMouseEnter={() => setActiveIndex(i)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors border-b border-black-800 last:border-b-0"
                    style={{ background: i === activeIndex ? 'rgba(0,255,65,0.07)' : 'transparent' }}
                  >
                    {/* Domain colored dot */}
                    <span
                      className="inline-block rounded-full flex-shrink-0"
                      style={{
                        width: 8,
                        height: 8,
                        backgroundColor: dotColor,
                        boxShadow: `0 0 5px ${dotColor}70`,
                      }}
                    />
                    {/* Term + short description */}
                    <div className="flex-1 min-w-0">
                      <span className="text-[13px] font-mono text-white">
                        <HighlightMatch text={s.term.replace(/_/g, ' ')} query={activeSearch} />
                      </span>
                      {s.description && (
                        <span className="text-[10px] font-mono text-black-500 ml-2">
                          {s.description.length > 60 ? s.description.slice(0, 60) + '\u2026' : s.description}
                        </span>
                      )}
                    </div>
                    {/* Domain pill */}
                    <span
                      className="flex-shrink-0 text-[9px] font-mono px-1.5 py-0.5 rounded"
                      style={{
                        backgroundColor: `${dotColor}15`,
                        color: dotColor,
                        border: `1px solid ${dotColor}30`,
                      }}
                    >
                      {domainLabel}
                    </span>
                  </button>
                )
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Discover results — instant, no AnimatePresence key flicker */}
      {activeSearch && results && (
        <div className="mt-4">
          {results.equivalents && results.equivalents.length > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[10px] font-mono text-black-500 uppercase tracking-wider">
                  {results.equivalents.length} equivalent{results.equivalents.length !== 1 ? 's' : ''} for
                </span>
                <span className="text-[10px] font-mono font-bold text-matrix-400">
                  &quot;{activeSearch}&quot;
                </span>
              </div>
              {results.equivalents.map((eq, i) => {
                const isUser = eq.lexicon?.startsWith('user:')
                const agentMeta = !isUser ? AGENT_MAP[eq.lexicon] : null
                const color = agentMeta?.color || USER_LEXICON_COLOR
                const label = agentMeta?.name || (isUser ? (eq.domain || eq.lexicon?.slice(5)) : eq.lexicon)
                return (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: Math.min(i * 0.03, 0.25) }}
                    className="flex items-center gap-3 p-3 bg-black-900/40 rounded-lg border border-black-800"
                  >
                    <AgentDot color={color} size={8} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] font-mono text-black-500">{label}</div>
                      <div className="text-white text-sm font-mono font-medium">
                        <HighlightMatch text={eq.term} query={activeSearch} />
                      </div>
                      {eq.description && (
                        <div className="text-[10px] text-black-600 mt-0.5">
                          <HighlightMatch text={eq.description} query={activeSearch} />
                        </div>
                      )}
                    </div>
                    {eq.universal && (
                      <div className="flex-shrink-0 text-right min-w-0 max-w-[100px] sm:max-w-none">
                        <div className="text-[9px] font-mono text-black-600 uppercase">Universal</div>
                        <div className="text-[10px] font-mono text-matrix-400 truncate">
                          <HighlightMatch text={eq.universal} query={activeSearch} />
                        </div>
                      </div>
                    )}
                  </motion.div>
                )
              })}
            </div>
          ) : (
            <div className="text-center py-6 border border-black-800 rounded-lg">
              <p className="text-black-500 text-xs font-mono">
                No equivalents found for &quot;{activeSearch}&quot;
              </p>
              <p className="text-black-700 text-[10px] font-mono mt-1">
                Try a different term or register it in your lexicon below.
              </p>
            </div>
          )}
        </div>
      )}
    </GlassCard>
  )
}
// ============ My Lexicon Panel ============

function MyLexiconPanel({ userId, isConnected, onImported }) {
  const [myLexicon, setMyLexicon] = useState(null)
  const [importStatus, setImportStatus] = useState(null) // { type: 'success'|'error', message }
  const importInputRef = useRef(null)

  // Reload whenever userId changes or a term is added (parent refreshes via key)
  useEffect(() => {
    if (!isConnected || !userId) {
      setMyLexicon(null)
      return
    }
    setMyLexicon(getUserLexicon(userId))
  }, [isConnected, userId])

  // ---- Export ----
  const handleExport = useCallback(() => {
    if (!userId) return
    const json = exportLexicon(userId)
    if (!json) return
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const safeDomain = (myLexicon?.domain || 'lexicon').replace(/\s+/g, '-').toLowerCase()
    a.href = url
    a.download = `rosetta-${safeDomain}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [userId, myLexicon])

  // ---- Import ----
  const handleImportFile = useCallback((e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImportStatus(null)
    const reader = new FileReader()
    reader.onload = (ev) => {
      const result = importLexicon(ev.target.result)
      if (result.error) {
        setImportStatus({ type: 'error', message: result.error })
      } else {
        setImportStatus({
          type: 'success',
          message: `Imported ${result.termCount} term${result.termCount !== 1 ? 's' : ''} into "${result.domain}"`,
        })
        onImported?.()
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }, [onImported])

  if (!isConnected) {
    return (
      <GlassCard className="p-5">
        <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-3">My Lexicon</h2>
        <div className="text-center py-8">
          <div
            className="w-8 h-8 rounded-full mx-auto mb-3 flex items-center justify-center"
            style={{ backgroundColor: `${USER_LEXICON_COLOR}15`, border: `1px solid ${USER_LEXICON_COLOR}30` }}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke={USER_LEXICON_COLOR}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <p className="text-black-500 text-xs font-mono">Connect a wallet to view</p>
          <p className="text-black-700 text-[10px] font-mono mt-0.5">and manage your lexicon</p>
        </div>
      </GlassCard>
    )
  }

  return (
    <GlassCard className="p-5" style={{ borderColor: `${USER_LEXICON_COLOR}30` }}>
      <div
        className="absolute top-0 left-0 right-0 h-[2px] rounded-t-2xl"
        style={{ backgroundColor: USER_LEXICON_COLOR }}
      />
      <div className="flex items-center gap-2 mb-3">
        <AgentDot color={USER_LEXICON_COLOR} size={10} />
        <span className="text-white font-bold text-sm">My Lexicon</span>
        {myLexicon?.domain && (
          <span className="text-[10px] font-mono text-black-400 ml-auto">{myLexicon.domain}</span>
        )}
      </div>

      {myLexicon && myLexicon.terms && myLexicon.terms.length > 0 ? (
        <>
          <div className="space-y-1.5 max-h-64 overflow-y-auto scrollbar-thin">
            {myLexicon.terms.map((term, i) => (
              <motion.div
                key={term.term || i}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.03 }}
                className="flex items-start gap-3 p-2.5 bg-black-900/40 rounded-lg border border-black-800/50"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-white text-xs font-mono font-medium">{term.term}</div>
                  {term.description && (
                    <div className="text-[10px] text-black-500 mt-0.5">{term.description}</div>
                  )}
                </div>
                {term.universal && (
                  <div className="flex-shrink-0 text-right">
                    <div className="text-[9px] font-mono text-black-600 uppercase">Universal</div>
                    <div className="text-[10px] font-mono" style={{ color: USER_LEXICON_COLOR }}>
                      {term.universal}
                    </div>
                  </div>
                )}
              </motion.div>
            ))}
          </div>
          <div className="mt-2 pt-2 border-t border-black-800">
            <span className="text-[10px] font-mono text-black-600">
              {myLexicon.terms.length} term{myLexicon.terms.length !== 1 ? 's' : ''} registered
            </span>
          </div>
        </>
      ) : (
        <div className="text-center py-6">
          <p className="text-black-600 text-xs font-mono">No terms registered yet.</p>
          <p className="text-black-700 text-[10px] font-mono mt-1">
            Use the form to the left to add your first term.
          </p>
        </div>
      )}

      {/* ---- Export / Import buttons ---- */}
      <div className="mt-3 pt-3 border-t border-black-800 flex items-center gap-2 flex-wrap">
        {/* Export — only shown when there are terms */}
        {myLexicon && myLexicon.terms && myLexicon.terms.length > 0 && (
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-mono font-medium transition-all hover:opacity-80"
            style={{
              backgroundColor: `${USER_LEXICON_COLOR}15`,
              border: `1px solid ${USER_LEXICON_COLOR}40`,
              color: USER_LEXICON_COLOR,
            }}
            title="Download your lexicon as a JSON file to share with others"
          >
            <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export My Lexicon
          </button>
        )}

        {/* Import */}
        <button
          onClick={() => importInputRef.current?.click()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-mono font-medium transition-all hover:opacity-80"
          style={{
            backgroundColor: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.10)',
            color: '#94a3b8',
          }}
          title="Upload a shared lexicon JSON file"
        >
          <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l4-4m0 0l4 4m-4-4v12" />
          </svg>
          Import Lexicon
        </button>

        {/* Hidden file input */}
        <input
          ref={importInputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={handleImportFile}
        />
      </div>

      {/* Import status feedback */}
      <AnimatePresence>
        {importStatus && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-2 px-3 py-2 rounded-lg text-[11px] font-mono"
            style={{
              backgroundColor: importStatus.type === 'success' ? '#16a34a18' : '#dc262618',
              border: `1px solid ${importStatus.type === 'success' ? '#16a34a40' : '#dc262640'}`,
              color: importStatus.type === 'success' ? '#4ade80' : '#f87171',
            }}
          >
            {importStatus.message}
          </motion.div>
        )}
      </AnimatePresence>
    </GlassCard>
  )
}

// ============ Register Lexicon Form ============

function RegisterLexiconForm({ userId, isConnected, onRegistered }) {
  const [domain, setDomain] = useState('')
  const [phase, setPhase] = useState('register') // 'register' | 'addTerms'
  const [status, setStatus] = useState(null) // { type: 'success'|'error', message }
  const [newTerm, setNewTerm] = useState({ term: '', universal: '', description: '' })

  const handleRegister = useCallback(() => {
    if (!domain.trim() || !isConnected) return
    setStatus(null)

    const result = registerUserLexicon(userId, domain.trim())
    if (result.error) {
      setStatus({ type: 'error', message: result.error })
    } else {
      setStatus({ type: 'success', message: `Domain "${domain.trim()}" registered!` })
      setPhase('addTerms')
      onRegistered?.()
    }
  }, [domain, isConnected, userId, onRegistered])

  const handleAddTerm = useCallback(() => {
    if (!newTerm.term.trim() || !newTerm.universal.trim() || !isConnected) return
    setStatus(null)

    const result = addUserTerm(
      userId,
      newTerm.term.trim(),
      newTerm.universal.trim(),
      newTerm.description.trim() || ''
    )
    if (result.error) {
      setStatus({ type: 'error', message: result.error })
    } else {
      setStatus({ type: 'success', message: `Term "${newTerm.term.trim()}" added!` })
      setNewTerm({ term: '', universal: '', description: '' })
      onRegistered?.()
    }
  }, [newTerm, isConnected, userId, onRegistered])

  if (!isConnected) {
    return (
      <GlassCard className="p-5">
        <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-3">Register Your Lexicon</h2>
        <div className="text-center py-8">
          <div
            className="w-8 h-8 rounded-full mx-auto mb-3 flex items-center justify-center"
            style={{ backgroundColor: `${USER_LEXICON_COLOR}15`, border: `1px solid ${USER_LEXICON_COLOR}30` }}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke={USER_LEXICON_COLOR}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          </div>
          <p className="text-black-500 text-xs font-mono">Connect a wallet to register</p>
          <p className="text-black-700 text-[10px] font-mono mt-0.5">your domain lexicon</p>
        </div>
      </GlassCard>
    )
  }

  return (
    <GlassCard className="p-5" style={{ borderColor: `${USER_LEXICON_COLOR}20` }}>
      <div
        className="absolute top-0 left-0 right-0 h-[2px] rounded-t-2xl"
        style={{ backgroundColor: USER_LEXICON_COLOR }}
      />
      <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-4">Register Your Lexicon</h2>

      {/* Phase stepper */}
      <div className="flex items-center gap-3 mb-5">
        {[
          { key: 'register', label: 'Domain' },
          { key: 'addTerms', label: 'Terms' },
        ].map((step, i) => {
          const isDone = step.key === 'register' && phase === 'addTerms'
          const isActive = phase === step.key
          return (
            <div key={step.key} className="flex items-center gap-2">
              {i > 0 && <div className="w-6 h-px bg-black-700" />}
              <div className="flex items-center gap-1.5">
                <div
                  className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-mono font-bold transition-colors"
                  style={{
                    backgroundColor: isDone || isActive ? USER_LEXICON_COLOR : '#1e293b',
                    color: isDone || isActive ? '#000' : '#64748b',
                  }}
                >
                  {isDone ? '✓' : i + 1}
                </div>
                <span
                  className="text-[10px] font-mono"
                  style={{ color: isActive ? USER_LEXICON_COLOR : isDone ? '#64748b' : '#475569' }}
                >
                  {step.label}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Step 1: Register domain */}
      {phase === 'register' && (
        <div className="space-y-3">
          <div>
            <label className="block text-[10px] font-mono text-black-500 mb-1.5 uppercase tracking-wider">
              Domain Name
            </label>
            <input
              type="text"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && domain.trim()) handleRegister() }}
              placeholder="e.g. Medicine, Legal, Gaming, Cooking..."
              className="w-full bg-black-900/80 border border-black-700 rounded-lg px-3 py-2.5 text-sm text-white font-mono placeholder-black-600 focus:outline-none focus:border-matrix-600 transition-colors"
            />
            <p className="text-[10px] font-mono text-black-600 mt-1">
              The domain or field your lexicon belongs to.
            </p>
          </div>

          <button
            onClick={handleRegister}
            disabled={!domain.trim()}
            className={`w-full py-2.5 rounded-lg font-mono text-sm font-bold transition-all ${
              domain.trim()
                ? 'hover:opacity-90 active:scale-[0.99] text-black-900'
                : 'bg-black-800 text-black-600 cursor-not-allowed'
            }`}
            style={domain.trim() ? { backgroundColor: USER_LEXICON_COLOR } : {}}
          >
            Register Domain
          </button>
        </div>
      )}

      {/* Step 2: Add terms */}
      {phase === 'addTerms' && (
        <div className="space-y-3">
          <p className="text-[10px] font-mono text-black-400">
            Domain{' '}
            <span style={{ color: USER_LEXICON_COLOR }} className="font-bold">
              {domain}
            </span>{' '}
            registered. Add terms and their universal concept mappings.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div>
              <label className="block text-[10px] font-mono text-black-500 mb-1.5 uppercase tracking-wider">
                Your Term
              </label>
              <input
                type="text"
                value={newTerm.term}
                onChange={(e) => setNewTerm(t => ({ ...t, term: e.target.value }))}
                placeholder="e.g. triage"
                className="w-full bg-black-900/80 border border-black-700 rounded-lg px-3 py-2 text-sm text-white font-mono placeholder-black-600 focus:outline-none focus:border-matrix-600 transition-colors"
              />
            </div>
            <div>
              <label className="block text-[10px] font-mono text-black-500 mb-1.5 uppercase tracking-wider">
                Universal Concept
              </label>
              <input
                type="text"
                value={newTerm.universal}
                onChange={(e) => setNewTerm(t => ({ ...t, universal: e.target.value }))}
                placeholder="e.g. priority_sorting"
                className="w-full bg-black-900/80 border border-black-700 rounded-lg px-3 py-2 text-sm text-white font-mono placeholder-black-600 focus:outline-none focus:border-matrix-600 transition-colors"
              />
            </div>
            <div>
              <label className="block text-[10px] font-mono text-black-500 mb-1.5 uppercase tracking-wider">
                Description (opt.)
              </label>
              <input
                type="text"
                value={newTerm.description}
                onChange={(e) => setNewTerm(t => ({ ...t, description: e.target.value }))}
                placeholder="Short description"
                className="w-full bg-black-900/80 border border-black-700 rounded-lg px-3 py-2 text-sm text-white font-mono placeholder-black-600 focus:outline-none focus:border-matrix-600 transition-colors"
              />
            </div>
          </div>

          <button
            onClick={handleAddTerm}
            disabled={!newTerm.term.trim() || !newTerm.universal.trim()}
            className={`w-full py-2.5 rounded-lg font-mono text-sm font-bold transition-all ${
              newTerm.term.trim() && newTerm.universal.trim()
                ? 'hover:opacity-90 active:scale-[0.99] text-black-900'
                : 'bg-black-800 text-black-600 cursor-not-allowed'
            }`}
            style={
              newTerm.term.trim() && newTerm.universal.trim()
                ? { backgroundColor: USER_LEXICON_COLOR }
                : {}
            }
          >
            + Add Term
          </button>

          <button
            onClick={() => { setPhase('register'); setDomain(''); setStatus(null) }}
            className="w-full py-1.5 rounded-lg font-mono text-xs text-black-500 hover:text-black-400 transition-colors border border-black-800 hover:border-black-700"
          >
            Register another domain
          </button>
        </div>
      )}

      {/* Status message */}
      <AnimatePresence>
        {status && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className={`mt-3 p-2.5 rounded-lg text-xs font-mono text-center ${
              status.type === 'success'
                ? 'bg-matrix-500/10 text-matrix-400 border border-matrix-500/20'
                : 'bg-red-500/10 text-red-400 border border-red-500/20'
            }`}
          >
            {status.message}
          </motion.div>
        )}
      </AnimatePresence>
    </GlassCard>
  )
}


// ============ Sentence Translator ============

// Example sentences keyed by lexicon id for the placeholder hints
const EXAMPLE_SENTENCES = {
  medicine:     'The differential diagnosis revealed comorbidities requiring prophylactic treatment.',
  engineering:  'The safety factor exceeded the yield strength preventing buckling under thermal expansion.',
  law:          'The proximate cause established liability triggering indemnity under the contract.',
  trading:      'Momentum divergence at resistance triggered a fade entry with tight stop loss.',
  education:    'Scaffolding supports formative assessment to reach the zone of proximal development.',
  psychology:   'Confirmation bias and anchoring distorted the self efficacy of the group.',
  music:        'The dissonance resolved through counterpoint establishing a new harmonic cadence.',
  agriculture:  'Crop rotation and companion planting improved soil health after the fallow period.',
  philosophy:   'The dialectic tension between epistemology and ontology reveals a foundational axiom.',
  military:     'Asymmetric tactics exploited the decisive point via superior operational security.',
  cooking:      'Mise en place and deglazing built flavor layering through the Maillard reaction.',
  sports:       'Overreaching broke the plateau, periodization and active recovery restored peak output.',
  architecture: 'The parti drove fenestration choices along the datum respecting the genius loci.',
  journalism:   'The lede confirmed attribution and the inverted pyramid preserved editorial independence.',
  nyx:          'The directive restored coherence after the epoch change invalidated the audit trail.',
  poseidon:     'Liquidity depth absorbed slippage and the oracle prevented clearing price manipulation.',
  athena:       'The pivot exposed the tradeoff between optionality and the network effect flywheel.',
  hephaestus:   'Refactoring addressed tech debt and CI CD enforced idempotent deployment contracts.',
  hermes:       'Webhook latency exceeded the timeout and the circuit breaker triggered a backpressure retry.',
  apollo:       'The TWAP filtered noise and outlier regression revealed a meaningful signal correlation.',
}

function confidenceColor(confidence) {
  if (confidence >= 90) return '#00ff41'
  if (confidence >= 60) return '#fbbf24'
  return '#f97316'
}

function HighlightedText({ segments, onTermClick, activeTermIndex }) {
  return (
    <div className="text-sm leading-relaxed font-mono text-white/90 whitespace-pre-wrap break-words">
      {segments.map((seg, i) => {
        if (seg.type === 'text') {
          return <span key={i}>{seg.text}</span>
        }
        const color = seg.toTerm ? confidenceColor(seg.confidence) : '#94a3b8'
        const isActive = activeTermIndex === i
        return (
          <span
            key={i}
            onClick={() => onTermClick(i)}
            className="relative cursor-pointer rounded px-0.5 transition-all duration-150"
            style={{
              backgroundColor: isActive ? color + '25' : color + '15',
              borderBottom: '2px solid ' + color,
              color: color,
            }}
            title={seg.term + ' -> ' + (seg.toTerm || '(no equivalent)') + ' [' + seg.universal + ']'}
          >
            {seg.text}
          </span>
        )
      })}
    </div>
  )
}

function TermTooltipPanel({ segment, fromMeta, toMeta }) {
  if (!segment || segment.type !== 'term') return null
  const fromColor = fromMeta?.color || '#94a3b8'
  const toColor   = toMeta?.color   || '#94a3b8'
  const hasTranslation = !!segment.toTerm
  return (
    <motion.div
      key={segment.term + segment.text}
      initial={{ opacity: 0, y: 8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -4, scale: 0.97 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className="mt-3 p-3 rounded-xl border"
      style={{
        background: 'rgba(8,12,8,0.85)',
        borderColor: hasTranslation ? confidenceColor(segment.confidence) + '30' : 'rgba(37,37,37,0.8)',
      }}
    >
      <div className="flex items-center gap-3 mb-2">
        <div className="flex-1 text-center">
          <div className="flex items-center justify-center gap-1.5 mb-0.5">
            <AgentDot color={fromColor} size={5} />
            <span className="text-[9px] font-mono text-black-500">{fromMeta?.name}</span>
          </div>
          <span className="text-white text-xs font-mono font-semibold">{segment.text}</span>
          {segment.fromDesc && (
            <p className="text-[9px] font-mono text-black-600 mt-0.5 leading-snug">{segment.fromDesc}</p>
          )}
        </div>
        <div className="flex flex-col items-center gap-0.5 flex-shrink-0">
          <svg className="w-4 h-4 text-matrix-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
          </svg>
          <span className="text-[7px] font-mono text-black-700">UNIVERSAL</span>
        </div>
        <div className="flex-1 text-center">
          <div className="flex items-center justify-center gap-1.5 mb-0.5">
            <AgentDot color={toColor} size={5} />
            <span className="text-[9px] font-mono text-black-500">{toMeta?.name}</span>
          </div>
          {hasTranslation ? (
            <>
              <span className="text-xs font-mono font-semibold" style={{ color: confidenceColor(segment.confidence) }}>
                {segment.toTerm?.replace(/_/g, ' ')}
              </span>
              {segment.toDesc && (
                <p className="text-[9px] font-mono text-black-600 mt-0.5 leading-snug">{segment.toDesc}</p>
              )}
            </>
          ) : (
            <span className="text-[10px] font-mono text-black-600">no equivalent</span>
          )}
        </div>
      </div>
      <div className="flex items-center justify-center gap-1.5 pt-2 border-t border-black-800/60">
        <span className="text-[9px] font-mono text-black-600 uppercase tracking-wider">Universal concept:</span>
        <span className="text-[9px] font-mono text-matrix-500 font-semibold">{segment.universal}</span>
        {segment.confidence > 0 && (
          <span className="text-[8px] font-mono font-bold ml-1" style={{ color: confidenceColor(segment.confidence) }}>
            {segment.confidence}%
          </span>
        )}
      </div>
    </motion.div>
  )
}

function SentenceTranslator({ userLexicons = [] }) {
  const [stFromId, setStFromId] = useState('medicine')
  const [stToId, setStToId]     = useState('engineering')
  const [sourceText, setSourceText] = useState(
    'The differential diagnosis revealed comorbidities requiring prophylactic treatment.'
  )
  const [result, setResult]         = useState(null)
  const [activeTermIdx, setActiveTermIdx] = useState(null)
  const [copied, setCopied]         = useState(false)

  const handleStFromChange = useCallback((id) => {
    setStFromId(id)
    setResult(null)
    setActiveTermIdx(null)
    const example = EXAMPLE_SENTENCES[id]
    if (example) setSourceText(example)
  }, [])

  const handleStToChange = useCallback((id) => {
    setStToId(id)
    setResult(null)
    setActiveTermIdx(null)
  }, [])

  const handleTranslate = useCallback(() => {
    if (!stFromId || !stToId || !sourceText.trim()) return
    const r = translateSentence(stFromId, sourceText.trim(), stToId)
    setResult(r)
    setActiveTermIdx(null)
  }, [stFromId, stToId, sourceText])

  const handleTermClick = useCallback((idx) => {
    setActiveTermIdx(prev => prev === idx ? null : idx)
  }, [])

  const handleCopy = useCallback(() => {
    if (!result?.translatedText) return
    navigator.clipboard.writeText(result.translatedText).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [result])

  const activeSegment = result && activeTermIdx !== null ? result.segments[activeTermIdx] : null

  function getLexiconMeta(id) {
    if (!id) return null
    if (id.startsWith('user:')) {
      const userId = id.slice(5)
      const lex = userLexicons.find(u => u.userId === userId)
      return { name: lex?.domain || userId, color: USER_LEXICON_COLOR }
    }
    return AGENT_MAP[id] || null
  }

  const fromMeta = getLexiconMeta(stFromId)
  const toMeta   = getLexiconMeta(stToId)

  const termSegments = useMemo(
    () => (result ? result.segments.filter(s => s.type === 'term') : []),
    [result]
  )

  const canTranslate = stFromId && stToId && sourceText.trim().length > 0

  return (
    <GlassCard glowColor="matrix" spotlight className="p-5 mb-6">
      <div className="flex items-start justify-between mb-1">
        <div>
          <h2 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
            Sentence Translator
            <span
              className="text-[9px] font-mono font-bold px-2 py-0.5 rounded-full"
              style={{ backgroundColor: 'rgba(0,255,65,0.12)', color: '#00ff41' }}
            >
              NEW
            </span>
          </h2>
          <p className="text-black-500 text-[10px] font-mono mt-0.5">
            Paste a paragraph from your field. Every recognized term is highlighted and translated. Click any highlighted word to reveal the universal concept.
          </p>
        </div>
      </div>

      {/* Domain selectors */}
      <div className="flex gap-3 mt-4 mb-3">
        <LexiconSelect
          label="Source Domain"
          value={stFromId}
          onChange={handleStFromChange}
          excludeId={stToId}
          userLexicons={userLexicons}
        />
        <div className="flex items-end pb-0.5">
          <button
            onClick={() => {
              const tmp = stFromId
              handleStFromChange(stToId)
              handleStToChange(tmp)
            }}
            className="w-8 h-9 flex items-center justify-center rounded-lg border border-black-700 bg-black-900/60 text-black-500 hover:text-matrix-400 hover:border-matrix-700 transition-colors"
            title="Swap domains"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
            </svg>
          </button>
        </div>
        <LexiconSelect
          label="Target Domain"
          value={stToId}
          onChange={handleStToChange}
          excludeId={stFromId}
          userLexicons={userLexicons}
        />
      </div>

      {/* Two-panel layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left: source input */}
        <div>
          <label className="flex items-center gap-1.5 text-[10px] font-mono text-black-500 mb-1.5 uppercase tracking-wider">
            <AgentDot color={fromMeta?.color || '#94a3b8'} size={6} />
            Source — {fromMeta?.name || 'Domain'}
          </label>
          <div className="relative">
            <textarea
              id="rosetta-sentence-textarea"
              value={sourceText}
              onChange={(e) => { setSourceText(e.target.value); setResult(null); setActiveTermIdx(null) }}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleTranslate() }}
              rows={5}
              placeholder="Paste a paragraph from your field..."
              className="w-full bg-black-900/80 border border-black-700 rounded-lg px-3 py-2.5 text-sm text-white font-mono placeholder-black-600 focus:outline-none focus:border-matrix-600 transition-colors resize-none"
            />
            <span className="absolute bottom-2 right-3 text-[9px] font-mono text-black-700">Ctrl+Enter</span>
          </div>
          <button
            onClick={handleTranslate}
            disabled={!canTranslate}
            className={'w-full mt-2 py-2.5 rounded-lg font-mono text-sm font-bold transition-all ' + (
              canTranslate
                ? 'bg-matrix-600 text-black-900 hover:bg-matrix-500 active:scale-[0.99]'
                : 'bg-black-800 text-black-600 cursor-not-allowed'
            )}
          >
            Translate Paragraph
          </button>
        </div>

        {/* Right: annotated output */}
        <div>
          <label className="flex items-center gap-1.5 text-[10px] font-mono text-black-500 mb-1.5 uppercase tracking-wider">
            <AgentDot color={toMeta?.color || '#94a3b8'} size={6} />
            Translated — {toMeta?.name || 'Domain'}
          </label>

          {result ? (
            <div className="space-y-3">
              {/* Annotated source view with clickable highlights */}
              <div className="p-3 bg-black-900/60 rounded-lg border border-black-800 min-h-[100px]">
                <div className="text-[9px] font-mono text-black-600 uppercase tracking-wider mb-2">
                  Annotated source — click highlighted terms
                </div>
                <HighlightedText
                  segments={result.segments}
                  onTermClick={handleTermClick}
                  activeTermIndex={activeTermIdx}
                />
              </div>

              {/* Clean translated output */}
              <div className="relative p-3 bg-black-900/60 rounded-lg border border-matrix-800/30 min-h-[80px]">
                <div className="text-[9px] font-mono text-black-600 uppercase tracking-wider mb-2">
                  Translated output
                </div>
                <p className="text-sm font-mono text-white/90 leading-relaxed whitespace-pre-wrap break-words pr-6">
                  {result.translatedText}
                </p>
                <button
                  onClick={handleCopy}
                  className="absolute top-2 right-2 text-black-600 hover:text-matrix-400 transition-colors"
                  title="Copy translated text"
                >
                  {copied ? (
                    <svg className="w-3.5 h-3.5 text-matrix-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  )}
                </button>
              </div>

              {/* Stats */}
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-[10px] font-mono text-black-500">
                  {result.matchCount} term{result.matchCount !== 1 ? 's' : ''} recognized
                </span>
                <span className="text-black-700 text-[10px]">/</span>
                <span className="text-[10px] font-mono" style={{ color: '#00ff41' }}>
                  {result.translatedCount} translated
                </span>
                {result.matchCount > result.translatedCount && (
                  <>
                    <span className="text-black-700 text-[10px]">/</span>
                    <span className="text-[10px] font-mono text-black-500">
                      {result.matchCount - result.translatedCount} no equivalent
                    </span>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-[220px] rounded-lg border border-black-800 border-dashed">
              <div className="text-center">
                <p className="text-black-600 text-xs font-mono">Translation appears here</p>
                <p className="text-black-800 text-[10px] font-mono mt-1">Hit Translate Paragraph to begin</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Term detail tooltip */}
      <AnimatePresence>
        {activeSegment && (
          <TermTooltipPanel
            key={activeTermIdx}
            segment={activeSegment}
            fromMeta={fromMeta}
            toMeta={toMeta}
          />
        )}
      </AnimatePresence>

      {/* Term glossary chips */}
      {result && termSegments.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
          className="mt-4 pt-4 border-t border-black-800"
        >
          <div className="text-[9px] font-mono text-black-600 uppercase tracking-wider mb-2">
            Term map — {termSegments.length} domain term{termSegments.length !== 1 ? 's' : ''} detected
          </div>
          <div className="flex flex-wrap gap-1.5">
            {termSegments.map((seg, chipIdx) => {
              const color = seg.toTerm ? confidenceColor(seg.confidence) : '#94a3b8'
              let segIdx = -1
              let count = 0
              for (let si = 0; si < result.segments.length; si++) {
                if (result.segments[si].type === 'term') {
                  if (count === chipIdx) { segIdx = si; break }
                  count++
                }
              }
              const isActive = activeTermIdx === segIdx
              return (
                <button
                  key={'chip-' + chipIdx}
                  onClick={() => segIdx !== -1 && handleTermClick(segIdx)}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-mono transition-all"
                  style={{
                    backgroundColor: isActive ? color + '25' : color + '12',
                    border: '1px solid ' + (isActive ? color : color + '40'),
                    color: color,
                  }}
                >
                  <span>{seg.text}</span>
                  {seg.toTerm && (
                    <>
                      <svg className="w-2.5 h-2.5 mx-0.5 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                      </svg>
                      <span style={{ opacity: 0.8 }}>{seg.toTerm.replace(/_/g, ' ')}</span>
                    </>
                  )}
                </button>
              )
            })}
          </div>
        </motion.div>
      )}
    </GlassCard>
  )
}


// ============ Related Concepts Panel ============

function RelatedConceptsPanel({ universalKey, onClose, userLexicons = [] }) {
  const data = useMemo(() => getRelatedConcepts(universalKey), [universalKey])
  if (!data) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.97 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="mt-4 rounded-xl border overflow-hidden"
      style={{ background: 'rgba(8,12,8,0.92)', borderColor: 'rgba(0,255,65,0.2)' }}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'rgba(0,255,65,0.12)' }}>
        <div className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: '#00ff41', boxShadow: '0 0 6px #00ff4180' }} />
          <span className="text-[11px] font-mono font-semibold text-white">{universalKey}</span>
          {data.found && (
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'rgba(0,255,65,0.1)', color: '#00ff41' }}>
              {data.sourceLexiconCount} domain{data.sourceLexiconCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <button onClick={onClose} className="text-black-600 hover:text-black-400 transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="p-4">
        {data.definition && <p className="text-[11px] font-mono text-black-400 mb-3 italic">{data.definition}</p>}
        {!data.found ? (
          <p className="text-[11px] font-mono text-black-500">{data.error}</p>
        ) : data.related.length === 0 ? (
          <p className="text-[11px] font-mono text-black-500">No related concepts found.</p>
        ) : (
          <>
            <div className="text-[9px] font-mono text-black-600 uppercase tracking-wider mb-2">
              Conceptual neighbors &mdash; sorted by co-occurrence
            </div>
            <div className="space-y-1.5 max-h-72 overflow-y-auto scrollbar-thin pr-1">
              {data.related.map((rel, i) => (
                <motion.div
                  key={rel.universal}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.025 }}
                  className="p-2.5 rounded-lg border"
                  style={{ backgroundColor: 'rgba(15,20,15,0.5)', borderColor: 'rgba(37,37,37,0.8)' }}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-white text-[11px] font-mono font-semibold">{rel.universal}</span>
                    <span className="text-[8px] font-mono font-bold px-1 py-0.5 rounded flex-shrink-0" style={{ backgroundColor: 'rgba(0,255,65,0.1)', color: '#00ff41' }}>
                      {rel.coOccurrenceScore}
                    </span>
                  </div>
                  {rel.definition && <p className="text-[10px] font-mono text-black-500 mb-1.5">{rel.definition}</p>}
                  {rel.sampleTerms.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {rel.sampleTerms.map((st, si) => {
                        const meta = getLexiconLabel(st.lexicon, userLexicons)
                        if (!meta) return null
                        return (
                          <span key={si} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono"
                            style={{ backgroundColor: `${meta.color}14`, border: `1px solid ${meta.color}2a`, color: meta.color }}>
                            <span className="inline-block rounded-full flex-shrink-0" style={{ width: 4, height: 4, backgroundColor: meta.color }} />
                            {st.term}
                          </span>
                        )
                      })}
                    </div>
                  )}
                </motion.div>
              ))}
            </div>
          </>
        )}
      </div>
    </motion.div>
  )
}

// ============ Concept Chain Finder ============

function getNodeColor(universalKey) {
  for (const [id, lex] of Object.entries(LEXICONS)) {
    for (const [, mapping] of Object.entries(lex.concepts)) {
      if (mapping.universal === universalKey) {
        const isAgent = AI_AGENT_IDS.includes(id)
        return isAgent ? (AGENT_COLORS[id] || '#00ff41') : (HUMAN_DOMAIN_COLORS[id] || '#94a3b8')
      }
    }
  }
  return '#00ff41'
}

function ConceptChainFinder({ userLexicons = [] }) {
  const [termA, setTermA] = useState('')
  const [termB, setTermB] = useState('')
  const [result, setResult] = useState(null)
  const [selectedNode, setSelectedNode] = useState(null)

  const handleFind = useCallback(() => {
    if (!termA.trim() || !termB.trim()) return
    setSelectedNode(null)
    setResult(getConceptChain(termA.trim().toLowerCase(), termB.trim().toLowerCase()))
  }, [termA, termB])

  const handleKey = useCallback((e) => {
    if (e.key === 'Enter' && termA.trim() && termB.trim()) handleFind()
  }, [termA, termB, handleFind])

  const handleNodeClick = useCallback((k) => setSelectedNode(prev => prev === k ? null : k), [])
  const isDirect = result?.found && result?.hops === 0

  return (
    <GlassCard glowColor="matrix" spotlight className="p-5 mb-6">
      <div className="flex items-start justify-between mb-1">
        <div>
          <h2 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
            Concept Chain
            <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: 'rgba(0,255,65,0.12)', color: '#00ff41' }}>NEW</span>
          </h2>
          <p className="text-black-500 text-[10px] font-mono mt-0.5">
            Find the shortest path between any two terms through the universal concept graph. Click any node to explore its neighbors.
          </p>
        </div>
      </div>

      {/* Inputs */}
      <div className="flex flex-col sm:flex-row gap-2 mt-4">
        <div className="flex-1">
          <label className="block text-[10px] font-mono text-black-500 mb-1.5 uppercase tracking-wider">Term A</label>
          <input id="rosetta-chain-term-a" type="text" value={termA}
            onChange={(e) => { setTermA(e.target.value); setResult(null); setSelectedNode(null) }}
            onKeyDown={handleKey}
            placeholder="e.g. triage, liquidity, cadence..."
            className="w-full bg-black-900/80 border border-black-700 rounded-lg px-3 py-2.5 text-sm text-white font-mono placeholder-black-600 focus:outline-none focus:border-matrix-600 transition-colors"
          />
        </div>
        <div className="flex items-end pb-0.5 flex-shrink-0">
          <div className="w-8 h-9 flex items-center justify-center text-black-600 text-lg font-mono select-none">&#8596;</div>
        </div>
        <div className="flex-1">
          <label className="block text-[10px] font-mono text-black-500 mb-1.5 uppercase tracking-wider">Term B</label>
          <input type="text" value={termB}
            onChange={(e) => { setTermB(e.target.value); setResult(null); setSelectedNode(null) }}
            onKeyDown={handleKey}
            placeholder="e.g. leverage, fault tolerance..."
            className="w-full bg-black-900/80 border border-black-700 rounded-lg px-3 py-2.5 text-sm text-white font-mono placeholder-black-600 focus:outline-none focus:border-matrix-600 transition-colors"
          />
        </div>
        <div className="flex items-end pb-0.5 flex-shrink-0">
          <button onClick={handleFind} disabled={!termA.trim() || !termB.trim()}
            className={`px-5 h-9 rounded-lg font-mono text-sm font-bold transition-all ${termA.trim() && termB.trim() ? 'bg-matrix-600 text-black-900 hover:bg-matrix-500 active:scale-[0.99]' : 'bg-black-800 text-black-600 cursor-not-allowed'}`}
          >
            Find Path
          </button>
        </div>
      </div>

      {/* Results */}
      <AnimatePresence mode="wait">
        {result && (
          <motion.div
            key={result.termA + '|' + result.termB}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3 }}
            className="mt-5"
          >
            {/* Error */}
            {!result.found && result.error && (
              <div className="p-4 rounded-xl border text-center" style={{ backgroundColor: 'rgba(239,68,68,0.06)', borderColor: 'rgba(239,68,68,0.2)' }}>
                <p className="text-red-400 text-xs font-mono">{result.error}</p>
                {result.suggestions?.length > 0 && (
                  <div className="mt-2">
                    <span className="text-[10px] font-mono text-black-500">Did you mean: </span>
                    {result.suggestions.map((s) => (
                      <button key={s}
                        onClick={() => { if (result.error?.includes(`'${termA}'`)) setTermA(s); else setTermB(s); setResult(null) }}
                        className="text-[10px] font-mono text-matrix-400 hover:text-matrix-300 underline mx-1 transition-colors"
                      >{s}</button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Direct match */}
            {result.found && isDirect && (
              <div className="p-4 rounded-xl border text-center" style={{ backgroundColor: 'rgba(0,255,65,0.06)', borderColor: 'rgba(0,255,65,0.25)' }}>
                <div className="flex items-center justify-center gap-2 mb-2">
                  <svg className="w-5 h-5 text-matrix-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-matrix-400 font-mono font-bold text-sm">Direct match!</span>
                </div>
                <p className="text-[11px] font-mono text-black-400">
                  <span className="text-white font-semibold">&ldquo;{result.termA}&rdquo;</span>
                  {' '}and{' '}
                  <span className="text-white font-semibold">&ldquo;{result.termB}&rdquo;</span>
                  {' '}both map to the same universal concept.
                </p>
                {result.path[0] && (
                  <button onClick={() => handleNodeClick(result.path[0].node)}
                    className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border font-mono text-xs transition-all hover:opacity-80"
                    style={{ backgroundColor: 'rgba(0,255,65,0.1)', borderColor: 'rgba(0,255,65,0.3)', color: '#00ff41' }}
                  >
                    <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: '#00ff41', boxShadow: '0 0 5px #00ff4180' }} />
                    {result.path[0].node}
                  </button>
                )}
              </div>
            )}

            {/* Multi-hop chain */}
            {result.found && !isDirect && result.path.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[10px] font-mono text-black-500 uppercase tracking-wider">
                    {result.hops} hop{result.hops !== 1 ? 's' : ''}
                  </span>
                  <span className="text-[10px] font-mono text-black-700">/</span>
                  <span className="text-[10px] font-mono text-black-500">{result.path.length} nodes</span>
                  <span className="text-[10px] font-mono text-black-700">&mdash;</span>
                  <span className="text-[10px] font-mono text-black-500">click any node to explore</span>
                </div>

                {/* Chain — horizontally scrollable */}
                <div className="overflow-x-auto pb-2">
                  <div className="flex items-start gap-0 min-w-max">
                    {result.path.map((step, si) => {
                      const nodeColor = getNodeColor(step.node)
                      const isFirst = si === 0
                      const isLast = si === result.path.length - 1
                      const isSelected = selectedNode === step.node
                      const edgeLexicons = step.via?.sharedLexicons || []

                      return (
                        <div key={step.node + si} className="flex items-start">
                          {/* Node column */}
                          <div className="flex flex-col items-center w-32">
                            {/* Term badge */}
                            <div className="h-7 flex items-end mb-1">
                              {isFirst && step.termAMapping && (
                                <div className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-full border truncate max-w-[120px]"
                                  style={{ color: nodeColor, borderColor: `${nodeColor}40`, backgroundColor: `${nodeColor}0d` }}
                                  title={`${step.termAMapping.term} (${step.termAMapping.lexicon})`}
                                >
                                  &ldquo;{step.termAMapping.term}&rdquo;
                                </div>
                              )}
                              {isLast && step.termBMapping && (
                                <div className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-full border truncate max-w-[120px]"
                                  style={{ color: nodeColor, borderColor: `${nodeColor}40`, backgroundColor: `${nodeColor}0d` }}
                                  title={`${step.termBMapping.term} (${step.termBMapping.lexicon})`}
                                >
                                  &ldquo;{step.termBMapping.term}&rdquo;
                                </div>
                              )}
                            </div>

                            {/* Universal concept bubble */}
                            <button onClick={() => handleNodeClick(step.node)}
                              className="w-28 px-2 py-2 rounded-xl border font-mono text-[9px] font-semibold transition-all hover:opacity-80 active:scale-95 text-center leading-tight"
                              style={{
                                backgroundColor: isSelected ? `${nodeColor}20` : `${nodeColor}0e`,
                                borderColor: isSelected ? nodeColor : `${nodeColor}40`,
                                color: nodeColor,
                                boxShadow: isSelected ? `0 0 14px ${nodeColor}30` : 'none',
                              }}
                              title={step.definition || step.node}
                            >
                              {step.node}
                            </button>

                            {/* Shared lexicon pills below node */}
                            {edgeLexicons.length > 0 && (
                              <div className="mt-1.5 flex flex-wrap justify-center gap-0.5 max-w-[120px]">
                                {edgeLexicons.slice(0, 2).map((lex) => {
                                  const meta = getLexiconLabel(lex, userLexicons)
                                  return (
                                    <span key={lex} className="text-[7px] font-mono px-1 rounded"
                                      style={{ backgroundColor: meta ? `${meta.color}14` : 'rgba(37,37,37,0.6)', color: meta?.color || '#64748b' }}
                                    >
                                      {meta?.name || lex}
                                    </span>
                                  )
                                })}
                                {edgeLexicons.length > 2 && (
                                  <span className="text-[7px] font-mono text-black-700">+{edgeLexicons.length - 2}</span>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Arrow */}
                          {si < result.path.length - 1 && (
                            <div className="flex items-center self-start mt-10 mx-0.5 flex-shrink-0">
                              <svg className="w-5 h-5 text-black-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                              </svg>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Compact definitions list */}
                <div className="mt-4 space-y-1">
                  {result.path.map((step, si) => (
                    <div key={step.node + '-def-' + si} className="flex items-start gap-2 px-2.5 py-1.5 rounded-lg" style={{ backgroundColor: 'rgba(15,20,15,0.4)' }}>
                      <span className="inline-block w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" style={{ backgroundColor: getNodeColor(step.node) }} />
                      <div className="min-w-0">
                        <span className="text-[10px] font-mono font-semibold" style={{ color: getNodeColor(step.node) }}>{step.node}</span>
                        {step.definition && <span className="text-[10px] font-mono text-black-500 ml-2">{step.definition}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Related Concepts panel */}
            <AnimatePresence>
              {selectedNode && (
                <RelatedConceptsPanel
                  key={selectedNode}
                  universalKey={selectedNode}
                  onClose={() => setSelectedNode(null)}
                  userLexicons={userLexicons}
                />
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </GlassCard>
  )
}

// ============ Ten Covenants Section ============

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X']

const ENFORCEMENT_META = {
  hard:      { label: 'HARD',      bg: 'rgba(239,68,68,0.15)',   border: 'rgba(239,68,68,0.35)',   text: '#ef4444' },
  soft:      { label: 'SOFT',      bg: 'rgba(245,158,11,0.15)',  border: 'rgba(245,158,11,0.35)',  text: '#f59e0b' },
  immutable: { label: 'IMMUTABLE', bg: 'rgba(168,85,247,0.15)',  border: 'rgba(168,85,247,0.35)',  text: '#a855f7' },
  spirit:    { label: 'SPIRIT',    bg: 'rgba(16,185,129,0.15)',  border: 'rgba(16,185,129,0.35)',  text: '#10b981' },
}

function CovenantCard({ covenant, index }) {
  const [open, setOpen] = useState(false)
  const meta = ENFORCEMENT_META[covenant.enforcement] || ENFORCEMENT_META.soft
  const roman = ROMAN[index] || String(index + 1)

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.05, ease: "easeOut" }}
      className="relative rounded-xl overflow-hidden border"
      style={{
        background: "linear-gradient(135deg, rgba(10,10,10,0.95) 0%, rgba(18,14,8,0.95) 100%)",
        borderColor: "rgba(120,90,40,0.3)",
        boxShadow: "0 2px 16px rgba(0,0,0,0.5), inset 0 1px 0 rgba(212,170,80,0.06)",
      }}
    >
      {/* Stone texture overlay */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: "radial-gradient(ellipse at 50% 0%, rgba(212,170,80,0.04) 0%, transparent 60%)",
        }}
      />

      <div className="relative z-10 p-4">
        {/* Top row: Roman numeral + badge */}
        <div className="flex items-center justify-between mb-3">
          <span
            className="font-mono font-bold text-lg leading-none"
            style={{ color: "rgba(212,170,80,0.6)", textShadow: "0 0 12px rgba(212,170,80,0.2)" }}
          >
            {roman}
          </span>
          <span
            className="text-[9px] font-mono font-bold px-2 py-0.5 rounded-full tracking-widest uppercase"
            style={{ background: meta.bg, border: `1px solid ${meta.border}`, color: meta.text }}
          >
            {meta.label}
          </span>
        </div>

        {/* Covenant text */}
        <p
          className="text-sm font-mono leading-relaxed mb-3"
          style={{ color: "#d4aa50", textShadow: "0 0 8px rgba(212,170,80,0.1)" }}
        >
          {covenant.covenant}
        </p>

        {/* Collapsible spirit button */}
        <button
          onClick={() => setOpen(v => !v)}
          className="flex items-center gap-1.5 text-[10px] font-mono transition-colors"
          style={{ color: open ? "rgba(212,170,80,0.7)" : "rgba(100,80,40,0.8)" }}
        >
          <svg
            className="w-3 h-3 transition-transform"
            style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          {open ? "hide spirit" : "reveal spirit"}
        </button>

        {/* Spirit text — collapsible */}
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="overflow-hidden"
            >
              <div
                className="mt-3 pt-3 border-t text-[11px] font-mono leading-relaxed italic"
                style={{ borderColor: "rgba(120,90,40,0.25)", color: "rgba(180,140,60,0.7)" }}
              >
                {covenant.spirit}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}

function TenCovenantsSection() {
  const [hashCopied, setHashCopied] = useState(false)

  const handleCopyHash = useCallback(() => {
    navigator.clipboard.writeText(COVENANT_HASH).then(() => {
      setHashCopied(true)
      setTimeout(() => setHashCopied(false), 2000)
    })
  }, [])

  return (
    <div className="mb-8">
      {/* Section heading */}
      <div className="text-center mb-6">
        <h2
          className="text-2xl sm:text-3xl font-bold font-display uppercase tracking-widest"
          style={{ color: "#d4aa50", textShadow: "0 0 30px rgba(212,170,80,0.25)" }}
        >
          The Ten Covenants
        </h2>
        <p className="text-[11px] font-mono mt-1.5" style={{ color: "rgba(140,110,50,0.8)" }}>
          Tet&apos;s Law — The governance backbone of the Rosetta Protocol
        </p>

        {/* Covenant hash — prominent */}
        <div
          className="inline-flex items-center gap-2 mt-3 px-4 py-2 rounded-lg border"
          style={{
            background: "rgba(10,8,4,0.8)",
            borderColor: "rgba(120,90,40,0.4)",
            boxShadow: "0 0 20px rgba(212,170,80,0.08), inset 0 1px 0 rgba(212,170,80,0.05)",
          }}
        >
          <span className="text-[9px] font-mono uppercase tracking-widest" style={{ color: "rgba(120,90,40,0.8)" }}>
            Covenant Hash
          </span>
          <span
            className="text-[11px] font-mono font-bold tracking-wider"
            style={{ color: "#d4aa50" }}
          >
            0x{COVENANT_HASH}
          </span>
          <button
            onClick={handleCopyHash}
            className="transition-colors"
            title="Copy full hash"
            style={{ color: hashCopied ? "#10b981" : "rgba(140,110,50,0.7)" }}
          >
            {hashCopied ? (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            )}
          </button>
        </div>

        {/* Enforcement legend */}
        <div className="flex flex-wrap items-center justify-center gap-3 mt-4">
          {Object.entries(ENFORCEMENT_META).map(([key, m]) => (
            <span
              key={key}
              className="text-[9px] font-mono font-bold px-2.5 py-1 rounded-full tracking-widest uppercase"
              style={{ background: m.bg, border: `1px solid ${m.border}`, color: m.text }}
            >
              {m.label}
            </span>
          ))}
          <span className="text-[9px] font-mono" style={{ color: "rgba(80,65,35,0.8)" }}>
            — enforcement types
          </span>
        </div>
      </div>

      {/* Covenant cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {TEN_COVENANTS.map((covenant, i) => (
          <CovenantCard key={covenant.number} covenant={covenant} index={i} />
        ))}
      </div>
    </div>
  )
}

// ============ Popular Translations ============

const POPULAR_PAIRS = [
  {
    fromId: 'medicine',
    toId: 'engineering',
    term: 'diagnosis',
    fromColor: '#ef4444',
    toColor: '#f97316',
    insight: 'Root-cause analysis — isolate the fault before you fix anything.',
  },
  {
    fromId: 'trading',
    toId: 'medicine',
    term: 'liquidity',
    fromColor: '#eab308',
    toColor: '#ef4444',
    insight: 'Perfusion — resources must flow to where they are needed or the system fails.',
  },
  {
    fromId: 'cooking',
    toId: 'military',
    term: 'mise en place',
    fromColor: '#f59e0b',
    toColor: '#78716c',
    insight: 'OPSEC brief — arrange everything before the chaos starts, or it wins.',
  },
  {
    fromId: 'music',
    toId: 'psychology',
    term: 'cadence',
    fromColor: '#ec4899',
    toColor: '#8b5cf6',
    insight: 'Closure — the sequence resolves, the phrase ends, the mind can rest.',
  },
  {
    fromId: 'philosophy',
    toId: 'engineering',
    term: 'axiom',
    fromColor: '#06b6d4',
    toColor: '#f97316',
    insight: 'Spec — ground truth so basic it cannot be derived from anything simpler.',
  },
  {
    fromId: 'law',
    toId: 'trading',
    term: 'precedent',
    fromColor: '#6b7280',
    toColor: '#eab308',
    insight: 'Support level — a price the market tested and respected; it carries weight.',
  },
]
    fromColor: '#eab308',
    toColor: '#ef4444',
    insight: 'Perfusion — resources must flow to where they are needed or the system fails.',
  },
  {
    fromId: 'cooking',
    toId: 'military',
    term: 'mise en place',
    fromColor: '#f59e0b',
    toColor: '#78716c',
    insight: 'OPSEC brief — arrange everything before the chaos starts, or it wins.',
  },
  {
    fromId: 'music',
    toId: 'psychology',
    term: 'cadence',
    fromColor: '#ec4899',
    toColor: '#8b5cf6',
    insight: 'Closure — the sequence resolves, the phrase ends, the mind can rest.',
  },
  {
    fromId: 'philosophy',
    toId: 'engineering',
    term: 'axiom',
    fromColor: '#06b6d4',
    toColor: '#f97316',
    insight: 'Spec — ground truth so basic it cannot be derived from anything simpler.',
  },
  {
    fromId: 'law',
    toId: 'trading',
    term: 'precedent',
    fromColor: '#6b7280',
    toColor: '#eab308',
    insight: 'Support level — a price the market tested and respected; it carries weight.',
  },
]

function PopularTranslations({ onTryPair }) {
  return (
    <GlassCard glowColor="matrix" className="p-5 mb-6">
      <div className="flex items-start justify-between mb-1">
        <div>
          <h2 className="text-sm font-bold text-white uppercase tracking-wider">Popular Translations</h2>
          <p className="text-black-500 text-[10px] font-mono mt-0.5">
            Click any pair to pre-fill the translator and see it live.
          </p>
        </div>
        <span
          className="text-[9px] font-mono font-bold px-2 py-0.5 rounded-full flex-shrink-0 ml-4 mt-0.5"
          style={{ backgroundColor: 'rgba(0,255,65,0.1)', color: '#00ff41' }}
        >
          START HERE
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mt-4">
        {POPULAR_PAIRS.map((pair) => (
          <motion.button
            key={`${pair.fromId}-${pair.term}`}
            onClick={() => onTryPair(pair)}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="text-left p-3 rounded-xl border transition-all duration-200 group"
            style={{
              backgroundColor: 'rgba(10,16,10,0.7)',
              borderColor: 'rgba(0,255,65,0.12)',
            }}
          >
            {/* Domain route */}
            <div className="flex items-center gap-1.5 mb-2 flex-wrap">
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold"
                style={{ backgroundColor: `${pair.fromColor}18`, border: `1px solid ${pair.fromColor}35`, color: pair.fromColor }}
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: pair.fromColor }} />
                {pair.fromId.charAt(0).toUpperCase() + pair.fromId.slice(1)}
              </span>
              <svg className="w-3 h-3 text-black-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold"
                style={{ backgroundColor: `${pair.toColor}18`, border: `1px solid ${pair.toColor}35`, color: pair.toColor }}
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: pair.toColor }} />
                {pair.toId.charAt(0).toUpperCase() + pair.toId.slice(1)}
              </span>
            </div>

            {/* Term */}
            <div className="text-white text-sm font-mono font-semibold mb-1 group-hover:text-matrix-300 transition-colors">
              &ldquo;{pair.term}&rdquo;
            </div>

            {/* Insight */}
            <p className="text-[10px] font-mono text-black-500 leading-snug">{pair.insight}</p>

            {/* Try hint */}
            <div
              className="mt-2 text-[9px] font-mono font-bold uppercase tracking-wider opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ color: '#00ff41' }}
            >
              Try it &rarr;
            </div>
          </motion.button>
        ))}
      </div>
    </GlassCard>
  )
}

// ============ Example Translation Placeholder Cards ============

const EXAMPLE_PLACEHOLDER_PAIRS = [
  { fromId: 'medicine',  toId: 'engineering',  term: 'diagnosis',    fromLabel: 'Medicine',  toLabel: 'Engineering', fromColor: '#ef4444', toColor: '#f97316' },
  { fromId: 'cooking',   toId: 'military',     term: 'mise en place', fromLabel: 'Cooking',   toLabel: 'Military',    fromColor: '#f59e0b', toColor: '#78716c' },
  { fromId: 'trading',   toId: 'agriculture',  term: 'liquidity',     fromLabel: 'Trading',   toLabel: 'Agriculture', fromColor: '#eab308', toColor: '#84cc16' },
]

function ExampleTranslationCards({ onTry }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="mt-4"
    >
      <p className="text-[10px] font-mono text-black-600 mb-3 text-center uppercase tracking-wider">
        &mdash; or click an example to try instantly &mdash;
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {EXAMPLE_PLACEHOLDER_PAIRS.map((ex) => (
          <button
            key={`${ex.fromId}-${ex.term}`}
            onClick={() => onTry(ex)}
            className="text-left p-3 rounded-lg border transition-all hover:border-matrix-700/50 group"
            style={{ backgroundColor: 'rgba(8,12,8,0.6)', borderColor: 'rgba(30,40,30,0.8)' }}
          >
            <div className="text-[9px] font-mono text-black-600 mb-1">Try:</div>
            <div className="flex items-center gap-1 flex-wrap mb-1.5">
              <span className="text-[10px] font-mono font-semibold" style={{ color: ex.fromColor }}>
                {ex.fromLabel}
              </span>
              <svg className="w-2.5 h-2.5 text-black-700 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
              <span className="text-[10px] font-mono font-semibold" style={{ color: ex.toColor }}>
                {ex.toLabel}
              </span>
            </div>
            <div className="text-white text-xs font-mono font-bold group-hover:text-matrix-300 transition-colors">
              &ldquo;{ex.term}&rdquo;
            </div>
          </button>
        ))}
      </div>
    </motion.div>
  )
}

// ============ Theme Toggle Button ============

function ThemeToggle({ isDark, onToggle }) {
  return (
    <button
      onClick={onToggle}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="absolute top-0 right-0 z-20 flex items-center justify-center w-9 h-9 rounded-full border transition-all duration-200 hover:scale-110 active:scale-95"
      style={{
        backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
        borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)',
        color: isDark ? '#e2e8f0' : '#334155',
      }}
    >
      {isDark ? (
        /* Sun icon */
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <circle cx="12" cy="12" r="5" />
          <path strokeLinecap="round" d="M12 2v2m0 16v2M2 12h2m16 0h2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      ) : (
        /* Moon icon */
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z" />
        </svg>
      )}
    </button>
  )
}

// ============ Main Page Component ============

export default function RosettaPage() {
  // ---- Theme toggle (dark/light) — persisted to localStorage ----
  const [isDark, setIsDark] = useState(() => {
    try {
      const saved = localStorage.getItem('rosetta-theme')
      return saved ? saved === 'dark' : true
    } catch { return true }
  })

  const toggleTheme = useCallback(() => {
    setIsDark(prev => {
      const next = !prev
      try { localStorage.setItem('rosetta-theme', next ? 'dark' : 'light') } catch {}
      return next
    })
  }, [])

  // ---- Dual wallet pattern ----
  const { isConnected: isExternalConnected, address: externalAddress } = useWallet()
  const { isConnected: isDeviceConnected, address: deviceAddress } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected
  const userId = externalAddress || deviceAddress || null

  // ---- Translation state ----
  const [fromId, setFromId] = useState('')
  const [toId, setToId] = useState('')
  const [concept, setConcept] = useState('')
  const [translateAll, setTranslateAll] = useState(false)
  const [translationResult, setTranslationResult] = useState(null)
  const [translateAllResults, setTranslateAllResults] = useState(null)
  const translationResultRef = useRef(null)

  // ---- Protocol stats (computed client-side) ----
  const [protocolData] = useState(() => getProtocolStats())
  const [detailedStats] = useState(() => getDetailedStats())

  // ---- Agent lexicon: selected + computed terms ----
  const [selectedAgent, setSelectedAgent] = useState(null)

  // ---- User lexicons (re-computed on every registration) ----
  const [userLexicons, setUserLexicons] = useState(() => getAllUserLexicons())

  // ---- Refresh user lexicons after any registration / term add ----
  const refreshUserLexicons = useCallback(() => {
    setUserLexicons(getAllUserLexicons())
    // Force MyLexiconPanel to re-read storage by bumping a key
    setLexiconRevision(r => r + 1)
  }, [])

  const [lexiconRevision, setLexiconRevision] = useState(0)

  // ---- Compute agent lexicon terms on demand ----
  const lexiconTerms = selectedAgent
    ? Object.entries(LEXICONS[selectedAgent]?.concepts || {}).map(([term, m]) => ({
        term,
        universal: m.universal,
        description: m.desc,
      }))
    : null

  // ---- Translate handler (synchronous — no network) ----
  const handleTranslate = useCallback(() => {
    if (!fromId || !concept.trim()) return
    if (!translateAll && !toId) return

    setTranslationResult(null)
    setTranslateAllResults(null)

    if (translateAll) {
      const results = translateToAll(fromId, concept.trim())
      setTranslateAllResults(results)
    } else {
      const result = translate(fromId, toId, concept.trim())
      setTranslationResult(result)
    }

    // Smooth scroll to result after state update
    setTimeout(() => {
      translationResultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }, 80)
  }, [fromId, toId, concept, translateAll])

  // ---- Try a pre-filled example or popular pair ----
  const handleTryPair = useCallback((pair) => {
    setFromId(pair.fromId)
    setToId(pair.toId)
    setConcept(pair.term)
    setTranslateAll(false)
    setTranslationResult(null)
    setTranslateAllResults(null)
    // Auto-translate immediately
    const result = translate(pair.fromId, pair.toId, pair.term)
    setTranslationResult(result)
    setTimeout(() => {
      translationResultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }, 80)
  }, [])

  // ---- Derived ----
  const stats = {
    agents: protocolData.agent_count,
    terms: protocolData.total_terms,
    universals: protocolData.universal_count,
    covenantHash: COVENANT_HASH,
    userLexicons: userLexicons.length,
  }

  const agentTermCounts = protocolData.agent_terms || {}
  const canTranslate = fromId && concept.trim() && (translateAll || toId)

  // ---- Keyboard shortcuts ----
  const [showHelp, setShowHelp] = useState(false)

  // Reset parent-owned state. Sub-component inputs keep their local state;
  // the user can clear those by pressing Escape again while focused in them.
  const handleEscapeReset = useCallback(() => {
    setTranslationResult(null)
    setTranslateAllResults(null)
    setConcept('')
    setFromId('')
    setToId('')
    setTranslateAll(false)
    setShowHelp(false)
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
  }, [])

  useEffect(() => {
    const FOCUSABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])
    function isInputFocused() {
      const el = document.activeElement
      return el && (FOCUSABLE_TAGS.has(el.tagName) || el.isContentEditable)
    }
    function onKeyDown(e) {
      // Never intercept when modifiers are held (except Escape)
      if (e.key !== 'Escape' && (e.ctrlKey || e.metaKey || e.altKey)) return

      if (e.key === 'Escape') {
        if (showHelp) { setShowHelp(false); return }
        handleEscapeReset()
        return
      }

      // Remaining shortcuts: only fire when no input is focused
      if (isInputFocused()) return

      switch (e.key) {
        case '/': {
          e.preventDefault()
          document.getElementById('rosetta-discover-input')?.focus()
          break
        }
        case 't': {
          e.preventDefault()
          const el = document.getElementById('rosetta-translate-from')
          el?.focus()
          el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
          break
        }
        case 's': {
          e.preventDefault()
          const el = document.getElementById('rosetta-sentence-textarea')
          el?.focus()
          el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
          break
        }
        case 'c': {
          e.preventDefault()
          const el = document.getElementById('rosetta-chain-term-a')
          el?.focus()
          el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
          break
        }
        case '?': {
          e.preventDefault()
          setShowHelp(v => !v)
          break
        }
        default:
          break
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [showHelp, handleEscapeReset])

  return (
    <div className={`max-w-5xl mx-auto px-4 py-6${isDark ? '' : ' rosetta-light'}`}>

      {/* ============ Hero Section ============ */}
      <motion.div
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className="relative text-center mb-6 overflow-visible"
      >
        {/* Theme toggle — top right */}
        <ThemeToggle isDark={isDark} onToggle={toggleTheme} />

        {/* Glow halo behind title */}
        <div
          className="absolute left-1/2 -translate-x-1/2 -top-4 w-96 h-24 pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse at center, rgba(0,255,65,0.12) 0%, transparent 70%)',
            filter: 'blur(20px)',
          }}
        />
        <h1 className="relative text-3xl sm:text-5xl font-bold text-white font-display uppercase tracking-tight">
          Rosetta Stone{' '}
          <span
            className="text-matrix-500"
            style={{ textShadow: '0 0 30px rgba(0,255,65,0.4)' }}
          >
            Protocol
          </span>
        </h1>
        <p className="text-black-300 text-sm sm:text-base mt-3 max-w-xl mx-auto leading-relaxed">
          24 lexicons. 510 terms. 242 universal concepts.{' '}
          <span className="text-white font-semibold">Every domain speaks every other domain.</span>
        </p>

        {/* Animated stat counters */}
        <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-8 mt-5">
          {[
            { label: 'Lexicons', value: ALL_LEXICONS.length, color: '#00ff41' },
            { label: 'Terms', value: stats.terms, color: '#22d3ee' },
            { label: 'Concepts', value: stats.universals, color: '#a855f7' },
            { label: 'Covenants', value: 10, color: '#d4aa50' },
          ].map((s) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="text-center"
            >
              <div
                className="text-2xl sm:text-3xl font-bold font-mono"
                style={{ color: s.color, textShadow: `0 0 16px ${s.color}50` }}
              >
                <AnimatedCounter target={s.value} duration={1400} />
              </div>
              <div className="text-[10px] font-mono text-black-500 uppercase tracking-wider mt-0.5">
                {s.label}
              </div>
            </motion.div>
          ))}
        </div>

        {/* One-sentence intro for first-time visitors */}
        <p className="text-black-400 text-xs sm:text-sm font-mono mt-4 max-w-2xl mx-auto leading-relaxed px-2">
          Pick any term from your field and instantly see what every other domain calls the same idea &mdash; medicine, engineering, law, music, trading, and more share a hidden universal language.
        </p>

        {/* Subtitle line */}
        <p className="text-black-600 text-[10px] font-mono mt-3">
          Runs 100% client-side — AI Agents + Human Domains + User Lexicons
        </p>
      </motion.div>

      {/* ============ Did You Know? ============ */}
      <DidYouKnow />

      {/* ============ Popular Translations — first-time onboarding ============ */}
      <PopularTranslations onTryPair={handleTryPair} />

      {/* ============ Protocol Stats — compact ============ */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-6">
        {[
          { label: 'AI Agents', value: AGENT_LEXICONS.length },
          { label: 'Human Domains', value: HUMAN_LEXICONS.length },
          {
            label: 'Covenant Hash',
            value: stats.covenantHash
              ? `0x${stats.covenantHash.slice(0, 6)}…${stats.covenantHash.slice(-4)}`
              : '--',
            copyable: stats.covenantHash,
          },
          { label: 'User Lexicons', value: stats.userLexicons, accent: USER_LEXICON_COLOR },
        ].map((s) => (
          <div
            key={s.label}
            className="text-center p-2.5 bg-black-800/40 border border-black-700/50 rounded-lg"
            style={s.accent ? { borderColor: `${s.accent}30` } : {}}
          >
            <div className="flex items-center justify-center gap-1">
              <span
                className="font-mono font-bold text-sm"
                style={s.accent ? { color: s.accent } : { color: '#ffffff' }}
              >
                {s.value}
              </span>
              {s.copyable && <CopyButton text={s.copyable} />}
            </div>
            <div className="text-black-500 text-[10px] font-mono">{s.label}</div>
          </div>
        ))}
      </div>

      {/* ============ Concept Explorer ============ */}
      <ConceptExplorer userLexicons={userLexicons} />

      {/* ============ Discover Section ============ */}
      <DiscoverSection />

      {/* ============ Sentence Translator ============ */}
      <SentenceTranslator userLexicons={userLexicons} />

      {/* ============ Concept Chain ============ */}
      <ConceptChainFinder userLexicons={userLexicons} />

      {/* ============ Translation Interface ============ */}
      <GlassCard glowColor="matrix" className="p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-white uppercase tracking-wider">Translate</h2>

          {/* Translate-All Toggle */}
          <button
            onClick={() => {
              setTranslateAll(!translateAll)
              setTranslationResult(null)
              setTranslateAllResults(null)
            }}
            className={`flex items-center gap-2 text-[10px] font-mono px-3 py-1.5 rounded-full transition-colors ${
              translateAll
                ? 'bg-terminal-600/20 text-terminal-400 border border-terminal-600/40'
                : 'bg-black-800/60 text-black-400 border border-black-700 hover:border-black-600'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full transition-colors ${
                translateAll ? 'bg-terminal-400' : 'bg-black-600'
              }`}
            />
            Translate to All
          </button>
        </div>

        {/* Lexicon Selects */}
        <div className="flex items-end gap-2 mb-3">
          <LexiconSelect
            label="From Lexicon"
            value={fromId}
            onChange={(v) => {
              setFromId(v)
              setTranslationResult(null)
              setTranslateAllResults(null)
            }}
            excludeId={toId}
            userLexicons={userLexicons}
            selectId="rosetta-translate-from"
          />

          {!translateAll && (
            <>
              {/* Swap button */}
              <motion.button
                onClick={() => {
                  const prevFrom = fromId
                  const prevTo = toId
                  setFromId(prevTo)
                  setToId(prevFrom)
                  setTranslationResult(null)
                  setTranslateAllResults(null)
                }}
                disabled={!fromId || !toId}
                whileHover={{ scale: fromId && toId ? 1.1 : 1 }}
                whileTap={{ scale: fromId && toId ? 0.92 : 1, rotate: fromId && toId ? 180 : 0 }}
                className="flex-shrink-0 w-9 h-9 mb-0.5 rounded-full flex items-center justify-center border transition-all"
                style={
                  fromId && toId
                    ? { backgroundColor: 'rgba(0,255,65,0.1)', borderColor: 'rgba(0,255,65,0.35)', color: '#00ff41' }
                    : { backgroundColor: 'rgba(30,30,30,0.6)', borderColor: 'rgba(60,60,60,0.5)', color: '#374151' }
                }
                title="Swap lexicons"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                </svg>
              </motion.button>

              <LexiconSelect
                label="To Lexicon"
                value={toId}
                onChange={(v) => {
                  setToId(v)
                  setTranslationResult(null)
                  setTranslateAllResults(null)
                }}
                excludeId={fromId}
                userLexicons={userLexicons}
              />
            </>
          )}
        </div>

        {/* Concept Input */}
        <div className="mb-3">
          <label className="block text-[10px] font-mono text-black-500 mb-1.5 uppercase tracking-wider">
            Concept
          </label>
          <input
            type="text"
            value={concept}
            onChange={(e) => setConcept(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && canTranslate) handleTranslate() }}
            placeholder="Enter a term or concept to translate..."
            className="w-full bg-black-900/80 border border-black-700 rounded-lg px-3 py-2.5 text-sm text-white font-mono placeholder-black-600 focus:outline-none focus:border-matrix-600 transition-colors"
          />
        </div>

        {/* Translate Button */}
        <button
          onClick={handleTranslate}
          disabled={!canTranslate}
          className={`w-full py-2.5 rounded-lg font-mono text-sm font-bold transition-all ${
            canTranslate
              ? 'bg-matrix-600 text-black-900 hover:bg-matrix-500 active:scale-[0.99]'
              : 'bg-black-800 text-black-600 cursor-not-allowed'
          }`}
        >
          {translateAll ? 'Translate to All Lexicons' : 'Translate'}
        </button>

        {/* Results */}
        <div ref={translationResultRef}>
          <AnimatePresence mode="wait">
            {translationResult && !translateAll && (
              <TranslationResult
                key="single"
                result={translationResult}
                fromId={fromId}
                toId={toId}
                userLexicons={userLexicons}
              />
            )}
            {translateAllResults && translateAll && (
              <TranslateAllResults
                key="all"
                results={translateAllResults}
                fromId={fromId}
                userLexicons={userLexicons}
              />
            )}
            {/* Empty state: example cards when nothing has been translated yet */}
            {!translationResult && !translateAllResults && (
              <ExampleTranslationCards key="examples" onTry={handleTryPair} />
            )}
          </AnimatePresence>
        </div>
      </GlassCard>

      {/* ============ Register + My Lexicon ============ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <RegisterLexiconForm
          userId={userId}
          isConnected={isConnected}
          onRegistered={refreshUserLexicons}
        />
        <MyLexiconPanel
          key={`${userId}-${lexiconRevision}`}
          userId={userId}
          isConnected={isConnected}
          onImported={refreshUserLexicons}
        />
      </div>

      {/* Ten Covenants moved to dedicated governance page */}

      {/* ============ Lexicon Grid — AI Agents ============ */}
      <div className="mb-4">
        <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-1">
          AI Agents
        </h2>
        <p className="text-black-600 text-[10px] font-mono">
          {AGENT_LEXICONS.length} agents — {AGENT_LEXICONS.reduce((n, l) => n + (agentTermCounts[l.id] || 0), 0)} terms
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
        {AGENT_LEXICONS.map(lexicon => (
          <LexiconCard
            key={lexicon.id}
            agent={lexicon}
            termCount={agentTermCounts[lexicon.id] ?? '--'}
            onSelect={setSelectedAgent}
            isSelected={selectedAgent === lexicon.id}
          />
        ))}

        {/* Expanded panel — only for agent group */}
        <AnimatePresence>
          {selectedAgent && AGENT_LEXICONS.some(l => l.id === selectedAgent) && (
            <LexiconPanel
              agent={LEXICON_MAP[selectedAgent]}
              terms={lexiconTerms}
            />
          )}
        </AnimatePresence>
      </div>

      {/* ============ Lexicon Grid — Human Domains ============ */}
      <div className="mb-4">
        <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-1">
          Human Domains
        </h2>
        <p className="text-black-600 text-[10px] font-mono">
          {HUMAN_LEXICONS.length} domains — {HUMAN_LEXICONS.reduce((n, l) => n + (agentTermCounts[l.id] || 0), 0)} terms
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {HUMAN_LEXICONS.map(lexicon => (
          <LexiconCard
            key={lexicon.id}
            agent={lexicon}
            termCount={agentTermCounts[lexicon.id] ?? '--'}
            onSelect={setSelectedAgent}
            isSelected={selectedAgent === lexicon.id}
          />
        ))}

        {/* Expanded panel — only for human domain group */}
        <AnimatePresence>
          {selectedAgent && HUMAN_LEXICONS.some(l => l.id === selectedAgent) && (
            <LexiconPanel
              agent={LEXICON_MAP[selectedAgent]}
              terms={lexiconTerms}
            />
          )}
        </AnimatePresence>
      </div>

      {/* ============ Footer ============ */}
      <div className="mt-8 text-center">
        <p className="text-black-700 text-[10px] font-mono">
          Rosetta Stone Protocol v2.0 — {ALL_LEXICONS.length} lexicons, {Object.values(agentTermCounts).reduce((a, b) => a + b, 0)} terms across AI Agents + Human Domains + User Lexicons
        </p>
        <p className="text-black-800 text-[9px] font-mono mt-0.5">
          Runs client-side — no backend required
        </p>
        {/* Keyboard shortcut hint */}
        <button
          onClick={() => setShowHelp(v => !v)}
          className="mt-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-mono text-[10px] transition-colors"
          style={{
            backgroundColor: 'rgba(0,255,65,0.05)',
            border: '1px solid rgba(0,255,65,0.15)',
            color: 'rgba(0,255,65,0.5)',
          }}
          title="Keyboard shortcuts"
        >
          <span
            className="inline-flex items-center justify-center w-4 h-4 rounded border font-bold text-[9px]"
            style={{ borderColor: 'rgba(0,255,65,0.3)', color: 'rgba(0,255,65,0.6)' }}
          >
            ?
          </span>
          shortcuts
        </button>
      </div>

      {/* ============ Keyboard Shortcut Help Overlay ============ */}
      <AnimatePresence>
        {showHelp && (
          <>
            {/* Backdrop */}
            <motion.div
              key="kb-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="fixed inset-0 z-40"
              style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
              onClick={() => setShowHelp(false)}
            />

            {/* Panel */}
            <motion.div
              key="kb-panel"
              initial={{ opacity: 0, scale: 0.94, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 12 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
              className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none"
            >
              <div
                className="pointer-events-auto w-full max-w-sm mx-4 rounded-2xl border overflow-hidden"
                style={{
                  background: 'rgba(5,10,8,0.97)',
                  borderColor: 'rgba(0,255,65,0.28)',
                  boxShadow: '0 0 48px rgba(0,255,65,0.12), 0 24px 64px rgba(0,0,0,0.7)',
                }}
              >
                {/* Header */}
                <div
                  className="flex items-center justify-between px-5 py-4 border-b"
                  style={{ borderColor: 'rgba(0,255,65,0.14)' }}
                >
                  <div className="flex items-center gap-2">
                    <motion.span
                      className="inline-block w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: '#00ff41' }}
                      animate={{ boxShadow: ['0 0 4px #00ff4166', '0 0 10px #00ff41cc', '0 0 4px #00ff4166'] }}
                      transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                    />
                    <span className="text-[11px] font-mono font-bold uppercase tracking-widest text-matrix-400">
                      Keyboard Shortcuts
                    </span>
                  </div>
                  <button
                    onClick={() => setShowHelp(false)}
                    className="text-black-600 hover:text-black-400 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {/* Shortcut rows */}
                <div className="px-5 py-4 space-y-2.5">
                  {[
                    { key: '/',   desc: 'Focus Discover search' },
                    { key: 't',   desc: 'Focus Translate — From dropdown' },
                    { key: 's',   desc: 'Focus Sentence Translator' },
                    { key: 'c',   desc: 'Focus Concept Chain — Term A' },
                    { key: 'Esc', desc: 'Clear all results and reset' },
                    { key: '?',   desc: 'Toggle this help panel' },
                  ].map(({ key, desc }) => (
                    <div key={key} className="flex items-center gap-3">
                      <kbd
                        className="inline-flex items-center justify-center min-w-[36px] h-7 px-2 rounded-lg font-mono text-xs font-bold flex-shrink-0"
                        style={{
                          backgroundColor: 'rgba(0,255,65,0.08)',
                          border: '1px solid rgba(0,255,65,0.28)',
                          color: '#00ff41',
                          boxShadow: '0 1px 0 rgba(0,255,65,0.2)',
                        }}
                      >
                        {key}
                      </kbd>
                      <span className="text-[12px] font-mono text-black-300">{desc}</span>
                    </div>
                  ))}
                </div>

                {/* Footer note */}
                <div
                  className="px-5 py-3 border-t"
                  style={{ borderColor: 'rgba(0,255,65,0.10)' }}
                >
                  <p className="text-[10px] font-mono text-black-600">
                    Shortcuts are inactive while any input is focused.
                  </p>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
