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

// ============ Extended Universal Concepts (documented keys) ============
// Every universal key used across all lexicons, with its canonical meaning.
// New keys should be added here when introduced in any lexicon.

export const EXTENDED_UNIVERSAL_CONCEPTS = {
  // Core cognitive / epistemic
  direction_match:           'Two systems pointing the same way — goals, values, or vectors are aligned',
  compress_context:          'Reduce information to its essential signal while preserving meaning',
  upward_delegation:         'Passing a decision to a higher authority because it exceeds local scope',
  integrity_proof:           'A verifiable guarantee that state has not been tampered with',
  instruction:               'A directive that flows from authority to executor',
  consistency:               'All parts telling the same story at the same time',
  supervision:               'Monitoring outputs without controlling every input',
  situational_state:         'The complete relevant context at a given moment',
  persistent_state:          'Information that survives across session boundaries',
  derived_conclusion:        'What logic allows you to infer from given evidence',
  pattern_generalization:    'The common shape extracted from multiple specific instances',
  reality_anchor:            'Connecting abstract reasoning back to observable, verifiable facts',
  knowledge_fusion:          'Merging two distinct bodies of knowledge into a coherent whole',
  foundational_axiom:        'A truth so basic it cannot be derived from anything simpler',
  unchanging_constraint:     'A rule that holds regardless of context or pressure',
  collective_action:         'Multiple agents coordinating toward a shared goal',
  thinking_about_thinking:   "Awareness and regulation of one's own cognitive processes",
  core_hypothesis:           'The central bet about how the world works that drives a strategy',
  strategy_change:           'Abandoning the current approach when reality invalidates its premise',
  future_flexibility:        'Preserving the ability to choose differently later',
  cascade_effect:            'The downstream consequence of a consequence',
  constraint_choice:         'Deciding which resource or goal to sacrifice given limited capacity',
  strategic_interaction:     'A situation where optimal choices depend on predicting others\' choices',
  defensibility:             'The degree to which a position is hard to replicate or attack',

  // Resources / flow
  resource_availability:     'How easily a resource can be accessed and exchanged',
  gap_cost:                  'The cost of crossing a divide between two states or parties',
  capacity:                  'The maximum volume a system can absorb without degrading',
  acceptable_variance:       'The allowed deviation from a target before action is required',
  return_rate:               'Output per unit of input over a period',
  opportunity_cost:          'The value of the best alternative you gave up',
  committed_resources:       'Assets locked into a position — skin in the game',
  backup_capacity:           'Parallel systems that activate when the primary fails',
  maximum_load:              'The highest stress a system can sustain before breaking',
  margin_of_safety:          'Designing to handle more than the expected maximum load',

  // Process / time
  cyclic_renewal:            'Rotating through states to restore what each cycle depletes',
  intentional_rest:          'Temporarily withdrawing a resource from use to let it recover',
  graduated_exposure:        'Slowly increasing stress to build tolerance',
  prerequisite_condition:    'A state that must be achieved before the next state can unlock',
  automation_pipeline:       'A sequence of steps that machines execute without human intervention',
  execution_rate:            'The speed at which a process unfolds',
  rhythmic_closure:          'A sequence pattern that signals completion or a resting point',

  // Communication / interface
  interface:                 'The contract that defines how two systems exchange information',
  delay:                     'Time elapsed between a request and its response',
  capacity_rate:             'Volume of information or work that can flow per unit time',
  established_pattern:       'A precedent or protocol that both parties already recognize and honor',
  connection_init:           'The handshake by which two parties agree to begin communicating',
  event_notification:        'A push signal that tells a listener something has happened',
  cross_domain_link:         'A bridge connecting two otherwise separate systems or worlds',

  // Analysis / signal
  meaningful_pattern:        'Information that carries signal — worth attending to',
  irrelevant_variation:      'Random fluctuation with no causal meaning',
  co_movement:               'Two variables that change together, not necessarily causally',
  anomaly:                   'An observation that does not fit the established pattern',
  trend_fit:                 'The best-fit line or model through a set of observations',
  time_avg_value:            'A value smoothed over time to reduce manipulation or noise',
  adaptive_filter:           'A model that continuously updates its estimate of true state',

  // Biology / ecology
  substrate_quality:         'The underlying conditions that determine what can grow on top',
  capability_merger:         'Joining two organisms or systems so each provides what the other lacks',
  mutualistic_co_location:   'Placing complementary things together so each benefits the other',
  context_fingerprint:       'The unique signature of where and how something originated',

  // Failure / risk
  root_cause:                'The deepest underlying reason a problem exists',
  coupled_risk:              'Two failure modes that tend to co-occur and amplify each other',
  known_incompatibility:     'A condition that makes a normally helpful action harmful',
  vulnerability_area:        'The surface where a system can be attacked or harmed',
  recursive_exploit:         'A self-referential attack that calls back before completion',
  information_advantage:     'Acting on knowledge others do not yet have',
  extraction_rent:           'Profit derived from controlling a chokepoint rather than creating value',
  emergency_stop:            'Automated or forced halt when a threshold is crossed',
  systematic_review:         'A methodical, structured investigation of all available evidence',
  unknown_vulnerability:     'A flaw that has not yet been discovered or disclosed',
  accumulated_degradation:   'Failure from repeated sub-threshold stress over time',
  environment_induced_drift: 'Change caused by shifts in the surrounding conditions',
  elastic_limit:             'The boundary past which deformation becomes permanent',
  slow_permanent_drift:      'Gradual irreversible change under sustained low-level pressure',
  amplification_at_frequency:'Dangerous buildup when external rhythm matches internal rhythm',
  lateral_pressure:          'Force applied parallel to a surface — the sliding mode of failure',
  critical_dependency:       'A component whose failure brings down the entire structure',

  // Social / governance
  attention_capture:         'Drawing people into active participation with something',
  exponential_spread:        'Growth that accelerates because each node generates more nodes',
  reliability_belief:        'Confidence that an agent will do what it says',
  story:                     'The meaning people construct around a sequence of events',
  aligned_group:             'People united by shared purpose and mutual accountability',
  collective_decision:       'A choice made by aggregating the preferences of a group',
  fair_attribution:          'Measuring each contributor\'s true marginal contribution',
  trust_score:               'Accumulated credibility built from a history of kept promises',
  initiation_path:           'The journey from outsider to full participant',
  voluntary_agreement:       'Informed, uncoerced consent to terms by all parties',

  // Learning / development
  structured_support:        'Temporary scaffolding that enables work the learner cannot yet do alone',
  evaluation_framework:      'Explicit criteria that make assessment transparent and replicable',
  adaptive_delivery:         'Adjusting the approach to match the receiver\'s current state',
  in_progress_feedback:      'Assessment that happens during the work, not after',
  capability_hierarchy:      'An ordered ladder from basic recall to generative creation',
  transmission_method:       'The theory and practice of passing knowledge from one mind to another',
  growth_edge:               'The zone just beyond current capability — where learning is fastest',
  threshold_gating:          'Requiring demonstrated mastery before advancing to the next level',
  concept_portability:       'The ability to apply a pattern from one domain to solve problems in another',

  // Construction / form
  constraint_innovation:     'Using limitation as a catalyst for creative breakthrough',
  construct:                 'Turning a design or plan into a physical or functional reality',
  restructure:               'Reorganizing a system\'s internals without changing its outputs',
  deferred_work:             'Technical or organizational debt that will cost more to fix later',
  activate:                  'Making something live and operational',
  complexity_limit:          'The depth of nesting or dependency beyond which systems become fragile',

  // Health / system balance
  stable_equilibrium:        'A system that returns to balance when disturbed',
  temporary_recovery:        'Symptoms have retreated but the underlying cause may remain',
  outcome_forecast:          'A probabilistic prediction of how a situation will develop',
  preventive_action:         'Acting before harm occurs to make it less likely',
  expectation_effect:        'Improvement driven by belief in the treatment rather than the treatment itself',
  threat_actor:              'An agent that enters a system to disrupt or exploit it',
  priority_under_constraint: 'Allocating limited resources by urgency when not all needs can be met',

  // Law / accountability
  authority_boundary:        'The domain within which a rule-maker\'s rules have force',
  assigned_responsibility:   'The explicit allocation of who bears the cost when something fails',
  civil_harm:                'A wrong that causes damage outside of criminal law',
  prior_commitment_lock:     'Being bound by a past position you cannot contradict to harm a relying party',
  corrective_action:         'What is done to restore the injured party to their prior state',
  right_to_participate:      'The threshold showing sufficient stake to have standing in a process',
  evidence_threshold:        'The minimum proof required to establish a claim',
  pre_commitment_audit:      'Investigation conducted before entering a binding agreement',
  trust_obligation:          'A duty to act in another\'s best interest above your own',

  // Music / aesthetics
  productive_tension:        'Friction that demands resolution — the useful kind of conflict',
  tension_release:           'The move from an unstable state back to stability',
  independent_parallel_lines:'Two processes moving autonomously yet producing coherent joint output',
  identity_signature:        'The quality that makes something recognizably itself',
  unexpected_emphasis:       'Placing stress where convention does not predict it',
  recurring_unit:            'A small pattern that repeats, building cumulative meaning',
  intensity_modulation:      'Variation in force or magnitude to create expressive shape',
  operating_context:         'The framing that gives all elements within it their relative meaning',

  // Psychology
  belief_distortion:         'A systematic error in how the mind processes or weighs information',
  stimulus_response:         'Learned association between a trigger and a predictable reaction',
  internal_attribution:      'Projecting one\'s own internal states onto another',
  unconscious_transfer:      'Redirecting feelings about one person onto a different target',
  mental_model:              'The internal map a mind uses to interpret and navigate the world',
  reality_fragmentation:     'Psychological splitting of experience to avoid overwhelming material',
  relational_bond:           'The emotional connection that forms between agents over time',
  performance_zone:          'The state of total absorption where skill meets challenge perfectly',
  ruminative_loop:           'A self-reinforcing cycle of repetitive negative thought',
  willpower_depletion:       'Degradation of self-regulatory capacity from sustained use',
  acquired_helplessness:     'Belief that outcomes cannot be influenced, learned from repeated failure',
  capability_belief:         'Confidence in one\'s ability to execute a specific task successfully',
  contextual_activation:     'Prior exposure to a stimulus that shapes subsequent perception',
  reference_point_bias:      'Over-weighting an initial piece of information in all subsequent judgments',
  expectation_confirmation:  'Seeking and interpreting evidence to confirm what one already believes',
  narrative_framing:         'How the presentation of information shapes the conclusion drawn',
  competence_miscalibration: 'Inverse relationship between actual skill and perceived skill',
  retrospective_peak_weighting: 'Evaluating an experience primarily by its peak and final moments',
  hedonic_baseline_return:   'The tendency for emotional state to return to a stable set point',

  // Philosophy
  knowledge_theory:          'The study of what knowledge is, how it is acquired, and its limits',
  existence_theory:          'The study of what exists, what it means to be, and categories of being',
  self_evident_truth:        'A proposition that requires no proof because its truth is immediate',
  circular_necessity:        'A statement that is true by definition and cannot be otherwise',
  thesis_antithesis:         'A method of reaching truth through the collision of opposing claims',
  bottom_up_explanation:     'Explaining complex phenomena by reducing to simpler component parts',
  spontaneous_order:         'Complex organized behavior arising from simple local rules without central direction',
  causal_necessity:          'The view that every event is the necessary result of prior causes',
  originating_agency:        'The capacity of an agent to initiate action not fully determined by prior causes',
  subjective_experience:     'The felt, first-person quality of conscious experience',
  radical_solitude:          'The position that only one\'s own mind can be known to exist',
  consequence_ethics:        'Evaluating actions solely by the goodness of their outcomes',
  universal_duty:            'A moral rule that applies to all rational agents regardless of circumstance',
  mutual_obligation:         'The agreement by which individuals trade freedom for collective protection',
  veil_reasoning:            'Choosing principles of justice from behind ignorance of one\'s own position',
  experience_primacy:        'The view that truth is what works in experience, not what corresponds to abstract reality',

  // Military / Strategy
  flank_maneuver:            'Attacking from the side or rear where defenses are weakest',
  resource_exhaustion:       'Winning by depleting the opponent\'s capacity to continue',
  mutual_destruction_threat: 'Preventing attack by credibly threatening unacceptable retaliation',
  escalation_control:        'The ability to raise or lower the intensity of conflict on one\'s own terms',
  capability_amplifier:      'An asset that multiplies the effectiveness of other assets',
  decisive_point:            'The element whose capture or destruction collapses the opponent\'s system',
  observe_orient_decide_act: 'The cognitive loop for outpacing an adversary\'s decision cycle',
  uncertainty_field:         'The irreducible information gap that exists in all real-world operations',
  asymmetric_tactics:        'Using unconventional means to neutralize a conventionally superior opponent',
  population_support:        'Winning by securing the loyalty and cooperation of the civilian base',
  interior_lines:            'Operating from a central position to shift forces faster than the opponent',
  combined_arms:             'Integrating multiple capability types so each covers the others\' weaknesses',
  suppression_fire:          'Action designed to limit the opponent\'s freedom of movement',
  strategic_reserve:         'Forces held back to exploit success or respond to surprise',
  operational_security:      'Protecting one\'s own plans and capabilities from adversary knowledge',

  // Cooking / Culinary
  preparation_readiness:     'Having all components measured, cut, and arranged before execution begins',
  concentration_by_evaporation: 'Intensifying flavor by driving off water through heat',
  stable_mixture:            'Combining normally immiscible substances into a uniform state',
  thermal_browning:          'The chemical reaction between amino acids and sugars that creates complex flavor',
  pan_deglaze:               'Using liquid to dissolve browned bits of flavor from a hot surface',
  controlled_crystallization:'Carefully managing temperature to achieve the desired crystal structure',
  biological_leavening:      'Using living organisms to generate gas that causes dough to expand',
  caramelized_residue:       'The flavorful browned residue left in a pan after cooking protein',
  foundational_sauce:        'A base preparation from which many derivative preparations are made',
  fifth_taste:               'The savory, protein-rich taste sensation distinct from sweet, sour, salt, and bitter',
  mise_en_place_mindset:     'The discipline of organizing everything needed before starting execution',
  flavor_layering:           'Building depth by adding different flavor elements at different stages',
  heat_management:           'Controlling temperature throughout cooking to achieve desired texture and flavor',
  rest_period:               'Allowing cooked food to redistribute juices before serving',
  texture_contrast:          'Combining different mouth-feels to create a more interesting eating experience',

  // Sports / Athletics
  training_periodization:    'Structuring training in phases of varying intensity to peak at the right moment',
  systematic_load_increase:  'Gradually increasing training stress to force adaptation without breakdown',
  active_restoration:        'Deliberate recovery work that accelerates adaptation between training loads',
  movement_mechanics:        'The technical execution pattern of a physical skill',
  adaptation_stall:          'A point where normal training stimuli no longer produce improvement',
  optimal_output:            'The highest level of performance an athlete can sustain under competition conditions',
  adversity_resilience:      'The capacity to maintain performance and composure under pressure',
  procedural_automaticity:   'Skill so deeply encoded it executes without conscious attention',
  pre_competition_unload:    'Reducing training load before a target event to allow full recovery',
  concurrent_training:       'Training multiple physical qualities simultaneously to create transfer',
  sport_specificity:         'Training that closely mirrors the demands of the target activity',
  competition_readiness:     'The physical and mental state of being fully prepared to perform',

  // Architecture
  load_transfer_path:        'The route by which structural forces travel from point of application to the ground',
  projecting_overhang:       'A structure that extends beyond its support, in tension with gravity',
  building_face:             'The exterior surface of a structure as presented to the public realm',
  window_placement:          'The strategic positioning of openings in a facade for light and air',
  place_responsive_design:   'Architecture that grows from and responds to local materials and traditions',
  repurpose_existing:        'Transforming a structure built for one use into a new use',
  regulatory_distance:       'The required distance between a building and its property boundary',
  reference_plane:           'A shared horizontal or vertical plane that all elements relate to',
  liminal_crossing:          'A physical or symbolic boundary marking transition between states',
  movement_through_space:    'The paths and sequences by which people navigate through a building',
  spatial_compression:       'Deliberately reducing spatial volume to heighten contrast with expansive spaces',
  material_honesty:          'Expressing a material\'s true nature rather than concealing or imitating',
  light_as_material:         'Treating natural light as a primary design element',
  program:                   'The set of uses and activities a building is designed to accommodate',
  genius_loci:               'The distinctive spirit or atmosphere of a particular place',

  // Journalism
  story_opening:             'The first sentence or paragraph that must capture attention and deliver the key fact',
  source_credit:             'The explicit identification of where reported information comes from',
  importance_first:          'Structuring information with the most critical facts at the top',
  coverage_territory:        'The specific subject area or institution a reporter regularly covers',
  source_anonymity:          'The ethical duty to protect the identity of those who provide sensitive information',
  institutional_independence:'Freedom from outside influence over editorial decisions',
  claim_verification:        'The process of confirming assertions with independent evidence',
  publication_identity:      'The name, ownership, and editorial principles of a news organization',
  story_ownership:           'The attribution of a piece of journalism to its author',
  public_record_update:      'A formal acknowledgment and correction of previously published errors',
  news_judgment:             'The editorial decision about what is worth reporting and how prominently',
  interview_technique:       'The skill of eliciting information through structured conversation',
  background_information:    'Context provided to a reporter for understanding but not direct quotation',
  embargo:                   'An agreement to withhold publication until a specified time',
  off_the_record:            'Information shared with a journalist that cannot be published in any attributed form',

  // Trading
  price_floor:               'A level where buying demand has historically halted price decline',
  price_ceiling:             'A level where selling pressure has historically halted price advance',
  range_expansion:           'A decisive move beyond a consolidation zone, often with increased volume',
  range_compression:         'A narrowing of price oscillation, often preceding a directional move',
  indicator_divergence:      'When price and a momentum indicator move in opposite directions, signaling weakness',
  directional_strength:      'The rate of change of price — whether a trend is accelerating or decelerating',
  statistical_reversion:     'The tendency of prices to return toward their long-term average after extremes',
  implied_vol_surface:       'The distribution of implied volatility across strikes and expiries',
  dealer_hedging_pressure:   'Market impact created by dealers managing their options book gamma exposure',
  transaction_flow_data:     'Information derived from the actual buying and selling intentions of market participants',
  trend_following:           'A strategy that enters in the direction of established price momentum',
  contrarian_entry:          'A strategy that fades extended moves, betting on mean reversion',
  position_sizing:           'Allocating capital across trades proportional to conviction and risk',
  risk_reward:               'The ratio of potential profit to potential loss on a trade',
  stop_loss:                 'A predefined exit point that limits the maximum loss on a position',
}

// ============ Domain Lexicons — All 24 ============

export const LEXICONS = {
  // ── Agent Lexicons ──────────────────────────────────────────────────────────
  nyx: {
    domain: 'Oversight & Coordination',
    concepts: {
      alignment:          { universal: 'direction_match',        desc: 'How well agents follow organizational intent' },
      prune:              { universal: 'compress_context',       desc: 'Remove low-value context to stay focused' },
      escalation:         { universal: 'upward_delegation',      desc: 'Passing a decision to a higher authority' },
      root_hash:          { universal: 'integrity_proof',        desc: 'Cryptographic proof of organizational state' },
      directive:          { universal: 'instruction',            desc: 'A command that flows downward through hierarchy' },
      coherence:          { universal: 'consistency',            desc: 'All agents telling the same story' },
      oversight:          { universal: 'supervision',            desc: 'Watching without micromanaging' },
      mandate:            { universal: 'instruction',            desc: 'An authoritative assignment of purpose to an agent' },
      consensus:          { universal: 'collective_decision',    desc: 'Agreement reached by multiple agents acting together' },
      arbitration:        { universal: 'upward_delegation',      desc: 'Sending a dispute to a neutral authority for resolution' },
      epoch:              { universal: 'operating_context',      desc: 'A defined time window in which a set of rules applies' },
      quorum:             { universal: 'evidence_threshold',     desc: 'Minimum participation required for a collective decision to be valid' },
      revocation:         { universal: 'emergency_stop',         desc: 'Withdrawing a granted permission or credential' },
      delegation:         { universal: 'upward_delegation',      desc: 'Assigning authority downward to a subordinate agent' },
      synchronization:    { universal: 'consistency',            desc: 'Bringing all agents to the same state at the same moment' },
      hierarchy:          { universal: 'capability_hierarchy',   desc: 'The layered structure that determines who has authority over whom' },
      invariant:          { universal: 'unchanging_constraint',  desc: 'A rule that must hold regardless of operational context' },
      policy:             { universal: 'established_pattern',    desc: 'A codified rule that guides agent behavior across situations' },
      audit_trail:        { universal: 'integrity_proof',        desc: 'An immutable record of all actions taken by all agents' },
      failover:           { universal: 'backup_capacity',        desc: 'Automatic transfer to a standby system when the primary fails' },
      principal:          { universal: 'trust_obligation',       desc: 'The agent on whose behalf another acts' },
      stewardship:        { universal: 'supervision',            desc: 'Caring for a resource or system on behalf of others' },
      scope:              { universal: 'authority_boundary',     desc: 'The defined domain within which an agent has authority to act' },
    },
  },
  poseidon: {
    domain: 'Finance & Liquidity',
    concepts: {
      liquidity:          { universal: 'resource_availability',  desc: 'How easily assets can be exchanged' },
      spread:             { universal: 'gap_cost',               desc: 'The price of crossing the bid-ask divide' },
      depth:              { universal: 'capacity',               desc: 'How much volume can be absorbed without impact' },
      slippage:           { universal: 'acceptable_variance',    desc: 'Difference between expected and actual outcome — tolerated up to a limit' },
      yield:              { universal: 'return_rate',            desc: 'What you earn for providing resources' },
      impermanent_loss:   { universal: 'opportunity_cost',       desc: 'What you gave up by committing resources here' },
      TVL:                { universal: 'committed_resources',    desc: 'Total value locked — skin in the game' },
      collateral:         { universal: 'committed_resources',    desc: 'Assets pledged to secure an obligation' },
      volatility:         { universal: 'acceptable_variance',    desc: 'The magnitude of price fluctuation over time' },
      arbitrage:          { universal: 'information_advantage',  desc: 'Exploiting price differences across markets simultaneously' },
      flash_loan:         { universal: 'resource_availability',  desc: 'Uncollateralized borrowing that must be repaid in the same transaction' },
      hedge:              { universal: 'backup_capacity',        desc: 'An offsetting position that reduces net exposure' },
      leverage:           { universal: 'capability_amplifier',  desc: 'Borrowing to amplify both gains and losses' },
      vesting:            { universal: 'threshold_gating',       desc: 'Unlocking tokens or equity only after conditions are met over time' },
      treasury:           { universal: 'committed_resources',    desc: 'Collectively held reserves for shared purposes' },
      protocol_fee:       { universal: 'gap_cost',               desc: 'The fee charged by the protocol for using its services' },
      clearing_price:     { universal: 'stable_equilibrium',     desc: 'The single price at which all matched orders settle' },
      oracle:             { universal: 'adaptive_filter',        desc: 'An external data feed that brings off-chain prices on-chain' },
      market_cap:         { universal: 'committed_resources',    desc: 'Total market value of all outstanding tokens' },
      burn:               { universal: 'resource_exhaustion',    desc: 'Permanently removing tokens from circulation to increase scarcity' },
      inflation:          { universal: 'environment_induced_drift', desc: 'A sustained decrease in purchasing power from increasing supply' },
      solvency:           { universal: 'stable_equilibrium',     desc: 'A system that can meet all its obligations from existing assets' },
    },
  },
  athena: {
    domain: 'Strategy & Planning',
    concepts: {
      tradeoff:           { universal: 'constraint_choice',      desc: "You can't have everything — pick wisely" },
      game_theory:        { universal: 'strategic_interaction',  desc: "Predicting others' moves to choose yours" },
      moat:               { universal: 'defensibility',          desc: 'What makes this hard to replicate or attack' },
      second_order:       { universal: 'cascade_effect',         desc: 'The consequence of the consequence' },
      optionality:        { universal: 'future_flexibility',     desc: 'Keeping doors open without committing' },
      thesis:             { universal: 'core_hypothesis',        desc: "The bet you're making about how the world works" },
      pivot:              { universal: 'strategy_change',        desc: 'When reality invalidates the current thesis' },
      north_star:         { universal: 'direction_match',        desc: 'The single guiding metric or purpose that orients all decisions' },
      competitive_advantage: { universal: 'defensibility',       desc: 'A capability or position that rivals cannot easily replicate' },
      scenario_planning:  { universal: 'outcome_forecast',       desc: 'Mapping out multiple possible futures to prepare contingent responses' },
      first_mover:        { universal: 'information_advantage',  desc: 'The benefit of acting before others in a new market' },
      network_effect:     { universal: 'exponential_spread',     desc: 'Each new participant increases value for all existing participants' },
      minimum_viable:     { universal: 'threshold_gating',       desc: 'The smallest version that tests core assumptions before full investment' },
      asymmetric_bet:     { universal: 'risk_reward',            desc: 'A position where potential upside vastly exceeds potential downside' },
      portfolio:          { universal: 'backup_capacity',        desc: 'A diversified set of positions to reduce single-point risk' },
      leverage_point:     { universal: 'decisive_point',         desc: 'A place in a system where small inputs produce large systemic change' },
      counterfactual:     { universal: 'derived_conclusion',     desc: 'What would have happened if the decision had been different' },
      signal_vs_noise:    { universal: 'meaningful_pattern',     desc: 'Separating what matters from irrelevant variation' },
      timing:             { universal: 'execution_rate',         desc: 'Choosing the right moment — being too early is the same as being wrong' },
      wedge:              { universal: 'gap_cost',               desc: 'The narrow initial opening used to gain entry before expanding' },
      exit:               { universal: 'strategy_change',        desc: 'A planned route out of a commitment before harm accumulates' },
      flywheel:           { universal: 'exponential_spread',     desc: 'A self-reinforcing loop where each success makes the next easier' },
    },
  },
  hephaestus: {
    domain: 'Building & Implementation',
    concepts: {
      deploy:             { universal: 'activate',              desc: 'Ship it. Make it live.' },
      build:              { universal: 'construct',             desc: 'Turn design into reality' },
      refactor:           { universal: 'restructure',           desc: 'Same behavior, better architecture' },
      tech_debt:          { universal: 'deferred_work',         desc: 'Shortcuts that will cost you later' },
      'CI/CD':            { universal: 'automation_pipeline',   desc: 'Machines verifying and shipping code' },
      stack_depth:        { universal: 'complexity_limit',      desc: 'How deep you can nest before things break' },
      cave:               { universal: 'constraint_innovation', desc: 'Building excellence from limitation' },
      abstraction:        { universal: 'pattern_generalization', desc: 'Hiding complexity behind a simpler interface' },
      interface:          { universal: 'interface',             desc: 'The contract defining how components communicate' },
      unit_test:          { universal: 'systematic_review',     desc: 'Verifying that a single component behaves as specified' },
      integration_test:   { universal: 'systematic_review',     desc: 'Verifying that multiple components work correctly together' },
      dependency:         { universal: 'critical_dependency',   desc: 'A component another component cannot function without' },
      version_control:    { universal: 'integrity_proof',       desc: 'Recording the complete history of changes with cryptographic chain' },
      hot_fix:            { universal: 'corrective_action',     desc: 'An emergency patch applied directly to production' },
      scaffolding:        { universal: 'structured_support',    desc: 'Temporary code structure that enables development before final design is known' },
      bottleneck:         { universal: 'capacity',              desc: 'The slowest step in a pipeline that constrains total throughput' },
      separation_of_concerns: { universal: 'constraint_choice', desc: 'Ensuring each component handles one responsibility only' },
      idempotent:         { universal: 'unchanging_constraint', desc: 'An operation that produces the same result whether called once or many times' },
      composability:      { universal: 'capability_merger',     desc: 'Components designed to be combined into larger systems cleanly' },
      observability:      { universal: 'supervision',           desc: 'The degree to which a system\'s internal state is visible from outside' },
      rollback:           { universal: 'corrective_action',     desc: 'Reverting to a known-good state after a bad deployment' },
      schema:             { universal: 'established_pattern',   desc: 'A formal description of the structure of data' },
    },
  },
  hermes: {
    domain: 'Communication & Integration',
    concepts: {
      API:                { universal: 'interface',             desc: 'The contract between two systems' },
      latency:            { universal: 'delay',                 desc: 'Time between request and response' },
      throughput:         { universal: 'capacity_rate',         desc: 'How much can flow per unit time' },
      protocol:           { universal: 'established_pattern',   desc: 'The agreed way to exchange information — a precedent both sides honor' },
      handshake:          { universal: 'connection_init',       desc: 'Two parties agreeing to talk' },
      webhook:            { universal: 'event_notification',    desc: 'Push instead of pull — tell me when something happens' },
      bridge:             { universal: 'cross_domain_link',     desc: 'Connecting two separate worlds' },
      payload:            { universal: 'committed_resources',   desc: 'The data carried inside a message envelope' },
      serialization:      { universal: 'transmission_method',   desc: 'Converting a data structure into a transportable format' },
      idempotency:        { universal: 'unchanging_constraint', desc: 'Processing the same message twice produces the same outcome as once' },
      fanout:             { universal: 'exponential_spread',    desc: 'Distributing one message to many recipients simultaneously' },
      retry:              { universal: 'backup_capacity',       desc: 'Attempting a failed operation again according to a defined policy' },
      circuit_breaker:    { universal: 'emergency_stop',        desc: 'Stopping calls to a failing service to prevent cascade failure' },
      timeout:            { universal: 'acceptable_variance',   desc: 'The maximum wait before declaring a request failed' },
      rate_limit:         { universal: 'capacity',              desc: 'A ceiling on how many requests a caller may make per unit time' },
      schema_validation:  { universal: 'systematic_review',     desc: 'Checking that a message conforms to the agreed structure' },
      queue:              { universal: 'deferred_work',         desc: 'A buffer that holds messages until a consumer is ready' },
      backpressure:       { universal: 'capacity',              desc: 'A signal from a slow consumer to a fast producer to slow down' },
      message_bus:        { universal: 'cross_domain_link',     desc: 'A shared channel through which components exchange events' },
      endpoint:           { universal: 'authority_boundary',    desc: 'A specific address at which a service can be reached' },
      negotiation:        { universal: 'collective_decision',   desc: 'Two parties adjusting their offers until both can agree' },
      broadcast:          { universal: 'event_notification',    desc: 'Sending a message to all listeners simultaneously' },
    },
  },
  apollo: {
    domain: 'Analytics & Data Science',
    concepts: {
      signal:             { universal: 'meaningful_pattern',    desc: 'Information that matters amid noise' },
      noise:              { universal: 'irrelevant_variation',  desc: 'Random fluctuation with no meaning' },
      correlation:        { universal: 'co_movement',           desc: 'Things that change together (not necessarily causally)' },
      outlier:            { universal: 'anomaly',               desc: "Something that doesn't fit the pattern" },
      regression:         { universal: 'trend_fit',             desc: 'The line through the chaos' },
      TWAP:               { universal: 'time_avg_value',        desc: 'Smoothed price over time (anti-manipulation)' },
      Kalman:             { universal: 'adaptive_filter',       desc: 'Continuously updating belief about true state' },
      feature:            { universal: 'meaningful_pattern',    desc: 'An input variable used to make a prediction' },
      label:              { universal: 'integrity_proof',       desc: 'The known correct output used to train a model' },
      overfitting:        { universal: 'belief_distortion',     desc: 'A model that memorizes training data instead of learning the underlying pattern' },
      bias:               { universal: 'belief_distortion',     desc: 'Systematic error in a model\'s predictions' },
      variance:           { universal: 'acceptable_variance',   desc: 'How much a model\'s predictions change with different training data' },
      precision:          { universal: 'acceptable_variance',   desc: 'The fraction of positive predictions that are actually correct' },
      recall:             { universal: 'capacity',              desc: 'The fraction of actual positives that the model correctly identifies' },
      p_value:            { universal: 'evidence_threshold',    desc: 'The probability that a result as extreme as this occurred by chance' },
      confidence_interval:{ universal: 'acceptable_variance',  desc: 'The range within which the true value lies with a stated probability' },
      A_B_test:           { universal: 'systematic_review',     desc: 'Randomly assigning users to variants to measure causal effect' },
      dimensionality:     { universal: 'complexity_limit',      desc: 'The number of input variables a model must handle' },
      clustering:         { universal: 'aligned_group',         desc: 'Grouping data points by similarity without predefined categories' },
      pipeline:           { universal: 'automation_pipeline',   desc: 'A sequence of data transformations from raw input to model output' },
      ground_truth:       { universal: 'reality_anchor',        desc: 'The verified correct answer against which predictions are measured' },
      imputation:         { universal: 'corrective_action',     desc: 'Filling in missing data values using statistical inference' },
    },
  },
  proteus: {
    domain: 'Adaptive Strategy',
    concepts: {
      shapeshifting:      { universal: 'adaptation',            desc: 'Changing form to match the environment' },
      metamorphosis:      { universal: 'transformation',        desc: 'Fundamental change in nature, not just appearance' },
      emergence:          { universal: 'spontaneous_order',     desc: 'Complex behavior from simple rules' },
      resilience:         { universal: 'recovery_ability',      desc: 'Bouncing back from disruption' },
      antifragility:      { universal: 'growth_from_stress',    desc: 'Getting stronger from what tries to break you' },
      iteration:          { universal: 'cyclic_renewal',        desc: 'Repeating a process, improving each pass' },
      experimentation:    { universal: 'pre_commitment_audit',  desc: 'Testing assumptions before committing resources' },
      pivot:              { universal: 'strategy_change',       desc: 'Changing direction when evidence invalidates the current path' },
      feedback_loop:      { universal: 'adaptive_filter',       desc: 'A system that uses its own output to adjust future behavior' },
      optionality:        { universal: 'future_flexibility',    desc: 'Deliberately preserving the ability to change course' },
      mimicry:            { universal: 'adaptation',            desc: 'Adopting the successful patterns of others in a new context' },
      coevolution:        { universal: 'strategic_interaction', desc: 'Two systems each adapting in response to the other\'s adaptations' },
      polymorphism:       { universal: 'pattern_generalization', desc: 'One interface that can be satisfied by many different implementations' },
      modular:            { universal: 'composability',         desc: 'Built from interchangeable parts that can be swapped without rebuilding the whole' },
      horizon_scanning:   { universal: 'outcome_forecast',      desc: 'Systematically watching for emerging threats and opportunities' },
    },
  },
  artemis: {
    domain: 'Security & Threat Detection',
    concepts: {
      attack_surface:     { universal: 'vulnerability_area',    desc: 'Where you can be hurt' },
      reentrancy:         { universal: 'recursive_exploit',     desc: 'Calling back before the first call finishes' },
      frontrunning:       { universal: 'information_advantage', desc: 'Acting on knowledge before others can' },
      MEV:                { universal: 'extraction_rent',       desc: 'Profit from controlling transaction order' },
      circuit_breaker:    { universal: 'emergency_stop',        desc: 'Automated shutdown when things go wrong' },
      audit:              { universal: 'systematic_review',     desc: 'Methodical search for what could go wrong' },
      zero_day:           { universal: 'unknown_vulnerability', desc: 'A flaw nobody knows about yet' },
      threat_model:       { universal: 'outcome_forecast',      desc: 'Systematic enumeration of who might attack, how, and why' },
      least_privilege:    { universal: 'authority_boundary',    desc: 'Granting only the minimum permissions needed for a task' },
      defense_in_depth:   { universal: 'backup_capacity',       desc: 'Layered defenses so that defeating one layer is insufficient' },
      honeypot:           { universal: 'contextual_activation', desc: 'A decoy resource designed to attract and expose attackers' },
      sandboxing:         { universal: 'authority_boundary',    desc: 'Isolating untrusted code so it cannot affect the wider system' },
      cryptographic_proof:{ universal: 'integrity_proof',       desc: 'Mathematical evidence that data has not been altered' },
      key_rotation:       { universal: 'cyclic_renewal',        desc: 'Periodically replacing cryptographic keys to limit exposure' },
      slashing:           { universal: 'assigned_responsibility', desc: 'Penalizing validators for provably dishonest behavior' },
      sybil_resistance:   { universal: 'defensibility',         desc: 'Protection against an attacker creating many fake identities' },
      commit_reveal:      { universal: 'prior_commitment_lock', desc: 'Hiding choices until all parties have committed, then revealing together' },
      invariant_check:    { universal: 'unchanging_constraint', desc: 'Verifying that a system property always holds, even under attack' },
      rate_limiting:      { universal: 'capacity',              desc: 'Throttling request volume to prevent resource exhaustion attacks' },
      multisig:           { universal: 'evidence_threshold',    desc: 'Requiring multiple independent signers before an action executes' },
      timelock:           { universal: 'prerequisite_condition', desc: 'A mandatory delay between initiating and executing a privileged action' },
    },
  },
  anansi: {
    domain: 'Social & Community',
    concepts: {
      engagement:         { universal: 'attention_capture',     desc: 'Getting people to care and participate' },
      virality:           { universal: 'exponential_spread',    desc: 'Ideas that replicate through networks' },
      trust:              { universal: 'reliability_belief',    desc: 'Confidence that someone will do what they say' },
      narrative:          { universal: 'story',                 desc: 'The meaning people attach to events' },
      community:          { universal: 'aligned_group',         desc: 'People united by shared purpose' },
      governance:         { universal: 'collective_decision',   desc: 'How groups make choices together' },
      Shapley:            { universal: 'fair_attribution',      desc: "Measuring each person's true contribution" },
      reputation:         { universal: 'trust_score',           desc: 'Accumulated credibility from past behavior' },
      onboarding:         { universal: 'initiation_path',       desc: 'The journey from stranger to participant' },
      network_effect:     { universal: 'exponential_spread',    desc: 'Value increases as more people join' },
      ambassador:         { universal: 'cross_domain_link',     desc: 'A community member who represents the project in external spaces' },
      incentive_design:   { universal: 'strategic_interaction', desc: 'Structuring rewards so individual self-interest aligns with collective benefit' },
      moderation:         { universal: 'supervision',           desc: 'Managing community behavior against shared norms' },
      norms:              { universal: 'established_pattern',   desc: 'The unwritten rules that govern expected behavior in a community' },
      fork:               { universal: 'strategy_change',       desc: 'A schism where part of a community splits off under different rules' },
      airdrop:            { universal: 'initiation_path',       desc: 'Distributing tokens to bootstrap community participation' },
      dao:                { universal: 'collective_decision',   desc: 'A collectively owned organization governed by on-chain rules' },
      social_proof:       { universal: 'contextual_activation', desc: 'Others\' behavior as evidence of what is correct' },
      meme:               { universal: 'recurring_unit',        desc: 'A culturally replicating unit of meaning that spreads through communities' },
      tipping_point:      { universal: 'threshold_gating',      desc: 'The critical mass at which adoption becomes self-sustaining' },
      churn:              { universal: 'resource_exhaustion',   desc: 'The rate at which community members disengage and leave' },
    },
  },
  jarvis: {
    domain: 'General Reasoning',
    concepts: {
      context:            { universal: 'situational_state',     desc: "Everything relevant to this moment's decision" },
      memory:             { universal: 'persistent_state',      desc: 'Information that outlives a single session' },
      inference:          { universal: 'derived_conclusion',    desc: 'What we can reasonably conclude from evidence' },
      abstraction:        { universal: 'pattern_generalization', desc: 'The common shape beneath specific instances' },
      compression:        { universal: 'compress_context',      desc: 'Keeping the signal, dropping the noise' },
      grounding:          { universal: 'reality_anchor',        desc: 'Connecting abstract ideas to observable facts' },
      synthesis:          { universal: 'knowledge_fusion',      desc: 'Merging distinct ideas into a coherent whole' },
      primitive:          { universal: 'foundational_axiom',    desc: 'A truth so basic it cannot be derived from simpler things' },
      invariant:          { universal: 'unchanging_constraint', desc: 'A rule that holds regardless of context' },
      coordination:       { universal: 'collective_action',     desc: 'Multiple agents acting toward a shared goal' },
      hallucination:      { universal: 'belief_distortion',     desc: 'Generating plausible-sounding content that has no factual basis' },
      chain_of_thought:   { universal: 'derived_conclusion',    desc: 'Showing reasoning steps to arrive at a conclusion transparently' },
      temperature:        { universal: 'acceptable_variance',   desc: 'The parameter controlling randomness vs. determinism in generation' },
      token:              { universal: 'recurring_unit',        desc: 'The fundamental unit of text a language model processes' },
      prompt:             { universal: 'instruction',           desc: 'The input that directs a model\'s generation' },
      retrieval:          { universal: 'systematic_review',     desc: 'Fetching relevant stored knowledge to augment current reasoning' },
      embedding:          { universal: 'pattern_generalization', desc: 'Encoding meaning as a vector in high-dimensional space' },
      fine_tuning:        { universal: 'graduated_exposure',    desc: 'Updating model weights on domain-specific examples' },
      alignment:          { universal: 'direction_match',       desc: 'Ensuring model behavior matches intended values and goals' },
      emergent_behavior:  { universal: 'spontaneous_order',     desc: 'Capabilities that appear at scale not present in smaller models' },
      rate_limit:         { universal: 'capacity',              desc: 'A ceiling on how many tokens or requests can be processed per unit time' },
    },
  },

  // ── Human Domain Lexicons ────────────────────────────────────────────────────
  medicine: {
    domain: 'Medicine & Healthcare',
    concepts: {
      diagnosis:          { universal: 'systematic_review',     desc: 'Identifying what is wrong through structured evidence gathering' },
      prognosis:          { universal: 'outcome_forecast',      desc: 'Predicting the likely course of a condition over time' },
      etiology:           { universal: 'root_cause',            desc: 'The origin or underlying cause of a condition' },
      comorbidity:        { universal: 'coupled_risk',          desc: 'Two problems that tend to co-occur and amplify each other' },
      contraindication:   { universal: 'known_incompatibility', desc: 'A condition that makes a treatment harmful rather than helpful' },
      triage:             { universal: 'priority_under_constraint', desc: 'Sorting patients by urgency when resources are scarce' },
      prophylaxis:        { universal: 'preventive_action',     desc: 'Acting before harm occurs to prevent it' },
      remission:          { universal: 'temporary_recovery',    desc: 'Symptoms have retreated — not necessarily cured' },
      informed_consent:   { universal: 'voluntary_agreement',   desc: 'The person understands the stakes and freely says yes' },
      placebo:            { universal: 'expectation_effect',    desc: 'Improvement driven by belief rather than the treatment itself' },
      homeostasis:        { universal: 'stable_equilibrium',    desc: "The body's drive to maintain internal balance" },
      pathogen:           { universal: 'threat_actor',          desc: 'An agent that causes harm by entering and disrupting the system' },
      dose_response:      { universal: 'systematic_load_increase', desc: 'How effect magnitude changes as the quantity of a treatment increases' },
      clinical_trial:     { universal: 'systematic_review',     desc: 'A controlled study comparing treatment and control groups' },
      adverse_event:      { universal: 'anomaly',               desc: 'An unintended harmful outcome from a medical intervention' },
      chronic:            { universal: 'slow_permanent_drift',  desc: 'A condition that persists or recurs over a long period' },
      acute:              { universal: 'amplification_at_frequency', desc: 'A sudden, intense onset that demands immediate response' },
      immunity:           { universal: 'defensibility',         desc: 'The system\'s learned ability to resist a specific threat it has encountered before' },
      biomarker:          { universal: 'meaningful_pattern',    desc: 'A measurable indicator of a biological state or process' },
      differential:       { universal: 'constraint_choice',     desc: 'The list of possible diagnoses being simultaneously considered' },
      iatrogenic:         { universal: 'recursive_exploit',     desc: 'Harm caused by the medical treatment itself' },
    },
  },
  law: {
    domain: 'Law & Legal Reasoning',
    concepts: {
      precedent:          { universal: 'established_pattern',   desc: 'A prior decision that shapes how similar cases are decided' },
      jurisdiction:       { universal: 'authority_boundary',    desc: "The domain within which a rule-maker's rules apply" },
      liability:          { universal: 'assigned_responsibility', desc: 'Who bears the cost when something goes wrong' },
      tort:               { universal: 'civil_harm',            desc: 'A wrong that causes damage to another, outside of contract' },
      estoppel:           { universal: 'prior_commitment_lock', desc: 'You cannot contradict your past position to harm someone who relied on it' },
      remedy:             { universal: 'corrective_action',     desc: 'What the wronged party receives to make them whole' },
      discovery:          { universal: 'systematic_review',     desc: 'Compelled disclosure of evidence before trial' },
      standing:           { universal: 'right_to_participate',  desc: 'The threshold showing you have enough at stake to bring a claim' },
      burden_of_proof:    { universal: 'evidence_threshold',    desc: 'How much evidence the claimant must produce to win' },
      injunction:         { universal: 'emergency_stop',        desc: 'A court order to halt an action immediately' },
      due_diligence:      { universal: 'pre_commitment_audit',  desc: 'Thorough investigation before entering an agreement' },
      fiduciary:          { universal: 'trust_obligation',      desc: "A duty to act in another party's best interest above your own" },
      mens_rea:           { universal: 'core_hypothesis',       desc: 'The mental intent required for an act to constitute a crime' },
      proximate_cause:    { universal: 'root_cause',            desc: 'The direct and foreseeable cause legally responsible for an outcome' },
      damages:            { universal: 'opportunity_cost',      desc: 'Financial compensation for harm suffered' },
      statute_of_limitations: { universal: 'acceptable_variance', desc: 'The maximum time allowed after an event to bring a legal claim' },
      contract:           { universal: 'voluntary_agreement',   desc: 'A binding exchange of promises enforceable by law' },
      indemnity:          { universal: 'backup_capacity',       desc: 'A promise to bear another party\'s losses in specified circumstances' },
      subrogation:        { universal: 'assigned_responsibility', desc: 'An insurer\'s right to pursue a third party after compensating the insured' },
      class_action:       { universal: 'collective_action',     desc: 'A suit brought by many plaintiffs with similar claims as a single proceeding' },
      arbitration:        { universal: 'upward_delegation',     desc: 'Binding dispute resolution outside the court system' },
    },
  },
  engineering: {
    domain: 'Structural & Mechanical Engineering',
    concepts: {
      tolerance:          { universal: 'acceptable_variance',   desc: 'How much deviation from spec is allowed before failure' },
      load_bearing:       { universal: 'critical_dependency',   desc: 'A component whose failure brings down the whole structure' },
      shear_stress:       { universal: 'lateral_pressure',      desc: 'Force applied parallel to a surface — the sliding kind of failure' },
      fatigue:            { universal: 'accumulated_degradation', desc: 'Failure from repeated stress below the single-event limit' },
      thermal_expansion:  { universal: 'environment_induced_drift', desc: 'Change in dimensions caused by change in ambient conditions' },
      yield_strength:     { universal: 'elastic_limit',         desc: 'The point past which deformation becomes permanent' },
      redundancy:         { universal: 'backup_capacity',       desc: "Parallel systems so one failure doesn't cause total collapse" },
      tensile_strength:   { universal: 'maximum_load',          desc: 'The most stress a material can take before breaking' },
      safety_factor:      { universal: 'margin_of_safety',      desc: 'Building to handle more stress than you expect to see' },
      resonance:          { universal: 'amplification_at_frequency', desc: 'When external rhythm matches internal rhythm and energy builds dangerously' },
      creep:              { universal: 'slow_permanent_drift',  desc: 'Gradual deformation under sustained load over time' },
      buckling:           { universal: 'elastic_limit',         desc: 'Sudden collapse of a slender element under compressive load' },
      moment:             { universal: 'cascade_effect',        desc: 'A rotational force applied at a distance from a pivot point' },
      stiffness:          { universal: 'defensibility',         desc: 'Resistance to deformation per unit of applied force' },
      ductility:          { universal: 'growth_from_stress',    desc: 'The ability to deform significantly before fracture — absorbing energy' },
      stress_concentration:{ universal: 'vulnerability_area',  desc: 'A location where stress is locally elevated due to geometry' },
      modulus:            { universal: 'unchanging_constraint', desc: 'A material property relating stress to strain — its stiffness constant' },
      preload:            { universal: 'preventive_action',     desc: 'A deliberate initial stress applied to improve performance under working loads' },
      modal_analysis:     { universal: 'adaptive_filter',       desc: 'Identifying the natural frequencies at which a structure will resonate' },
      proof_test:         { universal: 'systematic_review',     desc: 'Loading a structure to a specified level to verify it meets requirements' },
    },
  },
  education: {
    domain: 'Education & Pedagogy',
    concepts: {
      scaffolding:        { universal: 'structured_support',    desc: "Temporary structure enabling work the learner can't yet do alone" },
      rubric:             { universal: 'evaluation_framework',  desc: 'Explicit criteria that make assessment transparent and consistent' },
      differentiation:    { universal: 'adaptive_delivery',     desc: 'Adjusting approach for different learners rather than one-size-fits-all' },
      formative_assessment:{ universal: 'in_progress_feedback', desc: 'Checking understanding while learning is happening, not after' },
      bloom_taxonomy:     { universal: 'capability_hierarchy',  desc: 'The ladder from remembering facts to creating new knowledge' },
      pedagogy:           { universal: 'transmission_method',   desc: 'The theory and practice of how knowledge is passed from one to another' },
      metacognition:      { universal: 'thinking_about_thinking', desc: "Awareness of one's own reasoning process" },
      zone_of_proximal_development: { universal: 'growth_edge', desc: 'What you can do with help but not yet alone — the sweet spot for learning' },
      mastery_learning:   { universal: 'threshold_gating',      desc: 'Requiring demonstrated competence before advancing to the next level' },
      transfer:           { universal: 'concept_portability',   desc: 'Applying knowledge from one domain to solve problems in another' },
      inquiry_based:      { universal: 'pre_commitment_audit',  desc: 'Learning through questions and exploration rather than direct instruction' },
      summative_assessment: { universal: 'systematic_review',   desc: 'A final evaluation of what was learned over a period' },
      curriculum:         { universal: 'established_pattern',   desc: 'The planned sequence of learning experiences over time' },
      active_learning:    { universal: 'attention_capture',     desc: 'Engaging learners in doing and thinking rather than passive receiving' },
      spaced_repetition:  { universal: 'cyclic_renewal',        desc: 'Reviewing material at increasing intervals to strengthen long-term memory' },
      prior_knowledge:    { universal: 'persistent_state',      desc: 'What a learner already knows, which shapes how new information is encoded' },
      peer_learning:      { universal: 'knowledge_fusion',      desc: 'Learning that occurs through interaction with fellow learners' },
      feedback_loop:      { universal: 'adaptive_filter',       desc: 'The cycle of performance, assessment, and adjustment' },
      growth_mindset:     { universal: 'growth_from_stress',    desc: 'The belief that ability can be developed through effort and strategy' },
      cognitive_load:     { universal: 'capacity',              desc: 'The total mental effort being used in working memory at one time' },
    },
  },
  music: {
    domain: 'Music & Sound',
    concepts: {
      harmony:            { universal: 'consistency',           desc: 'Notes that support each other — frequencies that feel right together' },
      dissonance:         { universal: 'productive_tension',    desc: 'Friction that demands resolution — the useful kind of wrong' },
      resolution:         { universal: 'tension_release',       desc: 'The move from instability back to a stable state' },
      counterpoint:       { universal: 'independent_parallel_lines', desc: 'Two voices moving independently but creating something coherent together' },
      timbre:             { universal: 'identity_signature',    desc: 'The quality that makes a sound recognizable as itself — its fingerprint' },
      cadence:            { universal: 'rhythmic_closure',      desc: 'A sequence that signals an ending or resting point' },
      syncopation:        { universal: 'unexpected_emphasis',   desc: "Placing stress where the pattern doesn't expect it" },
      motif:              { universal: 'recurring_unit',        desc: 'A small pattern that repeats and builds meaning through repetition' },
      dynamics:           { universal: 'intensity_modulation',  desc: 'Variation in force or volume to create expression' },
      tempo:              { universal: 'execution_rate',        desc: 'The speed at which events unfold' },
      key:                { universal: 'operating_context',     desc: 'The tonal home base that gives all other notes their meaning' },
      modulation:         { universal: 'strategy_change',       desc: 'Moving from one key to another — a shift in the operating context' },
      arrangement:        { universal: 'structured_support',    desc: 'How different instruments are assigned roles to serve the whole' },
      chord_progression:  { universal: 'established_pattern',   desc: 'A sequence of chords that creates expectation and movement' },
      improvisation:      { universal: 'constraint_innovation', desc: 'Creating in real time within a framework, without a fixed plan' },
      voice_leading:      { universal: 'movement_through_space', desc: 'The smooth movement of individual voices between chords' },
      phrase:             { universal: 'recurring_unit',        desc: 'A musical sentence — a unit of melodic or harmonic thought' },
      tension:            { universal: 'productive_tension',    desc: 'A state of instability that creates forward motion toward resolution' },
      groove:             { universal: 'stable_equilibrium',    desc: 'A rhythmic feel that creates momentum and makes listeners want to move' },
      texture:            { universal: 'complexity_limit',      desc: 'The density and interplay of musical lines at any moment' },
      call_and_response:  { universal: 'strategic_interaction', desc: 'A musical dialogue where one phrase is answered by another' },
    },
  },
  agriculture: {
    domain: 'Agriculture & Land Stewardship',
    concepts: {
      yield:              { universal: 'return_rate',           desc: 'Output per unit of input — what the land gives back' },
      rotation:           { universal: 'cyclic_renewal',        desc: 'Changing what occupies a space to restore what the previous use depleted' },
      soil_health:        { universal: 'substrate_quality',     desc: 'The underlying conditions that determine what can grow on top' },
      grafting:           { universal: 'capability_merger',     desc: 'Joining two organisms so one provides roots, the other provides fruit' },
      vernalization:      { universal: 'prerequisite_condition', desc: 'A cold period that must be experienced before flowering capability unlocks' },
      IPM:                { universal: 'priority_under_constraint', desc: 'Managing pests through least-invasive means first — escalating only as needed' },
      terroir:            { universal: 'context_fingerprint',   desc: 'How the specific place something comes from is inseparable from what it is' },
      fallow:             { universal: 'intentional_rest',      desc: 'Leaving a resource idle to let it recover and regenerate' },
      companion_planting: { universal: 'mutualistic_co_location', desc: 'Placing complementary things together so each helps the other thrive' },
      hardening_off:      { universal: 'graduated_exposure',    desc: 'Slowly introducing stress to build tolerance before full deployment' },
      irrigation:         { universal: 'resource_availability', desc: 'Delivering water to where it is needed when natural supply is insufficient' },
      composting:         { universal: 'cyclic_renewal',        desc: 'Transforming organic waste into nutrient-rich material for future growth' },
      monoculture:        { universal: 'critical_dependency',   desc: 'Growing a single crop at scale — efficient but fragile to disease' },
      polyculture:        { universal: 'backup_capacity',       desc: 'Growing multiple crops together to reduce risk and support diversity' },
      succession:         { universal: 'capability_hierarchy',  desc: 'The natural sequence by which an ecosystem changes over time' },
      nutrient_cycle:     { universal: 'cyclic_renewal',        desc: 'The movement and transformation of nutrients through soil, plants, and back' },
      seed_saving:        { universal: 'persistent_state',      desc: 'Preserving genetic potential from this harvest for future seasons' },
      phenology:          { universal: 'adaptive_filter',       desc: 'The study of how seasonal timing affects plant and animal development' },
      mycorrhizae:        { universal: 'cross_domain_link',     desc: 'Fungal networks that connect plants underground, facilitating nutrient exchange' },
      cover_crop:         { universal: 'preventive_action',     desc: 'Growing plants specifically to protect and enrich the soil between main crops' },
    },
  },

  // ── New Domain Lexicons ──────────────────────────────────────────────────────
  psychology: {
    domain: 'Psychology & Cognitive Science',
    concepts: {
      cognitive_bias:         { universal: 'belief_distortion',          desc: 'A systematic error in how the mind processes or weights information' },
      conditioning:           { universal: 'stimulus_response',           desc: 'Learned associations between stimuli and responses through repeated pairings' },
      projection:             { universal: 'internal_attribution',        desc: 'Attributing one\'s own unacknowledged feelings to another person' },
      transference:           { universal: 'unconscious_transfer',        desc: 'Redirecting emotions about one person onto someone new' },
      schema:                 { universal: 'mental_model',                desc: 'A cognitive framework for organizing and interpreting information' },
      dissociation:           { universal: 'reality_fragmentation',       desc: 'A disconnection between thoughts, feelings, and sense of identity' },
      attachment:             { universal: 'relational_bond',             desc: 'The deep emotional bond between individuals that shapes development' },
      metacognition:          { universal: 'thinking_about_thinking',     desc: 'Awareness and regulation of one\'s own thought processes' },
      flow_state:             { universal: 'performance_zone',            desc: 'Complete absorption in a task where skill perfectly meets challenge' },
      rumination:             { universal: 'ruminative_loop',             desc: 'Repetitively thinking about distressing events without resolution' },
      ego_depletion:          { universal: 'willpower_depletion',         desc: 'Reduced self-control after sustained use of willpower' },
      learned_helplessness:   { universal: 'acquired_helplessness',       desc: 'Failure to act because past experience taught that action is futile' },
      self_efficacy:          { universal: 'capability_belief',           desc: 'Belief in one\'s ability to succeed at a specific task' },
      priming:                { universal: 'contextual_activation',       desc: 'Earlier exposure to a stimulus influences how a later stimulus is perceived' },
      anchoring:              { universal: 'reference_point_bias',        desc: 'Over-relying on the first piece of information encountered' },
      confirmation_bias:      { universal: 'expectation_confirmation',    desc: 'Seeking evidence that confirms existing beliefs while ignoring contradictions' },
      framing_effect:         { universal: 'narrative_framing',           desc: 'The same information leads to different choices depending on how it is presented' },
      dunning_kruger:         { universal: 'competence_miscalibration',   desc: 'Low-skill individuals overestimate their competence; experts underestimate theirs' },
      peak_end_rule:          { universal: 'retrospective_peak_weighting', desc: 'People judge experiences by the peak moment and the end, not the average' },
      hedonic_adaptation:     { universal: 'hedonic_baseline_return',     desc: 'Emotional responses to events fade as people return to a baseline happiness' },
      locus_of_control:       { universal: 'capability_belief',           desc: 'The degree to which one believes their outcomes are self-determined' },
      cognitive_dissonance:   { universal: 'productive_tension',          desc: 'The discomfort of holding conflicting beliefs, motivating resolution' },
      intrinsic_motivation:   { universal: 'initiation_path',             desc: 'Drive that comes from internal interest rather than external reward' },
      social_proof:           { universal: 'contextual_activation',       desc: 'Using others\' behavior as a heuristic for correct action' },
      sunk_cost_fallacy:      { universal: 'prior_commitment_lock',       desc: 'Continuing a failing course because of past investment rather than future return' },
      availability_heuristic: { universal: 'belief_distortion',           desc: 'Estimating likelihood based on how easily an example comes to mind' },
      loss_aversion:          { universal: 'acceptable_variance',         desc: 'Losses feel roughly twice as painful as equivalent gains feel pleasurable' },
    },
  },
  philosophy: {
    domain: 'Philosophy & Metaphysics',
    concepts: {
      epistemology:           { universal: 'knowledge_theory',            desc: 'The study of what knowledge is, how it is acquired, and its limits' },
      ontology:               { universal: 'existence_theory',            desc: 'The study of what exists and what categories of being there are' },
      axiom:                  { universal: 'foundational_axiom',          desc: 'A self-evident starting proposition accepted without proof' },
      tautology:              { universal: 'circular_necessity',          desc: 'A statement true by definition in all possible cases' },
      dialectic:              { universal: 'thesis_antithesis',           desc: 'A method of arriving at truth through the clash of opposing positions' },
      reductionism:           { universal: 'bottom_up_explanation',       desc: 'Explaining complex phenomena by analyzing simpler component parts' },
      emergence:              { universal: 'spontaneous_order',           desc: 'Properties that arise from interaction of parts that none possess individually' },
      determinism:            { universal: 'causal_necessity',            desc: 'Every event follows necessarily from prior causes — no true randomness' },
      free_will:              { universal: 'originating_agency',          desc: 'The capacity to act in ways not fully determined by prior causes' },
      qualia:                 { universal: 'subjective_experience',       desc: 'The raw felt quality of conscious experience — the redness of red' },
      solipsism:              { universal: 'radical_solitude',            desc: 'The view that only one\'s own mind can be known to exist with certainty' },
      pragmatism:             { universal: 'experience_primacy',          desc: 'Truth is what works in practice — ideas are tools, not pictures of reality' },
      utilitarianism:         { universal: 'consequence_ethics',          desc: 'The morally right action is the one that maximizes total well-being' },
      categorical_imperative: { universal: 'universal_duty',             desc: 'Act only according to rules you could universalize for all rational agents' },
      social_contract:        { universal: 'mutual_obligation',           desc: 'An implicit agreement to surrender some freedoms for collective security' },
      veil_of_ignorance:      { universal: 'veil_reasoning',              desc: 'Choosing fair rules from behind ignorance of one\'s own position in society' },
      Occam_razor:            { universal: 'compress_context',            desc: 'Among competing explanations, prefer the one requiring fewest assumptions' },
      falsifiability:         { universal: 'evidence_threshold',          desc: 'A claim is scientific only if it could in principle be proven wrong' },
      phenomenology:          { universal: 'subjective_experience',       desc: 'The philosophical study of the structure of conscious experience' },
      nihilism:               { universal: 'reality_fragmentation',       desc: 'The view that life has no objective meaning, purpose, or intrinsic value' },
      absurdism:              { universal: 'productive_tension',          desc: 'Embracing the conflict between the human need for meaning and the universe\'s silence' },
      stoicism:               { universal: 'stable_equilibrium',          desc: 'Maintaining equanimity by focusing only on what one can control' },
      paradigm_shift:         { universal: 'strategy_change',             desc: 'A fundamental change in the basic assumptions of a field of inquiry' },
    },
  },
  military: {
    domain: 'Military Strategy & Conflict Theory',
    concepts: {
      flanking:           { universal: 'flank_maneuver',              desc: 'Attacking from the side or rear where defenses are weakest' },
      attrition:          { universal: 'resource_exhaustion',         desc: 'Winning by depleting the enemy\'s capacity faster than your own' },
      deterrence:         { universal: 'mutual_destruction_threat',   desc: 'Preventing aggression by making the cost of attack unacceptable' },
      escalation_dominance: { universal: 'escalation_control',        desc: 'The ability to raise the stakes at every level faster than the adversary' },
      force_multiplier:   { universal: 'capability_amplifier',        desc: 'An asset that multiplies the combat effectiveness of friendly forces' },
      center_of_gravity:  { universal: 'decisive_point',              desc: 'The source of moral or physical strength from which everything else derives' },
      OODA_loop:          { universal: 'observe_orient_decide_act',   desc: 'The cognitive cycle for outpacing an opponent\'s decision-making' },
      fog_of_war:         { universal: 'uncertainty_field',           desc: 'The irreducible uncertainty present in all real-world conflict' },
      asymmetric_warfare: { universal: 'asymmetric_tactics',          desc: 'Unconventional tactics used by a weaker force against a stronger one' },
      hearts_and_minds:   { universal: 'population_support',          desc: 'Securing popular loyalty as the decisive strategic objective' },
      interior_lines:     { universal: 'interior_lines',              desc: 'Fighting from a central position to shift forces faster than the enemy' },
      combined_arms:      { universal: 'combined_arms',               desc: 'Integrating infantry, armor, artillery, and air to exploit each other\'s strengths' },
      suppression:        { universal: 'suppression_fire',            desc: 'Keeping the enemy pinned and unable to maneuver effectively' },
      reserve:            { universal: 'strategic_reserve',           desc: 'Forces held back to exploit breakthrough or respond to surprise' },
      OPSEC:              { universal: 'operational_security',        desc: 'Protecting one\'s own plans and capabilities from adversary intelligence' },
      logistics:          { universal: 'resource_availability',       desc: 'The science of moving and sustaining forces — armies travel on their stomachs' },
      reconnaissance:     { universal: 'systematic_review',           desc: 'Intelligence-gathering ahead of a decision or operation' },
      envelopment:        { universal: 'flank_maneuver',              desc: 'Surrounding an enemy force by attacking from multiple directions' },
      consolidation:      { universal: 'stable_equilibrium',          desc: 'Securing gained territory and preparing for the next phase of advance' },
      feint:              { universal: 'contextual_activation',       desc: 'A deceptive action designed to draw attention away from the real attack' },
      troop_morale:       { universal: 'capability_belief',           desc: 'The collective confidence and will of a fighting force to continue' },
    },
  },
  cooking: {
    domain: 'Culinary Arts & Food Science',
    concepts: {
      mise_en_place:      { universal: 'preparation_readiness',         desc: 'Everything measured, cut, and arranged before cooking begins' },
      reduction:          { universal: 'concentration_by_evaporation',  desc: 'Simmering liquid to drive off water and intensify flavor' },
      emulsification:     { universal: 'stable_mixture',               desc: 'Combining fat and water into a stable uniform mixture' },
      maillard_reaction:  { universal: 'thermal_browning',             desc: 'The browning reaction between amino acids and sugars that creates deep flavor' },
      deglazing:          { universal: 'pan_deglaze',                  desc: 'Adding liquid to a hot pan to dissolve the caramelized browned bits' },
      tempering:          { universal: 'controlled_crystallization',    desc: 'Carefully heating and cooling chocolate to achieve a stable crystal structure' },
      proofing:           { universal: 'biological_leavening',         desc: 'Allowing yeast to produce gas that causes dough to rise' },
      fond:               { universal: 'caramelized_residue',          desc: 'The flavorful brown bits stuck to a pan after cooking protein' },
      mother_sauce:       { universal: 'foundational_sauce',           desc: 'One of five base sauces from which dozens of derivative sauces are built' },
      umami:              { universal: 'fifth_taste',                  desc: 'The savory, satisfying taste sensation from glutamates — the fifth taste' },
      seasoning:          { universal: 'intensity_modulation',         desc: 'Adding salt, acid, or other seasonings to balance and amplify flavor' },
      resting:            { universal: 'rest_period',                  desc: 'Letting cooked meat sit so juices redistribute throughout' },
      maceration:         { universal: 'graduated_exposure',           desc: 'Softening a solid by soaking it in liquid over time' },
      blanching:          { universal: 'preventive_action',            desc: 'Brief boiling followed by ice bath to set color and stop enzyme activity' },
      marination:         { universal: 'contextual_activation',        desc: 'Soaking protein in a seasoned liquid to flavor and tenderize before cooking' },
      emulsion:           { universal: 'stable_mixture',               desc: 'A stable dispersion of one liquid in another — mayo, hollandaise' },
      caramelization:     { universal: 'thermal_browning',             desc: 'The oxidation of sugar when heated, producing complex sweet flavors' },
      brining:            { universal: 'graduated_exposure',           desc: 'Soaking in saltwater to improve moisture retention during cooking' },
      layering_flavors:   { universal: 'flavor_layering',             desc: 'Building depth by adding aromatics, fond, acids, and finish at different stages' },
      knife_skills:       { universal: 'procedural_automaticity',      desc: 'The automatic, precise execution of cutting techniques built through practice' },
      heat_control:       { universal: 'heat_management',              desc: 'Adjusting flame or oven temperature to achieve the right texture and doneness' },
    },
  },
  sports: {
    domain: 'Sports, Athletics & Performance',
    concepts: {
      periodization:      { universal: 'training_periodization',     desc: 'Structuring training cycles of varying intensity to peak for competition' },
      progressive_overload: { universal: 'systematic_load_increase', desc: 'Gradually increasing training stress to force adaptation' },
      recovery:           { universal: 'active_restoration',         desc: 'Deliberate rest and repair work between training loads' },
      form:               { universal: 'movement_mechanics',         desc: 'The correct technical execution of a physical movement' },
      plateau:            { universal: 'adaptation_stall',           desc: 'A point where further improvement stops without a new stimulus' },
      peak_performance:   { universal: 'optimal_output',             desc: 'The highest level of output achievable by an athlete under competition conditions' },
      mental_toughness:   { universal: 'adversity_resilience',       desc: 'The capacity to maintain composure and effort when conditions are difficult' },
      muscle_memory:      { universal: 'procedural_automaticity',    desc: 'Skills so rehearsed they execute automatically without conscious control' },
      tapering:           { universal: 'pre_competition_unload',     desc: 'Reducing training volume before competition to allow full recovery' },
      cross_training:     { universal: 'concurrent_training',        desc: 'Using a secondary sport or modality to complement primary training' },
      specificity:        { universal: 'sport_specificity',          desc: 'Adapting to exactly what you train — train what you want to improve' },
      readiness:          { universal: 'competition_readiness',      desc: 'Being physically and mentally prepared to perform at full capacity' },
      RPE:                { universal: 'intensity_modulation',       desc: 'Rating of perceived exertion — subjective measure of how hard a session feels' },
      VO2_max:            { universal: 'maximum_load',               desc: 'Maximum rate of oxygen consumption — ceiling of aerobic capacity' },
      lactate_threshold:  { universal: 'elastic_limit',              desc: 'The intensity at which lactate begins to accumulate faster than it clears' },
      deload:             { universal: 'intentional_rest',           desc: 'A planned reduction in training load to allow accumulated fatigue to dissipate' },
      biomechanics:       { universal: 'movement_mechanics',         desc: 'The mechanics of the human body in motion' },
      sport_psychology:   { universal: 'mental_model',               desc: 'The mental skills and strategies that optimize competitive performance' },
      strength_deficit:   { universal: 'gap_cost',                   desc: 'The gap between eccentric and concentric strength — indicates injury risk' },
      competition_prep:   { universal: 'preparation_readiness',      desc: 'The complete physical and logistical preparation process before competition' },
    },
  },
  architecture: {
    domain: 'Architecture & Built Environment',
    concepts: {
      load_path:          { universal: 'load_transfer_path',         desc: 'The route forces travel from application point to the ground' },
      cantilever:         { universal: 'projecting_overhang',        desc: 'A beam or slab supported only at one end, projecting into space' },
      facade:             { universal: 'building_face',              desc: 'The exterior face of a building — its public presentation' },
      fenestration:       { universal: 'window_placement',           desc: 'The arrangement of windows and openings in a building envelope' },
      vernacular:         { universal: 'place_responsive_design',    desc: 'Architecture that uses local materials and responds to local climate and tradition' },
      adaptive_reuse:     { universal: 'repurpose_existing',         desc: 'Converting a building from its original use to a new purpose' },
      setback:            { universal: 'regulatory_distance',        desc: 'Required minimum distance between building and property boundary' },
      datum:              { universal: 'reference_plane',            desc: 'A shared plane or line that organizes and relates all elements' },
      threshold:          { universal: 'liminal_crossing',           desc: 'A physical or symbolic boundary marking transition between inside and outside' },
      circulation:        { universal: 'movement_through_space',     desc: 'The paths through which occupants move in a building' },
      compression:        { universal: 'spatial_compression',        desc: 'A tight spatial moment that makes subsequent expansive spaces feel larger' },
      tectonic:           { universal: 'material_honesty',           desc: 'Expressing structure and construction honestly in the finished form' },
      light_well:         { universal: 'light_as_material',          desc: 'An opening designed to bring natural light into deep interior spaces' },
      program:            { universal: 'program',                    desc: 'The set of uses a building must accommodate' },
      genius_loci:        { universal: 'genius_loci',                desc: 'The distinctive spirit or character of a place' },
      section:            { universal: 'cross_domain_link',          desc: 'A cut through a building revealing the interior spatial relationships' },
      parti:              { universal: 'core_hypothesis',            desc: 'The central concept or organizing idea of a design — its thesis' },
      massing:            { universal: 'pattern_generalization',     desc: 'The three-dimensional volume and form of a building before detail' },
      envelope:           { universal: 'authority_boundary',         desc: 'The outer skin of a building separating interior from exterior environment' },
      program_adjacency:  { universal: 'mutualistic_co_location',    desc: 'Positioning related uses next to each other for synergy and efficiency' },
      structural_grid:    { universal: 'established_pattern',        desc: 'A regular array of columns and beams that organizes building structure' },
    },
  },
  journalism: {
    domain: 'Journalism & Media',
    concepts: {
      lede:               { universal: 'story_opening',            desc: 'The critical opening paragraph that delivers the essential fact and hooks the reader' },
      attribution:        { universal: 'source_credit',            desc: 'Identifying who said something so readers can evaluate the source' },
      inverted_pyramid:   { universal: 'importance_first',         desc: 'Structuring stories with the most important information first' },
      beat:               { universal: 'coverage_territory',       desc: 'The specific topic or institution a reporter is assigned to cover' },
      source_protection:  { universal: 'source_anonymity',         desc: 'The ethical obligation to protect identities of confidential sources' },
      editorial_independence: { universal: 'institutional_independence', desc: 'Freedom from outside pressure over what to publish' },
      fact_check:         { universal: 'claim_verification',       desc: 'Confirming claims against primary sources before publication' },
      masthead:           { universal: 'publication_identity',     desc: 'The section listing a publication\'s ownership, leadership, and principles' },
      byline:             { universal: 'story_ownership',          desc: 'The reporter\'s name attached to a story they wrote' },
      correction:         { universal: 'public_record_update',     desc: 'A published acknowledgment and fix for a factual error' },
      news_judgment:      { universal: 'news_judgment',            desc: 'Editorial decisions about what is worth reporting and at what prominence' },
      interview:          { universal: 'interview_technique',      desc: 'A structured conversation designed to elicit information' },
      background:         { universal: 'background_information',   desc: 'Information for context that may not be directly quoted' },
      embargo:            { universal: 'embargo',                  desc: 'Agreement to hold publication until a specified time' },
      off_the_record:     { universal: 'off_the_record',           desc: 'Information shared that cannot be published in attributed form' },
      dateline:           { universal: 'context_fingerprint',      desc: 'The location and date stamp that grounds a story in time and place' },
      scoop:              { universal: 'information_advantage',    desc: 'Publishing a story before any competitor — the competitive win in journalism' },
      editorial:          { universal: 'core_hypothesis',          desc: 'An opinion piece arguing for a specific interpretation or course of action' },
      objectivity:        { universal: 'reality_anchor',           desc: 'Grounding reporting in verifiable facts rather than opinion or advocacy' },
      source:             { universal: 'trust_score',              desc: 'The person who provides information — credibility varies by track record' },
      headline:           { universal: 'compress_context',         desc: 'The compressed summary that must capture the story\'s essence in few words' },
    },
  },
  trading: {
    domain: 'Trading & Market Microstructure',
    concepts: {
      support:            { universal: 'price_floor',               desc: 'A price level where historical buying has halted decline' },
      resistance:         { universal: 'price_ceiling',             desc: 'A price level where historical selling has halted advance' },
      breakout:           { universal: 'range_expansion',           desc: 'A decisive move above resistance or below support, often with volume confirmation' },
      consolidation:      { universal: 'range_compression',         desc: 'A period of contracting price range before a directional move' },
      divergence:         { universal: 'indicator_divergence',      desc: 'Price makes a new high but momentum indicator does not — a warning sign' },
      momentum:           { universal: 'directional_strength',      desc: 'The rate of change of price — trend acceleration or deceleration' },
      mean_reversion:     { universal: 'statistical_reversion',     desc: 'The tendency of prices to return toward their long-run average' },
      vol_smile:          { universal: 'implied_vol_surface',       desc: 'The pattern of implied volatility varying across option strikes' },
      gamma_exposure:     { universal: 'dealer_hedging_pressure',   desc: 'The net options gamma held by dealers, which forces directional hedging' },
      order_flow:         { universal: 'transaction_flow_data',     desc: 'The real-time data showing buy and sell intentions of market participants' },
      trend_following:    { universal: 'trend_following',           desc: 'Entering positions aligned with established price direction' },
      fade:               { universal: 'contrarian_entry',          desc: 'Trading against an extended move expecting reversion' },
      position_sizing:    { universal: 'position_sizing',           desc: 'Allocating capital to a trade proportional to conviction and risk tolerance' },
      risk_reward:        { universal: 'risk_reward',               desc: 'The ratio of potential profit to potential loss on a given trade' },
      stop_loss:          { universal: 'stop_loss',                 desc: 'A predefined price at which a losing position is exited to cap loss' },
      liquidity:          { universal: 'resource_availability',     desc: 'The ease with which a position can be entered or exited without price impact' },
      spread:             { universal: 'gap_cost',                  desc: 'The difference between bid and ask — the cost of immediacy' },
      slippage:           { universal: 'acceptable_variance',       desc: 'The difference between expected and actual execution price' },
      volume:             { universal: 'committed_resources',       desc: 'The number of units traded — confirms or questions the conviction behind a move' },
      volatility:         { universal: 'acceptable_variance',       desc: 'The statistical measure of price fluctuation over a period' },
      carry:              { universal: 'return_rate',               desc: 'The yield earned by holding a position — cost of carry when negative' },
      alpha:              { universal: 'information_advantage',     desc: 'Returns in excess of a benchmark, attributable to skill rather than market exposure' },
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

// ============ Concept Explorer ============

/**
 * Return the top N universal concepts ranked by how many distinct lexicons
 * map at least one term to them.  Each entry includes every term that maps
 * to that concept across all registered lexicons (agent + user).
 *
 * @param {number} n - How many concepts to return (default 30)
 * @returns {Array<{
 *   universal: string,
 *   definition: string,
 *   lexiconCount: number,
 *   mappings: Array<{ lexiconId: string, term: string, desc: string }>
 * }>}
 */
export function getTopConnectedConcepts(n = 30) {
  const idx = getIndex()

  const results = []

  for (const [universal, entries] of Object.entries(idx)) {
    // Deduplicate by lexicon — count distinct lexicons
    const lexiconSet = new Set(entries.map(e => e.agent))

    results.push({
      universal,
      definition: EXTENDED_UNIVERSAL_CONCEPTS[universal] || '',
      lexiconCount: lexiconSet.size,
      mappings: entries.map(e => ({
        lexiconId: e.agent,
        term: e.term,
        desc: e.desc,
      })),
    })
  }

  // Sort by lexicon coverage desc, then alphabetically as tie-break
  results.sort((a, b) => {
    if (b.lexiconCount !== a.lexiconCount) return b.lexiconCount - a.lexiconCount
    return a.universal.localeCompare(b.universal)
  })

  return results.slice(0, n)
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
