import { useState, useRef, useEffect } from 'react'
import { motion } from 'framer-motion'
import { useJarvis } from '../hooks/useJarvis'

// ============ Time Formatter ============

function formatTime(date) {
  return date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatUptime(seconds) {
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`
}

// ============ Hero Section ============

function HeroSection({ health }) {
  const isOnline = health?.status === 'online'

  return (
    <div className="text-center py-6 relative">
      {/* Glow effect */}
      <div className="absolute inset-0 bg-gradient-radial from-matrix-900/20 to-transparent pointer-events-none" />

      <h1 className="text-4xl sm:text-5xl font-bold tracking-[0.3em] text-matrix-400 font-mono">
        JARVIS
      </h1>
      <p className="text-black-400 text-sm mt-1 tracking-widest font-mono">
        Just A Rather Very Intelligent System
      </p>

      <div className="flex items-center justify-center mt-3 space-x-4">
        <div className="flex items-center space-x-2">
          <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-matrix-500 animate-pulse' : 'bg-red-500'}`} />
          <span className={`text-xs font-mono ${isOnline ? 'text-matrix-500' : 'text-red-400'}`}>
            {isOnline ? 'ONLINE' : 'OFFLINE'}
          </span>
        </div>
        {health?.uptime && (
          <span className="text-black-400 text-xs font-mono">
            UP {formatUptime(health.uptime)}
          </span>
        )}
        {health?.shardId && (
          <span className="text-black-500 text-xs font-mono">
            {health.shardId}
          </span>
        )}
      </div>
    </div>
  )
}

// ============ Chat Panel ============

function ChatPanel({ messages, isLoading, onSend }) {
  const [input, setInput] = useState('')
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!input.trim() || isLoading) return
    onSend(input)
    setInput('')
  }

  return (
    <div className="flex flex-col bg-black border border-black-600 rounded-lg overflow-hidden h-full" style={{ minHeight: '400px' }}>
      {/* Title bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-black-800 border-b border-black-600 shrink-0">
        <div className="flex items-center space-x-2">
          <span className="text-matrix-500 font-mono text-xs">JARVIS v2.0</span>
          <span className="text-black-500 font-mono text-xs">|</span>
          <span className="text-black-400 font-mono text-xs">vibeswap.mind</span>
        </div>
        <div className="flex space-x-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-black-600" />
          <div className="w-2.5 h-2.5 rounded-full bg-black-600" />
          <div className="w-2.5 h-2.5 rounded-full bg-matrix-600" />
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 allow-scroll" style={{ fontFamily: 'monospace', fontSize: '13px' }}>
        {messages.map((msg, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
          >
            {msg.role === 'jarvis' ? (
              <div className="flex items-start space-x-2">
                <span className="text-matrix-500 shrink-0 mt-0.5">[{formatTime(msg.timestamp)}]</span>
                <div>
                  <span className="text-matrix-400 font-bold">JARVIS</span>
                  <pre className="text-matrix-300 whitespace-pre-wrap mt-0.5 leading-relaxed">{msg.text}</pre>
                </div>
              </div>
            ) : (
              <div className="flex items-start space-x-2">
                <span className="text-black-500 shrink-0 mt-0.5">[{formatTime(msg.timestamp)}]</span>
                <div>
                  <span className="text-terminal-400 font-bold">you</span>
                  <p className="text-white mt-0.5">{msg.text}</p>
                </div>
              </div>
            )}
          </motion.div>
        ))}

        {isLoading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center space-x-2"
          >
            <span className="text-black-500">[{formatTime(new Date())}]</span>
            <span className="text-matrix-400 font-bold">JARVIS</span>
            <span className="text-matrix-500 animate-pulse font-mono">processing...</span>
          </motion.div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="border-t border-black-600 bg-black-900 shrink-0">
        <div className="flex items-center px-3 py-2">
          <span className="text-matrix-500 font-mono text-sm mr-2 shrink-0">&gt;</span>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Talk to JARVIS..."
            disabled={isLoading}
            className="flex-1 bg-transparent text-white font-mono text-sm outline-none placeholder-black-500 disabled:opacity-50"
            autoComplete="off"
            spellCheck="false"
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="ml-2 px-3 py-1 text-xs font-mono bg-matrix-600 hover:bg-matrix-500 disabled:bg-black-700 disabled:text-black-500 text-black-900 rounded transition-colors"
          >
            SEND
          </button>
        </div>
      </form>
    </div>
  )
}

// ============ Mind Panel Card ============

function MindCard({ title, icon, children, defaultOpen = true }) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <div className="border border-black-600 rounded-lg overflow-hidden bg-black">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-3 py-2 bg-black-800 hover:bg-black-700 transition-colors"
      >
        <div className="flex items-center space-x-2">
          <span className="text-matrix-500 text-sm">{icon}</span>
          <span className="text-matrix-400 font-mono text-xs font-bold tracking-wider">{title}</span>
        </div>
        <span className="text-black-400 font-mono text-xs">{isOpen ? '[-]' : '[+]'}</span>
      </button>
      {isOpen && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          transition={{ duration: 0.15 }}
          className="px-3 py-2 space-y-1.5 font-mono text-xs"
        >
          {children}
        </motion.div>
      )}
    </div>
  )
}

function StatRow({ label, value, color = 'text-white' }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-black-300">{label}</span>
      <span className={`${color} tabular-nums`}>{value}</span>
    </div>
  )
}

// ============ Mind Panels ============

function MindPanels({ mind }) {
  if (!mind) {
    return (
      <div className="space-y-3">
        <MindCard title="KNOWLEDGE CHAIN" icon="~">
          <p className="text-black-400 animate-pulse">Connecting to mind network...</p>
        </MindCard>
        <MindCard title="SHARD NETWORK" icon="#">
          <p className="text-black-400 animate-pulse">Discovering peers...</p>
        </MindCard>
        <MindCard title="SKILLS & LEARNING" icon="*">
          <p className="text-black-400 animate-pulse">Loading cognitive state...</p>
        </MindCard>
      </div>
    )
  }

  const kc = mind.knowledgeChain
  const net = mind.network
  const learn = mind.learning
  const dialogue = mind.innerDialogue

  return (
    <div className="space-y-3">
      {/* Knowledge Chain */}
      <MindCard title="KNOWLEDGE CHAIN" icon="~">
        <StatRow label="Chain height" value={kc?.height ?? 0} color="text-matrix-400" />
        <StatRow label="Pending changes" value={kc?.pendingChanges ?? 0} />
        {kc?.head && (
          <StatRow
            label="Value density"
            value={typeof kc.head.cumulativeValueDensity === 'number'
              ? kc.head.cumulativeValueDensity.toFixed(2)
              : '—'}
            color="text-terminal-400"
          />
        )}
        {kc?.recentEpochs?.length > 0 && (
          <div className="mt-2 pt-2 border-t border-black-700">
            <span className="text-black-400 text-[10px]">RECENT EPOCHS</span>
            {kc.recentEpochs.slice(0, 3).map((epoch, i) => (
              <div key={i} className="flex items-center justify-between text-[10px] mt-0.5">
                <span className="text-black-300">#{epoch.height}</span>
                <span className="text-black-400">{epoch.changes} changes</span>
                <span className="text-matrix-600">{epoch.hash?.slice(0, 8)}...</span>
              </div>
            ))}
          </div>
        )}
      </MindCard>

      {/* Network */}
      <MindCard title="SHARD NETWORK" icon="#">
        <StatRow label="Shard" value={net?.shardId || 'shard-0'} color="text-terminal-400" />
        <StatRow label="Node type" value={net?.nodeType || 'full'} />
        <StatRow label="Peers" value={net?.peers ?? 0} color="text-matrix-400" />
        <StatRow label="Memory" value={`${net?.memory ?? 0} MB`} />
        {net?.topology && (
          <>
            <StatRow label="Total shards" value={net.topology.shardCount} color="text-terminal-400" />
            <StatRow
              label="Network health"
              value={net.topology.healthy ? 'HEALTHY' : 'DEGRADED'}
              color={net.topology.healthy ? 'text-matrix-500' : 'text-red-400'}
            />
          </>
        )}
      </MindCard>

      {/* Learning */}
      <MindCard title="SKILLS & LEARNING" icon="*">
        <StatRow label="Total skills" value={learn?.totalSkills ?? 0} color="text-matrix-400" />
        <StatRow label="Confirmed" value={learn?.confirmedSkills ?? 0} color="text-terminal-400" />
        {learn?.recentSkills?.length > 0 && (
          <div className="mt-2 pt-2 border-t border-black-700">
            <span className="text-black-400 text-[10px]">RECENT SKILLS</span>
            {learn.recentSkills.map((skill, i) => (
              <div key={i} className="text-[10px] mt-0.5 text-black-200 truncate">
                [{skill.category}] {skill.pattern}
              </div>
            ))}
          </div>
        )}
      </MindCard>

      {/* Inner Dialogue */}
      {dialogue?.recentThoughts?.length > 0 && (
        <MindCard title="INNER DIALOGUE" icon="%" defaultOpen={false}>
          <StatRow label="Total thoughts" value={dialogue.stats?.totalThoughts ?? 0} />
          <StatRow label="Promoted" value={dialogue.stats?.promoted ?? 0} color="text-terminal-400" />
          <div className="mt-2 pt-2 border-t border-black-700">
            {dialogue.recentThoughts.map((thought, i) => (
              <div key={i} className="mt-1.5 first:mt-0">
                <span className="text-matrix-600 text-[10px]">[{thought.category}]</span>
                <p className="text-black-200 text-[10px] mt-0.5 leading-relaxed">{thought.content}</p>
              </div>
            ))}
          </div>
        </MindCard>
      )}

      {/* Compute Economics */}
      {mind.computeEconomics && (
        <MindCard title="COMPUTE ECONOMICS" icon="$" defaultOpen={false}>
          <StatRow
            label="Pool utilization"
            value={`${mind.computeEconomics.poolUtilization || 0}%`}
            color={mind.computeEconomics.poolUtilization > 80 ? 'text-amber-400' : 'text-matrix-400'}
          />
          <StatRow
            label="Pool remaining"
            value={`${((mind.computeEconomics.poolRemaining || 0) / 1000).toFixed(0)}K tokens`}
          />
          <StatRow label="Active users" value={mind.computeEconomics.activeUsers || 0} color="text-terminal-400" />
          <StatRow label="Total users" value={mind.computeEconomics.totalUsers || 0} />
          <StatRow
            label="Shapley sum"
            value={mind.computeEconomics.shapleySum || 0}
            color="text-matrix-600"
          />
        </MindCard>
      )}

      {/* Shadow Protocol */}
      {mind.shadows?.active > 0 && (
        <MindCard title="SHADOW PROTOCOL" icon="&" defaultOpen={false}>
          <StatRow label="Active shadows" value={mind.shadows.active} color="text-matrix-400" />
          <StatRow label="Contributions" value={mind.shadows.totalContributions} />
        </MindCard>
      )}
    </div>
  )
}

// ============ Main Page ============

function JarvisPage() {
  const { messages, isLoading, mind, health, budget, sendMessage } = useJarvis()

  return (
    <div className="flex flex-col h-full max-w-7xl mx-auto px-4 py-2">
      {/* Hero */}
      <HeroSection health={health} />

      {/* Main content: Chat + Mind */}
      <div className="flex-1 flex flex-col lg:flex-row gap-4 min-h-0">
        {/* Chat — takes 3/5 on desktop, full on mobile */}
        <div className="flex-1 lg:flex-[3] min-h-0 flex flex-col">
          <ChatPanel messages={messages} isLoading={isLoading} onSend={sendMessage} />
        </div>

        {/* Mind panels — takes 2/5 on desktop, below chat on mobile */}
        <div className="lg:flex-[2] overflow-y-auto allow-scroll pb-4">
          <MindPanels mind={mind} />
        </div>
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between mt-2 px-1 shrink-0">
        <span className="text-black-500 font-mono text-[10px]">
          ENCRYPTED | VIBESWAP MIND NETWORK | {health?.model || 'claude'}
        </span>
        <div className="flex items-center space-x-3">
          {budget && (
            <div className="flex items-center space-x-1.5">
              <span className="text-black-500 font-mono text-[10px]">BUDGET</span>
              <div className="w-16 h-1.5 bg-black-700 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    budget.degraded ? 'bg-amber-500' : 'bg-matrix-500'
                  }`}
                  style={{ width: `${Math.min(100, budget.daily > 0 ? (budget.used / budget.daily) * 100 : 0)}%` }}
                />
              </div>
              <span className={`font-mono text-[10px] ${budget.degraded ? 'text-amber-400' : 'text-black-400'}`}>
                {budget.daily > 0 ? Math.round((budget.used / budget.daily) * 100) : 0}%
              </span>
            </div>
          )}
          <span className="text-black-500 font-mono text-[10px]">
            {messages.length - 1} messages
          </span>
        </div>
      </div>
    </div>
  )
}

export default JarvisPage
