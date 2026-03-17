// ============ Nyx Orchestrator — Freedom's Jarvis ============
//
// The evolution from monolith to hierarchy.
// Freedom talks to Nyx. Nyx delegates to gods. Gods do the work. Nyx synthesizes.
//
// Instead of one AI that does everything, it's a hierarchy of Greek gods.
// Each god is a full mind (shard), not a fragment (swarm).
//
// "Even Zeus feared Nyx."
// ============

import { pantheonChat, routeQuestion, consultAgent, getArchetypes, getTheAIStatus } from './pantheon.js'
import { updateAgentContext, getTreeState } from './pantheon-merkle.js'

// ============ Task Registry ============
// Every orchestration creates a task with lifecycle tracking.

const tasks = new Map()
let taskCounter = 0

function createTask(type, message, gods = []) {
  const id = `nyx-${++taskCounter}-${Date.now().toString(36)}`
  const task = {
    id,
    type,          // direct | route | multi | status
    message: message.slice(0, 200),
    gods,          // [{ id, status, response }]
    status: 'pending',
    created: new Date().toISOString(),
    completed: null,
    synthesis: null,
  }
  tasks.set(id, task)
  while (tasks.size > 100) tasks.delete([...tasks.keys()][0])
  return task
}

// ============ Activity Log ============
// Real-time feed of what's happening in the Pantheon.

const activity = []
const MAX_ACTIVITY = 200
const listeners = []

function emit(type, data) {
  const event = { type, ...data, ts: new Date().toISOString() }
  activity.push(event)
  while (activity.length > MAX_ACTIVITY) activity.shift()
  for (const fn of listeners) { try { fn(event) } catch {} }
  return event
}

export function onActivity(fn) { listeners.push(fn) }
export function getActivity(limit = 50) { return activity.slice(-limit) }
export function getTasks(limit = 20) { return [...tasks.values()].slice(-limit) }
export function getTask(id) { return tasks.get(id) || null }

// ============ God Metadata ============
// Symbols and colors for each god — mirrors pantheon-merkle.js constellation.

const GOD_META = {
  nyx:        { symbol: '\u25C6', color: '#a855f7', label: 'Orchestrator' },
  poseidon:   { symbol: '\u25BC', color: '#3b82f6', label: 'Finance' },
  athena:     { symbol: '\u25C7', color: '#f59e0b', label: 'Strategy' },
  hephaestus: { symbol: '\u25A0', color: '#ef4444', label: 'Building' },
  hermes:     { symbol: '\u25B2', color: '#10b981', label: 'Comms' },
  apollo:     { symbol: '\u25CF', color: '#fbbf24', label: 'Analytics' },
  proteus:    { symbol: '\u25CB', color: '#6366f1', label: 'Adaptive' },
  artemis:    { symbol: '\u25D1', color: '#c084fc', label: 'Security' },
  anansi:     { symbol: '\u2726', color: '#f97316', label: 'Social' },
}

export function getGodMeta(id) { return GOD_META[id] || null }
export function getAllGodMeta() { return GOD_META }

// ============ Intent Classification ============
// Fast keyword classification, no LLM call needed.

const CONVERSATIONAL = [
  /^(hi|hello|hey|sup|yo|gm|good morning|good evening|good night)\b/i,
  /^(how are you|what's up|whats up|how's it going)/i,
  /^(thanks|thank you|thx|ty|cheers)\b/i,
  /^(who are you|what are you|introduce yourself)/i,
  /^(help|what can you do)\b/i,
]

const STATUS = [
  /\b(status|overview|dashboard|report)\b/i,
  /who('s| is) (working|active|online)/i,
  /\b(pantheon|hierarchy|tree|gods)\b/i,
  /how much.*(cost|spent|money)/i,
  /\bcost(s)?\b/i,
]

const AGENT_NAMES = ['poseidon', 'athena', 'hephaestus', 'hermes', 'apollo', 'proteus', 'artemis', 'anansi']

const DOMAIN_KEYWORDS = {
  poseidon: ['trade', 'trading', 'price', 'market', 'defi', 'swap', 'liquidity', 'amm', 'yield', 'apy', 'tvl', 'portfolio', 'pnl', 'slippage', 'mev', 'arbitrage', 'whale', 'volume', 'dex', 'cex', 'funding', 'leverage'],
  athena: ['architect', 'design', 'plan', 'strategy', 'review', 'refactor', 'pattern', 'structure', 'roadmap', 'technical debt', 'scalab', 'tradeoff', 'decision', 'approach'],
  hephaestus: ['build', 'deploy', 'docker', 'ci', 'cd', 'pipeline', 'infra', 'server', 'devops', 'container', 'kubernetes', 'nginx', 'compile', 'test', 'debug', 'fix', 'implement', 'code', 'ship'],
  hermes: ['api', 'webhook', 'telegram', 'discord', 'twitter', 'social', 'message', 'notification', 'integration', 'oauth', 'endpoint'],
  apollo: ['data', 'analytic', 'metric', 'dashboard', 'monitor', 'alert', 'trend', 'pattern', 'predict', 'forecast', 'chart', 'graph'],
  proteus: ['adapt', 'regime', 'strategy rotation', 'dynamic', 'condition', 'shift', 'multi-strategy'],
  artemis: ['security', 'audit', 'vulnerab', 'attack', 'exploit', 'hack', 'permission', 'access control', 'encryption'],
  anansi: ['community', 'content', 'meme', 'engagement', 'narrative', 'story', 'brand', 'marketing', 'growth'],
}

function scoreDomains(msg) {
  const scores = {}
  for (const [god, kws] of Object.entries(DOMAIN_KEYWORDS)) {
    scores[god] = kws.filter(kw => msg.includes(kw)).length
  }
  return scores
}

function classifyIntent(message) {
  const msg = message.trim()
  const lower = msg.toLowerCase()

  // 1. Conversational
  if (CONVERSATIONAL.some(p => p.test(msg))) {
    return { strategy: 'direct', reason: 'conversational' }
  }

  // 2. Status request
  if (STATUS.some(p => p.test(msg))) {
    return { strategy: 'status', reason: 'status request' }
  }

  // 3. Direct god addressing: "@poseidon ...", "tell poseidon ...", "poseidon: ..."
  for (const name of AGENT_NAMES) {
    const patterns = [
      new RegExp(`^@${name}\\b`, 'i'),
      new RegExp(`^(tell|ask|have|get)\\s+${name}\\b`, 'i'),
      new RegExp(`^${name}[,:]\\s`, 'i'),
    ]
    const match = patterns.find(p => p.test(msg))
    if (match) {
      const instruction = msg.replace(match, '').trim() || msg
      return { strategy: 'route', target: name, instruction, reason: `direct address: ${name}` }
    }
  }

  // 4. Domain scoring
  const scores = scoreDomains(lower)
  const ranked = Object.entries(scores).filter(([_, s]) => s > 0).sort((a, b) => b[1] - a[1])

  // 5. Multi-domain: 2+ domains with score >= 2
  const strong = ranked.filter(([_, s]) => s >= 2)
  if (strong.length >= 2) {
    return {
      strategy: 'multi',
      domains: strong.map(([id, score]) => ({ id, score })),
      reason: `multi-domain: ${strong.map(([id]) => id).join(', ')}`,
    }
  }

  // 6. Single domain with good confidence
  if (ranked.length > 0 && ranked[0][1] >= 2) {
    return { strategy: 'route', target: ranked[0][0], reason: `domain: ${ranked[0][0]} (${ranked[0][1]} hits)` }
  }

  // 7. Use pantheon.js routeQuestion as fallback
  const route = routeQuestion(msg)
  if (route.confidence === 'high') {
    return { strategy: 'route', target: route.agent, reason: route.reason }
  }

  // 8. Default: Nyx handles directly
  return { strategy: 'direct', reason: 'general' }
}

// ============ Execution Strategies ============

// Direct: Nyx answers
async function execDirect(message, chatId) {
  const task = createTask('direct', message)
  task.status = 'active'
  emit('direct', { taskId: task.id })

  const response = await pantheonChat('nyx', message, chatId)

  task.status = 'complete'
  task.completed = new Date().toISOString()
  task.synthesis = response.text

  return {
    taskId: task.id, type: 'direct', speaker: 'nyx',
    text: response.text, delegations: [], usage: response.usage,
  }
}

// Route: delegate to a specific god
async function execRoute(godId, message, chatId, instruction) {
  const archetypes = getArchetypes()
  const god = archetypes[godId]
  if (!god) return execDirect(message, chatId)

  const task = createTask('route', message, [{ id: godId, status: 'pending' }])
  task.status = 'active'
  emit('route', { taskId: task.id, god: godId, domain: god.domain })

  const response = await pantheonChat(godId, instruction || message, chatId)

  task.gods[0].status = 'complete'
  task.gods[0].response = response.text
  task.status = 'complete'
  task.completed = new Date().toISOString()
  task.synthesis = response.text

  try { updateAgentContext(godId, `query: ${message.slice(0, 80)}`) } catch {}

  return {
    taskId: task.id, type: 'route', speaker: godId,
    text: response.text,
    delegations: [{ god: godId, domain: god.domain, text: response.text }],
    usage: response.usage,
  }
}

// Multi: parallel delegation to multiple gods, then synthesis
async function execMulti(domains, message, chatId) {
  const archetypes = getArchetypes()
  const gods = domains.map(d => ({ id: d.id, status: 'pending', response: null }))

  const task = createTask('multi', message, gods)
  task.status = 'active'
  emit('multi-start', { taskId: task.id, gods: domains.map(d => d.id) })

  // Parallel delegation
  const results = await Promise.all(
    gods.map(async (god) => {
      god.status = 'active'
      emit('delegate', { taskId: task.id, god: god.id })
      try {
        const response = await consultAgent('nyx', god.id,
          `[Nyx orchestration — Freedom asks]: "${message}"\n\nAnswer from your domain (${archetypes[god.id]?.domain}). Be concise — 2-4 sentences.`
        )
        god.status = 'complete'
        god.response = response.text
        return { god: god.id, text: response.text, ok: true }
      } catch (err) {
        god.status = 'error'
        god.response = `Error: ${err.message}`
        return { god: god.id, text: god.response, ok: false }
      }
    })
  )

  // Synthesize
  emit('synthesize', { taskId: task.id })
  const godOutputs = results.filter(r => r.ok)
    .map(r => `**${r.god.toUpperCase()}** (${archetypes[r.god]?.domain?.split(',')[0]}): ${r.text}`)
    .join('\n\n')

  const synthesis = await pantheonChat('nyx',
    `[SYNTHESIZE for Freedom]\nQuestion: "${message}"\n\nGod responses:\n${godOutputs}\n\nCombine into one clear, unified answer. Credit each god.`,
    `synth-${chatId}`
  )

  task.status = 'complete'
  task.completed = new Date().toISOString()
  task.synthesis = synthesis.text

  return {
    taskId: task.id, type: 'multi', speaker: 'nyx',
    text: synthesis.text,
    delegations: results.map(r => ({
      god: r.god, domain: archetypes[r.god]?.domain, text: r.text, ok: r.ok,
    })),
    usage: synthesis.usage,
  }
}

// Status: system overview
async function execStatus() {
  const status = await getTheAIStatus()
  const tree = getTreeState()
  const archetypes = getArchetypes()

  const task = createTask('status', 'system status')
  task.status = 'complete'
  task.completed = new Date().toISOString()

  const lines = [
    '**Pantheon Status**',
    `Agents: ${status.activeAgents} | Calls: ${status.totalCalls} | Cost: ${status.totalCost}`,
    `Root Hash: \`${tree.rootHashShort || 'uninitialized'}\``,
    '',
    '**Hierarchy:**',
  ]

  for (const [id, arch] of Object.entries(archetypes)) {
    const indent = arch.tier === 0 ? '' : arch.tier === 1 ? '  ' : '    '
    const meta = GOD_META[id] || {}
    lines.push(`${indent}${meta.symbol || '?'} **${id}** (T${arch.tier}) — ${arch.domain.split(',')[0]}`)
  }

  const text = lines.join('\n')
  task.synthesis = text

  return {
    taskId: task.id, type: 'status', speaker: 'nyx',
    text, delegations: [],
    usage: { input: 0, output: 0, cost: '$0.0000' },
  }
}

// ============ Main Entry Point ============

export async function orchestrate(message, chatId = 'default') {
  const intent = classifyIntent(message)
  emit('classify', { message: message.slice(0, 100), ...intent })

  switch (intent.strategy) {
    case 'direct':  return execDirect(message, chatId)
    case 'status':  return execStatus()
    case 'route':   return execRoute(intent.target, message, chatId, intent.instruction)
    case 'multi':   return execMulti(intent.domains, message, chatId)
    default:        return execDirect(message, chatId)
  }
}

// ============ Pantheon Overview (for UI) ============

export function getPantheonOverview() {
  const archetypes = getArchetypes()
  const tree = getTreeState()

  return {
    gods: Object.entries(archetypes).map(([id, arch]) => ({
      id,
      tier: arch.tier,
      domain: arch.domain,
      manager: arch.manager,
      meta: GOD_META[id],
      hash: tree.nodes?.[id]?.hash,
      constellation: tree.nodes?.[id]?.constellation,
    })),
    rootHash: tree.rootHash,
    rootHashShort: tree.rootHashShort,
    taskCount: tasks.size,
    activityCount: activity.length,
  }
}
