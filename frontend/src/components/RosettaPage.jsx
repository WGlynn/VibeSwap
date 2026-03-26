import { useState, useEffect, useCallback, useRef } from 'react'
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
  discoverEquivalent,
  registerUserLexicon,
  addUserTerm,
  getUserLexicon,
  getAllUserLexicons,
  getProtocolStats,
  getTopConnectedConcepts,
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

function LexiconSelect({ value, onChange, label, excludeId, userLexicons = [] }) {
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
          <span className="text-[10px] font-mono text-black-500 uppercase tracking-wider">Translation Result</span>
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
        <div className="flex items-center gap-2 mb-4">
          <AgentDot color={from?.color} size={8} />
          <span className="text-[10px] font-mono text-black-500 uppercase tracking-wider">
            {from?.name} &rarr; All Lexicons
          </span>
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

                      {/* Domain color dots preview (up to 8) */}
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {uniqueLexicons.slice(0, 8).map((m) => {
                          const meta = getLexiconLabel(m.lexiconId, userLexicons)
                          if (!meta) return null
                          return (
                            <span
                              key={m.lexiconId}
                              className="inline-block rounded-full flex-shrink-0"
                              style={{
                                width: 7,
                                height: 7,
                                backgroundColor: meta.color,
                                boxShadow: `0 0 4px ${meta.color}60`,
                              }}
                              title={meta.name}
                            />
                          )
                        })}
                        {uniqueLexicons.length > 8 && (
                          <span className="text-[9px] font-mono text-black-600">
                            +{uniqueLexicons.length - 8}
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

// ============ Discover Section ============

function DiscoverSection() {
  const [searchTerm, setSearchTerm] = useState('')
  const [activeSearch, setActiveSearch] = useState('')
  const [results, setResults] = useState(null)
  const debounceRef = useRef(null)

  const handleSearch = useCallback((term) => {
    if (!term.trim()) {
      setResults(null)
      setActiveSearch('')
      return
    }

    const trimmed = term.trim()
    setActiveSearch(trimmed)
    const data = discoverEquivalent(trimmed)
    setResults(data)
  }, [])

  const handleInputChange = useCallback((value) => {
    setSearchTerm(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!value.trim()) {
      setResults(null)
      setActiveSearch('')
      return
    }
    debounceRef.current = setTimeout(() => handleSearch(value), 300)
  }, [handleSearch])

  return (
    <GlassCard glowColor="terminal" className="p-5 mb-6">
      <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-1">Discover</h2>
      <p className="text-black-500 text-[10px] font-mono mb-4">
        Enter any word — see how every lexicon (agent + user) expresses the same concept.
      </p>

      <div className="relative">
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && searchTerm.trim()) handleSearch(searchTerm) }}
          placeholder="Enter any word or concept..."
          className="w-full bg-black-900/80 border border-black-700 rounded-lg px-3 py-2.5 pr-10 text-sm text-white font-mono placeholder-black-600 focus:outline-none focus:border-terminal-600 transition-colors"
        />
        {searchTerm && (
          <button
            onClick={() => { setSearchTerm(''); setResults(null); setActiveSearch('') }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-black-600 hover:text-black-400 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Discover results */}
      {activeSearch && results && (
        <div className="mt-4">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeSearch}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.3 }}
            >
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
                        transition={{ delay: i * 0.04 }}
                        className="flex items-center gap-3 p-3 bg-black-900/40 rounded-lg border border-black-800"
                      >
                        <AgentDot color={color} size={8} />
                        <div className="flex-1 min-w-0">
                          <div className="text-[10px] font-mono text-black-500">{label}</div>
                          <div className="text-white text-sm font-mono font-medium">{eq.term}</div>
                          {eq.description && (
                            <div className="text-[10px] text-black-600 mt-0.5">{eq.description}</div>
                          )}
                        </div>
                        {eq.universal && (
                          <div className="flex-shrink-0 text-right">
                            <div className="text-[9px] font-mono text-black-600 uppercase">Universal</div>
                            <div className="text-[10px] font-mono text-matrix-400">{eq.universal}</div>
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
                    Try a different term or register it in your lexicon.
                  </p>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      )}
    </GlassCard>
  )
}

// ============ My Lexicon Panel ============

function MyLexiconPanel({ userId, isConnected }) {
  const [myLexicon, setMyLexicon] = useState(null)

  // Reload whenever userId changes or a term is added (parent refreshes via key)
  useEffect(() => {
    if (!isConnected || !userId) {
      setMyLexicon(null)
      return
    }
    setMyLexicon(getUserLexicon(userId))
  }, [isConnected, userId])

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

// ============ Main Page Component ============

export default function RosettaPage() {
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

  // ---- Protocol stats (computed client-side) ----
  const [protocolData] = useState(() => getProtocolStats())

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
  }, [fromId, toId, concept, translateAll])

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

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      {/* ============ Header ============ */}
      <div className="text-center mb-6">
        <h1 className="text-3xl sm:text-4xl font-bold text-white font-display text-5d">
          ROSETTA STONE <span className="text-matrix-500">PROTOCOL</span>
        </h1>
        <p className="text-black-400 text-sm mt-2 max-w-lg mx-auto">
          So everyone can finally understand everyone.
        </p>
        <p className="text-black-600 text-[10px] font-mono mt-1">
          {ALL_LEXICONS.length} lexicons — AI Agents + Human Domains — universal translation layer
        </p>
      </div>

      {/* ============ Protocol Stats ============ */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        {[
          { label: 'Agents', value: stats.agents },
          { label: 'Total Terms', value: stats.terms },
          { label: 'Universal Concepts', value: stats.universals },
          {
            label: 'Covenant Hash',
            value: stats.covenantHash
              ? `${stats.covenantHash.slice(0, 6)}...${stats.covenantHash.slice(-4)}`
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
        <div className="flex gap-3 mb-3">
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
          />
          {!translateAll && (
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
        </AnimatePresence>
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
      </div>
    </div>
  )
}
