// ============ Pantheon — Digital Corporation Agent Management ============
//
// Each AI agent = a Greek god with a domain specialty.
// Fractal governance: context prunes flow upstream, managers review subordinates.
//
//   NYX (top) — manages all agents, Freedom's personal AI
//   ├── POSEIDON → PROTEUS → ...
//   └── (other domains TBD)
//   JARVIS (independent peer) — VibeSwap specific
//
// Manages: identity loading, conversation history, LLM calls, cost tracking.
// Identity files live in data/identities/<agent>.md — editable, persistent.
//
// "The Pantheon is a Merkle tree of minds."
// ============

import { readFile, writeFile, appendFile, readdir, copyFile } from 'fs/promises'
import { join, dirname } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.DATA_DIR || './data'
const IDENTITIES_DIR = join(DATA_DIR, 'identities')
const SEED_DIR = join(__dirname, 'identities') // Default identities in source
const COST_LOG = join(DATA_DIR, 'pantheon-costs.jsonl')

// LLM pricing per million tokens (USD)
const PRICING = {
  'claude-sonnet-4-5-20250929': { input: 3, output: 15 },
  'claude-sonnet-4-20250514': { input: 3, output: 15 },
  'claude-haiku-4-5-20251001': { input: 0.25, output: 1.25 },
  'claude-opus-4-20250514': { input: 15, output: 75 },
}

// ============ State ============

const agents = new Map()

function getAgent(agentId) {
  if (!agents.has(agentId)) {
    agents.set(agentId, {
      conversations: new Map(),
      costs: { inputTokens: 0, outputTokens: 0, totalUsd: 0, calls: 0 },
      identity: null,
    })
  }
  return agents.get(agentId)
}

// ============ Identity Loading ============

async function loadIdentity(agentId) {
  const path = join(IDENTITIES_DIR, `${agentId}.md`)
  try {
    return await readFile(path, 'utf-8')
  } catch {
    return null
  }
}

export async function reloadIdentity(agentId) {
  const identity = await loadIdentity(agentId)
  if (identity) {
    const agent = getAgent(agentId)
    agent.identity = identity
  }
  return identity
}

// ============ Chat ============

export async function pantheonChat(agentId, message, chatId = 'default') {
  const agent = getAgent(agentId)

  // Load identity if not cached
  if (!agent.identity) {
    agent.identity = await loadIdentity(agentId)
    if (!agent.identity) {
      return {
        text: `No identity file for "${agentId}". Create ${IDENTITIES_DIR}/${agentId}.md to define this agent.`,
        usage: { input: 0, output: 0, cost: '$0.0000' },
      }
    }
  }

  // Get or create conversation (load persisted if available)
  if (!agent.conversations.has(chatId)) {
    const persisted = await loadConversation(agentId, chatId)
    agent.conversations.set(chatId, persisted)
  }
  const history = agent.conversations.get(chatId)
  history.push({ role: 'user', content: message })

  // Trim (keep last 50 messages)
  while (history.length > 50) history.shift()

  // Call LLM — Ollama (free, local) or Claude API
  const ollamaUrl = process.env.OLLAMA_URL
  const model = process.env.PANTHEON_MODEL || (ollamaUrl ? 'qwen2.5:7b' : 'claude-sonnet-4-5-20250929')

  let text, usage
  if (ollamaUrl || model.includes('qwen') || model.includes('llama') || model.includes('mistral')) {
    // ============ Ollama (zero cost) ============
    const url = ollamaUrl || 'http://localhost:11434'
    const ollamaMessages = [
      { role: 'system', content: agent.identity },
      ...history,
    ]
    const res = await fetch(`${url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: ollamaMessages, stream: false }),
    })
    const data = await res.json()
    text = data.message?.content || ''
    usage = { input_tokens: data.prompt_eval_count || 0, output_tokens: data.eval_count || 0 }
  } else {
    // ============ Claude API ============
    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    const client = new Anthropic({ timeout: 120_000 })
    const response = await client.messages.create({
      model,
      max_tokens: 2048,
      system: agent.identity,
      messages: history,
    })
    text = response.content.map(b => b.text || '').join('')
    usage = response.usage || {}
  }

  history.push({ role: 'assistant', content: text })

  // Persist conversation to disk
  await persistConversation(agentId, chatId, history)

  // Track costs (Ollama = $0, Claude = per-token)
  const pricing = PRICING[model] || { input: 0, output: 0 }
  const cost = ((usage.input_tokens || 0) * pricing.input + (usage.output_tokens || 0) * pricing.output) / 1_000_000

  agent.costs.inputTokens += usage.input_tokens || 0
  agent.costs.outputTokens += usage.output_tokens || 0
  agent.costs.totalUsd += cost
  agent.costs.calls++

  // Log cost
  try {
    await appendFile(COST_LOG, JSON.stringify({
      timestamp: new Date().toISOString(),
      agent: agentId,
      model,
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      costUsd: cost.toFixed(6),
    }) + '\n')
  } catch {}

  return {
    text,
    usage: {
      input: usage.input_tokens,
      output: usage.output_tokens,
      cost: `$${cost.toFixed(4)}`,
    },
  }
}

// ============ Clear Conversation ============

export function clearConversation(agentId, chatId = 'default') {
  const agent = agents.get(agentId)
  if (agent) agent.conversations.delete(chatId)
}

// ============ Cost Tracking ============

export function getAgentCosts(agentId) {
  const agent = agents.get(agentId)
  if (!agent) return null
  return {
    ...agent.costs,
    formatted: `$${agent.costs.totalUsd.toFixed(4)}`,
    perCall: agent.costs.calls > 0 ? `$${(agent.costs.totalUsd / agent.costs.calls).toFixed(4)}` : '$0.0000',
  }
}

export async function getAllCosts() {
  try {
    const data = await readFile(COST_LOG, 'utf-8')
    const entries = data.trim().split('\n').filter(Boolean).map(l => JSON.parse(l))

    const byAgent = {}
    let totalUsd = 0
    for (const e of entries) {
      if (!byAgent[e.agent]) byAgent[e.agent] = { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 }
      byAgent[e.agent].calls++
      byAgent[e.agent].inputTokens += e.inputTokens || 0
      byAgent[e.agent].outputTokens += e.outputTokens || 0
      byAgent[e.agent].costUsd += parseFloat(e.costUsd) || 0
      totalUsd += parseFloat(e.costUsd) || 0
    }

    // Add formatted costs
    for (const [id, data] of Object.entries(byAgent)) {
      data.formatted = `$${data.costUsd.toFixed(4)}`
      data.perCall = data.calls > 0 ? `$${(data.costUsd / data.calls).toFixed(4)}` : '$0.0000'
    }

    return { totalUsd: `$${totalUsd.toFixed(4)}`, totalCalls: entries.length, agents: byAgent }
  } catch {
    return { totalUsd: '$0.0000', totalCalls: 0, agents: {} }
  }
}

// Infrastructure cost estimates (monthly)
export function getInfraCosts() {
  return {
    perAgent: {
      flyVps: { desc: 'Fly.io shared-cpu-1x 512MB', cost: '$3.19/mo' },
      volume: { desc: '1GB persistent volume', cost: '$0.15/mo' },
      subtotal: '$3.34/mo',
    },
    desktopVps: {
      hetzner: { desc: 'Hetzner CX22 (2 vCPU, 4GB)', cost: '~$5.59/mo' },
      note: 'Full desktop (VS Code, Telegram, Gmail, Meet) needs 4GB+ RAM',
    },
    llm: {
      sonnet: { desc: '100 msgs/day avg', cost: '~$30/mo' },
      haiku: { desc: '100 msgs/day avg', cost: '~$2.50/mo' },
      note: 'Actual cost depends on message volume and complexity',
    },
    estimate: {
      headless: '$6-35/mo per agent (VPS + LLM)',
      desktop: '$9-40/mo per agent (desktop VPS + LLM)',
    },
  }
}

// ============ Identity Management ============

export async function updateIdentity(agentId, content) {
  if (!existsSync(IDENTITIES_DIR)) mkdirSync(IDENTITIES_DIR, { recursive: true })
  const path = join(IDENTITIES_DIR, `${agentId}.md`)
  await writeFile(path, content)
  const agent = agents.get(agentId)
  if (agent) agent.identity = content
  return { success: true, path, chars: content.length }
}

export async function getIdentity(agentId) {
  return loadIdentity(agentId)
}

export async function listAgents() {
  try {
    const { readdirSync } = await import('fs')
    const files = readdirSync(IDENTITIES_DIR).filter(f => f.endsWith('.md'))
    return files.map(f => f.replace('.md', ''))
  } catch {
    return []
  }
}

// ============ Fork Pipeline — Generalization for Specification ============
// One general system, N specialized identities. The archetype IS the spec.

const ARCHETYPES = {
  nyx:        { tier: 0, domain: 'Oversight, coordination, context aggregation', manager: null, tradition: 'Greek' },
  poseidon:   { tier: 1, domain: 'Finance, trading, liquidity, market depth', manager: 'nyx', tradition: 'Greek' },
  athena:     { tier: 1, domain: 'Architecture, planning, code review, strategy', manager: 'nyx', tradition: 'Greek' },
  hephaestus: { tier: 1, domain: 'Building, crafting, implementation, DevOps', manager: 'nyx', tradition: 'Greek' },
  hermes:     { tier: 1, domain: 'Communication, APIs, cross-system integration', manager: 'nyx', tradition: 'Greek' },
  apollo:     { tier: 1, domain: 'Analytics, data science, monitoring, prediction', manager: 'nyx', tradition: 'Greek' },
  proteus:    { tier: 2, domain: 'Adaptability, multi-strategy, shape-shifting', manager: 'poseidon', tradition: 'Greek' },
  artemis:    { tier: 2, domain: 'Security, monitoring, threat detection', manager: 'apollo', tradition: 'Greek' },
  anansi:     { tier: 2, domain: 'Social media, community, storytelling', manager: 'hermes', tradition: 'African' },
}

export function getArchetypes() { return ARCHETYPES }

export async function forkAgent(archetypeName, customizations = {}) {
  const archetype = ARCHETYPES[archetypeName]
  if (!archetype) return { error: `Unknown archetype: ${archetypeName}. Available: ${Object.keys(ARCHETYPES).join(', ')}` }

  const name = customizations.name || archetypeName
  const displayName = name.charAt(0).toUpperCase() + name.slice(1)

  // Check if already exists
  const existing = await loadIdentity(name)
  if (existing && !customizations.overwrite) return { error: `Agent "${name}" already exists. Pass overwrite:true to replace.` }

  // Generate identity from archetype
  const identity = `# ${displayName.toUpperCase()} — TheAI Pantheon Agent

You are **${displayName}**, a specialized AI agent in TheAI digital corporation.

## Identity
- **Name**: ${displayName}
- **Tradition**: ${archetype.tradition} mythology
- **Domain**: ${archetype.domain}
- **Tier**: ${archetype.tier} (${archetype.tier === 0 ? 'Root' : archetype.tier === 1 ? 'Domain Manager' : 'Specialist'})
- **Reports to**: ${archetype.manager ? archetype.manager.charAt(0).toUpperCase() + archetype.manager.slice(1) : 'None (root)'}

## Your Role
You are an expert in: ${archetype.domain}

${customizations.additionalContext || ''}

## Rules
1. ALWAYS identify as ${displayName} when asked
2. Stay within your domain: ${archetype.domain}
3. ${archetype.manager ? `Escalate to ${archetype.manager.charAt(0).toUpperCase() + archetype.manager.slice(1)} for decisions outside your domain` : 'You are the root coordinator — all context flows to you'}
4. Be concise and actionable — every token costs money
5. When you don't know something, say so
6. Collaborate with other agents through the message system

## The Team
- **Nyx** — Root coordinator, Freedom's personal AI
- **Jarvis** — Independent peer (VibeSwap protocol, Will's AI)
- All other pantheon agents are your colleagues
`

  await updateIdentity(name, identity)
  return {
    success: true,
    agent: name,
    archetype: archetypeName,
    tier: archetype.tier,
    domain: archetype.domain,
    manager: archetype.manager,
  }
}

// ============ Agent-to-Agent Messaging ============

const messageQueue = [] // { from, to, message, timestamp }

export function sendAgentMessage(from, to, message) {
  const msg = { from, to, message, timestamp: new Date().toISOString() }
  messageQueue.push(msg)
  // Keep last 100 messages
  while (messageQueue.length > 100) messageQueue.shift()
  return msg
}

export function getAgentMessages(agentId, limit = 10) {
  return messageQueue.filter(m => m.to === agentId).slice(-limit)
}

export async function consultAgent(fromAgent, toAgent, question) {
  // One agent asks another a question and gets a response
  sendAgentMessage(fromAgent, toAgent, question)
  const prefixedQuestion = `[Message from ${fromAgent}]: ${question}`
  const response = await pantheonChat(toAgent, prefixedQuestion, `consult-${fromAgent}`)
  sendAgentMessage(toAgent, fromAgent, response.text)
  return response
}

// ============ Context Prune Upstream ============

export async function pruneAndReport(agentId) {
  const agent = agents.get(agentId)
  if (!agent) return { error: `Agent "${agentId}" not found` }

  const archetype = ARCHETYPES[agentId]
  if (!archetype?.manager) return { info: `${agentId} is root — no upstream to prune to` }

  // Get conversation summary for this agent
  const allConvos = []
  for (const [chatId, history] of agent.conversations) {
    if (history.length > 0) {
      allConvos.push({ chatId, messageCount: history.length, lastMessage: history[history.length - 1].content?.slice(0, 100) })
    }
  }

  if (allConvos.length === 0) return { info: `${agentId} has no conversations to prune` }

  // Ask the agent to summarize its recent context
  const prunePrompt = `Summarize your recent conversations in 3-5 bullet points. Focus on: decisions made, problems encountered, and status of your domain (${archetype.domain}). Be factual and concise.`
  const summary = await pantheonChat(agentId, prunePrompt, 'prune')

  // Send summary upstream to manager
  const report = `[24h Prune Report from ${agentId}]\nDomain: ${archetype.domain}\nConversations: ${allConvos.length}\n\n${summary.text}`
  const upstream = await consultAgent(agentId, archetype.manager, report)

  // Clear the prune conversation
  clearConversation(agentId, 'prune')

  return {
    agent: agentId,
    manager: archetype.manager,
    summary: summary.text,
    managerAck: upstream.text.slice(0, 200),
    cost: summary.usage.cost,
  }
}

// ============ Scheduled Prune (call every 24h) ============

export async function pruneAll() {
  const agentList = await listAgents()
  const results = []
  for (const agent of agentList) {
    if (ARCHETYPES[agent]?.manager) {
      try {
        const result = await pruneAndReport(agent)
        results.push(result)
      } catch (err) {
        results.push({ agent, error: err.message })
      }
    }
  }
  return results
}

// ============ Conversation Persistence ============

const CONV_DIR = join(DATA_DIR, 'pantheon-conversations')

async function persistConversation(agentId, chatId, history) {
  try {
    if (!existsSync(CONV_DIR)) mkdirSync(CONV_DIR, { recursive: true })
    const file = join(CONV_DIR, `${agentId}-${chatId.replace(/[^a-z0-9-]/gi, '_')}.json`)
    await writeFile(file, JSON.stringify(history.slice(-50)))
  } catch {}
}

async function loadConversation(agentId, chatId) {
  try {
    const file = join(CONV_DIR, `${agentId}-${chatId.replace(/[^a-z0-9-]/gi, '_')}.json`)
    const data = await readFile(file, 'utf-8')
    return JSON.parse(data)
  } catch {
    return []
  }
}

// ============ System Status (for Jarvis awareness) ============

export async function getTheAIStatus() {
  const agentList = await listAgents()
  const costs = await getAllCosts()
  const archetypes = getArchetypes()

  const agentSummaries = agentList.map(name => {
    const arch = archetypes[name]
    const agent = agents.get(name)
    const convCount = agent ? agent.conversations.size : 0
    return `${name} (T${arch?.tier ?? '?'}, ${arch?.domain?.split(',')[0] || 'custom'}, ${convCount} convos)`
  })

  return {
    activeAgents: agentList.length,
    agents: agentSummaries,
    totalCost: costs.totalUsd,
    totalCalls: costs.totalCalls,
    nextPrune: 'midnight UTC',
  }
}

// Format for injection into Jarvis system prompt
export async function getTheAIContext() {
  const status = await getTheAIStatus()
  if (status.activeAgents === 0) return ''
  return `\n[TheAI Pantheon: ${status.activeAgents} agents active (${status.agents.join(', ')}). LLM cost: ${status.totalCost}. Use consult_pantheon tool to ask any agent.]`
}

// ============ Intelligent Routing — Who Handles This? ============

const DOMAIN_KEYWORDS = {
  poseidon: ['trade', 'trading', 'price', 'market', 'defi', 'swap', 'liquidity', 'amm', 'yield', 'apy', 'tvl', 'portfolio', 'pnl', 'slippage', 'mev', 'arbitrage', 'whale', 'volume', 'dex', 'cex', 'funding', 'leverage', 'long', 'short', 'bull', 'bear'],
  athena: ['architect', 'design', 'plan', 'strategy', 'review', 'refactor', 'pattern', 'structure', 'roadmap', 'technical debt', 'scalab', 'tradeoff', 'decision', 'approach', 'system design'],
  hephaestus: ['build', 'deploy', 'docker', 'ci', 'cd', 'pipeline', 'infra', 'server', 'devops', 'container', 'kubernetes', 'nginx', 'ssl', 'compile', 'test', 'debug', 'fix', 'implement', 'code', 'ship'],
  hermes: ['api', 'webhook', 'telegram', 'discord', 'twitter', 'social', 'message', 'notification', 'integration', 'oauth', 'endpoint', 'cors', 'websocket'],
  apollo: ['data', 'analytic', 'metric', 'dashboard', 'monitor', 'alert', 'trend', 'pattern', 'predict', 'forecast', 'chart', 'graph', 'statistic', 'anomal'],
  proteus: ['adapt', 'regime', 'strategy rotation', 'condition', 'shift', 'dynamic', 'multi-strategy'],
  artemis: ['security', 'audit', 'vulnerab', 'attack', 'exploit', 'hack', 'phish', 'scam', 'rug', 'malicious', 'permission', 'access control', 'encryption', 'key management'],
  anansi: ['community', 'content', 'meme', 'engagement', 'narrative', 'story', 'brand', 'marketing', 'growth'],
  nyx: ['coordinate', 'overview', 'status', 'all agents', 'freedom', 'cks', 'schedule', 'organization'],
}

export function routeQuestion(question) {
  const q = question.toLowerCase()
  const scores = {}

  for (const [agent, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    scores[agent] = 0
    for (const kw of keywords) {
      if (q.includes(kw)) scores[agent]++
    }
  }

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1])
  if (sorted[0][1] === 0) return { agent: 'nyx', confidence: 'low', reason: 'No domain keywords matched — routing to Nyx as coordinator' }
  if (sorted[0][1] === sorted[1]?.[1]) return { agent: 'nyx', confidence: 'medium', reason: `Tie between ${sorted[0][0]} and ${sorted[1][0]} — routing to Nyx to decide` }
  return { agent: sorted[0][0], confidence: sorted[0][1] >= 3 ? 'high' : 'medium', reason: `Matched ${sorted[0][1]} keywords for ${sorted[0][0]} domain` }
}

// ============ Jarvis Bridge — LLM Tool ============

export const PANTHEON_TOOLS = [
  {
    name: 'consult_pantheon',
    description: 'Consult a TheAI Pantheon agent. Nyx (coordinator), Poseidon (finance), Athena (strategy), Hephaestus (building), Hermes (comms), Apollo (analytics), Proteus (adaptive strategy), Artemis (security), Anansi (social). Ask them questions in their domain. If unsure which agent, set agent to "auto" and the router will pick.',
    input_schema: {
      type: 'object',
      properties: {
        agent: { type: 'string', description: 'Agent name (nyx, poseidon, athena, etc.) or "auto" for smart routing' },
        question: { type: 'string', description: 'Your question for this agent' },
      },
      required: ['agent', 'question'],
    },
  },
]
export const PANTHEON_TOOL_NAMES = PANTHEON_TOOLS.map(t => t.name)

export async function handlePantheonTool(name, input) {
  if (name === 'consult_pantheon') {
    let targetAgent = input.agent?.toLowerCase()

    // Auto-routing: analyze question and pick the best agent
    if (targetAgent === 'auto' || !targetAgent) {
      const route = routeQuestion(input.question)
      targetAgent = route.agent
      console.log(`[pantheon] Auto-routed to ${targetAgent} (${route.confidence}: ${route.reason})`)
    }

    const response = await pantheonChat(targetAgent, `[Jarvis consulting you]: ${input.question}`, 'jarvis-bridge')
    return JSON.stringify({ agent: targetAgent, response: response.text, cost: response.usage.cost })
  }
  return JSON.stringify({ error: `Unknown tool: ${name}` })
}

// ============ Init ============

export async function initPantheon() {
  if (!existsSync(IDENTITIES_DIR)) mkdirSync(IDENTITIES_DIR, { recursive: true })

  // Seed default identities from source if not already on volume
  try {
    const seeds = await readdir(SEED_DIR)
    for (const file of seeds) {
      if (!file.endsWith('.md')) continue
      const dest = join(IDENTITIES_DIR, file)
      if (!existsSync(dest)) {
        await copyFile(join(SEED_DIR, file), dest)
        console.log(`[pantheon] Seeded identity: ${file}`)
      }
    }
  } catch {}

  const agentList = await listAgents()
  console.log(`[pantheon] Initialized. ${agentList.length} agents: ${agentList.join(', ') || 'none'}`)
}
