import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'

// ============ Rosetta Stone Protocol — Universal Translation ============

const API_BASE = import.meta.env.VITE_API_URL || ''

// ============ Agent Registry ============

const AGENTS = [
  { id: 'nyx', name: 'Nyx', domain: 'Shadow Ops & Covert Intelligence', color: '#a855f7' },
  { id: 'poseidon', name: 'Poseidon', domain: 'Liquidity & Ocean Protocols', color: '#3b82f6' },
  { id: 'athena', name: 'Athena', domain: 'Strategy & Wisdom Systems', color: '#f59e0b' },
  { id: 'hephaestus', name: 'Hephaestus', domain: 'Forge & Infrastructure', color: '#ef4444' },
  { id: 'hermes', name: 'Hermes', domain: 'Messaging & Cross-Chain', color: '#10b981' },
  { id: 'apollo', name: 'Apollo', domain: 'Oracle & Price Discovery', color: '#fbbf24' },
  { id: 'proteus', name: 'Proteus', domain: 'Adaptive Morphology', color: '#6366f1' },
  { id: 'artemis', name: 'Artemis', domain: 'Hunting & MEV Prevention', color: '#c084fc' },
  { id: 'anansi', name: 'Anansi', domain: 'Web Weaving & Narrative', color: '#f97316' },
]

const AGENT_MAP = Object.fromEntries(AGENTS.map(a => [a.id, a]))

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

// ============ Agent Select Dropdown ============

function AgentSelect({ value, onChange, label, excludeId }) {
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
          <option value="">Select agent...</option>
          {AGENTS.filter(a => a.id !== excludeId).map(agent => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>
        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-black-500">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
        {value && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
            <AgentDot color={AGENT_MAP[value]?.color} />
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

function TranslationResult({ result, fromAgent, toAgent }) {
  if (!result) return null

  const from = AGENT_MAP[fromAgent]
  const to = AGENT_MAP[toAgent]

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
            <div className="text-white text-sm font-medium font-mono">{result.to_term}</div>
          </div>
        </div>

        {/* Universal concept */}
        {result.universal && (
          <div className="mt-3 pt-3 border-t border-black-800">
            <span className="text-[10px] font-mono text-black-600">Universal concept: </span>
            <span className="text-[10px] font-mono text-matrix-400">{result.universal}</span>
          </div>
        )}
      </GlassCard>
    </motion.div>
  )
}

// ============ Translate-All Results ============

function TranslateAllResults({ results, fromAgent }) {
  if (!results || results.length === 0) return null

  const from = AGENT_MAP[fromAgent]

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
            {from?.name} &rarr; All Agents
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {results.map((r, i) => {
            const targetAgent = AGENT_MAP[r.agent]
            if (!targetAgent) return null
            return (
              <motion.div
                key={r.agent}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className="flex items-center gap-2.5 p-2.5 bg-black-900/50 rounded-lg border border-black-800"
              >
                <AgentDot color={targetAgent.color} size={7} />
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] font-mono text-black-500">{targetAgent.name}</div>
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

function LexiconPanel({ agent, terms, isLoading, error }) {
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

        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <div className="w-5 h-5 border-2 border-black-700 border-t-matrix-500 rounded-full animate-spin" />
          </div>
        )}

        {error && (
          <div className="text-center py-6">
            <p className="text-red-400 text-xs font-mono">{error}</p>
          </div>
        )}

        {!isLoading && !error && terms && terms.length > 0 && (
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

        {!isLoading && !error && (!terms || terms.length === 0) && (
          <div className="text-center py-6">
            <p className="text-black-600 text-xs font-mono">No terms loaded for this agent.</p>
          </div>
        )}
      </GlassCard>
    </motion.div>
  )
}

// ============ Main Page Component ============

export default function RosettaPage() {
  // ---- Translation state ----
  const [fromAgent, setFromAgent] = useState('')
  const [toAgent, setToAgent] = useState('')
  const [concept, setConcept] = useState('')
  const [translateAll, setTranslateAll] = useState(false)
  const [translating, setTranslating] = useState(false)
  const [translationResult, setTranslationResult] = useState(null)
  const [translateAllResults, setTranslateAllResults] = useState(null)

  // ---- Protocol state ----
  const [protocolData, setProtocolData] = useState(null)
  const [protocolLoading, setProtocolLoading] = useState(true)
  const [protocolError, setProtocolError] = useState(null)

  // ---- Lexicon state ----
  const [selectedAgent, setSelectedAgent] = useState(null)
  const [lexiconTerms, setLexiconTerms] = useState(null)
  const [lexiconLoading, setLexiconLoading] = useState(false)
  const [lexiconError, setLexiconError] = useState(null)

  // ---- Fetch protocol data on mount ----
  useEffect(() => {
    let cancelled = false

    async function fetchProtocol() {
      setProtocolLoading(true)
      setProtocolError(null)
      try {
        const res = await fetch(`${API_BASE}/web/rosetta/view`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (!cancelled) setProtocolData(data)
      } catch (err) {
        if (!cancelled) setProtocolError(err.message || 'Failed to load protocol data')
      } finally {
        if (!cancelled) setProtocolLoading(false)
      }
    }

    fetchProtocol()
    return () => { cancelled = true }
  }, [])

  // ---- Fetch lexicon when agent selected ----
  useEffect(() => {
    if (!selectedAgent) {
      setLexiconTerms(null)
      setLexiconError(null)
      return
    }

    let cancelled = false

    async function fetchLexicon() {
      setLexiconLoading(true)
      setLexiconError(null)
      try {
        const res = await fetch(`${API_BASE}/web/rosetta/lexicon?agent=${selectedAgent}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (!cancelled) setLexiconTerms(data.terms || data)
      } catch (err) {
        if (!cancelled) setLexiconError(err.message || 'Failed to load lexicon')
      } finally {
        if (!cancelled) setLexiconLoading(false)
      }
    }

    fetchLexicon()
    return () => { cancelled = true }
  }, [selectedAgent])

  // ---- Translate handler ----
  const handleTranslate = useCallback(async () => {
    if (!fromAgent || !concept.trim()) return
    if (!translateAll && !toAgent) return

    setTranslating(true)
    setTranslationResult(null)
    setTranslateAllResults(null)

    try {
      if (translateAll) {
        const res = await fetch(
          `${API_BASE}/web/rosetta/all?from=${fromAgent}&concept=${encodeURIComponent(concept.trim())}`
        )
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        setTranslateAllResults(data.translations || data)
      } else {
        const res = await fetch(
          `${API_BASE}/web/rosetta/translate?from=${fromAgent}&to=${toAgent}&concept=${encodeURIComponent(concept.trim())}`
        )
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        setTranslationResult(data)
      }
    } catch {
      // Show inline error in the result area
      if (translateAll) {
        setTranslateAllResults([])
      } else {
        setTranslationResult({
          from_term: concept.trim(),
          to_term: '-- translation unavailable --',
          universal: null,
          confidence: 0,
          error: true,
        })
      }
    } finally {
      setTranslating(false)
    }
  }, [fromAgent, toAgent, concept, translateAll])

  // ---- Derived stats ----
  const stats = protocolData ? {
    agents: protocolData.agent_count ?? AGENTS.length,
    terms: protocolData.total_terms ?? 0,
    universals: protocolData.universal_count ?? 0,
    covenantHash: protocolData.covenant_hash ?? '',
  } : {
    agents: AGENTS.length,
    terms: '--',
    universals: '--',
    covenantHash: '',
  }

  const agentTermCounts = protocolData?.agent_terms || {}

  const canTranslate = fromAgent && concept.trim() && (translateAll || toAgent)

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
          Universal translation layer for the Pantheon agent network
        </p>
      </div>

      {/* ============ Protocol Stats ============ */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
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
        ].map((s) => (
          <div key={s.label} className="text-center p-2.5 bg-black-800/40 border border-black-700/50 rounded-lg">
            <div className="flex items-center justify-center gap-1">
              <span className="text-white font-mono font-bold text-sm">{s.value}</span>
              {s.copyable && <CopyButton text={s.copyable} />}
            </div>
            <div className="text-black-500 text-[10px] font-mono">{s.label}</div>
          </div>
        ))}
      </div>

      {protocolError && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-center">
          <p className="text-red-400 text-xs font-mono">Protocol data unavailable: {protocolError}</p>
          <p className="text-black-600 text-[10px] font-mono mt-1">Translation features still available via direct API calls.</p>
        </div>
      )}

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

        {/* Agent Selects */}
        <div className="flex gap-3 mb-3">
          <AgentSelect
            label="From Agent"
            value={fromAgent}
            onChange={(v) => {
              setFromAgent(v)
              setTranslationResult(null)
              setTranslateAllResults(null)
            }}
            excludeId={toAgent}
          />
          {!translateAll && (
            <AgentSelect
              label="To Agent"
              value={toAgent}
              onChange={(v) => {
                setToAgent(v)
                setTranslationResult(null)
                setTranslateAllResults(null)
              }}
              excludeId={fromAgent}
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
          disabled={!canTranslate || translating}
          className={`w-full py-2.5 rounded-lg font-mono text-sm font-bold transition-all ${
            canTranslate && !translating
              ? 'bg-matrix-600 text-black-900 hover:bg-matrix-500 active:scale-[0.99]'
              : 'bg-black-800 text-black-600 cursor-not-allowed'
          }`}
        >
          {translating ? (
            <span className="flex items-center justify-center gap-2">
              <div className="w-4 h-4 border-2 border-black-600 border-t-black-900 rounded-full animate-spin" />
              Translating...
            </span>
          ) : translateAll ? (
            'Translate to All Agents'
          ) : (
            'Translate'
          )}
        </button>

        {/* Results */}
        <AnimatePresence mode="wait">
          {translationResult && !translateAll && (
            <TranslationResult
              key="single"
              result={translationResult}
              fromAgent={fromAgent}
              toAgent={toAgent}
            />
          )}
          {translateAllResults && translateAll && (
            <TranslateAllResults
              key="all"
              results={translateAllResults}
              fromAgent={fromAgent}
            />
          )}
        </AnimatePresence>
      </GlassCard>

      {/* ============ Agent Lexicon Grid ============ */}
      <div className="mb-4">
        <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-3">
          Agent Lexicons
        </h2>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {AGENTS.map(agent => (
          <LexiconCard
            key={agent.id}
            agent={agent}
            termCount={agentTermCounts[agent.id] ?? '--'}
            onSelect={setSelectedAgent}
            isSelected={selectedAgent === agent.id}
          />
        ))}

        {/* Expanded lexicon panel — spans full grid width */}
        <AnimatePresence>
          {selectedAgent && (
            <LexiconPanel
              agent={AGENT_MAP[selectedAgent]}
              terms={lexiconTerms}
              isLoading={lexiconLoading}
              error={lexiconError}
            />
          )}
        </AnimatePresence>
      </div>

      {/* ============ Footer ============ */}
      <div className="mt-8 text-center">
        <p className="text-black-700 text-[10px] font-mono">
          Rosetta Stone Protocol v1.0 — Pantheon Cross-Domain Understanding Layer
        </p>
      </div>
    </div>
  )
}
