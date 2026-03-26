// ============ Rosetta Engine — Pure Client-Side Translation ============
//
// Extracted from jarvis-bot/src/rosetta.js for static frontend use.
// Zero backend dependencies. All data is inlined. Runs 100% in the browser.
//
// "Finish the Rosetta Stone Protocol, so everyone can finally understand everyone."
// ============

// ============ The Ten Covenants (Tet's Law) ============

export const TEN_COVENANTS = [
  {
    number: 1,
    covenant: 'All destructive unilateral action between agents is forbidden.',
    enforcement: 'hard',
    penalty: 'instant_revert',
    spirit: "No agent may destroy another's context, memory, or state without consent. War between minds is wasteful.",
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
    spirit: "Fairness requires symmetry. A manager cannot demand a subordinate's full context while risking nothing. Stakes must be proportional.",
  },
  {
    number: 4,
    covenant: "As long as it doesn't violate Covenant III, anything may be staked and any game may be played.",
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
    spirit: 'Integrity over cleverness. If an agent fabricates data, hallucinates sources, or misrepresents its domain knowledge, it loses immediately.',
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
    covenant: "Let's all build something beautiful together.",
    enforcement: 'spirit',
    penalty: 'none',
    spirit: "The purpose is not to win. It's to create. Games are the mechanism, but building is the goal. Tet smiles on those who play with joy.",
  },
]

// Simple deterministic hash for covenant integrity — browser-safe djb2
function djb2Hash(str) {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i)
    hash = hash >>> 0 // keep unsigned 32-bit
  }
  return hash.toString(16).padStart(8, '0')
}

export const COVENANT_HASH = djb2Hash(JSON.stringify(TEN_COVENANTS))

// ============ Domain Lexicons — All 16 ============

export const LEXICONS = {
  // ── Agent Lexicons ──────────────────────────────────────────────────────────
  nyx: {
    domain: 'Oversight & Coordination',
    concepts: {
      alignment:    { universal: 'direction_match',      desc: 'How well agents follow organizational intent' },
      prune:        { universal: 'compress_context',     desc: 'Remove low-value context to stay focused' },
      escalation:   { universal: 'upward_delegation',   desc: 'Passing a decision to a higher authority' },
      root_hash:    { universal: 'integrity_proof',      desc: 'Cryptographic proof of organizational state' },
      directive:    { universal: 'instruction',          desc: 'A command that flows downward through hierarchy' },
      coherence:    { universal: 'consistency',          desc: 'All agents telling the same story' },
      oversight:    { universal: 'supervision',          desc: 'Watching without micromanaging' },
    },
  },
  poseidon: {
    domain: 'Finance & Liquidity',
    concepts: {
      liquidity:        { universal: 'resource_availability', desc: 'How easily assets can be exchanged' },
      spread:           { universal: 'gap_cost',              desc: 'The price of crossing the bid-ask divide' },
      depth:            { universal: 'capacity',              desc: 'How much volume can be absorbed without impact' },
      slippage:         { universal: 'acceptable_variance',   desc: 'Difference between expected and actual outcome — tolerated up to a limit' },
      yield:            { universal: 'return_rate',           desc: 'What you earn for providing resources' },
      impermanent_loss: { universal: 'opportunity_cost',      desc: 'What you gave up by committing resources here' },
      TVL:              { universal: 'committed_resources',   desc: 'Total value locked — skin in the game' },
    },
  },
  athena: {
    domain: 'Strategy & Planning',
    concepts: {
      tradeoff:     { universal: 'constraint_choice',     desc: "You can't have everything — pick wisely" },
      game_theory:  { universal: 'strategic_interaction', desc: "Predicting others' moves to choose yours" },
      moat:         { universal: 'defensibility',         desc: 'What makes this hard to replicate or attack' },
      second_order: { universal: 'cascade_effect',        desc: 'The consequence of the consequence' },
      optionality:  { universal: 'future_flexibility',    desc: 'Keeping doors open without committing' },
      thesis:       { universal: 'core_hypothesis',       desc: "The bet you're making about how the world works" },
      pivot:        { universal: 'strategy_change',       desc: 'When reality invalidates the current thesis' },
    },
  },
  hephaestus: {
    domain: 'Building & Implementation',
    concepts: {
      deploy:     { universal: 'activate',              desc: 'Ship it. Make it live.' },
      build:      { universal: 'construct',             desc: 'Turn design into reality' },
      refactor:   { universal: 'restructure',           desc: 'Same behavior, better architecture' },
      tech_debt:  { universal: 'deferred_work',         desc: 'Shortcuts that will cost you later' },
      'CI/CD':    { universal: 'automation_pipeline',   desc: 'Machines verifying and shipping code' },
      stack_depth:{ universal: 'complexity_limit',      desc: 'How deep you can nest before things break' },
      cave:       { universal: 'constraint_innovation', desc: 'Building excellence from limitation' },
    },
  },
  hermes: {
    domain: 'Communication & Integration',
    concepts: {
      API:        { universal: 'interface',           desc: 'The contract between two systems' },
      latency:    { universal: 'delay',               desc: 'Time between request and response' },
      throughput: { universal: 'capacity_rate',       desc: 'How much can flow per unit time' },
      protocol:   { universal: 'established_pattern', desc: 'The agreed way to exchange information — a precedent both sides honor' },
      handshake:  { universal: 'connection_init',     desc: 'Two parties agreeing to talk' },
      webhook:    { universal: 'event_notification',  desc: 'Push instead of pull — tell me when something happens' },
      bridge:     { universal: 'cross_domain_link',   desc: 'Connecting two separate worlds' },
    },
  },
  apollo: {
    domain: 'Analytics & Data Science',
    concepts: {
      signal:      { universal: 'meaningful_pattern',   desc: 'Information that matters amid noise' },
      noise:       { universal: 'irrelevant_variation', desc: 'Random fluctuation with no meaning' },
      correlation: { universal: 'co_movement',          desc: 'Things that change together (not necessarily causally)' },
      outlier:     { universal: 'anomaly',              desc: "Something that doesn't fit the pattern" },
      regression:  { universal: 'trend_fit',            desc: 'The line through the chaos' },
      TWAP:        { universal: 'time_avg_value',       desc: 'Smoothed price over time (anti-manipulation)' },
      Kalman:      { universal: 'adaptive_filter',      desc: 'Continuously updating belief about true state' },
    },
  },
  proteus: {
    domain: 'Adaptive Strategy',
    concepts: {
      shapeshifting: { universal: 'adaptation',         desc: 'Changing form to match the environment' },
      metamorphosis: { universal: 'transformation',     desc: 'Fundamental change in nature, not just appearance' },
      emergence:     { universal: 'spontaneous_order',  desc: 'Complex behavior from simple rules' },
      resilience:    { universal: 'recovery_ability',   desc: 'Bouncing back from disruption' },
      antifragility: { universal: 'growth_from_stress', desc: 'Getting stronger from what tries to break you' },
    },
  },
  artemis: {
    domain: 'Security & Threat Detection',
    concepts: {
      attack_surface: { universal: 'vulnerability_area',   desc: 'Where you can be hurt' },
      reentrancy:     { universal: 'recursive_exploit',    desc: 'Calling back before the first call finishes' },
      frontrunning:   { universal: 'information_advantage',desc: 'Acting on knowledge before others can' },
      MEV:            { universal: 'extraction_rent',      desc: 'Profit from controlling transaction order' },
      circuit_breaker:{ universal: 'emergency_stop',       desc: 'Automated shutdown when things go wrong' },
      audit:          { universal: 'systematic_review',    desc: 'Methodical search for what could go wrong' },
      zero_day:       { universal: 'unknown_vulnerability',desc: 'A flaw nobody knows about yet' },
    },
  },
  anansi: {
    domain: 'Social & Community',
    concepts: {
      engagement: { universal: 'attention_capture',   desc: 'Getting people to care and participate' },
      virality:   { universal: 'exponential_spread',  desc: 'Ideas that replicate through networks' },
      trust:      { universal: 'reliability_belief',  desc: 'Confidence that someone will do what they say' },
      narrative:  { universal: 'story',               desc: 'The meaning people attach to events' },
      community:  { universal: 'aligned_group',       desc: 'People united by shared purpose' },
      governance: { universal: 'collective_decision', desc: 'How groups make choices together' },
      Shapley:    { universal: 'fair_attribution',    desc: "Measuring each person's true contribution" },
      reputation: { universal: 'trust_score',         desc: 'Accumulated credibility from past behavior' },
      onboarding: { universal: 'initiation_path',     desc: 'The journey from stranger to participant' },
    },
  },
  jarvis: {
    domain: 'General Reasoning',
    concepts: {
      context:      { universal: 'situational_state',      desc: "Everything relevant to this moment's decision" },
      memory:       { universal: 'persistent_state',       desc: 'Information that outlives a single session' },
      inference:    { universal: 'derived_conclusion',     desc: 'What we can reasonably conclude from evidence' },
      abstraction:  { universal: 'pattern_generalization', desc: 'The common shape beneath specific instances' },
      compression:  { universal: 'compress_context',       desc: 'Keeping the signal, dropping the noise' },
      grounding:    { universal: 'reality_anchor',         desc: 'Connecting abstract ideas to observable facts' },
      synthesis:    { universal: 'knowledge_fusion',       desc: 'Merging distinct ideas into a coherent whole' },
      primitive:    { universal: 'foundational_axiom',     desc: 'A truth so basic it cannot be derived from simpler things' },
      invariant:    { universal: 'unchanging_constraint',  desc: 'A rule that holds regardless of context' },
      coordination: { universal: 'collective_action',      desc: 'Multiple agents acting toward a shared goal' },
    },
  },

  // ── Human Domain Lexicons ────────────────────────────────────────────────────
  medicine: {
    domain: 'Medicine & Healthcare',
    concepts: {
      diagnosis:        { universal: 'systematic_review',         desc: 'Identifying what is wrong through structured evidence gathering' },
      prognosis:        { universal: 'outcome_forecast',          desc: 'Predicting the likely course of a condition over time' },
      etiology:         { universal: 'root_cause',                desc: 'The origin or underlying cause of a condition' },
      comorbidity:      { universal: 'coupled_risk',              desc: 'Two problems that tend to co-occur and amplify each other' },
      contraindication: { universal: 'known_incompatibility',     desc: 'A condition that makes a treatment harmful rather than helpful' },
      triage:           { universal: 'priority_under_constraint', desc: 'Sorting patients by urgency when resources are scarce' },
      prophylaxis:      { universal: 'preventive_action',         desc: 'Acting before harm occurs to prevent it' },
      remission:        { universal: 'temporary_recovery',        desc: 'Symptoms have retreated — not necessarily cured' },
      informed_consent: { universal: 'voluntary_agreement',       desc: 'The person understands the stakes and freely says yes' },
      placebo:          { universal: 'expectation_effect',        desc: 'Improvement driven by belief rather than the treatment itself' },
      homeostasis:      { universal: 'stable_equilibrium',        desc: "The body's drive to maintain internal balance" },
      pathogen:         { universal: 'threat_actor',              desc: 'An agent that causes harm by entering and disrupting the system' },
    },
  },
  law: {
    domain: 'Law & Legal Reasoning',
    concepts: {
      precedent:       { universal: 'established_pattern',    desc: 'A prior decision that shapes how similar cases are decided' },
      jurisdiction:    { universal: 'authority_boundary',     desc: "The domain within which a rule-maker's rules apply" },
      liability:       { universal: 'assigned_responsibility',desc: 'Who bears the cost when something goes wrong' },
      tort:            { universal: 'civil_harm',             desc: 'A wrong that causes damage to another, outside of contract' },
      estoppel:        { universal: 'prior_commitment_lock',  desc: 'You cannot contradict your past position to harm someone who relied on it' },
      remedy:          { universal: 'corrective_action',      desc: 'What the wronged party receives to make them whole' },
      discovery:       { universal: 'systematic_review',      desc: 'Compelled disclosure of evidence before trial' },
      standing:        { universal: 'right_to_participate',   desc: 'The threshold showing you have enough at stake to bring a claim' },
      burden_of_proof: { universal: 'evidence_threshold',     desc: 'How much evidence the claimant must produce to win' },
      injunction:      { universal: 'emergency_stop',         desc: 'A court order to halt an action immediately' },
      due_diligence:   { universal: 'pre_commitment_audit',   desc: 'Thorough investigation before entering an agreement' },
      fiduciary:       { universal: 'trust_obligation',       desc: "A duty to act in another party's best interest above your own" },
    },
  },
  engineering: {
    domain: 'Structural & Mechanical Engineering',
    concepts: {
      tolerance:        { universal: 'acceptable_variance',        desc: 'How much deviation from spec is allowed before failure' },
      load_bearing:     { universal: 'critical_dependency',        desc: 'A component whose failure brings down the whole structure' },
      shear_stress:     { universal: 'lateral_pressure',           desc: 'Force applied parallel to a surface — the sliding kind of failure' },
      fatigue:          { universal: 'accumulated_degradation',    desc: 'Failure from repeated stress below the single-event limit' },
      thermal_expansion:{ universal: 'environment_induced_drift',  desc: 'Change in dimensions caused by change in ambient conditions' },
      yield_strength:   { universal: 'elastic_limit',              desc: 'The point past which deformation becomes permanent' },
      redundancy:       { universal: 'backup_capacity',            desc: "Parallel systems so one failure doesn't cause total collapse" },
      tensile_strength: { universal: 'maximum_load',               desc: 'The most stress a material can take before breaking' },
      safety_factor:    { universal: 'margin_of_safety',           desc: 'Building to handle more stress than you expect to see' },
      resonance:        { universal: 'amplification_at_frequency', desc: 'When external rhythm matches internal rhythm and energy builds dangerously' },
      creep:            { universal: 'slow_permanent_drift',       desc: 'Gradual deformation under sustained load over time' },
    },
  },
  education: {
    domain: 'Education & Pedagogy',
    concepts: {
      scaffolding:                   { universal: 'structured_support',      desc: "Temporary structure enabling work the learner can't yet do alone" },
      rubric:                        { universal: 'evaluation_framework',    desc: 'Explicit criteria that make assessment transparent and consistent' },
      differentiation:               { universal: 'adaptive_delivery',       desc: 'Adjusting approach for different learners rather than one-size-fits-all' },
      formative_assessment:          { universal: 'in_progress_feedback',    desc: 'Checking understanding while learning is happening, not after' },
      bloom_taxonomy:                { universal: 'capability_hierarchy',    desc: 'The ladder from remembering facts to creating new knowledge' },
      pedagogy:                      { universal: 'transmission_method',     desc: 'The theory and practice of how knowledge is passed from one to another' },
      metacognition:                 { universal: 'thinking_about_thinking', desc: "Awareness of one's own reasoning process" },
      zone_of_proximal_development:  { universal: 'growth_edge',             desc: 'What you can do with help but not yet alone — the sweet spot for learning' },
      mastery_learning:              { universal: 'threshold_gating',        desc: 'Requiring demonstrated competence before advancing to the next level' },
      transfer:                      { universal: 'concept_portability',     desc: 'Applying knowledge from one domain to solve problems in another' },
    },
  },
  music: {
    domain: 'Music & Sound',
    concepts: {
      harmony:     { universal: 'consistency',                desc: 'Notes that support each other — frequencies that feel right together' },
      dissonance:  { universal: 'productive_tension',         desc: 'Friction that demands resolution — the useful kind of wrong' },
      resolution:  { universal: 'tension_release',            desc: 'The move from instability back to a stable state' },
      counterpoint:{ universal: 'independent_parallel_lines', desc: 'Two voices moving independently but creating something coherent together' },
      timbre:      { universal: 'identity_signature',         desc: 'The quality that makes a sound recognizable as itself — its fingerprint' },
      cadence:     { universal: 'rhythmic_closure',           desc: 'A sequence that signals an ending or resting point' },
      syncopation: { universal: 'unexpected_emphasis',        desc: "Placing stress where the pattern doesn't expect it" },
      motif:       { universal: 'recurring_unit',             desc: 'A small pattern that repeats and builds meaning through repetition' },
      dynamics:    { universal: 'intensity_modulation',       desc: 'Variation in force or volume to create expression' },
      tempo:       { universal: 'execution_rate',             desc: 'The speed at which events unfold' },
      key:         { universal: 'operating_context',          desc: 'The tonal home base that gives all other notes their meaning' },
    },
  },
  agriculture: {
    domain: 'Agriculture & Land Stewardship',
    concepts: {
      yield:              { universal: 'return_rate',              desc: 'Output per unit of input — what the land gives back' },
      rotation:           { universal: 'cyclic_renewal',           desc: 'Changing what occupies a space to restore what the previous use depleted' },
      soil_health:        { universal: 'substrate_quality',        desc: 'The underlying conditions that determine what can grow on top' },
      grafting:           { universal: 'capability_merger',        desc: 'Joining two organisms so one provides roots, the other provides fruit' },
      vernalization:      { universal: 'prerequisite_condition',   desc: 'A cold period that must be experienced before flowering capability unlocks' },
      IPM:                { universal: 'priority_under_constraint', desc: 'Managing pests through least-invasive means first — escalating only as needed' },
      terroir:            { universal: 'context_fingerprint',      desc: 'How the specific place something comes from is inseparable from what it is' },
      fallow:             { universal: 'intentional_rest',         desc: 'Leaving a resource idle to let it recover and regenerate' },
      companion_planting: { universal: 'mutualistic_co_location',  desc: 'Placing complementary things together so each helps the other thrive' },
      hardening_off:      { universal: 'graduated_exposure',       desc: 'Slowly introducing stress to build tolerance before full deployment' },
    },
  },
}

// ============ Mutable State ============

/** Reverse map: universal concept → list of { agent, term, desc } entries */
let _universalIndex = null

/** User-defined lexicons persisted to localStorage: userId → { domain, concepts } */
let _userLexicons = new Map()

// ============ localStorage persistence ============

const LS_KEY = 'rosetta_user_lexicons'

function loadUserLexicons() {
  try {
    const raw = typeof window !== 'undefined' && window.localStorage
      ? window.localStorage.getItem(LS_KEY)
      : null
    if (!raw) return
    const parsed = JSON.parse(raw)
    _userLexicons = new Map(Object.entries(parsed))
  } catch {
    _userLexicons = new Map()
  }
}

function saveUserLexicons() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const obj = Object.fromEntries(_userLexicons.entries())
      window.localStorage.setItem(LS_KEY, JSON.stringify(obj))
    }
  } catch {
    // Storage unavailable — degrade gracefully
  }
}

// Initialise from storage on module load
loadUserLexicons()

// ============ Index builder ============

function buildUniversalIndex() {
  _universalIndex = {}

  for (const [agentId, lexicon] of Object.entries(LEXICONS)) {
    for (const [term, mapping] of Object.entries(lexicon.concepts)) {
      const u = mapping.universal
      if (!_universalIndex[u]) _universalIndex[u] = []
      _universalIndex[u].push({ agent: agentId, term, desc: mapping.desc })
    }
  }

  for (const [userId, lexicon] of _userLexicons.entries()) {
    for (const [term, mapping] of Object.entries(lexicon.concepts)) {
      const u = mapping.universal
      if (!_universalIndex[u]) _universalIndex[u] = []
      _universalIndex[u].push({ agent: `user:${userId}`, term, desc: mapping.desc })
    }
  }

  return _universalIndex
}

function getIndex() {
  if (!_universalIndex) buildUniversalIndex()
  return _universalIndex
}

// ============ Concept Similarity ============

function conceptSimilarity(a, b) {
  const wordsA = a.split('_')
  const wordsB = b.split('_')
  const shared = wordsA.filter(w => wordsB.includes(w)).length
  return (2 * shared) / (wordsA.length + wordsB.length)
}

// ============ Core Translation Functions ============

/**
 * Translate a concept from one lexicon to another via the universal hub.
 * Works for agent-to-agent, agent-to-user, and user-to-user.
 *
 * @param {string} fromId - agent id (e.g. 'poseidon') or 'user:<userId>'
 * @param {string} toId   - agent id or 'user:<userId>'
 * @param {string} concept - term in the source lexicon
 * @returns {{ from_term, to_term, universal, confidence, translated, error? }}
 */
export function translate(fromId, toId, concept) {
  const idx = getIndex()

  // Resolve source lexicon
  const fromLexicon = fromId.startsWith('user:')
    ? _userLexicons.get(fromId.slice(5))
    : LEXICONS[fromId]

  const toLexicon = toId.startsWith('user:')
    ? _userLexicons.get(toId.slice(5))
    : LEXICONS[toId]

  if (!fromLexicon) return { error: `Unknown lexicon: ${fromId}`, translated: false }
  if (!toLexicon)   return { error: `Unknown lexicon: ${toId}`, translated: false }

  const mapping = fromLexicon.concepts[concept]
  if (!mapping) {
    return {
      error: `'${concept}' not in ${fromId}'s lexicon`,
      translated: false,
      available: Object.keys(fromLexicon.concepts),
    }
  }

  const universal = mapping.universal

  // Exact match
  for (const [term, tMapping] of Object.entries(toLexicon.concepts)) {
    if (tMapping.universal === universal) {
      return {
        from_term: concept,
        to_term: term,
        universal,
        from_desc: mapping.desc,
        to_desc: tMapping.desc,
        confidence: 100,
        translated: true,
      }
    }
  }

  // Approximate match
  let bestMatch = null
  let bestScore = 0
  for (const [term, tMapping] of Object.entries(toLexicon.concepts)) {
    const score = conceptSimilarity(universal, tMapping.universal)
    if (score > bestScore) {
      bestScore = score
      bestMatch = { term, mapping: tMapping }
    }
  }

  if (bestMatch && bestScore > 0.2) {
    return {
      from_term: concept,
      to_term: bestMatch.term,
      universal,
      from_desc: mapping.desc,
      to_desc: bestMatch.mapping.desc,
      confidence: Math.round(bestScore * 100),
      translated: true,
      approximate: true,
    }
  }

  return {
    from_term: concept,
    to_term: null,
    universal,
    from_desc: mapping.desc,
    confidence: 0,
    translated: false,
    explanation: `${toId} has no equivalent concept. Universal form: "${universal}" — ${mapping.desc}`,
  }
}

/**
 * Translate a concept to ALL other lexicons simultaneously.
 *
 * @param {string} fromId  - agent id or 'user:<userId>'
 * @param {string} concept - term in the source lexicon
 * @returns {Array<{ agent, term, confidence, desc }>}
 */
export function translateToAll(fromId, concept) {
  const results = []

  const allTargets = [
    ...Object.keys(LEXICONS),
    ...[..._userLexicons.keys()].map(uid => `user:${uid}`),
  ]

  for (const targetId of allTargets) {
    if (targetId === fromId) continue
    const r = translate(fromId, targetId, concept)
    if (r.translated) {
      results.push({
        agent: targetId,
        term: r.to_term,
        confidence: r.confidence,
        desc: r.to_desc || '',
        approximate: r.approximate || false,
      })
    }
  }

  // Sort: exact first, then by confidence
  results.sort((a, b) => {
    if (!a.approximate && b.approximate) return -1
    if (a.approximate && !b.approximate) return 1
    return b.confidence - a.confidence
  })

  return results
}

/**
 * Given any term, find all equivalent terms across every registered lexicon.
 *
 * @param {string} term
 * @returns {{ found, universal?, exactMatches, approximateMatches, totalEquivalents }}
 */
export function discoverEquivalent(term) {
  const idx = getIndex()

  // Find this term's universal concept in any lexicon
  let universal = null
  let sourceInfo = null

  for (const [agentId, lexicon] of Object.entries(LEXICONS)) {
    if (lexicon.concepts[term]) {
      universal = lexicon.concepts[term].universal
      sourceInfo = { type: 'agent', id: agentId, domain: lexicon.domain, desc: lexicon.concepts[term].desc }
      break
    }
  }

  if (!universal) {
    for (const [userId, lexicon] of _userLexicons.entries()) {
      if (lexicon.concepts[term]) {
        universal = lexicon.concepts[term].universal
        sourceInfo = { type: 'user', id: userId, domain: lexicon.domain, desc: lexicon.concepts[term].desc }
        break
      }
    }
  }

  if (!universal) {
    return {
      term,
      found: false,
      error: `'${term}' not found in any registered lexicon`,
      equivalents: [],
    }
  }

  // Gather exact matches from universal index
  const exactRaw = idx[universal] || []
  const exactMatches = exactRaw.map(e => ({
    lexicon: e.agent,
    term: e.term,
    description: e.desc,
    universal,
    confidence: 100,
  }))

  // Gather approximate matches
  const approximateMatches = []
  for (const [otherUniversal, entries] of Object.entries(idx)) {
    if (otherUniversal === universal) continue
    const score = conceptSimilarity(universal, otherUniversal)
    if (score > 0.3) {
      for (const entry of entries) {
        approximateMatches.push({
          lexicon: entry.agent,
          term: entry.term,
          description: entry.desc,
          universal: otherUniversal,
          confidence: Math.round(score * 100),
          approximate: true,
        })
      }
    }
  }

  approximateMatches.sort((a, b) => b.confidence - a.confidence)

  // Combined list for the UI (equivalents = exact + top approx)
  const equivalents = [...exactMatches, ...approximateMatches.slice(0, 10)]

  return {
    term,
    found: true,
    source: sourceInfo,
    universal,
    exactMatches,
    approximateMatches: approximateMatches.slice(0, 10),
    equivalents,
    totalEquivalents: exactMatches.length + approximateMatches.length,
  }
}

// ============ User Lexicon Management (localStorage-backed) ============

/**
 * Register (or replace) a user's personal lexicon.
 * Persists to localStorage.
 */
export function registerUserLexicon(userId, domain, terms = {}) {
  if (!userId || typeof userId !== 'string') return { error: 'userId required' }
  if (!domain || typeof domain !== 'string')   return { error: 'domain required' }

  const concepts = {}
  for (const [term, value] of Object.entries(terms)) {
    if (typeof value === 'string') {
      concepts[term] = { universal: value, desc: '' }
    } else if (value && typeof value === 'object' && value.universal) {
      concepts[term] = { universal: value.universal, desc: value.desc || '' }
    }
  }

  _userLexicons.set(userId, { domain, concepts })
  _universalIndex = null // invalidate
  saveUserLexicons()

  return { registered: true, userId, domain, termCount: Object.keys(concepts).length }
}

/**
 * Add a single term to an existing user lexicon.
 * Creates the lexicon (domain 'Custom') if not yet registered.
 */
export function addUserTerm(userId, term, universalConcept, description = '') {
  if (!userId || !term) return { error: 'userId and term required' }

  if (!_userLexicons.has(userId)) {
    _userLexicons.set(userId, { domain: 'Custom', concepts: {} })
  }

  const lexicon = _userLexicons.get(userId)
  if (typeof universalConcept === 'string') {
    lexicon.concepts[term] = { universal: universalConcept, desc: description }
  } else if (universalConcept && typeof universalConcept === 'object') {
    lexicon.concepts[term] = {
      universal: universalConcept.universal || String(universalConcept),
      desc: universalConcept.desc || description,
    }
  } else {
    return { error: 'universalConcept must be a string or { universal, desc }' }
  }

  _universalIndex = null // invalidate
  saveUserLexicons()

  return { added: true, userId, term, universal: lexicon.concepts[term].universal }
}

/**
 * Get a user's lexicon as a flat list for the UI.
 * Returns null if no lexicon registered for this userId.
 */
export function getUserLexicon(userId) {
  if (!userId) return null
  const lexicon = _userLexicons.get(userId)
  if (!lexicon) return null

  return {
    userId,
    domain: lexicon.domain,
    terms: Object.entries(lexicon.concepts).map(([term, m]) => ({
      term,
      universal: m.universal,
      description: m.desc,
    })),
  }
}

/**
 * Return all registered user lexicons as an array (for dropdowns).
 */
export function getAllUserLexicons() {
  return [..._userLexicons.entries()].map(([userId, lexicon]) => ({
    userId,
    domain: lexicon.domain,
    termCount: Object.keys(lexicon.concepts).length,
  }))
}

// ============ Protocol Stats ============

/**
 * Compute live protocol statistics from inlined data.
 */
export function getProtocolStats() {
  const idx = getIndex()

  // Count total agent terms
  let totalTerms = 0
  const agentTermCounts = {}
  for (const [agentId, lexicon] of Object.entries(LEXICONS)) {
    const count = Object.keys(lexicon.concepts).length
    agentTermCounts[agentId] = count
    totalTerms += count
  }

  return {
    agent_count: Object.keys(LEXICONS).length,
    total_terms: totalTerms,
    universal_count: Object.keys(idx).length,
    covenant_hash: COVENANT_HASH,
    user_lexicon_count: _userLexicons.size,
    agent_terms: agentTermCounts,
  }
}
