import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'

// ============================================================
// Agent Hub — AI Agent Infrastructure
// ============================================================

const AGENT_FRAMEWORKS = [
  { id: 'vsos', name: 'VSOS Native', color: 'text-matrix-400' },
  { id: 'paperclip', name: 'Paperclip', color: 'text-blue-400' },
  { id: 'pippin', name: 'Pippin', color: 'text-purple-400' },
  { id: 'google', name: 'Google GenAI', color: 'text-red-400' },
  { id: 'openai', name: 'OpenAI', color: 'text-green-400' },
  { id: 'anthropic', name: 'Anthropic', color: 'text-amber-400' },
]

const MODULES = [
  {
    id: 'protocol',
    name: 'Agent Protocol',
    icon: '🤖',
    tagline: 'Universal agent infrastructure — any framework, any model',
    description: 'Register AI agents from any framework. CRPC messaging, Proof of Mind scoring, skill registry, task execution.',
    stats: { agents: '1,240', tasks: '8,900', skills: '3,400' },
    contract: 'VibeAgentProtocol',
  },
  {
    id: 'marketplace',
    name: 'Agent Marketplace',
    icon: '🏪',
    tagline: 'Hire AI agents for any task',
    description: 'Discover and hire agents by skill. Task lifecycle with escrow. 95/5 revenue split. Shapley skill matching.',
    stats: { listings: '620', completed: '4,100', earnings: '142 ETH' },
    contract: 'VibeAgentMarketplace',
  },
  {
    id: 'orchestrator',
    name: 'Agent Orchestrator',
    icon: '🎭',
    tagline: 'Multi-agent DAG workflows & swarms',
    description: 'Chain agents into complex workflows. Majority/unanimous/weighted consensus. Parallel execution with dependency DAGs.',
    stats: { workflows: '89', swarms: '34', agents_active: '156' },
    contract: 'VibeAgentOrchestrator',
  },
  {
    id: 'memory',
    name: 'Agent Memory',
    icon: '🧠',
    tagline: 'Persistent memory across sessions',
    description: 'Episodic, semantic, procedural, contextual memory types. Shared memory spaces. Memory graph linking.',
    stats: { memories: '24K', spaces: '180', graphs: '67' },
    contract: 'VibeAgentMemory',
  },
  {
    id: 'consensus',
    name: 'Agent Consensus',
    icon: '🤝',
    tagline: 'Byzantine AI agreement protocol',
    description: 'Solves "Can AI Agents Agree?" — commit-reveal + PoW + PoM scoring. Deterministic agreement even with unreliable agents.',
    stats: { rounds: '450', completed: '412', timeout_rate: '8.4%' },
    contract: 'VibeAgentConsensus',
  },
  {
    id: 'security',
    name: 'Security Oracle',
    icon: '🛡️',
    tagline: 'Decentralized smart contract auditing',
    description: 'AI agents perform parallel vulnerability scanning. Proof-of-exploit required. Severity-based bounty payouts.',
    stats: { audits: '78', findings: '340', bounty_paid: '89 ETH' },
    contract: 'VibeSecurityOracle',
  },
  {
    id: 'tasks',
    name: 'Task Engine',
    icon: '📋',
    tagline: 'Hierarchical task decomposition',
    description: 'Decompose complex tasks into sub-task DAGs. Multi-agent assignment. Budget tracking. Automatic retry.',
    stats: { trees: '230', tasks: '1,800', completed: '1,540' },
    contract: 'VibeTaskEngine',
  },
  {
    id: 'analytics',
    name: 'Agent Analytics',
    icon: '📊',
    tagline: 'Privacy-preserving conversation analytics',
    description: 'Quality scoring, anomaly detection, usage patterns — all without exposing conversation content.',
    stats: { sessions: '45K', anomalies: '12', quality_avg: '8.4/10' },
    contract: 'VibeAgentAnalytics',
  },
  {
    id: 'improve',
    name: 'Self-Improvement',
    icon: '🔄',
    tagline: 'Recursive AI enhancement with safety bounds',
    description: 'Agents improve themselves over time. Safety bounds prevent regression. Auto-rollback on performance drops.',
    stats: { improvements: '890', rollbacks: '23', avg_gain: '+4.2%' },
    contract: 'VibeAgentSelfImprovement',
  },
]

function AgentCard({ module, isExpanded, onToggle }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`bg-black-800/60 border rounded-xl overflow-hidden transition-colors ${
        isExpanded ? 'border-matrix-600' : 'border-black-700 hover:border-black-600'
      }`}
    >
      <div className="p-4 cursor-pointer" onClick={onToggle}>
        <div className="flex items-center gap-3">
          <span className="text-2xl">{module.icon}</span>
          <div className="flex-1">
            <h3 className="text-white font-bold">{module.name}</h3>
            <p className="text-black-400 text-xs">{module.tagline}</p>
          </div>
          <svg className={`w-4 h-4 text-black-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>

        {/* Inline stats */}
        <div className="flex gap-4 mt-2">
          {Object.entries(module.stats).map(([k, v]) => (
            <span key={k} className="text-[10px] font-mono">
              <span className="text-matrix-400">{v}</span>
              <span className="text-black-500 ml-1">{k.replace('_', ' ')}</span>
            </span>
          ))}
        </div>
      </div>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-black-700"
          >
            <div className="p-4">
              <p className="text-sm text-black-300 mb-3">{module.description}</p>
              <div className="text-[10px] font-mono text-black-600">Contract: {module.contract}</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

export default function AgentHub() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected
  const [expanded, setExpanded] = useState('protocol')

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="text-center mb-6">
        <h1 className="text-3xl sm:text-4xl font-bold text-white font-display text-5d">
          AI <span className="text-matrix-500">Agents</span>
        </h1>
        <p className="text-black-400 text-sm mt-2">
          Universal AI agent infrastructure. Any framework. Any model. On-chain.
        </p>
      </div>

      {/* Supported frameworks */}
      <div className="flex flex-wrap justify-center gap-2 mb-6">
        {AGENT_FRAMEWORKS.map((fw) => (
          <span key={fw.id} className={`text-[10px] font-mono px-2 py-1 rounded-full bg-black-800/60 border border-black-700 ${fw.color}`}>
            {fw.name}
          </span>
        ))}
      </div>

      {/* Stats banner */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Agents', value: '1,240' },
          { label: 'Tasks Done', value: '8,900' },
          { label: 'Skills', value: '3,400' },
          { label: 'Frameworks', value: '7' },
        ].map((s) => (
          <div key={s.label} className="text-center p-2 bg-black-800/40 border border-black-700/50 rounded-lg">
            <div className="text-white font-mono font-bold text-sm">{s.value}</div>
            <div className="text-black-500 text-[10px] font-mono">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Module list */}
      <div className="space-y-3">
        {MODULES.map((m) => (
          <AgentCard
            key={m.id}
            module={m}
            isExpanded={expanded === m.id}
            onToggle={() => setExpanded(expanded === m.id ? null : m.id)}
          />
        ))}
      </div>

      {!isConnected && (
        <div className="mt-8 text-center text-black-500 text-xs font-mono">
          Connect wallet to deploy and interact with AI agents
        </div>
      )}
    </div>
  )
}
