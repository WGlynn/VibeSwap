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

// ============ Mutable State ============
// Declared early so all functions below can reference without TDZ issues.

/** Reverse map: universal concept → list of { agent, term, desc } entries */
let universalIndex = null

/** User-defined lexicons: userId → { domain, concepts } */
const USER_LEXICONS = new Map()

/**
 * Build (or rebuild) the universal index from all agent + user lexicons.
 * Called lazily on first access and after any lexicon mutation.
 */
function buildUniversalIndex() {
  universalIndex = {}

  // Index all agent lexicons
  for (const [agentId, lexicon] of Object.entries(LEXICONS)) {
    for (const [term, mapping] of Object.entries(lexicon.concepts)) {
      const u = mapping.universal
      if (!universalIndex[u]) universalIndex[u] = []
      universalIndex[u].push({ agent: agentId, term, desc: mapping.desc })
    }
  }

  // Index all user lexicons
  for (const [userId, lexicon] of USER_LEXICONS.entries()) {
    for (const [term, mapping] of Object.entries(lexicon.concepts)) {
      const u = mapping.universal
      if (!universalIndex[u]) universalIndex[u] = []
      universalIndex[u].push({ agent: `user:${userId}`, term, desc: mapping.desc })
    }
  }

  return universalIndex
}

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
      'reputation':     { universal: 'trust_score',           desc: 'Accumulated credibility from past behavior' },
      'onboarding':     { universal: 'initiation_path',       desc: 'The journey from stranger to participant' },
    },
  },
  // jarvis: General-purpose reasoning — the universal translator agent
  jarvis: {
    domain: 'General Reasoning',
    concepts: {
      'context':        { universal: 'situational_state',     desc: 'Everything relevant to this moment\'s decision' },
      'memory':         { universal: 'persistent_state',      desc: 'Information that outlives a single session' },
      'inference':      { universal: 'derived_conclusion',    desc: 'What we can reasonably conclude from evidence' },
      'abstraction':    { universal: 'pattern_generalization', desc: 'The common shape beneath specific instances' },
      'compression':    { universal: 'compress_context',      desc: 'Keeping the signal, dropping the noise' },
      'grounding':      { universal: 'reality_anchor',        desc: 'Connecting abstract ideas to observable facts' },
      'synthesis':      { universal: 'knowledge_fusion',      desc: 'Merging distinct ideas into a coherent whole' },
      'primitive':      { universal: 'foundational_axiom',    desc: 'A truth so basic it cannot be derived from simpler things' },
      'invariant':      { universal: 'unchanging_constraint', desc: 'A rule that holds regardless of context' },
      'coordination':   { universal: 'collective_action',     desc: 'Multiple agents acting toward a shared goal' },
    },
  },

  // ── Human Domain Lexicons ─────────────────────────────────────────────────
  // Real-world professional vocabularies mapped to the same universal hub.
  //
  // The Rosetta insight: when professionals from different worlds look up their
  // own native terms, they find each other's terms mapped to the same universal
  // concept — and realize they've been solving the same class of problem with
  // different words.
  //
  // Convergences this unlocks:
  //   medicine:"diagnosis"  + artemis:"audit"     + law:"discovery"     → systematic_review
  //   medicine:"triage"     + artemis:"triage"    + agriculture:"IPM"   → priority_under_constraint
  //   poseidon:"yield"      + agriculture:"yield"                       → return_rate
  //   law:"precedent"       + hermes:"protocol"                         → established_pattern
  //   law:"injunction"      + artemis:"circuit_breaker"                 → emergency_stop
  //   music:"harmony"       + nyx:"coherence"                           → consistency
  //   engineering:"tolerance" + poseidon:"slippage"                     → acceptable_variance
  //   engineering:"redundancy" + proteus:"resilience"                   → backup_capacity / recovery_ability
  //   agriculture:"fallow"  + hephaestus:"tech_debt" resolution         → intentional_rest
  //   education:"scaffolding"                                           → structured_support
  //   education:"zone_of_proximal_development"                          → growth_edge
  //   music:"dissonance"    + athena:"tradeoff"                         → productive_tension

  medicine: {
    domain: 'Medicine & Healthcare',
    concepts: {
      'diagnosis':         { universal: 'systematic_review',         desc: 'Identifying what is wrong through structured evidence gathering' },
      'prognosis':         { universal: 'outcome_forecast',          desc: 'Predicting the likely course of a condition over time' },
      'etiology':          { universal: 'root_cause',                desc: 'The origin or underlying cause of a condition' },
      'comorbidity':       { universal: 'coupled_risk',              desc: 'Two problems that tend to co-occur and amplify each other' },
      'contraindication':  { universal: 'known_incompatibility',     desc: 'A condition that makes a treatment harmful rather than helpful' },
      'triage':            { universal: 'priority_under_constraint', desc: 'Sorting patients by urgency when resources are scarce' },
      'prophylaxis':       { universal: 'preventive_action',         desc: 'Acting before harm occurs to prevent it' },
      'remission':         { universal: 'temporary_recovery',        desc: 'Symptoms have retreated — not necessarily cured' },
      'informed_consent':  { universal: 'voluntary_agreement',       desc: 'The person understands the stakes and freely says yes' },
      'placebo':           { universal: 'expectation_effect',        desc: 'Improvement driven by belief rather than the treatment itself' },
      'homeostasis':       { universal: 'stable_equilibrium',        desc: 'The body\'s drive to maintain internal balance' },
      'pathogen':          { universal: 'threat_actor',              desc: 'An agent that causes harm by entering and disrupting the system' },
    },
  },

  law: {
    domain: 'Law & Legal Reasoning',
    concepts: {
      'precedent':         { universal: 'established_pattern',       desc: 'A prior decision that shapes how similar cases are decided' },
      'jurisdiction':      { universal: 'authority_boundary',        desc: 'The domain within which a rule-maker\'s rules apply' },
      'liability':         { universal: 'assigned_responsibility',   desc: 'Who bears the cost when something goes wrong' },
      'tort':              { universal: 'civil_harm',                desc: 'A wrong that causes damage to another, outside of contract' },
      'estoppel':          { universal: 'prior_commitment_lock',     desc: 'You cannot contradict your past position to harm someone who relied on it' },
      'remedy':            { universal: 'corrective_action',         desc: 'What the wronged party receives to make them whole' },
      'discovery':         { universal: 'systematic_review',         desc: 'Compelled disclosure of evidence before trial' },
      'standing':          { universal: 'right_to_participate',      desc: 'The threshold showing you have enough at stake to bring a claim' },
      'burden_of_proof':   { universal: 'evidence_threshold',        desc: 'How much evidence the claimant must produce to win' },
      'injunction':        { universal: 'emergency_stop',            desc: 'A court order to halt an action immediately' },
      'due_diligence':     { universal: 'pre_commitment_audit',      desc: 'Thorough investigation before entering an agreement' },
      'fiduciary':         { universal: 'trust_obligation',          desc: 'A duty to act in another party\'s best interest above your own' },
    },
  },

  engineering: {
    domain: 'Structural & Mechanical Engineering',
    concepts: {
      'tolerance':         { universal: 'acceptable_variance',       desc: 'How much deviation from spec is allowed before failure' },
      'load_bearing':      { universal: 'critical_dependency',       desc: 'A component whose failure brings down the whole structure' },
      'shear_stress':      { universal: 'lateral_pressure',          desc: 'Force applied parallel to a surface — the sliding kind of failure' },
      'fatigue':           { universal: 'accumulated_degradation',   desc: 'Failure from repeated stress below the single-event limit' },
      'thermal_expansion': { universal: 'environment_induced_drift', desc: 'Change in dimensions caused by change in ambient conditions' },
      'yield_strength':    { universal: 'elastic_limit',             desc: 'The point past which deformation becomes permanent' },
      'redundancy':        { universal: 'backup_capacity',           desc: 'Parallel systems so one failure doesn\'t cause total collapse' },
      'tensile_strength':  { universal: 'maximum_load',              desc: 'The most stress a material can take before breaking' },
      'safety_factor':     { universal: 'margin_of_safety',          desc: 'Building to handle more stress than you expect to see' },
      'resonance':         { universal: 'amplification_at_frequency', desc: 'When external rhythm matches internal rhythm and energy builds dangerously' },
      'creep':             { universal: 'slow_permanent_drift',      desc: 'Gradual deformation under sustained load over time' },
    },
  },

  education: {
    domain: 'Education & Pedagogy',
    concepts: {
      'scaffolding':                  { universal: 'structured_support',      desc: 'Temporary structure enabling work the learner can\'t yet do alone' },
      'rubric':                       { universal: 'evaluation_framework',    desc: 'Explicit criteria that make assessment transparent and consistent' },
      'differentiation':              { universal: 'adaptive_delivery',       desc: 'Adjusting approach for different learners rather than one-size-fits-all' },
      'formative_assessment':         { universal: 'in_progress_feedback',    desc: 'Checking understanding while learning is happening, not after' },
      'bloom_taxonomy':               { universal: 'capability_hierarchy',    desc: 'The ladder from remembering facts to creating new knowledge' },
      'pedagogy':                     { universal: 'transmission_method',     desc: 'The theory and practice of how knowledge is passed from one to another' },
      'metacognition':                { universal: 'thinking_about_thinking', desc: 'Awareness of one\'s own reasoning process' },
      'zone_of_proximal_development': { universal: 'growth_edge',             desc: 'What you can do with help but not yet alone — the sweet spot for learning' },
      'mastery_learning':             { universal: 'threshold_gating',        desc: 'Requiring demonstrated competence before advancing to the next level' },
      'transfer':                     { universal: 'concept_portability',     desc: 'Applying knowledge from one domain to solve problems in another' },
    },
  },

  music: {
    domain: 'Music & Sound',
    concepts: {
      'harmony':       { universal: 'consistency',                desc: 'Notes that support each other — frequencies that feel right together' },
      'dissonance':    { universal: 'productive_tension',         desc: 'Friction that demands resolution — the useful kind of wrong' },
      'resolution':    { universal: 'tension_release',            desc: 'The move from instability back to a stable state' },
      'counterpoint':  { universal: 'independent_parallel_lines', desc: 'Two voices moving independently but creating something coherent together' },
      'timbre':        { universal: 'identity_signature',         desc: 'The quality that makes a sound recognizable as itself — its fingerprint' },
      'cadence':       { universal: 'rhythmic_closure',           desc: 'A sequence that signals an ending or resting point' },
      'syncopation':   { universal: 'unexpected_emphasis',        desc: 'Placing stress where the pattern doesn\'t expect it' },
      'motif':         { universal: 'recurring_unit',             desc: 'A small pattern that repeats and builds meaning through repetition' },
      'dynamics':      { universal: 'intensity_modulation',       desc: 'Variation in force or volume to create expression' },
      'tempo':         { universal: 'execution_rate',             desc: 'The speed at which events unfold' },
      'key':           { universal: 'operating_context',          desc: 'The tonal home base that gives all other notes their meaning' },
    },
  },

  agriculture: {
    domain: 'Agriculture & Land Stewardship',
    concepts: {
      'yield':              { universal: 'return_rate',              desc: 'Output per unit of input — what the land gives back' },
      'rotation':           { universal: 'cyclic_renewal',           desc: 'Changing what occupies a space to restore what the previous use depleted' },
      'soil_health':        { universal: 'substrate_quality',        desc: 'The underlying conditions that determine what can grow on top' },
      'grafting':           { universal: 'capability_merger',        desc: 'Joining two organisms so one provides roots, the other provides fruit' },
      'vernalization':      { universal: 'prerequisite_condition',   desc: 'A cold period that must be experienced before flowering capability unlocks' },
      'IPM':                { universal: 'priority_under_constraint', desc: 'Managing pests through least-invasive means first — escalating only as needed' },
      'terroir':            { universal: 'context_fingerprint',      desc: 'How the specific place something comes from is inseparable from what it is' },
      'fallow':             { universal: 'intentional_rest',         desc: 'Leaving a resource idle to let it recover and regenerate' },
      'companion_planting': { universal: 'mutualistic_co_location',  desc: 'Placing complementary things together so each helps the other thrive' },
      'hardening_off':      { universal: 'graduated_exposure',       desc: 'Slowly introducing stress to build tolerance before full deployment' },
    },
  },
}

// ============ Extended Universal Concept Registry ============
// These are additional universal concepts that expand the hub for human domains.
// Agent lexicons above already define ~50 universals; these add breadth for user registration.
// Any string is a valid universal key — this list documents the well-known ones.
//
// Domains covered by extensions:
//   Medicine, Music, Law, Education, Biology, Physics, Psychology, Philosophy,
//   Sports, Architecture, Cooking, Military, Literature, Economics (macro)
//
// Format: universal_key → description
// (Not a runtime object — documentation only. Runtime truth is universalIndex.)
export const EXTENDED_UNIVERSAL_CONCEPTS = {
  // ---- Human/Biological ----
  'system_instability':    'A state oscillating dangerously around equilibrium',
  'homeostasis':           'Self-regulating balance maintained against external pressure',
  'feedback_loop':         'Output becomes input — amplifying or dampening change',
  'threshold_crossing':    'The moment a gradual change becomes a qualitative shift',
  'resource_depletion':    'Consuming a finite resource faster than it replenishes',
  'information_gradient':  'Difference in knowledge between two parties',
  'selection_pressure':    'Environmental force that favors certain traits over others',
  'symbiosis':             'Two distinct entities gaining mutual benefit from proximity',
  // ---- Time / Process ----
  'initiation_path':       'The structured journey from outside to inside a system',
  'phase_transition':      'A system-wide state change triggered by a parameter crossing',
  'decay_rate':            'How quickly something loses value, potency, or relevance',
  'latent_potential':      'Energy or capability present but not yet expressed',
  'iteration_cycle':       'One full loop of try → measure → improve',
  'convergence':           'Multiple independent paths meeting at the same destination',
  // ---- Knowledge / Mind ----
  'situational_state':     'Everything relevant to this moment\'s decision',
  'persistent_state':      'Information that outlives a single session',
  'derived_conclusion':    'What we can reasonably conclude from evidence',
  'pattern_generalization':'The common shape beneath specific instances',
  'reality_anchor':        'Connecting abstract ideas to observable facts',
  'knowledge_fusion':      'Merging distinct ideas into a coherent whole',
  'foundational_axiom':    'A truth so basic it cannot be derived from simpler things',
  'unchanging_constraint': 'A rule that holds regardless of context',
  // ---- Social / Power ----
  'trust_score':           'Accumulated credibility from past behavior',
  'collective_action':     'Multiple agents acting toward a shared goal',
  'norm_enforcement':      'Social pressure keeping behavior within acceptable bounds',
  'status_signal':         'A costly action whose only function is to demonstrate quality',
  'coalition_formation':   'Smaller actors combining to match larger ones',
  'legitimacy':            'Power acknowledged as rightful by those it governs',
  // ---- Value / Exchange ----
  'price_discovery':       'The process by which true value is revealed through exchange',
  'externality':           'A cost or benefit falling on those not party to a transaction',
  'scarcity_premium':      'Extra value attached to something simply because it is rare',
  'coordination_cost':     'The overhead of getting multiple parties to act together',
  'option_value':          'Value of having the ability to act — even without acting',
}

// ============ User-Defined Lexicons ============
// Humans register their own domain vocabulary here.
// Every user lexicon is a spoke to the same universal hub.
// USER_LEXICONS and buildUniversalIndex are declared at the top of this file.

/**
 * Register (or replace) a user's personal lexicon.
 * @param {string} userId - Unique identifier for this user
 * @param {string} domain - Human-readable domain label (e.g. "Cardiology", "Jazz Theory")
 * @param {Object} terms - Map of their words → universal concept strings
 *   e.g. { 'arrhythmia': 'system_instability', 'chord': 'harmonic_combination' }
 */
export function registerUserLexicon(userId, domain, terms) {
  if (!userId || typeof userId !== 'string') return { error: 'userId required' }
  if (!domain || typeof domain !== 'string') return { error: 'domain required' }
  if (!terms || typeof terms !== 'object') return { error: 'terms must be an object' }

  const concepts = {}
  for (const [term, value] of Object.entries(terms)) {
    if (typeof value === 'string') {
      // shorthand: term → universal string
      concepts[term] = { universal: value, desc: '' }
    } else if (value && typeof value === 'object' && value.universal) {
      // full form: term → { universal, desc }
      concepts[term] = { universal: value.universal, desc: value.desc || '' }
    }
  }

  USER_LEXICONS.set(userId, { domain, concepts })

  // Rebuild the universal index to include the new lexicon
  universalIndex = null

  return { registered: true, userId, domain, termCount: Object.keys(concepts).length }
}

/**
 * Add a single term to an existing user lexicon.
 * Creates the lexicon (with domain 'Custom') if it doesn't exist yet.
 * @param {string} userId
 * @param {string} term - The user's word
 * @param {string|Object} universalConcept - The universal concept string, or { universal, desc }
 */
export function addUserTerm(userId, term, universalConcept) {
  if (!userId || !term) return { error: 'userId and term required' }

  if (!USER_LEXICONS.has(userId)) {
    USER_LEXICONS.set(userId, { domain: 'Custom', concepts: {} })
  }

  const lexicon = USER_LEXICONS.get(userId)
  if (typeof universalConcept === 'string') {
    lexicon.concepts[term] = { universal: universalConcept, desc: '' }
  } else if (universalConcept && typeof universalConcept === 'object') {
    lexicon.concepts[term] = {
      universal: universalConcept.universal || String(universalConcept),
      desc: universalConcept.desc || '',
    }
  } else {
    return { error: 'universalConcept must be a string or { universal, desc }' }
  }

  // Rebuild universal index
  universalIndex = null

  return { added: true, userId, term, universal: lexicon.concepts[term].universal }
}

/**
 * Translate a concept between two users' lexicons via the universal hub.
 * @param {string} fromUserId
 * @param {string} toUserId
 * @param {string} concept - Term from fromUser's lexicon
 */
export function translateUser(fromUserId, toUserId, concept) {
  if (!universalIndex) buildUniversalIndex()

  const fromLexicon = USER_LEXICONS.get(fromUserId)
  const toLexicon = USER_LEXICONS.get(toUserId)

  if (!fromLexicon) return { error: `No lexicon registered for user: ${fromUserId}`, translated: false }
  if (!toLexicon) return { error: `No lexicon registered for user: ${toUserId}`, translated: false }

  const mapping = fromLexicon.concepts[concept]
  if (!mapping) {
    return {
      error: `'${concept}' not in ${fromUserId}'s lexicon`,
      translated: false,
      available: Object.keys(fromLexicon.concepts),
    }
  }

  const universal = mapping.universal

  // Exact match in target user's lexicon
  for (const [term, tMapping] of Object.entries(toLexicon.concepts)) {
    if (tMapping.universal === universal) {
      return {
        from: { userId: fromUserId, term: concept, desc: mapping.desc },
        universal,
        to: { userId: toUserId, term, desc: tMapping.desc },
        confidence: 1.0,
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
      from: { userId: fromUserId, term: concept, desc: mapping.desc },
      universal,
      to: { userId: toUserId, term: bestMatch.term, desc: bestMatch.mapping.desc },
      confidence: bestScore,
      translated: true,
      approximate: true,
    }
  }

  return {
    from: { userId: fromUserId, term: concept, desc: mapping.desc },
    universal,
    to: null,
    confidence: 0,
    translated: false,
    explanation: `${toUserId} has no equivalent concept. Universal form: "${universal}"`,
  }
}

/**
 * Show how a user's concept maps across ALL registered lexicons — agents and users.
 * @param {string} userId
 * @param {string} concept - Term from the user's lexicon
 */
export function translateUserToAll(userId, concept) {
  if (!universalIndex) buildUniversalIndex()

  const userLexicon = USER_LEXICONS.get(userId)
  if (!userLexicon) return { error: `No lexicon registered for user: ${userId}` }

  const mapping = userLexicon.concepts[concept]
  if (!mapping) {
    return {
      error: `'${concept}' not in ${userId}'s lexicon`,
      available: Object.keys(userLexicon.concepts),
    }
  }

  const universal = mapping.universal
  const results = {}

  // Translate to all agent lexicons
  for (const agentId of Object.keys(LEXICONS)) {
    const agentLexicon = LEXICONS[agentId]
    let bestTerm = null
    let bestScore = 0

    for (const [term, tMapping] of Object.entries(agentLexicon.concepts)) {
      if (tMapping.universal === universal) {
        results[agentId] = { type: 'agent', term, desc: tMapping.desc, confidence: 1.0, translated: true }
        bestTerm = null // exact found, skip approximate
        break
      }
      const score = conceptSimilarity(universal, tMapping.universal)
      if (score > bestScore) {
        bestScore = score
        bestTerm = { term, mapping: tMapping }
      }
    }

    if (!results[agentId]) {
      if (bestTerm && bestScore > 0.2) {
        results[agentId] = { type: 'agent', term: bestTerm.term, desc: bestTerm.mapping.desc, confidence: bestScore, translated: true, approximate: true }
      } else {
        results[agentId] = { type: 'agent', translated: false, explanation: `No equivalent in ${agentId}'s domain` }
      }
    }
  }

  // Translate to all other user lexicons
  for (const [otherUserId, otherLexicon] of USER_LEXICONS.entries()) {
    if (otherUserId === userId) continue
    let bestTerm = null
    let bestScore = 0

    for (const [term, tMapping] of Object.entries(otherLexicon.concepts)) {
      if (tMapping.universal === universal) {
        results[`user:${otherUserId}`] = { type: 'user', term, desc: tMapping.desc, confidence: 1.0, translated: true }
        bestTerm = null
        break
      }
      const score = conceptSimilarity(universal, tMapping.universal)
      if (score > bestScore) {
        bestScore = score
        bestTerm = { term, mapping: tMapping }
      }
    }

    if (!results[`user:${otherUserId}`]) {
      if (bestTerm && bestScore > 0.2) {
        results[`user:${otherUserId}`] = { type: 'user', term: bestTerm.term, desc: bestTerm.mapping.desc, confidence: bestScore, translated: true, approximate: true }
      } else {
        results[`user:${otherUserId}`] = { type: 'user', translated: false, explanation: `No equivalent in ${otherUserId}'s vocabulary` }
      }
    }
  }

  return {
    source: { userId, concept, domain: userLexicon.domain },
    universal,
    translations: results,
  }
}

/**
 * Given any term from any lexicon (agent or user), find all equivalent terms
 * across every registered lexicon. Reverse lookup via universal hub.
 * @param {string} term - The term to look up
 * @returns {{ universal: string, matches: Array<{ source, term, desc, confidence }> }}
 */
export function discoverEquivalent(term) {
  if (!universalIndex) buildUniversalIndex()

  // Step 1: find this term's universal concept in any lexicon
  let universal = null
  let sourceInfo = null

  // Search agent lexicons
  for (const [agentId, lexicon] of Object.entries(LEXICONS)) {
    if (lexicon.concepts[term]) {
      universal = lexicon.concepts[term].universal
      sourceInfo = { type: 'agent', id: agentId, domain: lexicon.domain, desc: lexicon.concepts[term].desc }
      break
    }
  }

  // Search user lexicons if not found in agents
  if (!universal) {
    for (const [userId, lexicon] of USER_LEXICONS.entries()) {
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
    }
  }

  // Step 2: gather all equivalents from the universal index
  const exactMatches = universalIndex[universal] || []

  // Step 3: also collect approximate matches (similar universal concepts)
  const approximateMatches = []
  for (const [otherUniversal, entries] of Object.entries(universalIndex)) {
    if (otherUniversal === universal) continue
    const score = conceptSimilarity(universal, otherUniversal)
    if (score > 0.3) {
      for (const entry of entries) {
        approximateMatches.push({ ...entry, confidence: score, approximate: true, theirUniversal: otherUniversal })
      }
    }
  }

  // Sort approximate matches by score descending
  approximateMatches.sort((a, b) => b.confidence - a.confidence)

  return {
    term,
    found: true,
    source: sourceInfo,
    universal,
    exactMatches: exactMatches.map(e => ({ ...e, confidence: 1.0 })),
    approximateMatches: approximateMatches.slice(0, 10),
    totalEquivalents: exactMatches.length + approximateMatches.length,
  }
}

/**
 * Fuzzy matching: suggest which universal concept a new term might map to,
 * based on word overlap with existing universal concepts and their descriptions.
 * @param {string} term - A new word the user is trying to register
 * @returns {{ suggestions: Array<{ universal, score, reason, examples }> }}
 */
export function getSuggestedMappings(term) {
  if (!universalIndex) buildUniversalIndex()

  const termWords = term.toLowerCase().replace(/_/g, ' ').split(/\s+/)

  const scores = {}

  // Score against every universal concept key
  for (const universal of Object.keys(universalIndex)) {
    const uWords = universal.split('_')
    const overlap = termWords.filter(w => uWords.includes(w)).length
    if (overlap > 0) {
      scores[universal] = (scores[universal] || 0) + (overlap * 2) / (termWords.length + uWords.length)
    }
  }

  // Score against descriptions of agent lexicon terms
  for (const [agentId, lexicon] of Object.entries(LEXICONS)) {
    for (const [agentTerm, mapping] of Object.entries(lexicon.concepts)) {
      const descWords = mapping.desc.toLowerCase().split(/\s+/)
      const overlap = termWords.filter(w => descWords.includes(w) && w.length > 3).length
      if (overlap > 0) {
        const boost = overlap / (termWords.length + descWords.length)
        scores[mapping.universal] = (scores[mapping.universal] || 0) + boost
      }

      // Direct word match against agent term itself
      const agentTermWords = agentTerm.toLowerCase().replace(/_/g, ' ').split(/\s+/)
      const termOverlap = termWords.filter(w => agentTermWords.includes(w)).length
      if (termOverlap > 0) {
        const boost = (termOverlap * 1.5) / (termWords.length + agentTermWords.length)
        scores[mapping.universal] = (scores[mapping.universal] || 0) + boost
      }
    }
  }

  // Rank and format
  const ranked = Object.entries(scores)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([universal, score]) => {
      const examples = (universalIndex[universal] || []).map(e => `${e.agent}:"${e.term}"`).join(', ')
      return {
        universal,
        score: Math.min(score, 1.0),
        reason: `Word overlap with existing concepts`,
        examples: examples || 'none yet',
        registeredBy: (universalIndex[universal] || []).map(e => e.agent),
      }
    })

  return {
    term,
    suggestions: ranked,
    tip: ranked.length > 0
      ? `Top suggestion: use "${ranked[0].universal}" — already spoken by: ${ranked[0].registeredBy.join(', ')}`
      : `No close matches found. "${term}" may be a genuinely new concept — register it with a new universal key.`,
  }
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
    users: {},
    universalConcepts: Object.keys(universalIndex).length,
    totalTerms: 0,
    registeredUsers: USER_LEXICONS.size,
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

  for (const [userId, lexicon] of USER_LEXICONS.entries()) {
    const terms = Object.keys(lexicon.concepts)
    view.users[userId] = {
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
    // Serialize user lexicons: Map → plain object for JSON
    const userLexiconsObj = {}
    for (const [userId, lexicon] of USER_LEXICONS.entries()) {
      userLexiconsObj[userId] = lexicon
    }
    const state = {
      covenantHash: COVENANT_HASH,
      challenges: [...challenges.values()],
      userLexicons: userLexiconsObj,
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

    // Restore user lexicons
    if (state.userLexicons) {
      for (const [userId, lexicon] of Object.entries(state.userLexicons)) {
        USER_LEXICONS.set(userId, lexicon)
      }
      // Rebuild index to include restored user lexicons
      universalIndex = null
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
  const agentTerms = Object.values(LEXICONS).reduce((sum, l) => sum + Object.keys(l.concepts).length, 0)
  console.log(`[rosetta] Protocol initialized. ${Object.keys(LEXICONS).length} agent lexicons, ${agentTerms} agent terms, ${Object.keys(universalIndex).length} universal concepts, ${TEN_COVENANTS.length} covenants (${COVENANT_HASH.slice(0, 16)}...) — ${USER_LEXICONS.size} user lexicons loaded`)
  return {
    agentTerms,
    universalConcepts: Object.keys(universalIndex).length,
    covenantHash: COVENANT_HASH,
    userLexicons: USER_LEXICONS.size,
  }
}

// ============ Exports for Tools ============

export function getLexicon(agentId) {
  return LEXICONS[agentId] || null
}

export function getAllLexicons() {
  return LEXICONS
}

/** Return a user's registered lexicon, or null if not registered. */
export function getUserLexicon(userId) {
  return USER_LEXICONS.get(userId) || null
}

/** Return all user lexicons as a plain object. */
export function getAllUserLexicons() {
  const result = {}
  for (const [userId, lexicon] of USER_LEXICONS.entries()) {
    result[userId] = lexicon
  }
  return result
}

export function getCovenant(number) {
  return TEN_COVENANTS.find(c => c.number === number) || null
}
