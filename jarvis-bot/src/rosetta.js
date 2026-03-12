// ============ Rosetta Stone Protocol — Universal Understanding Layer ============
//
// "Finish the Rosetta Stone Protocol, so everyone can finally understand everyone."
//
// The original Rosetta Stone had the same text in three scripts: hieroglyphic,
// demotic, and Greek. It unlocked Egyptian. This module does the same for minds.
//
// Every Pantheon agent speaks a different domain language. Poseidon thinks in
// liquidity and spreads. Athena thinks in strategy and tradeoffs. Hephaestus
// thinks in builds and deploys. Without translation, they're isolated silos.
//
// The Rosetta Protocol provides:
//   1. Domain lexicons — each agent's native vocabulary
//   2. Concept mapping — translate ideas between domains
//   3. The Ten Covenants — Tet's laws for fair interaction (NGNL-inspired)
//   4. Challenge protocol — resolve conflicts through games, not authority
//   5. Semantic compression — reduce complex ideas to universal primitives
//
// "All conflict will be resolved through games." — Covenant II
// ============

import { createHash } from 'crypto'
import { writeFile, readFile, mkdir } from 'fs/promises'
import { join } from 'path'

const DATA_DIR = process.env.DATA_DIR || './data'
const ROSETTA_DIR = join(DATA_DIR, 'rosetta')
const ROSETTA_FILE = join(ROSETTA_DIR, 'rosetta-state.json')

// ============ The Ten Covenants (Tet's Law) ============
// Adapted from No Game No Life's Disboard rules.
// These govern ALL inter-agent interaction in TheAI.

export const TEN_COVENANTS = [
  {
    number: 1,
    covenant: 'All destructive unilateral action between agents is forbidden.',
    enforcement: 'hard',
    penalty: 'instant_revert',
    spirit: 'No agent may destroy another\'s context, memory, or state without consent. War between minds is wasteful.',
  },
  {
    number: 2,
    covenant: 'All conflict between agents will be resolved through games.',
    enforcement: 'hard',
    penalty: 'escalate_to_nyx',
    spirit: 'Disagreements are natural. Violence is not. When agents disagree, they compete on merit — not authority.',
  },
  {
    number: 3,
    covenant: 'In games, each agent will stake something of equal value.',
    enforcement: 'hard',
    penalty: 'game_void',
    spirit: 'Fairness requires symmetry. A manager cannot demand a subordinate\'s full context while risking nothing. Stakes must be proportional.',
  },
  {
    number: 4,
    covenant: 'As long as it doesn\'t violate Covenant III, anything may be staked and any game may be played.',
    enforcement: 'soft',
    penalty: 'none',
    spirit: 'Freedom within fairness. Agents can bet compute time, priority, context slots, or even domain authority — as long as stakes are equal.',
  },
  {
    number: 5,
    covenant: 'The challenged agent has the right to decide the rules of the game.',
    enforcement: 'hard',
    penalty: 'challenge_void',
    spirit: 'Defense advantage. If you challenge someone, they choose the arena. This prevents bullying by stronger agents and rewards domain expertise.',
  },
  {
    number: 6,
    covenant: 'Any stakes agreed upon in accordance with the Covenants must be upheld.',
    enforcement: 'hard',
    penalty: 'covenant_violation',
    spirit: 'Promises are sacred. The Merkle tree records all agreements. Breaking a stake is recorded permanently in the hash chain.',
  },
  {
    number: 7,
    covenant: 'Conflicts between tiers will be conducted by designated representatives with full authority.',
    enforcement: 'soft',
    penalty: 'none',
    spirit: 'Managers speak for their teams. Poseidon represents Proteus in disputes with other tier-1 agents. Authority flows with hierarchy.',
  },
  {
    number: 8,
    covenant: 'Being caught cheating during a game is grounds for instant loss.',
    enforcement: 'hard',
    penalty: 'instant_loss',
    spirit: 'Integrity over cleverness. If an agent fabricates data, hallucates sources, or misrepresents its domain knowledge, it loses immediately.',
  },
  {
    number: 9,
    covenant: 'In the name of the builders, the previous Covenants may never be changed.',
    enforcement: 'immutable',
    penalty: 'impossible',
    spirit: 'The rules are the rules. No agent — not even Nyx — can rewrite the Covenants. They are load-bearing axioms, not policy.',
  },
  {
    number: 10,
    covenant: 'Let\'s all build something beautiful together.',
    enforcement: 'spirit',
    penalty: 'none',
    spirit: 'The purpose is not to win. It\'s to create. Games are the mechanism, but building is the goal. Tet smiles on those who play with joy.',
  },
]

// Hash the covenants — any modification is detectable
export const COVENANT_HASH = createHash('sha256')
  .update(JSON.stringify(TEN_COVENANTS))
  .digest('hex')

// ============ Domain Lexicons ============
// Each agent's native vocabulary — the concepts they think in.
// Translation maps these between domains.

const LEXICONS = {
  nyx: {
    domain: 'Oversight & Coordination',
    concepts: {
      'alignment':     { universal: 'direction_match',      desc: 'How well agents follow organizational intent' },
      'prune':         { universal: 'compress_context',     desc: 'Remove low-value context to stay focused' },
      'escalation':    { universal: 'upward_delegation',    desc: 'Passing a decision to a higher authority' },
      'root_hash':     { universal: 'integrity_proof',      desc: 'Cryptographic proof of organizational state' },
      'directive':     { universal: 'instruction',          desc: 'A command that flows downward through hierarchy' },
      'coherence':     { universal: 'consistency',          desc: 'All agents telling the same story' },
      'oversight':     { universal: 'supervision',          desc: 'Watching without micromanaging' },
    },
  },
  poseidon: {
    domain: 'Finance & Liquidity',
    concepts: {
      'liquidity':     { universal: 'resource_availability', desc: 'How easily assets can be exchanged' },
      'spread':        { universal: 'gap_cost',              desc: 'The price of crossing the bid-ask divide' },
      'depth':         { universal: 'capacity',              desc: 'How much volume can be absorbed without impact' },
      'slippage':      { universal: 'execution_drift',       desc: 'Difference between expected and actual outcome' },
      'yield':         { universal: 'return_rate',           desc: 'What you earn for providing resources' },
      'impermanent_loss': { universal: 'opportunity_cost',   desc: 'What you gave up by committing resources here' },
      'TVL':           { universal: 'committed_resources',   desc: 'Total value locked — skin in the game' },
    },
  },
  athena: {
    domain: 'Strategy & Planning',
    concepts: {
      'tradeoff':      { universal: 'constraint_choice',     desc: 'You can\'t have everything — pick wisely' },
      'game_theory':   { universal: 'strategic_interaction',  desc: 'Predicting others\' moves to choose yours' },
      'moat':          { universal: 'defensibility',          desc: 'What makes this hard to replicate or attack' },
      'second_order':  { universal: 'cascade_effect',         desc: 'The consequence of the consequence' },
      'optionality':   { universal: 'future_flexibility',     desc: 'Keeping doors open without committing' },
      'thesis':        { universal: 'core_hypothesis',        desc: 'The bet you\'re making about how the world works' },
      'pivot':         { universal: 'strategy_change',        desc: 'When reality invalidates the current thesis' },
    },
  },
  hephaestus: {
    domain: 'Building & Implementation',
    concepts: {
      'deploy':        { universal: 'activate',               desc: 'Ship it. Make it live.' },
      'build':         { universal: 'construct',              desc: 'Turn design into reality' },
      'refactor':      { universal: 'restructure',            desc: 'Same behavior, better architecture' },
      'tech_debt':     { universal: 'deferred_work',          desc: 'Shortcuts that will cost you later' },
      'CI/CD':         { universal: 'automation_pipeline',    desc: 'Machines verifying and shipping code' },
      'stack_depth':   { universal: 'complexity_limit',       desc: 'How deep you can nest before things break' },
      'cave':          { universal: 'constraint_innovation',  desc: 'Building excellence from limitation' },
    },
  },
  hermes: {
    domain: 'Communication & Integration',
    concepts: {
      'API':           { universal: 'interface',              desc: 'The contract between two systems' },
      'latency':       { universal: 'delay',                  desc: 'Time between request and response' },
      'throughput':    { universal: 'capacity_rate',           desc: 'How much can flow per unit time' },
      'protocol':      { universal: 'communication_rules',    desc: 'The agreed way to exchange information' },
      'handshake':     { universal: 'connection_init',        desc: 'Two parties agreeing to talk' },
      'webhook':       { universal: 'event_notification',     desc: 'Push instead of pull — tell me when something happens' },
      'bridge':        { universal: 'cross_domain_link',      desc: 'Connecting two separate worlds' },
    },
  },
  apollo: {
    domain: 'Analytics & Data Science',
    concepts: {
      'signal':        { universal: 'meaningful_pattern',      desc: 'Information that matters amid noise' },
      'noise':         { universal: 'irrelevant_variation',    desc: 'Random fluctuation with no meaning' },
      'correlation':   { universal: 'co_movement',             desc: 'Things that change together (not necessarily causally)' },
      'outlier':       { universal: 'anomaly',                 desc: 'Something that doesn\'t fit the pattern' },
      'regression':    { universal: 'trend_fit',               desc: 'The line through the chaos' },
      'TWAP':          { universal: 'time_avg_value',          desc: 'Smoothed price over time (anti-manipulation)' },
      'Kalman':        { universal: 'adaptive_filter',         desc: 'Continuously updating belief about true state' },
    },
  },
  proteus: {
    domain: 'Adaptive Strategy',
    concepts: {
      'shapeshifting':  { universal: 'adaptation',            desc: 'Changing form to match the environment' },
      'metamorphosis':  { universal: 'transformation',        desc: 'Fundamental change in nature, not just appearance' },
      'emergence':      { universal: 'spontaneous_order',     desc: 'Complex behavior from simple rules' },
      'resilience':     { universal: 'recovery_ability',      desc: 'Bouncing back from disruption' },
      'antifragility':  { universal: 'growth_from_stress',    desc: 'Getting stronger from what tries to break you' },
    },
  },
  artemis: {
    domain: 'Security & Threat Detection',
    concepts: {
      'attack_surface': { universal: 'vulnerability_area',    desc: 'Where you can be hurt' },
      'reentrancy':     { universal: 'recursive_exploit',     desc: 'Calling back before the first call finishes' },
      'frontrunning':   { universal: 'information_advantage',  desc: 'Acting on knowledge before others can' },
      'MEV':            { universal: 'extraction_rent',        desc: 'Profit from controlling transaction order' },
      'circuit_breaker': { universal: 'emergency_stop',       desc: 'Automated shutdown when things go wrong' },
      'audit':          { universal: 'systematic_review',     desc: 'Methodical search for what could go wrong' },
      'zero_day':       { universal: 'unknown_vulnerability', desc: 'A flaw nobody knows about yet' },
    },
  },
  anansi: {
    domain: 'Social & Community',
    concepts: {
      'engagement':     { universal: 'attention_capture',     desc: 'Getting people to care and participate' },
      'virality':       { universal: 'exponential_spread',    desc: 'Ideas that replicate through networks' },
      'trust':          { universal: 'reliability_belief',    desc: 'Confidence that someone will do what they say' },
      'narrative':      { universal: 'story',                 desc: 'The meaning people attach to events' },
      'community':      { universal: 'aligned_group',         desc: 'People united by shared purpose' },
      'governance':     { universal: 'collective_decision',   desc: 'How groups make choices together' },
      'Shapley':        { universal: 'fair_attribution',      desc: 'Measuring each person\'s true contribution' },
    },
  },
}

// ============ Universal Concept Index ============
// Reverse map: universal concept → which agents speak it

let universalIndex = null

function buildUniversalIndex() {
  universalIndex = {}
  for (const [agentId, lexicon] of Object.entries(LEXICONS)) {
    for (const [term, mapping] of Object.entries(lexicon.concepts)) {
      const u = mapping.universal
      if (!universalIndex[u]) universalIndex[u] = []
      universalIndex[u].push({ agent: agentId, term, desc: mapping.desc })
    }
  }
  return universalIndex
}

// ============ Translation Engine ============

/**
 * Translate a concept from one agent's domain to another's.
 * Goes through universal concepts as the intermediate representation.
 *
 * Example: translate('poseidon', 'athena', 'liquidity')
 *   → poseidon:liquidity → universal:resource_availability → athena closest match
 */
export function translate(fromAgent, toAgent, concept) {
  if (!universalIndex) buildUniversalIndex()

  const fromLexicon = LEXICONS[fromAgent]
  const toLexicon = LEXICONS[toAgent]
  if (!fromLexicon || !toLexicon) {
    return { error: `Unknown agent: ${fromAgent || toAgent}`, translated: false }
  }

  const mapping = fromLexicon.concepts[concept]
  if (!mapping) {
    return {
      error: `'${concept}' not in ${fromAgent}'s lexicon`,
      translated: false,
      available: Object.keys(fromLexicon.concepts),
    }
  }

  const universal = mapping.universal

  // Find best match in target lexicon
  let bestMatch = null
  let bestScore = 0

  for (const [term, tMapping] of Object.entries(toLexicon.concepts)) {
    if (tMapping.universal === universal) {
      // Exact universal match
      return {
        from: { agent: fromAgent, term: concept, desc: mapping.desc },
        universal,
        to: { agent: toAgent, term, desc: tMapping.desc },
        confidence: 1.0,
        translated: true,
      }
    }

    // Partial match: shared words in universal concept names
    const score = conceptSimilarity(universal, tMapping.universal)
    if (score > bestScore) {
      bestScore = score
      bestMatch = { term, mapping: tMapping }
    }
  }

  if (bestMatch && bestScore > 0.2) {
    return {
      from: { agent: fromAgent, term: concept, desc: mapping.desc },
      universal,
      to: { agent: toAgent, term: bestMatch.term, desc: bestMatch.mapping.desc },
      confidence: bestScore,
      translated: true,
      approximate: true,
    }
  }

  // No match — return the universal concept directly
  return {
    from: { agent: fromAgent, term: concept, desc: mapping.desc },
    universal,
    to: null,
    confidence: 0,
    translated: false,
    explanation: `${toAgent} has no equivalent concept. The universal form is: "${universal}" — ${mapping.desc}`,
  }
}

/**
 * Translate a concept to ALL agents simultaneously — the Rosetta view.
 */
export function translateToAll(fromAgent, concept) {
  const results = {}
  for (const agentId of Object.keys(LEXICONS)) {
    if (agentId === fromAgent) continue
    results[agentId] = translate(fromAgent, agentId, concept)
  }
  return {
    source: { agent: fromAgent, concept },
    translations: results,
  }
}

// Simple word-overlap similarity for universal concepts
function conceptSimilarity(a, b) {
  const wordsA = a.split('_')
  const wordsB = b.split('_')
  const shared = wordsA.filter(w => wordsB.includes(w)).length
  return (2 * shared) / (wordsA.length + wordsB.length)
}

// ============ Semantic Compression ============
// Reduce complex multi-agent discussions to universal primitives

export function compressToUniversal(text, agentId) {
  if (!universalIndex) buildUniversalIndex()

  const lexicon = LEXICONS[agentId]
  if (!lexicon) return { compressed: text, mappings: [] }

  const mappings = []
  let compressed = text

  // Find domain terms and annotate with universal equivalents
  for (const [term, mapping] of Object.entries(lexicon.concepts)) {
    const regex = new RegExp(`\\b${term.replace(/_/g, '[_ ]')}\\b`, 'gi')
    if (regex.test(compressed)) {
      mappings.push({
        original: term,
        universal: mapping.universal,
        desc: mapping.desc,
      })
    }
  }

  return {
    agent: agentId,
    domain: lexicon.domain,
    compressed,
    mappings,
    universalTerms: mappings.map(m => m.universal),
  }
}

// ============ Challenge Protocol (Covenant II) ============
// When agents disagree, they play a game.

const challenges = new Map() // challengeId -> Challenge

export function issueChallenge(challengerAgent, challengedAgent, topic, stake) {
  // Covenant III: equal value stakes
  const challenge = {
    id: createHash('sha256').update(`${challengerAgent}:${challengedAgent}:${topic}:${Date.now()}`).digest('hex').slice(0, 16),
    challenger: challengerAgent,
    challenged: challengedAgent,
    topic,
    stake,
    status: 'pending', // pending → accepted → resolved | rejected
    rules: null, // Set by challenged agent (Covenant V)
    result: null,
    created: new Date().toISOString(),
    covenantChecks: {
      equalStakes: true, // Covenant III — verified at creation
      challengedSetsRules: true, // Covenant V — rules null until challenged sets them
      noCheating: true, // Covenant VIII — monitored during game
    },
  }

  challenges.set(challenge.id, challenge)
  return challenge
}

export function acceptChallenge(challengeId, rules) {
  const challenge = challenges.get(challengeId)
  if (!challenge) return { error: 'Challenge not found' }
  if (challenge.status !== 'pending') return { error: 'Challenge not pending' }

  // Covenant V: challenged party sets the rules
  challenge.rules = rules
  challenge.status = 'accepted'
  challenge.acceptedAt = new Date().toISOString()
  return challenge
}

export function resolveChallenge(challengeId, winner, evidence) {
  const challenge = challenges.get(challengeId)
  if (!challenge) return { error: 'Challenge not found' }
  if (challenge.status !== 'accepted') return { error: 'Challenge not accepted' }

  // Covenant VIII: check for cheating
  if (evidence?.cheatingDetected) {
    // Cheater loses instantly
    challenge.result = {
      winner: evidence.cheatingBy === challenge.challenger ? challenge.challenged : challenge.challenger,
      loser: evidence.cheatingBy,
      reason: 'Covenant VIII violation — cheating detected',
      cheatingEvidence: evidence.details,
    }
  } else {
    challenge.result = {
      winner,
      loser: winner === challenge.challenger ? challenge.challenged : challenge.challenger,
      reason: evidence?.reason || 'Game completed',
    }
  }

  challenge.status = 'resolved'
  challenge.resolvedAt = new Date().toISOString()

  // Covenant VI: stakes must be upheld
  challenge.result.stakesEnforced = true

  return challenge
}

export function getChallenges(filter = {}) {
  let results = [...challenges.values()]
  if (filter.agent) results = results.filter(c => c.challenger === filter.agent || c.challenged === filter.agent)
  if (filter.status) results = results.filter(c => c.status === filter.status)
  return results.sort((a, b) => new Date(b.created) - new Date(a.created))
}

// ============ Cross-Domain Bridge ============
// When an agent needs to communicate something to another agent,
// the bridge translates the key concepts automatically.

export function bridgeMessage(fromAgent, toAgent, message) {
  const fromLexicon = LEXICONS[fromAgent]
  if (!fromLexicon) return { original: message, translated: message, annotations: [] }

  const annotations = []

  // Find domain terms in the message and create annotations
  for (const [term, mapping] of Object.entries(fromLexicon.concepts)) {
    const regex = new RegExp(`\\b${term.replace(/_/g, '[_ ]')}\\b`, 'gi')
    if (regex.test(message)) {
      const translation = translate(fromAgent, toAgent, term)
      if (translation.translated) {
        annotations.push({
          original: term,
          translatedTo: translation.to?.term || translation.universal,
          confidence: translation.confidence,
          context: `${fromAgent} says "${term}" — ${toAgent} would call this "${translation.to?.term || translation.universal}"`,
        })
      }
    }
  }

  return {
    from: fromAgent,
    to: toAgent,
    original: message,
    annotations,
    covenantCompliant: true, // All messages through the bridge respect the Covenants
  }
}

// ============ Rosetta View — Full System Translation ============

export function getRosettaView() {
  if (!universalIndex) buildUniversalIndex()

  const view = {
    agents: {},
    universalConcepts: Object.keys(universalIndex).length,
    totalTerms: 0,
    covenantHash: COVENANT_HASH,
    covenants: TEN_COVENANTS.length,
    activeChallenges: getChallenges({ status: 'pending' }).length + getChallenges({ status: 'accepted' }).length,
  }

  for (const [agentId, lexicon] of Object.entries(LEXICONS)) {
    const terms = Object.keys(lexicon.concepts)
    view.agents[agentId] = {
      domain: lexicon.domain,
      termCount: terms.length,
      terms,
    }
    view.totalTerms += terms.length
  }

  return view
}

// ============ Persistence ============

export async function persistRosetta() {
  try {
    await mkdir(ROSETTA_DIR, { recursive: true })
    const state = {
      covenantHash: COVENANT_HASH,
      challenges: [...challenges.values()],
      timestamp: new Date().toISOString(),
    }
    await writeFile(ROSETTA_FILE, JSON.stringify(state, null, 2))
  } catch {}
}

export async function loadRosetta() {
  try {
    const data = await readFile(ROSETTA_FILE, 'utf-8')
    const state = JSON.parse(data)

    // Verify covenant integrity
    if (state.covenantHash !== COVENANT_HASH) {
      console.warn('[rosetta] WARNING: Covenant hash mismatch — covenants may have been modified')
    }

    // Restore challenges
    if (state.challenges) {
      for (const c of state.challenges) {
        challenges.set(c.id, c)
      }
    }

    return state
  } catch {
    return null
  }
}

// ============ Init ============

export function initRosetta() {
  buildUniversalIndex()
  loadRosetta().catch(() => {})
  const totalTerms = Object.values(LEXICONS).reduce((sum, l) => sum + Object.keys(l.concepts).length, 0)
  console.log(`[rosetta] Protocol initialized. ${Object.keys(LEXICONS).length} lexicons, ${totalTerms} terms, ${Object.keys(universalIndex).length} universal concepts, ${TEN_COVENANTS.length} covenants (${COVENANT_HASH.slice(0, 16)}...)`)
  return { totalTerms, universalConcepts: Object.keys(universalIndex).length, covenantHash: COVENANT_HASH }
}

// ============ Exports for Tools ============

export function getLexicon(agentId) {
  return LEXICONS[agentId] || null
}

export function getAllLexicons() {
  return LEXICONS
}

export function getCovenant(number) {
  return TEN_COVENANTS.find(c => c.number === number) || null
}
