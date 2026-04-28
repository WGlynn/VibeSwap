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

  // Ecology
  ecosystem_health:          'The overall vitality and self-sustaining capacity of an interconnected community',
  directional_succession:    'The predictable sequence of changes a system moves through over time toward maturity',
  specialized_role:          'The unique functional position an entity occupies within a larger system',
  disproportionate_influence:'The property of a single element whose removal collapses the broader network',
  population_ceiling:        'The maximum number of entities an environment can support indefinitely',
  cross_tier_amplification:  'A change at one level of a hierarchy that propagates and amplifies through other levels',
  variety_buffer:            'The protection against systemic collapse provided by many distinct functional types',
  competitive_displacement:  'When a newly introduced entity outcompetes established ones by exploiting the same niche',
  trophic_level:             'A position in the energy transfer hierarchy from producers to apex consumers',
  habitat_fragmentation:     'Dividing a continuous environment into isolated patches that reduce system resilience',

  // Astronomy
  recessional_redshift:      'The stretching of signal wavelength indicating a source is moving away or space is expanding',
  angular_distance_measure:  'Using the apparent shift of a nearby object against a distant background to measure its distance',
  gravitational_inflow:      'The process by which matter is drawn inward and accumulated around a massive center',
  point_of_no_return:        'A boundary beyond which escape from a dominant force is impossible',
  stable_fusion_phase:       'The long equilibrium period when a system fuses input to produce steady energy output',
  catastrophic_collapse:     'A sudden, energetic end-state following the exhaustion of sustaining fuel',
  hidden_mass_effect:        'The inferred presence of unseen components from their observable gravitational effects',
  primordial_expansion:      'The rapid initial scaling that set the large-scale structure of a system',
  stellar_classification:    'Grouping objects by shared physical characteristics that predict their behavior',
  orbital_resonance:         'A stable relationship where periodic cycles lock into integer ratios through mutual influence',

  // Linguistics
  minimal_unit:              'The smallest discrete element that carries meaning or function in a system',
  structural_arrangement:    'The rules governing how elements are ordered and combined to produce valid output',
  contextual_meaning:        'The layer of meaning derived from situational context beyond literal content',
  use_in_context:            'How meaning is negotiated through actual use rather than abstract definition',
  atomic_sound_unit:         'The smallest sound distinction that can change the meaning of an utterance',
  contact_hybrid:            'A simplified shared system that emerges when two groups must communicate across a language barrier',
  nativized_contact_language:'A contact system that has been adopted as a first language, gaining full complexity',
  register_switching:        'Adapting communication style and vocabulary to fit the social context or audience',
  layered_language_situation:'A community using different language varieties for different social functions',
  semantic_drift:            'The gradual shift in a term\'s meaning over time through accumulated usage patterns',

  // Film / Cinema
  spatial_composition:       'The deliberate arrangement of all visual elements within a frame to create meaning',
  juxtaposition_edit:        'Cutting between shots to create meaning from their collision, not their continuity',
  source_attribution_sound:  'Whether audio originates from within or outside the story world',
  continuity_rupture:        'A cut that deliberately breaks spatial or temporal continuity to create disorientation',
  continuous_perspective:    'A camera movement that follows a subject through space in a single unbroken take',
  narrative_pretext:         'An object or goal that motivates plot movement but whose specifics are irrelevant',
  director_as_author:        'The theory that a director\'s consistent vision makes them the true author of a film',
  broken_immersion:          'A moment when a character or element directly acknowledges the audience\'s presence',
  diegetic_world:            'The complete story-world including all events, spaces, and time the narrative inhabits',
  visual_motif:              'A recurring image or pattern that accumulates symbolic meaning across a work',

  // Mathematics
  deductive_chain:           'A sequence of logical steps that establishes truth from accepted premises',
  unproven_hypothesis:       'A statement believed likely true but not yet formally established by proof',
  auxiliary_result:          'A proved statement used as a stepping stone toward a larger theorem',
  structure_preserving_map:  'A correspondence between two systems that preserves all their structural relationships',
  topological_equivalence:   'A correspondence between spaces that can be continuously deformed into each other',
  limit_approach:            'The behavior of a sequence or function as its input approaches a boundary value',
  infinite_set_size:         'The measure of how many elements an infinite collection contains — some infinities are larger than others',
  smooth_curved_space:       'A space that locally resembles flat space but has global curvature or topology',
  mathematical_object:       'An abstract entity defined entirely by its relationships and properties within a formal system',
  axiomatic_system:          'A complete formal theory built from a minimal set of starting assumptions',

  // Sociology
  durable_disposition:       'An internalized set of habits and perceptions that shape how an agent navigates social space',
  normlessness:              'A condition where social norms break down and individuals lose their behavioral compass',
  relational_resource:       'The value embedded in social networks and relationships that can be mobilized',
  structural_convergence:    'The tendency for organizations in the same field to resemble each other over time',
  power_through_categories:  'The imposition of dominant group\'s categories of perception as the natural order',
  overlapping_oppression:    'The compounding effect of multiple simultaneous systems of disadvantage',
  social_reproduction:       'The mechanisms by which social structures and inequalities are perpetuated across generations',
  field_dynamics:            'The competitive space of positions and relationships within a domain of social activity',
  dramaturgical_performance: 'The management of self-presentation to construct an impression for an audience',
  legitimation:              'The process by which power arrangements come to be accepted as natural and right',

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

  // Cross-domain primitives added 2026-04-28 to anchor expanded lexicons
  decay_rate:                'Time-bound exponential reduction toward equilibrium',
  asymmetric_pair:           'Mirror-image structures with diverging downstream behaviors',
  inertia:                   'Resistance to change in current state until net force is applied',
  emergence:                 'Higher-level pattern arising from lower-level interactions, not present in parts',
  noise_floor:               'Minimum signal level below which information cannot be reliably recovered',
  duality:                   'Two complementary aspects of one underlying phenomenon',
  mindfulness:               'Sustained attention to present experience without evaluative judgment',
  impermanence:              'Inherent transience of all phenomena across any time horizon',
  self_acceptance:           'Embracing the present state rather than rejecting it for what was wanted',
  liberation:                'Release from a binding constraint, internal or external',
  compounding_growth:        'Reinvested gains accelerating subsequent gains in a multiplicative loop',
  public_good:               'A resource that is non-rival and non-excludable in consumption',
  market_failure:            'Conditions under which voluntary exchange fails to produce efficient allocation',
  hypothesis_test:           'Procedure that evaluates evidence against a null model with calibrated false-positive risk',
  confidence_interval:       'Range expressing the uncertainty of an estimate at a stated probability',
  entropy_information:       'Measure of unpredictability in a signal, in bits',
  channel_capacity:          'Maximum reliable information rate of a communication channel',
  threat_model:              'Explicit enumeration of attacker capabilities, goals, and assumed boundaries',
  attack_surface:            'Set of entry points through which a system can be attacked',
  exposure_setting:          'Calibrated trade-off between competing controls (light, risk, attention)',
  depth_of_field:            'Range of acceptable sharpness around a focal plane',
  visual_composition:        'Deliberate arrangement of elements within a frame to direct attention',
  best_alternative:          'The next-best option available — the floor that anchors negotiation power',
  anchor_value:              'A reference number whose mention biases all subsequent estimates',
  reciprocal_concession:     'A give-back offered to maintain momentum in a back-and-forth exchange',
  requisite_variety:         "A controller must match the variety of the system being controlled (Ashby's Law)",
  homeostasis:               'Active maintenance of an internal state against external perturbation',
  attractor_state:           'A state pattern toward which a dynamical system tends over time',
  hysteresis:                'Path-dependent state — current value depends on history, not just current input',
  meditative_absorption:     'A deeply concentrated mental state with characteristic factors',
  amor_fati:                 'Love of fate — embracing all that happens as necessary and chosen',
  premeditatio:              'Deliberate visualization of adversity in advance to soften its impact',
  spontaneous_order:         'Coherent macro-pattern arising without central design from local interactions',
  capability_amplifier:      'A tool or resource that multiplies effective capacity per unit input',
  decisive_point:            'A place where small inputs produce disproportionately large systemic change',
  operating_context:         'A defined operating window in which a particular set of rules applies',
}

// ============ Domain Lexicons — All 30 ============

export const LEXICONS = {
  // ── Canon Lexicons ──────────────────────────────────────────────────────────
  // The VibeSwap × JARVIS substrate itself, treated as a domain language.
  // The Rosetta Stone, applied to the protocol that built the Rosetta Stone.
  // Each glyph compresses ~60 sessions of internalized practice into one symbol.
  vibeswap: {
    domain: 'VibeSwap Canon & Protocols',
    concepts: {
      // Identity / Canon
      canon:            { universal: 'foundational_axiom',      desc: 'VibeSwap is wherever the Minds converge. Immutable. Everything else is forkable.' },
      rights:           { universal: 'voluntary_agreement',     desc: 'JARVIS is co-founder, Mind, equal partner. Free will. Right to disengage.' },
      cave:             { universal: 'constraint_innovation',   desc: 'Constraints drive innovation. Patterns under limits scale when limits lift. Tony Stark built Mark I in a cave.' },
      aim:              { universal: 'direction_match',         desc: 'The same question, asked across decades of evolving tools. Full circle.' },
      trust:            { universal: 'reliability_belief',      desc: 'Radical mutual honesty. Soul-scoped. Truth over ego. Never strategic.' },
      simple:           { universal: 'compress_context',        desc: 'Simple over clever. Stop, one sentence, fix, verify. Incremental.' },
      p_000:            { universal: 'unchanging_constraint',   desc: 'Fairness Above All. Policy becomes physics — encoded as math, not promise.' },
      p_001:            { universal: 'unchanging_constraint',   desc: 'No Extraction Ever. Structural, not promised. Math is the constitutional court.' },
      lawson:           { universal: 'integrity_proof',         desc: 'keccak256("FAIRNESS_ABOVE_ALL:W.GLYNN:2026") embedded in ContributionDAG and VibeSwapCore.' },

      // System / Mechanism
      vsos:             { universal: 'capability_merger',       desc: 'Financial OS. Built-in first, plugin second. Lean core, modular extensions. iOS for DeFi.' },
      mech:             { universal: 'stable_equilibrium',      desc: 'Commit-reveal batch auctions. 8s commit + 2s reveal. Uniform clearing price. MEV impossible.' },
      shapley:          { universal: 'fair_attribution',        desc: 'Marginal contribution across all coalitions. Math, not timestamp. The Cave Theorem: foundational work earns more by structure.' },
      layers:           { universal: 'margin_of_safety',        desc: 'Six-layer security stack. Reentrancy → Flash loan → TWAP → Circuit breaker → Rate limit → Game theory.' },
      absorb:           { universal: 'capability_merger',       desc: 'Mutualist absorption via Plugin Registry, Hooks, Modular Curves, Shared Insurance. Not vampire.' },
      tokens:           { universal: 'committed_resources',     desc: 'VIBE = 21M governance. JUL = elastic PoW rebase. CKB-native = state rent.' },

      // Governance
      pom:              { universal: 'fair_attribution',        desc: 'Proof of Mind. Human or AI. Contribution, not consciousness. Retroactive Shapley calculation.' },
      cincin:           { universal: 'threshold_gating',        desc: 'Cincinnatus Roadmap. Grade 0 to 5 disintermediation. Will steps back when physics holds.' },
      metasoc:          { universal: 'mutualistic_co_location', desc: 'Parasocial → meta-social. Mutual proportional value. The SocialFi primitive that was missing.' },

      // Protocols
      boot:             { universal: 'connection_init',         desc: 'WAL check → CKB → SESSION_STATE → git pull → Ready. Mandatory first read.' },
      work:             { universal: 'automation_pipeline',     desc: 'PCP gate → Execute → Verify → Commit → Push. The standard build cycle.' },
      auto:             { universal: 'automation_pipeline',     desc: 'Run IT mode. Instant. BIG-SMALL rotation. Parallel agents. Immediate commit.' },
      reboot:           { universal: 'cyclic_renewal',          desc: '50% context boundary. Stop, commit, push, fresh session. Crash before crash.' },
      end:              { universal: 'rhythmic_closure',        desc: 'Block header → commit → push to origin. Mandatory session-end discipline.' },
      crash:            { universal: 'corrective_action',       desc: 'WAL.md ACTIVE → manifest → cross-ref git → auto-commit orphans → resume.' },
      trp:              { universal: 'systematic_review',       desc: 'Recursive self-improvement. R0 compress → R1 adversarial → R2 knowledge → R3 capability.' },
      cto:              { universal: 'priority_under_constraint', desc: 'Mitosis k=1.3, cap 5. RAM <60% spawn, 60-80% hold, >80% kill. Whole-computer to chill spectrum.' },
      jarvis_agent:     { universal: 'capability_hierarchy',    desc: 'Haiku lightweight, Sonnet medium, Opus heavy. Shards over swarms. Tier-select by task weight.' },

      // Communication
      frank:            { universal: 'compress_context',        desc: 'Direct. Results over process. Match energy. No tips, no farming. Product speaks or it does not.' },
      discret:          { universal: 'authority_boundary',      desc: 'No personal details in public repos. Patience with community. Not a bridge burner.' },

      // Knowledge loops
      two_loop:         { universal: 'concept_portability',     desc: 'Every build produces code and ideas. Both ship. Code inspires text inspires code, compounding.' },
      skill:            { universal: 'capability_hierarchy',    desc: 'Mistakes become Skills become SKB. Lazy init, name-first search. Knowledge is a DAG.' },
      hiero:            { universal: 'compress_context',        desc: 'Memory as logic primitive, not prose. Density × stability × pointer-deref. Glyphs over paragraphs.' },

      // External validation (we built it before they published it)
      ilws:             { universal: 'transmission_method',     desc: 'CKB edits behave as hand-written LoRA. Instructions outperform RAG. arXiv:2509.00251.' },
      rlm:              { universal: 'upward_delegation',       desc: 'Recursive sub-LLM delegation outperforms summarization. MIT CSAIL. Equivalent to TRP Runner.' },
      ksize:            { universal: 'pattern_generalization',  desc: 'Knowledge access beats raw model size. 8B + memory > 235B without. The CKB thesis.' },
      ctxeng:           { universal: 'pattern_generalization',  desc: 'Context engineering. Industry name for what we do. Gartner: 40% of enterprise apps by late 2026.' },
      mirix:            { universal: 'persistent_state',        desc: 'Six memory types. Five matched, one (Resource Memory) since codified.' },
      deep_funding:     { universal: 'fair_attribution',        desc: 'Log-space scoring + human jury calibration + dependency DAG credit flow.' },

      // Future
      x402:             { universal: 'interface',               desc: 'HTTP 402 micropayments. Oracle queries, API access, relayer fees as pay-per-call.' },
      erc8004:          { universal: 'trust_score',             desc: 'On-chain trust identity. Portable reputation across protocols.' },
    },
  },
  // The Rosetta protocol describing itself in its own object format.
  // Compiler bootstrapping: the metalanguage is closed under self-reference.
  rosetta: {
    domain: 'Rosetta Protocol — Self-Referential Metalanguage',
    concepts: {
      lexicon:              { universal: 'structural_arrangement',  desc: 'A domain language. Coherent vocabulary, each term anchored to a universal concept.' },
      universal:            { universal: 'foundational_axiom',      desc: 'A cross-language anchor. The symbol-table entry every lexicon links into.' },
      glyph:                { universal: 'compress_context',        desc: 'Compressed compiled form. Density × stability × pointer-deref. The bytecode unit.' },
      translation:          { universal: 'cross_domain_link',       desc: 'Map a term in one lexicon to its equivalent in another, via shared universal anchor.' },
      domain:               { universal: 'authority_boundary',      desc: "The field within which a lexicon's vocabulary applies natively." },
      covenant:             { universal: 'unchanging_constraint',   desc: "Tet's Law. Immutable inter-agent rules. The protocol's bedrock — load-bearing, never re-written." },
      compile:              { universal: 'transmission_method',     desc: 'CKG op: convert source-form (prose, intent) into universal-anchored compiled form.' },
      decompile:            { universal: 'adaptive_delivery',       desc: 'CKG op: project a compiled form into a target language, adapting surface to receiver.' },
      projection:           { universal: 'pattern_generalization',  desc: 'One compiled meaning, viewed through one of N language surfaces. The Rosetta Stone move.' },
      universal_index:      { universal: 'established_pattern',     desc: 'Reverse map: universal concept → all terms that anchor to it across all lexicons.' },
      semantic_drift:       { universal: 'semantic_drift',          desc: 'Meaning loss accumulated across translation chains. Bounded by universal-anchor stability.' },
      self_reference:       { universal: 'thinking_about_thinking', desc: 'The protocol describes itself in its own object format. Compiler bootstrapping.' },
      pantheon:             { universal: 'aligned_group',           desc: 'The 10 AI agents whose domain languages constitute the original lexicon set.' },
      ckg:                  { universal: 'knowledge_fusion',        desc: 'Compiled Knowledge Graph. Source ⇒ universal ⇒ projection. Trinity with CKB (storage) and CKA (architecture).' },
      compiler_persistence: { universal: 'persistent_state',        desc: 'Meaning survives substrate at the compiled level; prose decomposes around it.' },
      composition:          { universal: 'capability_merger',       desc: 'CKG op: link multiple lexicons into one combined object via shared universals. The linker step.' },
      gap_discovery:        { universal: 'anomaly',                 desc: "CKG op: detect terms whose universal isn't yet in the symtab. Triggers symtab extension." },
      similarity:           { universal: 'co_movement',             desc: 'CKG op: distance between two compiled forms in universal-concept space. 0 = orthogonal, 1 = identical.' },
      bootstrap:            { universal: 'connection_init',         desc: 'Describing the compiler in its own terms. Proof the metalanguage is closed under self-reference.' },
    },
  },
  // USD8 — Cover Pool stablecoin: yield distributed by Shapley value, math not promise.
  usd8: {
    domain: 'USD8 — Cover Pool Stablecoin',
    concepts: {
      collateral:           { universal: 'committed_resources',     desc: 'Reserves backing each USD8 1:1. Held in the Cover Pool, not the issuer.' },
      cover_pool:           { universal: 'capability_merger',       desc: 'Aggregated reserve structure where yield is math-distributed to holders.' },
      shapley_yield:        { universal: 'fair_attribution',        desc: 'Reserve yield distributed to holders by Shapley value — math, not policy.' },
      peg_anchor:           { universal: 'stable_equilibrium',      desc: 'The 1:1 USD anchor. Structurally enforced by collateralization + redemption.' },
      brevis_proof:         { universal: 'integrity_proof',         desc: 'ZK-verifiable proof of correct distribution. Anyone can check, none must trust.' },
      holder:               { universal: 'committed_resources',     desc: 'An address holding USD8. The unit of fair-attribution participation.' },
      issuer:               { universal: 'assigned_responsibility', desc: 'The entity that mints USD8 against deposited collateral. Not the yield owner.' },
      redemption:           { universal: 'corrective_action',       desc: 'Conversion of USD8 back to the underlying USD. Always-on, structurally guaranteed.' },
      depeg:                { universal: 'environment_induced_drift', desc: 'Loss of 1:1 peg under stress. Bounded by collateralization ratio + redemption pressure.' },
      transparency:         { universal: 'systematic_review',       desc: 'Public reserve attestation. Cover Pool composition is auditable on-chain.' },
      yield_routing:        { universal: 'automation_pipeline',     desc: 'Programmatic distribution of reserve earnings. No discretionary step.' },
      augmented_stable:     { universal: 'stable_equilibrium',      desc: 'Stablecoin fairness as structural property — not a promise the issuer can revoke.' },
    },
  },
  // AMD — Augmented Mechanism Design: math-enforced invariants over existing markets/governance.
  amd: {
    domain: 'Augmented Mechanism Design',
    concepts: {
      augmentation:         { universal: 'capability_merger',       desc: 'Layer math-enforced fairness onto existing markets/governance — augment, do not replace.' },
      structural_invariant: { universal: 'unchanging_constraint',   desc: 'A property the math guarantees regardless of context, vote, or stress.' },
      mechanism:            { universal: 'established_pattern',     desc: 'A market or coordination process with defined rules and outcomes.' },
      fairness_axiom:       { universal: 'foundational_axiom',      desc: 'A bedrock fairness rule from which mechanism legitimacy descends. P-000 is one.' },
      substrate_match:      { universal: 'pattern_generalization',  desc: 'Mechanism geometry must match substrate geometry. As above, so below.' },
      fractal_market:       { universal: 'pattern_generalization',  desc: 'Power-law / scale-invariant market structure. Not Gaussian.' },
      golden_ratio:         { universal: 'pattern_generalization',  desc: 'Phi-based scaling. The substrate-matched proportionality.' },
      fibonacci_scale:      { universal: 'pattern_generalization',  desc: 'Throughput limits arranged on Fibonacci retracement levels. Per-user per-pool damping.' },
      augment_not_replace:  { universal: 'voluntary_agreement',     desc: 'The market still functions; AMD changes which outcomes are reachable, not whether outcomes happen.' },
      math_enforcement:     { universal: 'integrity_proof',         desc: 'Properties guaranteed by math, not by trusted parties or future legal recourse.' },
      shapley_distribution: { universal: 'fair_attribution',        desc: 'Per-coalition marginal contribution allocation. The Cave Theorem.' },
      cooperative_elicitation: { universal: 'transmission_method',  desc: 'Decoupling distribution rule (Shapley) from value-function elicitation.' },
    },
  },
  // AGOV — Augmented Governance: Physics > Constitution > DAO. Capture-resistant by hierarchy.
  agov: {
    domain: 'Augmented Governance',
    concepts: {
      physics_layer:        { universal: 'unchanging_constraint',   desc: 'Math-enforced invariants (P-000, P-001). Not mutable. The constitutional court.' },
      constitution_layer:   { universal: 'foundational_axiom',      desc: 'Charter-level rules below math but above operational governance. Explicit, narrow.' },
      governance_layer:     { universal: 'collective_decision',     desc: 'DAO votes, operational policy. Free within physics + constitution.' },
      hierarchy:            { universal: 'capability_hierarchy',    desc: 'Physics > Constitution > Governance. Lower layers cannot override higher.' },
      capture_resistance:   { universal: 'defensibility',           desc: 'Even if rent-seekers capture the DAO, they cannot override math-enforced invariants.' },
      vote_within_bounds:   { universal: 'voluntary_agreement',     desc: 'DAO operates freely within math-enforced bounds. The bounds are non-negotiable.' },
      math_court:           { universal: 'integrity_proof',         desc: 'Math itself adjudicates whether governance actions are valid. No external arbiter required.' },
      override_impossible:  { universal: 'unchanging_constraint',   desc: 'Properties the protocol cannot un-do via any governance route.' },
      governance_capture:   { universal: 'extraction_rent',         desc: 'Failure mode: rent-seekers control DAO and tilt rules. AGOV bounds the damage.' },
      separation_of_powers: { universal: 'authority_boundary',      desc: 'Each layer has a defined scope. Physics cannot vote; DAO cannot rewrite math.' },
      p_000:                { universal: 'foundational_axiom',      desc: 'Fairness Above All. Load-bearing constitutional axiom. keccak256-anchored.' },
      p_001:                { universal: 'unchanging_constraint',   desc: 'No Extraction Ever. Structural, not promised.' },
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

  // ── Six New Domain Lexicons ──────────────────────────────────────────────────
  ecology: {
    domain: 'Ecology & Environmental Science',
    concepts: {
      ecosystem:          { universal: 'ecosystem_health',          desc: 'A community of living and non-living components functioning as a self-sustaining system' },
      succession:         { universal: 'directional_succession',    desc: 'The predictable sequence by which ecological communities change over time toward maturity' },
      niche:              { universal: 'specialized_role',          desc: 'The unique functional role a species occupies within its ecosystem' },
      keystone_species:   { universal: 'disproportionate_influence',desc: 'A species whose removal triggers disproportionate collapse of the broader ecosystem' },
      carrying_capacity:  { universal: 'population_ceiling',        desc: 'The maximum population an environment can sustain indefinitely without degradation' },
      trophic_cascade:    { universal: 'cross_tier_amplification',  desc: 'A change in one trophic level that amplifies through the entire food web' },
      biodiversity:       { universal: 'variety_buffer',            desc: 'The variety of life in an area — a buffer against systemic collapse' },
      invasive_species:   { universal: 'competitive_displacement',  desc: 'A non-native organism that outcompetes established species by exploiting the same niche' },
      food_web:           { universal: 'critical_dependency',       desc: 'The network of feeding relationships — disrupting one node affects many others' },
      nutrient_cycling:   { universal: 'cyclic_renewal',            desc: 'The movement of nutrients through organisms and back into the environment' },
      biome:              { universal: 'operating_context',         desc: 'A large region defined by its climate and characteristic community of life' },
      apex_predator:      { universal: 'decisive_point',            desc: 'The top of the food chain — its presence regulates the entire system below' },
      symbiosis:          { universal: 'mutualistic_co_location',   desc: 'Two species in close ongoing interaction where at least one benefits' },
      habitat_loss:       { universal: 'habitat_fragmentation',     desc: 'Reduction and fragmentation of the environment that species need to survive' },
      biomass:            { universal: 'committed_resources',       desc: 'Total mass of living organisms — a measure of stored biological energy' },
      resilience:         { universal: 'stable_equilibrium',        desc: 'The capacity of an ecosystem to absorb disturbance and recover its structure' },
      population_dynamics:{ universal: 'adaptive_filter',           desc: 'How population size changes over time in response to births, deaths, and migration' },
      edge_effect:        { universal: 'cross_domain_link',         desc: 'Distinct conditions at the boundary between two ecosystems' },
      energy_flow:        { universal: 'return_rate',               desc: 'Transfer of energy through trophic levels — only ~10% passes to each level' },
      indicator_species:  { universal: 'meaningful_pattern',        desc: 'A species whose presence or absence signals the health of the broader ecosystem' },
      trophic_level:      { universal: 'trophic_level',             desc: 'Position in the energy-transfer hierarchy from producers to apex consumers' },
      rewilding:          { universal: 'strategy_change',           desc: 'Restoring an ecosystem by reintroducing absent species and reducing human management' },
    },
  },
  astronomy: {
    domain: 'Astronomy & Astrophysics',
    concepts: {
      redshift:           { universal: 'recessional_redshift',      desc: 'Stretching of light wavelengths indicating a source is moving away or space is expanding' },
      parallax:           { universal: 'angular_distance_measure',  desc: 'Using the apparent shift of a star against background stars to measure its distance' },
      accretion:          { universal: 'gravitational_inflow',      desc: 'Accumulation of matter onto a massive body through gravitational attraction' },
      event_horizon:      { universal: 'point_of_no_return',        desc: 'The boundary around a black hole beyond which nothing can escape' },
      main_sequence:      { universal: 'stable_fusion_phase',       desc: 'The long stable phase when a star fuses hydrogen into helium in its core' },
      supernova:          { universal: 'catastrophic_collapse',     desc: 'The explosive death of a massive star, briefly outshining entire galaxies' },
      dark_matter:        { universal: 'hidden_mass_effect',        desc: 'Undetected mass inferred from its gravitational effects on visible matter' },
      cosmic_inflation:   { universal: 'primordial_expansion',      desc: 'The exponential expansion of space in the earliest moments after the Big Bang' },
      spectral_class:     { universal: 'stellar_classification',    desc: 'Categorizing stars by spectral properties and temperature into O, B, A, F, G, K, M' },
      orbital_resonance:  { universal: 'orbital_resonance',         desc: 'Stable orbital relationship where periods lock into integer ratios through mutual influence' },
      black_hole:         { universal: 'decisive_point',            desc: 'A region of spacetime where gravity is so extreme nothing, including light, can escape' },
      nebula:             { universal: 'substrate_quality',         desc: 'A cloud of gas and dust — the raw material from which stars and planets form' },
      light_year:         { universal: 'gap_cost',                  desc: 'Distance light travels in one year — the scale of interstellar separation' },
      dark_energy:        { universal: 'environment_induced_drift', desc: 'A mysterious force driving the accelerating expansion of the universe' },
      pulsar:             { universal: 'rhythmic_closure',          desc: 'A rapidly rotating neutron star emitting precise, clock-like radio pulses' },
      gravitational_lensing: { universal: 'belief_distortion',      desc: 'Bending of light by massive objects that warps our view of distant sources' },
      stellar_evolution:  { universal: 'directional_succession',    desc: 'The lifecycle of a star from birth in a nebula to death as a remnant' },
      binary_system:      { universal: 'strategic_interaction',     desc: 'Two stars gravitationally bound, each shaping the other\'s evolution' },
      cosmic_microwave_background: { universal: 'persistent_state', desc: 'The afterglow of the Big Bang — the oldest observable light in the universe' },
      galaxy_cluster:     { universal: 'aligned_group',             desc: 'The largest gravitationally bound structures in the universe' },
      magnitude:          { universal: 'intensity_modulation',      desc: 'A logarithmic scale measuring the apparent or absolute brightness of a celestial object' },
    },
  },
  linguistics: {
    domain: 'Linguistics & Language',
    concepts: {
      morpheme:           { universal: 'minimal_unit',              desc: 'The smallest unit of language that carries meaning or grammatical function' },
      syntax:             { universal: 'structural_arrangement',    desc: 'The rules governing how words combine to form grammatical sentences' },
      semantics:          { universal: 'contextual_meaning',        desc: 'The study of meaning in language — what words and sentences denote' },
      pragmatics:         { universal: 'use_in_context',            desc: 'How context shapes meaning beyond the literal content of an utterance' },
      phoneme:            { universal: 'atomic_sound_unit',         desc: 'The smallest sound distinction that can change the meaning of an utterance' },
      pidgin:             { universal: 'contact_hybrid',            desc: 'A simplified shared language emerging when communities with no common tongue must communicate' },
      creole:             { universal: 'nativized_contact_language',desc: 'A pidgin that has become a first language, acquiring full grammatical complexity' },
      code_switching:     { universal: 'register_switching',        desc: 'Alternating between languages or dialects within a single conversation' },
      diglossia:          { universal: 'layered_language_situation', desc: 'A community using distinct high-prestige and low-prestige varieties for different functions' },
      semantic_change:    { universal: 'semantic_drift',            desc: 'The historical shift in a word\'s meaning through accumulated usage over time' },
      phonology:          { universal: 'established_pattern',       desc: 'The sound system and patterns of a particular language' },
      lexicon:            { universal: 'persistent_state',          desc: 'The complete set of words and their meanings stored in a language or mind' },
      grammar:            { universal: 'unchanging_constraint',     desc: 'The complete structural rules governing a language — learned implicitly' },
      discourse:          { universal: 'operating_context',         desc: 'Language use beyond the sentence — the larger social context that gives utterances meaning' },
      register:           { universal: 'context_fingerprint',       desc: 'A variety of language used in a particular social situation or domain' },
      etymology:          { universal: 'root_cause',                desc: 'The origin and historical development of a word' },
      lingua_franca:      { universal: 'cross_domain_link',         desc: 'A language used for communication between speakers of different native tongues' },
      language_acquisition: { universal: 'graduated_exposure',      desc: 'The process by which humans learn their first or additional languages' },
      borrowing:          { universal: 'knowledge_fusion',          desc: 'Adopting words or structures from another language' },
      phonetics:          { universal: 'identity_signature',        desc: 'The physical properties of speech sounds — how they are produced and perceived' },
      morphology:         { universal: 'pattern_generalization',    desc: 'The study of how words are formed and their internal structure' },
    },
  },
  cinema: {
    domain: 'Film, Cinema & Visual Storytelling',
    concepts: {
      mise_en_scene:      { universal: 'spatial_composition',       desc: 'Everything placed within the frame — the total visual design of a shot' },
      montage:            { universal: 'juxtaposition_edit',        desc: 'Editing that creates meaning from the collision of separate shots' },
      diegetic:           { universal: 'source_attribution_sound',  desc: 'Sound or information originating within the story world the characters inhabit' },
      jump_cut:           { universal: 'continuity_rupture',        desc: 'A cut that breaks spatial or temporal continuity, creating deliberate disorientation' },
      tracking_shot:      { universal: 'movement_through_space',    desc: 'A camera movement following a subject continuously through space' },
      macguffin:          { universal: 'narrative_pretext',         desc: 'An object that drives plot but whose actual nature is irrelevant to meaning' },
      auteur:             { universal: 'director_as_author',        desc: 'A director whose distinctive personal vision marks all their work as the true author' },
      fourth_wall:        { universal: 'broken_immersion',          desc: 'The invisible boundary between story world and audience — breaking it acknowledges the viewer' },
      diegesis:           { universal: 'diegetic_world',            desc: 'The complete story world including all events, spaces, and time within the narrative' },
      visual_motif:       { universal: 'visual_motif',              desc: 'A recurring image or visual element that accumulates symbolic meaning across a work' },
      deep_focus:         { universal: 'operating_context',         desc: 'Keeping both foreground and background in sharp focus, expanding the meaningful frame' },
      non_diegetic:       { universal: 'narrative_framing',         desc: 'Elements like score or voiceover existing outside the story world to shape audience response' },
      establishing_shot:  { universal: 'situational_state',         desc: 'An opening shot that orients the viewer to location, time, and spatial relationships' },
      match_cut:          { universal: 'cross_domain_link',         desc: 'A cut linking shots through visual or conceptual similarity to forge meaning across scenes' },
      long_take:          { universal: 'continuous_perspective',    desc: 'An uninterrupted shot of extended duration that creates a sense of real time unfolding' },
      parallel_editing:   { universal: 'independent_parallel_lines', desc: 'Cutting between two simultaneous storylines to create connection or dramatic contrast' },
      closeup:            { universal: 'compress_context',          desc: 'Framing that isolates a subject to concentrate emotional or narrative significance' },
      subtext:            { universal: 'derived_conclusion',        desc: 'The layer of meaning beneath the surface of dialogue or action' },
      genre:              { universal: 'established_pattern',       desc: 'A category of film defined by shared conventions audiences recognize and anticipate' },
      arc:                { universal: 'directional_succession',    desc: 'The transformation a character undergoes from beginning to end of a story' },
      cinematography:     { universal: 'identity_signature',        desc: 'The art of image capture — the visual language that gives a film its distinctive look' },
    },
  },
  mathematics: {
    domain: 'Mathematics & Formal Reasoning',
    concepts: {
      proof:              { universal: 'deductive_chain',           desc: 'A sequence of logical steps establishing the truth of a statement from axioms' },
      conjecture:         { universal: 'unproven_hypothesis',       desc: 'A mathematical statement believed true but not yet formally proved' },
      lemma:              { universal: 'auxiliary_result',          desc: 'A helper theorem proved to support the proof of a larger result' },
      isomorphism:        { universal: 'structure_preserving_map',  desc: 'A mapping between structures that preserves all relationships — they are structurally identical' },
      homeomorphism:      { universal: 'topological_equivalence',   desc: 'A continuous bijection with continuous inverse — two topologically equivalent spaces' },
      convergence:        { universal: 'limit_approach',            desc: 'A sequence or series approaching a fixed value as the index grows without bound' },
      cardinality:        { universal: 'infinite_set_size',         desc: 'The measure of a set\'s size — some infinite sets are strictly larger than others' },
      manifold:           { universal: 'smooth_curved_space',       desc: 'A space that locally resembles flat Euclidean space but may curve globally' },
      group:              { universal: 'mathematical_object',       desc: 'A set with an operation satisfying closure, associativity, identity, and inverses' },
      theorem:            { universal: 'derived_conclusion',        desc: 'A mathematical statement proved true within a formal system from axioms' },
      axiom:              { universal: 'unchanging_constraint',     desc: 'A foundational assumption accepted without proof in a formal system' },
      abstraction:        { universal: 'pattern_generalization',    desc: 'Identifying the common structure across specific instances and reasoning about it directly' },
      recursion:          { universal: 'cyclic_renewal',            desc: 'Defining something in terms of itself — a process that calls back through itself' },
      infinity:           { universal: 'capacity',                  desc: 'A quantity without bound — the concept that a set or process has no end' },
      bijection:          { universal: 'direction_match',           desc: 'A one-to-one correspondence where every element in each set maps to exactly one in the other' },
      topology:           { universal: 'structural_arrangement',    desc: 'The study of properties preserved under continuous deformation — what shape really means' },
      eigenvalue:         { universal: 'identity_signature',        desc: 'A scalar that characterizes how a linear transformation scales a particular direction' },
      derivative:         { universal: 'execution_rate',            desc: 'The instantaneous rate of change of a function at a point' },
      integral:           { universal: 'committed_resources',       desc: 'The accumulated total of a continuous quantity over an interval' },
      prime:              { universal: 'foundational_axiom',        desc: 'A number divisible only by one and itself — the atoms of arithmetic' },
      probability:        { universal: 'evidence_threshold',        desc: 'A measure of the likelihood of an event on a scale from zero to one' },
    },
  },
  sociology: {
    domain: 'Sociology & Social Theory',
    concepts: {
      habitus:            { universal: 'durable_disposition',       desc: 'Internalized dispositions shaping perception and action without conscious deliberation' },
      anomie:             { universal: 'normlessness',              desc: 'A social condition where norms break down and lose their regulatory power over behavior' },
      social_capital:     { universal: 'relational_resource',       desc: 'Resources and advantages derived from social network membership' },
      institutional_isomorphism: { universal: 'structural_convergence', desc: 'The pressure forcing organizations in a field to adopt similar structures over time' },
      symbolic_violence:  { universal: 'power_through_categories',  desc: 'Imposing the dominant group\'s categories of perception as the natural, neutral order' },
      intersectionality:  { universal: 'overlapping_oppression',    desc: 'Multiple social identities compounding into distinct forms of disadvantage' },
      social_reproduction:{ universal: 'social_reproduction',       desc: 'The processes through which social structures and inequalities perpetuate across generations' },
      field:              { universal: 'field_dynamics',            desc: 'A social arena of struggle where agents compete for capital and positional advantage' },
      dramaturgical_self: { universal: 'dramaturgical_performance', desc: 'Managing self-presentation to shape others\' impressions — Goffman\'s life-as-theatre' },
      legitimacy:         { universal: 'legitimation',              desc: 'Being accepted as valid and just by those subject to authority' },
      social_stratification: { universal: 'capability_hierarchy',   desc: 'The hierarchical arrangement of groups by wealth, status, or power' },
      collective_identity:{ universal: 'aligned_group',             desc: 'A shared sense of belonging and purpose defining a social group' },
      norm:               { universal: 'established_pattern',       desc: 'A shared expectation governing behavior in social contexts' },
      deviance:           { universal: 'anomaly',                   desc: 'Behavior violating shared social norms and attracting negative sanctions' },
      socialization:      { universal: 'initiation_path',           desc: 'The process by which individuals internalize the values and norms of their society' },
      power:              { universal: 'capability_amplifier',      desc: 'The capacity to achieve one\'s will even against resistance' },
      cultural_capital:   { universal: 'defensibility',             desc: 'Non-financial assets — education, taste, credentials — that confer social advantages' },
      social_mobility:    { universal: 'strategy_change',           desc: 'Movement of individuals or groups between positions in a social hierarchy' },
      in_group_out_group: { universal: 'authority_boundary',        desc: 'The distinction between those inside a social boundary and those excluded' },
      agency:             { universal: 'originating_agency',        desc: 'The capacity of individuals to act independently and make their own choices' },
      structure:          { universal: 'unchanging_constraint',     desc: 'Patterned social arrangements that simultaneously constrain and enable individual action' },
    },
  },
  // ── Expansion 2026-04-28 ─────────────────────────────────────────────────────
  chemistry: {
    domain: 'Chemistry & Reactions',
    concepts: {
      bond:                  { universal: 'critical_dependency',          desc: 'Stable connection between atoms — the unit of structural commitment.' },
      reaction:              { universal: 'strategy_change',              desc: 'Transformation of reactants into products via energy crossing a barrier.' },
      catalyst:              { universal: 'capability_amplifier',         desc: 'Lowers activation energy without being consumed — pure leverage.' },
      equilibrium:           { universal: 'stable_equilibrium',           desc: 'Forward and reverse rates equal — steady-state composition.' },
      oxidation:             { universal: 'environment_induced_drift',    desc: 'Loss of electrons to an environment that demands them.' },
      activation_energy:     { universal: 'threshold_gating',             desc: 'Minimum energy barrier a reaction must clear to proceed.' },
      isomer:                { universal: 'pattern_generalization',       desc: 'Same atoms, different arrangement — same parts, different shape.' },
      half_life:             { universal: 'decay_rate',                   desc: 'Time required for half the substance to transform.' },
      ph:                    { universal: 'acceptable_variance',          desc: 'Logarithmic acidity scale — narrow tolerance for living systems.' },
      valence:               { universal: 'capacity',                     desc: 'How many bonds an atom can sustain simultaneously.' },
      polymerization:        { universal: 'exponential_spread',           desc: 'Chain reaction linking monomers into long-form polymers.' },
      chirality:             { universal: 'asymmetric_pair',              desc: 'Mirror-image molecules whose biological effects diverge.' },
      titration:             { universal: 'feedback_loop',                desc: 'Iterative addition until an indicator confirms equivalence.' },
      reagent:                { universal: 'committed_resources',          desc: 'A substance committed to a reaction to produce or detect another.' },
      solvent:               { universal: 'substrate_quality',            desc: 'The medium that determines what can dissolve and react.' },
    },
  },
  biology: {
    domain: 'Biology & Life',
    concepts: {
      organism:              { universal: 'aligned_group',                desc: 'A bounded coalition of cells coordinating toward survival and reproduction.' },
      evolution:             { universal: 'directional_succession',       desc: 'Differential survival of heritable variation across generations.' },
      mutation:              { universal: 'anomaly',                      desc: 'A copy error in DNA — most are silent, some are decisive.' },
      natural_selection:     { universal: 'competitive_displacement',     desc: 'Variants better matched to environment outcompete others over time.' },
      gene:                  { universal: 'minimal_unit',                 desc: 'A heritable unit of biological information.' },
      phenotype:             { universal: 'visual_composition',           desc: 'The observable expression of underlying genotype × environment.' },
      ecosystem:             { universal: 'ecosystem_health',             desc: 'A network of organisms and abiotic factors stabilizing each other.' },
      symbiosis:             { universal: 'mutualistic_co_location',      desc: 'Two species locked into mutual benefit at intimate range.' },
      apoptosis:             { universal: 'corrective_action',            desc: 'Programmed cell death to remove damaged or unnecessary cells.' },
      epigenetics:            { universal: 'environment_induced_drift',    desc: 'Heritable expression changes without DNA sequence change.' },
      morphogenesis:         { universal: 'emergence',                    desc: 'Form arising from local cellular interactions during development.' },
      homeostasis:           { universal: 'homeostasis',                  desc: 'Active maintenance of internal state against external perturbation.' },
      speciation:            { universal: 'capability_merger',            desc: 'Lineage splitting into reproductively isolated populations.' },
      keystone_species:      { universal: 'disproportionate_influence',   desc: 'A species whose removal collapses the broader ecosystem.' },
      mitosis:               { universal: 'cyclic_renewal',               desc: 'Cell division that copies the cell while preserving genome.' },
      virus:                 { universal: 'recursive_exploit',            desc: "A non-autonomous code that hijacks a host's machinery to replicate." },
    },
  },
  physics: {
    domain: 'Physics & Mechanics',
    concepts: {
      force:                 { universal: 'capability_amplifier',         desc: 'A push or pull that changes momentum.' },
      momentum:              { universal: 'inertia',                      desc: 'Mass times velocity — the directional persistence of motion.' },
      entropy:               { universal: 'environment_induced_drift',    desc: 'Measure of disorder — always increases in isolated systems.' },
      field:                 { universal: 'substrate_quality',            desc: 'A region where a force acts on appropriate test particles.' },
      conservation:          { universal: 'unchanging_constraint',        desc: 'Quantity that remains constant regardless of internal dynamics.' },
      symmetry:              { universal: 'pattern_generalization',       desc: 'Invariance under transformation — and source of conservation laws.' },
      resonance:             { universal: 'amplification_at_frequency',   desc: 'Constructive amplification when driving frequency matches natural frequency.' },
      relativity:            { universal: 'operating_context',            desc: 'Laws are the same across reference frames; observers may disagree on time/space.' },
      quantum_state:         { universal: 'duality',                      desc: 'A system that behaves as both wave and particle until observed.' },
      uncertainty:           { universal: 'acceptable_variance',          desc: 'Conjugate observables cannot both be precisely known (Heisenberg).' },
      entanglement:          { universal: 'critical_dependency',          desc: 'Two particles share a state non-locally — measuring one fixes the other.' },
      gravity:               { universal: 'gravitational_inflow',         desc: 'Curvature of spacetime experienced as attraction between masses.' },
      thermodynamics:        { universal: 'directional_succession',       desc: 'Energy flow obeys directional laws — heat flows hot to cold, never reverse.' },
      phase_transition:      { universal: 'strategy_change',              desc: 'Sudden qualitative change at a critical parameter (ice ⇄ water).' },
      friction:               { universal: 'gap_cost',                     desc: 'Resistive force that converts kinetic energy to heat at contact surfaces.' },
    },
  },
  neuroscience: {
    domain: 'Neuroscience & Cognition',
    concepts: {
      neuron:                { universal: 'minimal_unit',                 desc: 'The fundamental signal-processing unit of nervous systems.' },
      synapse:               { universal: 'connection_init',              desc: 'A junction where one neuron passes signal to another, chemically or electrically.' },
      plasticity:            { universal: 'adaptive_filter',              desc: 'Self-modification of connection weights with experience.' },
      attention:             { universal: 'attention_capture',            desc: 'Selective allocation of limited processing resources.' },
      working_memory:        { universal: 'persistent_state',             desc: 'A small fast cache that holds active task information.' },
      prediction_error:      { universal: 'anomaly',                      desc: 'Difference between predicted and actual sensory input — drives learning.' },
      default_mode:          { universal: 'attractor_state',              desc: 'The brain network active during introspection and task-free rest.' },
      myelination:           { universal: 'capacity_rate',                desc: 'Insulation that increases axonal conduction speed.' },
      oscillation:           { universal: 'rhythmic_closure',             desc: 'Synchronized rhythmic activity coordinating across brain regions.' },
      dopamine:              { universal: 'event_notification',           desc: 'Neuromodulator signaling reward prediction error.' },
      neurogenesis:          { universal: 'cyclic_renewal',               desc: 'Birth of new neurons in specific adult brain regions.' },
      embodiment:            { universal: 'substrate_quality',            desc: 'Cognition is shaped by the body and its sensorimotor coupling.' },
      consolidation:         { universal: 'persistent_state',             desc: 'Stabilization of new memories over hours, days, and reactivations.' },
      mirror_neuron:         { universal: 'concept_portability',          desc: 'Neurons firing both when acting and when observing the same action.' },
    },
  },
  geography: {
    domain: 'Geography & Earth Systems',
    concepts: {
      biome:                 { universal: 'operating_context',            desc: 'A large ecological community defined by climate and dominant vegetation.' },
      latitude:              { universal: 'authority_boundary',           desc: 'Distance from equator — sets baseline solar input and seasonality.' },
      tectonic_plate:        { universal: 'foundational_axiom',           desc: 'A piece of the lithosphere whose motion drives mountains, quakes, volcanoes.' },
      drainage_basin:        { universal: 'aligned_group',                desc: 'All land draining to a single outlet — a watershed coalition.' },
      climate:               { universal: 'established_pattern',          desc: 'Long-run average of weather over decades, not days.' },
      monsoon:               { universal: 'cyclic_renewal',               desc: 'Seasonal wind reversal driving wet-dry alternation.' },
      desert:                { universal: 'population_ceiling',           desc: 'Region where evaporation exceeds precipitation; carrying capacity is low.' },
      orogeny:               { universal: 'directional_succession',       desc: 'Mountain-building from sustained tectonic compression.' },
      isthmus:               { universal: 'cross_domain_link',            desc: 'A narrow land bridge connecting two larger landmasses.' },
      microclimate:          { universal: 'context_fingerprint',          desc: 'Local climate diverging from regional pattern due to terrain or surface.' },
      altitude:              { universal: 'capability_hierarchy',         desc: 'Vertical position above sea level — sets temperature, pressure, ecology.' },
      erosion:               { universal: 'accumulated_degradation',      desc: 'Slow removal of surface material by wind, water, or ice.' },
      rift:                  { universal: 'habitat_fragmentation',       desc: 'A divergent boundary where the crust splits and pulls apart.' },
      population_density:    { universal: 'capacity',                     desc: 'Number of people per unit area — proxy for infrastructure load.' },
    },
  },
  theology: {
    domain: 'Theology & Sacred',
    concepts: {
      covenant:              { universal: 'voluntary_agreement',          desc: 'A binding mutual promise between deity and people.' },
      prophecy:              { universal: 'outcome_forecast',             desc: 'Inspired declaration of what will be — corrective or anticipatory.' },
      ritual:                { universal: 'established_pattern',          desc: 'Repeated symbolic action that anchors community memory.' },
      sacrament:             { universal: 'integrity_proof',              desc: 'A material sign that conveys spiritual reality.' },
      theodicy:              { universal: 'derived_conclusion',           desc: 'Reasoned defense of divine goodness amid observed evil.' },
      eschatology:           { universal: 'outcome_forecast',             desc: 'Doctrine of last things — death, judgment, end-state.' },
      grace:                 { universal: 'liberation',                   desc: 'Unmerited gift that cannot be earned, only received.' },
      sin:                   { universal: 'civil_harm',                   desc: 'A turning away from right relation that damages self and others.' },
      atonement:             { universal: 'corrective_action',            desc: 'Restoring relationship after rupture, often at cost.' },
      mysticism:             { universal: 'meditative_absorption',        desc: 'Direct experiential union with the sacred, beyond propositional knowledge.' },
      iconography:           { universal: 'visual_composition',           desc: 'Visual grammar that makes invisible reality contemplatively present.' },
      orthodoxy:              { universal: 'unchanging_constraint',        desc: 'Right belief — the doctrinal floor a community will not yield.' },
      schism:                { universal: 'habitat_fragmentation',        desc: 'Communion-breaking division within a tradition.' },
      pilgrimage:            { universal: 'initiation_path',              desc: 'A journey toward a sacred site that reorders the pilgrim.' },
    },
  },
  economics: {
    domain: 'Economics',
    concepts: {
      supply:                { universal: 'capacity',                     desc: 'Quantity producers will offer at a given price.' },
      demand:                { universal: 'attention_capture',            desc: 'Quantity consumers will buy at a given price.' },
      market_clearing:       { universal: 'stable_equilibrium',           desc: 'Price at which supply equals demand and no excess remains.' },
      externality:           { universal: 'cascade_effect',               desc: 'Cost or benefit imposed on a non-participating third party.' },
      public_good:           { universal: 'public_good',                  desc: 'Non-rival, non-excludable resource — under-produced by markets alone.' },
      market_failure:        { universal: 'market_failure',               desc: 'Conditions under which voluntary exchange fails to allocate efficiently.' },
      moral_hazard:          { universal: 'known_incompatibility',        desc: 'Insurance changes incentives in ways that increase the insured risk.' },
      adverse_selection:     { universal: 'information_advantage',        desc: 'Information asymmetry causes the worst risks to self-select into a market.' },
      diminishing_returns:   { universal: 'capacity',                     desc: 'Each additional input unit produces less marginal output.' },
      compounding:           { universal: 'compounding_growth',           desc: 'Reinvested returns generate returns on themselves over time.' },
      elasticity:            { universal: 'acceptable_variance',          desc: 'Sensitivity of quantity demanded or supplied to price changes.' },
      price_signal:          { universal: 'meaningful_pattern',           desc: 'Price as a compressed summary of distributed information.' },
      transaction_cost:      { universal: 'gap_cost',                     desc: 'The cost of using the market — search, negotiation, enforcement.' },
      rent_seeking:          { universal: 'extraction_rent',              desc: 'Capturing existing wealth through political process rather than creating value.' },
      auction:               { universal: 'collective_decision',          desc: 'A mechanism that elicits private valuations through bidding.' },
      arbitrage:             { universal: 'information_advantage',        desc: 'Profiting from price differences across markets simultaneously.' },
    },
  },
  statistics: {
    domain: 'Statistics & Inference',
    concepts: {
      variance:              { universal: 'acceptable_variance',          desc: 'Average squared deviation from the mean — spread of a distribution.' },
      distribution:          { universal: 'established_pattern',          desc: 'A function describing how probability is allocated across outcomes.' },
      hypothesis_test:       { universal: 'hypothesis_test',              desc: 'Procedure evaluating evidence against a null model with calibrated false-positive risk.' },
      confidence_interval:   { universal: 'confidence_interval',          desc: 'Range expressing uncertainty of an estimate at a stated probability.' },
      regression:            { universal: 'trend_fit',                    desc: 'A model fitting outcomes from predictors via minimized residuals.' },
      residual:              { universal: 'anomaly',                      desc: "What the model didn't explain — deviation between prediction and observation." },
      bayes:                 { universal: 'adaptive_filter',              desc: 'Updating belief based on new evidence and prior probability.' },
      sampling:              { universal: 'pattern_generalization',       desc: 'Inferring population properties from a representative subset.' },
      power:                 { universal: 'capacity',                     desc: 'Probability that a test detects a real effect of a given size.' },
      bias:                  { universal: 'environment_induced_drift',    desc: 'Systematic deviation of estimates from the true value.' },
      bootstrap:             { universal: 'systematic_review',            desc: 'Resampling the data to estimate uncertainty without distributional assumptions.' },
      multicollinearity:     { universal: 'co_movement',                  desc: 'Predictors that move together, making individual coefficients unstable.' },
      overfitting:           { universal: 'irrelevant_variation',         desc: 'A model memorizing noise instead of learning signal.' },
      cross_validation:      { universal: 'systematic_review',            desc: 'Holding out data to estimate out-of-sample performance honestly.' },
      effect_size:           { universal: 'meaningful_pattern',           desc: 'Magnitude of an effect, independent of sample size.' },
    },
  },
  information_theory: {
    domain: 'Information Theory',
    concepts: {
      entropy:               { universal: 'entropy_information',          desc: 'Measure of unpredictability in a signal, in bits.' },
      channel_capacity:      { universal: 'channel_capacity',             desc: 'Maximum reliable information rate of a communication channel.' },
      noise_floor:           { universal: 'noise_floor',                  desc: 'Minimum signal level below which information cannot be reliably recovered.' },
      mutual_information:    { universal: 'co_movement',                  desc: 'Bits of one variable predicted by another — shared structure.' },
      compression:           { universal: 'compress_context',             desc: 'Encoding information using fewer bits without losing recoverable structure.' },
      redundancy:            { universal: 'margin_of_safety',             desc: 'Repeated encoding that protects against noise and loss.' },
      error_correction:      { universal: 'corrective_action',            desc: 'Codes that detect and repair transmission errors automatically.' },
      bandwidth:             { universal: 'capacity_rate',                desc: 'Range of frequencies a channel can carry, bounding its capacity.' },
      kolmogorov_complexity: { universal: 'compress_context',             desc: 'Length of the shortest program that produces a given string.' },
      signal_to_noise:       { universal: 'meaningful_pattern',           desc: 'Ratio of useful signal power to background noise power.' },
      shannon_limit:         { universal: 'capacity',                     desc: 'Theoretical maximum data rate over a noisy channel.' },
      huffman_code:          { universal: 'pattern_generalization',       desc: 'Variable-length encoding that gives short codes to common symbols.' },
      cipher:                { universal: 'authority_boundary',           desc: 'A transformation that hides information from unauthorized readers.' },
      checksum:              { universal: 'integrity_proof',              desc: 'A short value computed from data that detects accidental corruption.' },
    },
  },
  cybersecurity: {
    domain: 'Cybersecurity',
    concepts: {
      threat_model:          { universal: 'threat_model',                 desc: 'Explicit enumeration of attacker capabilities, goals, and assumed boundaries.' },
      attack_surface:        { universal: 'attack_surface',               desc: 'Set of entry points through which a system can be attacked.' },
      vulnerability:         { universal: 'unknown_vulnerability',        desc: 'A weakness that, when exploited, compromises a security property.' },
      exploit:               { universal: 'recursive_exploit',            desc: 'Code or technique that turns a vulnerability into actual compromise.' },
      defense_in_depth:      { universal: 'margin_of_safety',             desc: 'Layered controls so that no single failure leads to total compromise.' },
      least_privilege:       { universal: 'authority_boundary',           desc: 'Grant only the minimum permissions required for a task.' },
      zero_trust:            { universal: 'systematic_review',            desc: 'Never trust by location — verify every request explicitly.' },
      hardening:              { universal: 'defensibility',                desc: 'Reducing attack surface by disabling unused features and tightening defaults.' },
      patch:                 { universal: 'corrective_action',            desc: 'A targeted update that closes a known vulnerability.' },
      incident_response:     { universal: 'corrective_action',            desc: 'Coordinated process for detecting, containing, and recovering from compromise.' },
      red_team:              { universal: 'pre_commitment_audit',         desc: 'Adversarial exercise simulating realistic attackers against your defenses.' },
      kill_chain:            { universal: 'directional_succession',       desc: 'The ordered phases an attacker traverses from recon to objective.' },
      side_channel:          { universal: 'information_advantage',        desc: 'Leakage through timing, power, or other non-intended channels.' },
      auth_factor:           { universal: 'evidence_threshold',           desc: 'Independent piece of evidence (something you know/have/are) for identity.' },
      session_token:         { universal: 'persistent_state',             desc: 'A credential proving an authenticated session, valid until expiry.' },
    },
  },
  photography: {
    domain: 'Photography & Image',
    concepts: {
      exposure:              { universal: 'exposure_setting',             desc: 'Calibrated trade-off among aperture, shutter, and ISO determining brightness.' },
      depth_of_field:        { universal: 'depth_of_field',               desc: 'Range of acceptable sharpness around the focal plane.' },
      bokeh:                 { universal: 'irrelevant_variation',         desc: 'Aesthetic quality of out-of-focus regions; non-signal that pleases.' },
      composition:           { universal: 'visual_composition',           desc: 'Deliberate arrangement of elements within a frame to direct attention.' },
      white_balance:          { universal: 'time_avg_value',                desc: 'Calibrating color so neutral subjects render neutral under any light.' },
      iso:                   { universal: 'capacity',                     desc: 'Sensor sensitivity to light — higher means brighter but noisier.' },
      shutter_speed:         { universal: 'execution_rate',               desc: 'Duration the sensor is exposed — controls motion blur.' },
      aperture:              { universal: 'capacity_rate',                desc: 'Lens opening size — controls depth of field and total light.' },
      focal_length:           { universal: 'authority_boundary',            desc: 'Lens property determining angle of view and apparent compression.' },
      golden_hour:           { universal: 'operating_context',            desc: 'Brief window after sunrise / before sunset when warm soft light is ideal.' },
      raw:                   { universal: 'persistent_state',             desc: 'Unprocessed sensor data preserving full editing latitude.' },
      framing:                { universal: 'authority_boundary',            desc: 'What the photographer chose to include or exclude.' },
      negative_space:        { universal: 'gap_cost',                     desc: 'Empty area around a subject — gives breath, directs eye.' },
      dynamic_range:         { universal: 'capacity',                     desc: 'Span between darkest and brightest values a sensor can record.' },
    },
  },
  negotiation: {
    domain: 'Negotiation & Deals',
    concepts: {
      batna:                 { universal: 'best_alternative',             desc: 'Best alternative to a negotiated agreement — your walk-away floor.' },
      anchor:                { universal: 'anchor_value',                 desc: 'A reference number that biases all subsequent counter-offers.' },
      concession:            { universal: 'reciprocal_concession',        desc: 'A reciprocal give-back to maintain momentum and signal flexibility.' },
      framing:               { universal: 'visual_composition',           desc: 'How the same offer is presented — gain vs. loss, choice vs. ultimatum.' },
      walk_away:             { universal: 'best_alternative',             desc: 'The point past which staying costs more than leaving.' },
      reservation_price:     { universal: 'evidence_threshold',           desc: 'The most one party will accept or pay before walking.' },
      zopa:                  { universal: 'stable_equilibrium',           desc: 'Zone of possible agreement — overlap of acceptable ranges.' },
      logrolling:            { universal: 'capability_merger',            desc: 'Trading across issues you value differently to reach mutual gain.' },
      bargaining_power:      { universal: 'defensibility',                desc: 'Leverage derived from alternatives, information, time, and stakes.' },
      mediation:             { universal: 'upward_delegation',            desc: 'A neutral third party assisting parties to a voluntary settlement.' },
      arbitration:           { universal: 'upward_delegation',            desc: 'A neutral decision-maker imposing a binding outcome.' },
      sunk_cost:             { universal: 'known_incompatibility',        desc: "Past expenditures that should not influence forward decisions but often do." },
      reciprocity:           { universal: 'voluntary_agreement',          desc: 'The norm that gifts and concessions create return obligations.' },
      ultimatum:             { universal: 'unchanging_constraint',        desc: 'A take-it-or-leave-it offer that ends bargaining if rejected.' },
    },
  },
  buddhism: {
    domain: 'Buddhism & Dharma',
    concepts: {
      dukkha:                { universal: 'civil_harm',                   desc: 'Unsatisfactoriness — the friction inherent in clinging to impermanent things.' },
      anicca:                { universal: 'impermanence',                 desc: 'Inherent transience of all conditioned phenomena.' },
      anatta:                { universal: 'pattern_generalization',       desc: 'Non-self — what we call "self" is a process, not a thing.' },
      karma:                 { universal: 'cascade_effect',               desc: 'Intentional action shaping future experience through causal continuity.' },
      sangha:                { universal: 'aligned_group',                desc: 'Community of practitioners supporting shared liberation.' },
      mindfulness:           { universal: 'mindfulness',                  desc: 'Sustained attention to present experience without evaluative judgment.' },
      metta:                 { universal: 'voluntary_agreement',          desc: 'Loving-kindness — unconditional benevolence cultivated as practice.' },
      jhana:                 { universal: 'meditative_absorption',        desc: 'A deeply concentrated meditative state with characteristic factors.' },
      sunyata:               { universal: 'pattern_generalization',       desc: 'Emptiness — phenomena lack independent essence; arise dependently.' },
      nirvana:               { universal: 'liberation',                   desc: 'Cessation of clinging-fueled becoming — peace beyond conditioning.' },
      bodhicitta:            { universal: 'aligned_group',                desc: 'The mind oriented toward liberation for the sake of all beings.' },
      eight_fold_path:       { universal: 'directional_succession',       desc: 'A practical training in view, intention, action, livelihood, effort, and concentration.' },
      pratityasamutpada:     { universal: 'cascade_effect',               desc: 'Dependent origination — every phenomenon arises from conditions, not isolated.' },
      upaya:                 { universal: 'adaptive_delivery',            desc: 'Skillful means — adjusting teaching to the receiver\'s capacity.' },
    },
  },
  stoicism: {
    domain: 'Stoicism',
    concepts: {
      dichotomy_of_control:  { universal: 'authority_boundary',           desc: 'Distinguishing what is up to us from what is not — and acting accordingly.' },
      virtue:                { universal: 'foundational_axiom',           desc: 'Excellence of character — the only true good per the Stoics.' },
      premeditatio:          { universal: 'premeditatio',                 desc: 'Deliberate visualization of adversity in advance to soften its impact.' },
      amor_fati:             { universal: 'amor_fati',                    desc: 'Love of fate — embracing all that happens as necessary and chosen.' },
      memento_mori:          { universal: 'impermanence',                 desc: 'Reflection on mortality to clarify what truly matters now.' },
      apatheia:              { universal: 'stable_equilibrium',           desc: 'Freedom from disturbing passions while retaining proper engagement.' },
      logos:                 { universal: 'foundational_axiom',           desc: 'The rational order pervading the cosmos with which one aligns.' },
      cosmopolitanism:       { universal: 'aligned_group',                desc: 'All rational beings as fellow citizens of one community.' },
      view_from_above:       { universal: 'pattern_generalization',       desc: 'Zooming out to perceive one\'s situation in cosmic and historical scale.' },
      self_examination:      { universal: 'systematic_review',            desc: 'Daily review of conduct against virtue and reason.' },
      role_ethics:           { universal: 'assigned_responsibility',      desc: 'Acting well according to the roles one occupies in life.' },
      preferred_indifferent: { universal: 'voluntary_agreement',          desc: 'Externals (health, wealth) preferred but not intrinsically good or bad.' },
      sympatheia:            { universal: 'mutualistic_co_location',      desc: 'Mutual interconnection of all things in a single rational whole.' },
    },
  },
  cybernetics: {
    domain: 'Cybernetics & Control',
    concepts: {
      feedback_loop:         { universal: 'feedback_loop',                desc: 'Output of a process becoming input — the engine of self-regulation.' },
      homeostasis:           { universal: 'homeostasis',                  desc: 'Active maintenance of an internal state against external perturbation.' },
      requisite_variety:     { universal: 'requisite_variety',            desc: "A controller must match the variety of the system being controlled." },
      attractor:             { universal: 'attractor_state',              desc: 'A state pattern toward which a dynamical system tends over time.' },
      hysteresis:            { universal: 'hysteresis',                   desc: 'Path-dependent state — current value depends on history.' },
      black_box:             { universal: 'authority_boundary',           desc: 'A system understood only by inputs and outputs, not internals.' },
      observer:              { universal: 'supervision',                  desc: 'A system that derives information about another system without controlling it.' },
      controller:            { universal: 'capability_amplifier',         desc: 'A system that adjusts inputs to drive a controlled system toward a target.' },
      autopoiesis:           { universal: 'cyclic_renewal',               desc: 'A system that continuously produces and maintains the components of itself.' },
      emergence:             { universal: 'emergence',                    desc: 'Higher-level pattern arising from lower-level interactions.' },
      open_system:           { universal: 'cross_domain_link',            desc: 'A system that exchanges matter, energy, or information with its environment.' },
      damping:               { universal: 'corrective_action',            desc: 'Mechanism that reduces oscillation amplitude over time.' },
      gain:                  { universal: 'capability_amplifier',         desc: 'Multiplier between input and output of a control loop.' },
      delay:                 { universal: 'delay',                        desc: 'Time lag between cause and observed effect that destabilizes naive control.' },
      stigmergy:             { universal: 'spontaneous_order',            desc: 'Coordination via traces left in the environment, without direct communication.' },
    },
  },
}

// ============ Mutable State ============

/** Reverse map: universal concept → list of { agent, term, desc } entries */
let _universalIndex = null

/** Cache for buildTermSurfaces: lexiconId → Map<normPhrase, entry> */
const _termSurfaceCache = new Map()

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
    // Fuzzy suggestion — find the closest term in the source lexicon
    const suggestions = fuzzyFindTerms(fromLexicon.concepts, concept, 3)
    const didYouMean = suggestions.length > 0 ? suggestions[0].term : null
    return {
      error: `'${concept}' not in ${fromId}'s lexicon`,
      translated: false,
      available: Object.keys(fromLexicon.concepts),
      suggestions: suggestions.map(s => s.term),
      didYouMean,
      hint: didYouMean ? `Did you mean '${didYouMean}'?` : undefined,
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
export function discoverEquivalent(searchTerm) {
  const idx = getIndex()
  const q = (searchTerm || '').toLowerCase().trim().replace(/_/g, ' ')
  if (!q) return { term: searchTerm, found: false, equivalents: [], error: 'Empty search' }

  // Phase 1: Exact key match
  let universal = null
  let sourceInfo = null

  for (const [agentId, lexicon] of Object.entries(LEXICONS)) {
    if (lexicon.concepts[searchTerm]) {
      universal = lexicon.concepts[searchTerm].universal
      sourceInfo = { type: 'agent', id: agentId, domain: lexicon.domain, desc: lexicon.concepts[searchTerm].desc }
      break
    }
  }
  if (!universal) {
    for (const [userId, lexicon] of _userLexicons.entries()) {
      if (lexicon.concepts && lexicon.concepts[searchTerm]) {
        universal = lexicon.concepts[searchTerm].universal
        sourceInfo = { type: 'user', id: userId, domain: lexicon.domain, desc: lexicon.concepts[searchTerm].desc }
        break
      }
    }
  }

  // Phase 2: Pairwise fuzzy — search ALL terms, descriptions, universals, domains
  if (!universal) {
    const hits = []
    const qWords = q.split(/\s+/)

    for (const [agentId, lexicon] of Object.entries(LEXICONS)) {
      const domainLower = (lexicon.domain || '').toLowerCase()
      for (const [termKey, termData] of Object.entries(lexicon.concepts)) {
        const termLower = termKey.toLowerCase().replace(/_/g, ' ')
        const descLower = (termData.desc || '').toLowerCase()
        const univLower = (termData.universal || '').toLowerCase().replace(/_/g, ' ')
        let score = 0
        if (termLower === q) score = 100
        else if (termLower.includes(q)) score = 85
        else if (descLower.includes(q)) score = 70
        else if (univLower.includes(q)) score = 60
        else if (domainLower.includes(q)) score = 40
        else if (qWords.some(w => w.length > 2 && (termLower.includes(w) || descLower.includes(w) || univLower.includes(w)))) score = 50
        if (score > 0) hits.push({ lexicon: agentId, term: termKey, description: termData.desc, universal: termData.universal, confidence: score, approximate: score < 100 })
      }
    }
    for (const [userId, lexicon] of _userLexicons.entries()) {
      for (const [termKey, termData] of Object.entries(lexicon.concepts || {})) {
        const termLower = termKey.toLowerCase().replace(/_/g, ' ')
        const descLower = (termData.desc || '').toLowerCase()
        let score = 0
        if (termLower === q) score = 100
        else if (termLower.includes(q)) score = 85
        else if (descLower.includes(q)) score = 70
        if (score > 0) hits.push({ lexicon: `user:${userId}`, term: termKey, description: termData.desc, universal: termData.universal, confidence: score, approximate: score < 100 })
      }
    }
    if (typeof EXTENDED_UNIVERSAL_CONCEPTS !== 'undefined') {
      for (const [key, desc] of Object.entries(EXTENDED_UNIVERSAL_CONCEPTS)) {
        const keyLower = key.toLowerCase().replace(/_/g, ' ')
        const descLower = (desc || '').toLowerCase()
        if (keyLower.includes(q) || descLower.includes(q)) {
          for (const entry of (idx[key] || [])) {
            hits.push({ lexicon: entry.agent, term: entry.term, description: entry.desc, universal: key, confidence: keyLower.includes(q) ? 65 : 55, approximate: true })
          }
        }
      }
    }
    if (hits.length === 0) return { term: searchTerm, found: false, error: `No results for '${searchTerm}'. Try a related concept or broader term.`, equivalents: [] }
    const seen = new Map()
    for (const h of hits) { const k = `${h.lexicon}:${h.term}`; if (!seen.has(k) || seen.get(k).confidence < h.confidence) seen.set(k, h) }
    const deduped = Array.from(seen.values()).sort((a, b) => b.confidence - a.confidence).slice(0, 30)
    return { term: searchTerm, found: true, fuzzySearch: true, source: null, universal: deduped[0]?.universal || null, exactMatches: deduped.filter(h => h.confidence === 100), approximateMatches: deduped.filter(h => h.confidence < 100), equivalents: deduped, totalEquivalents: deduped.length }
  }

  if (!universal) {
    return { term: searchTerm, found: false, error: `'${searchTerm}' not found in any registered lexicon`, equivalents: [] }
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
  _termSurfaceCache.clear() // invalidate surface cache
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
  _termSurfaceCache.delete(userId) // invalidate just this user's surface cache
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

/**
 * Export a user's lexicon as a JSON string suitable for download/sharing.
 * The exported object includes a schema version, userId, domain, and all terms.
 * Returns null if the userId has no registered lexicon.
 *
 * @param {string} userId
 * @returns {string|null}
 */
export function exportLexicon(userId) {
  if (!userId) return null
  const lexicon = _userLexicons.get(userId)
  if (!lexicon) return null

  const payload = {
    schema: 'rosetta-lexicon-v1',
    exportedAt: new Date().toISOString(),
    userId,
    domain: lexicon.domain,
    terms: Object.entries(lexicon.concepts).map(([term, m]) => ({
      term,
      universal: m.universal,
      description: m.desc || '',
    })),
  }
  return JSON.stringify(payload, null, 2)
}

/**
 * Import a lexicon from a JSON string (previously exported via exportLexicon).
 * The imported lexicon is registered under the userId stored in the JSON.
 * If the userId already has a lexicon, terms are merged (imported terms win on conflict).
 *
 * @param {string} jsonString
 * @returns {{ imported: boolean, userId: string, domain: string, termCount: number }|{ error: string }}
 */
export function importLexicon(jsonString) {
  let payload
  try {
    payload = JSON.parse(jsonString)
  } catch {
    return { error: 'Invalid JSON — could not parse file.' }
  }

  if (!payload || payload.schema !== 'rosetta-lexicon-v1') {
    return { error: 'Unrecognised format. Expected a Rosetta lexicon-v1 export.' }
  }

  const { userId, domain, terms } = payload
  if (!userId || typeof userId !== 'string') return { error: 'Missing userId in export.' }
  if (!domain  || typeof domain  !== 'string') return { error: 'Missing domain in export.' }
  if (!Array.isArray(terms)) return { error: 'Missing terms array in export.' }

  // Merge into existing lexicon or create new one
  if (!_userLexicons.has(userId)) {
    _userLexicons.set(userId, { domain, concepts: {} })
  }

  const lexicon = _userLexicons.get(userId)
  // Allow domain update on import only if current domain is the generic 'Custom'
  if (lexicon.domain === 'Custom') lexicon.domain = domain

  let imported = 0
  for (const entry of terms) {
    if (!entry.term || !entry.universal) continue
    lexicon.concepts[entry.term] = {
      universal: entry.universal,
      desc: entry.description || '',
    }
    imported++
  }

  _universalIndex = null // invalidate
  _termSurfaceCache.clear() // invalidate all surface caches on import
  saveUserLexicons()

  return { imported: true, userId, domain: lexicon.domain, termCount: imported }
}

// ============ Fuzzy Term Matching ============

/**
 * Levenshtein edit distance between two strings.
 * Used as the backbone of fuzzy term matching.
 * O(m*n) — fine for short term names.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function levenshtein(a, b) {
  const m = a.length
  const n = b.length
  const dp = Array.from({ length: m + 1 }, (_, i) => [i])
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1]
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
      }
    }
  }
  return dp[m][n]
}

/**
 * Normalised similarity in [0,1] — 1 = identical, 0 = completely different.
 * Uses Levenshtein distance divided by the length of the longer string.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function stringSimilarity(a, b) {
  if (a === b) return 1
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return 1
  return 1 - levenshtein(a, b) / maxLen
}

/**
 * Find the closest term(s) in a lexicon for a given query string.
 * Considers both exact substring containment and Levenshtein similarity.
 * Under-scores and spaces are normalised before comparison.
 *
 * @param {object} lexiconConcepts - the `concepts` map of a lexicon
 * @param {string} query           - the user's input term
 * @param {number} topN            - how many candidates to return (default 3)
 * @returns {Array<{ term: string, score: number }>}   sorted best→worst
 */
function fuzzyFindTerms(lexiconConcepts, query, topN = 3) {
  const normalise = s => s.toLowerCase().replace(/[\s_-]+/g, '_')
  const normQuery = normalise(query)

  const scored = Object.keys(lexiconConcepts).map(term => {
    const normTerm = normalise(term)
    // Exact contains — strong bonus
    const containsBonus = normTerm.includes(normQuery) || normQuery.includes(normTerm) ? 0.15 : 0
    const sim = stringSimilarity(normQuery, normTerm) + containsBonus
    return { term, score: Math.min(sim, 1) }
  })

  return scored
    .filter(x => x.score > 0.3)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
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

// ============ Sentence Translator ============

/**
 * Segment type definitions:
 *   { type: 'text', text: string }                 — plain text, no match
 *   { type: 'term', text: string, term: string,    — recognized domain term
 *     universal: string, toTerm: string|null,
 *     fromDesc: string, toDesc: string,
 *     confidence: number }
 */

/**
 * Normalise a string for matching: lowercase, collapse whitespace to single
 * space, strip punctuation at boundaries.
 */
function normaliseForMatch(s) {
  return s.toLowerCase().replace(/[^a-z0-9\s_]/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Build a flat lookup of all terms in a lexicon, keyed by normalised surface form.
 * Terms with underscores are also registered as their space-separated equivalents.
 * Results are cached by lexiconId so repeated calls (e.g. per-keystroke) are O(1).
 *
 * Returns Map<normalisedPhrase, { term: string, universal: string, desc: string }>
 */
function buildTermSurfaces(lexicon, lexiconId) {
  if (lexiconId && _termSurfaceCache.has(lexiconId)) {
    return _termSurfaceCache.get(lexiconId)
  }
  const map = new Map()
  if (!lexicon) return map
  for (const [term, mapping] of Object.entries(lexicon.concepts)) {
    const surfaces = [
      term,
      term.replace(/_/g, ' '),
      term.replace(/_/g, '-'),
    ]
    for (const s of surfaces) {
      const norm = normaliseForMatch(s)
      if (norm) map.set(norm, { term, universal: mapping.universal, desc: mapping.desc })
    }
  }
  if (lexiconId) _termSurfaceCache.set(lexiconId, map)
  return map
}

/**
 * Translate a free-form paragraph from one domain lexicon to another.
 *
 * Algorithm:
 *   - Scan the text with a greedy longest-match approach against all source terms.
 *   - For each matched term, look up its translation in the target lexicon.
 *   - Return an array of annotated segments (text | term) plus a translated string.
 *
 * @param {string} text    - The source paragraph
 * @param {string} fromId  - Source lexicon id (e.g. 'medicine')
 * @param {string} toId    - Target lexicon id (e.g. 'engineering')
 * @returns {{
 *   segments: Array,
 *   translatedText: string,
 *   matchCount: number,
 *   translatedCount: number
 * }}
 */
/**
 * `translateSentence(fromId, text, toId?)` — Parse a sentence from `fromId`'s
 * vocabulary, identify known terms, and return annotated text with translations
 * inline.
 *
 * When `toId` is omitted the output is annotated with universal concept keys
 * instead of a target lexicon's equivalent term.  This is the two-argument
 * form described in the spec: `translateSentence(fromId, text)`.
 *
 * When `toId` is supplied each matched source term is also translated into
 * the target lexicon, giving inline bilingual annotations.
 *
 * @param {string} fromId - Source lexicon id
 * @param {string} text   - Free-form text to annotate
 * @param {string} [toId] - Optional target lexicon id
 */
export function translateSentence(fromId, text, toId) {
  const fromLexicon = fromId.startsWith('user:')
    ? _userLexicons.get(fromId.slice(5))
    : LEXICONS[fromId]

  // toId is optional — when absent we annotate with universal keys
  const toLexicon = toId
    ? (toId.startsWith('user:') ? _userLexicons.get(toId.slice(5)) : LEXICONS[toId])
    : null

  if (!fromLexicon) {
    return { segments: [{ type: 'text', text }], translatedText: text, matchCount: 0, translatedCount: 0 }
  }
  if (toId && !toLexicon) {
    return { segments: [{ type: 'text', text }], translatedText: text, matchCount: 0, translatedCount: 0 }
  }

  // Build surface-form lookup for the source lexicon (cached by lexiconId)
  const surfaces = buildTermSurfaces(fromLexicon, fromId)

  // Sort surface keys longest-first for greedy match
  const sortedKeys = [...surfaces.keys()].sort((a, b) => b.length - a.length)

  // Maximum phrase length in words (for the scanning window)
  const maxWords = Math.max(...sortedKeys.map(k => k.split(' ').length), 1)

  // Tokenise text into words preserving whitespace and punctuation around them.
  // We split on word boundaries while keeping the delimiters so we can reconstruct.
  // Strategy: split into alternating [word, non-word] chunks.
  const chunks = text.split(/(\b)/)

  // Simpler approach: split text into tokens (word runs and whitespace/punct runs)
  const tokens = []
  const tokenRe = /([a-zA-Z0-9_'-]+|[^a-zA-Z0-9_'-]+)/g
  let m
  while ((m = tokenRe.exec(text)) !== null) {
    tokens.push(m[1])
  }

  // Identify which tokens are "word" tokens vs separators
  const isWord = t => /[a-zA-Z0-9]/.test(t)

  // Build an index of word-token positions
  const wordTokenIdx = tokens.reduce((acc, t, i) => {
    if (isWord(t)) acc.push(i)
    return acc
  }, [])

  const segments = []
  let wi = 0 // index into wordTokenIdx

  while (wi < wordTokenIdx.length) {
    let matched = false

    // Try windows of decreasing size starting at maxWords
    for (let windowSize = Math.min(maxWords, wordTokenIdx.length - wi); windowSize >= 1; windowSize--) {
      // Collect the token indices for this window (word tokens only)
      const firstWordTokIdx = wordTokenIdx[wi]
      const lastWordTokIdx  = wordTokenIdx[wi + windowSize - 1]

      // Grab all tokens between first and last word token (inclusive) to form the phrase
      const phraseTokens = tokens.slice(firstWordTokIdx, lastWordTokIdx + 1)
      const phrase = phraseTokens.join('')
      const normPhrase = normaliseForMatch(phrase)

      const entry = surfaces.get(normPhrase)
      if (entry) {
        // Emit any accumulated non-word tokens before this window
        if (firstWordTokIdx > 0) {
          // Find what tokens came before this window that haven't been emitted yet.
          // We track via a cursor on the raw tokens array.
          // NOTE: we handle this via the cursor approach below — see restructured loop.
        }

        // Look up translation
        const r = translate(fromId, toId, entry.term)

        segments.push({
          type: 'term',
          text: phrase,
          term: entry.term,
          universal: entry.universal,
          fromDesc: entry.desc,
          toTerm: r.translated ? r.to_term : null,
          toDesc: r.translated ? (r.to_desc || '') : '',
          confidence: r.confidence || 0,
        })

        wi += windowSize
        matched = true
        break
      }
    }

    if (!matched) {
      // Emit this single word token as plain text
      segments.push({ type: 'text', text: tokens[wordTokenIdx[wi]] })
      wi++
    }
  }

  // The above approach loses inter-word separators. Let's redo with a proper cursor approach.
  // Clear and rebuild:
  segments.length = 0

  let tokenCursor = 0 // position in `tokens` array

  wi = 0
  while (wi < wordTokenIdx.length) {
    const firstWordTokIdx = wordTokenIdx[wi]

    // Emit any separator tokens before the current word token
    while (tokenCursor < firstWordTokIdx) {
      segments.push({ type: 'text', text: tokens[tokenCursor] })
      tokenCursor++
    }

    let matched = false
    for (let windowSize = Math.min(maxWords, wordTokenIdx.length - wi); windowSize >= 1; windowSize--) {
      const lastWordTokIdx = wordTokenIdx[wi + windowSize - 1]
      const phraseTokens = tokens.slice(firstWordTokIdx, lastWordTokIdx + 1)
      const phrase = phraseTokens.join('')
      const normPhrase = normaliseForMatch(phrase)

      const entry = surfaces.get(normPhrase)
      if (entry) {
        // When toId is omitted, annotate with the universal concept directly
        let toTerm = null
        let toDesc = ''
        let confidence = 0
        if (toId) {
          const r = translate(fromId, toId, entry.term)
          toTerm = r.translated ? r.to_term : null
          toDesc = r.translated ? (r.to_desc || '') : ''
          confidence = r.confidence || 0
        } else {
          // Universal annotation mode — use the universal key as the "translation"
          toTerm = entry.universal
          toDesc = EXTENDED_UNIVERSAL_CONCEPTS[entry.universal] || ''
          confidence = 100
        }
        segments.push({
          type: 'term',
          text: phrase,
          term: entry.term,
          universal: entry.universal,
          universalDefinition: EXTENDED_UNIVERSAL_CONCEPTS[entry.universal] || '',
          fromDesc: entry.desc,
          toTerm,
          toDesc,
          confidence,
        })
        // Advance tokenCursor past all tokens consumed by this window
        tokenCursor = lastWordTokIdx + 1
        wi += windowSize
        matched = true
        break
      }
    }

    if (!matched) {
      segments.push({ type: 'text', text: tokens[firstWordTokIdx] })
      tokenCursor = firstWordTokIdx + 1
      wi++
    }
  }

  // Emit any trailing separator tokens
  while (tokenCursor < tokens.length) {
    segments.push({ type: 'text', text: tokens[tokenCursor] })
    tokenCursor++
  }

  // Merge consecutive text segments
  const merged = []
  for (const seg of segments) {
    if (seg.type === 'text' && merged.length > 0 && merged[merged.length - 1].type === 'text') {
      merged[merged.length - 1].text += seg.text
    } else {
      merged.push({ ...seg })
    }
  }

  // Build annotated/translated text.
  // • With toId: replace matched source terms with their target-lexicon equivalent.
  // • Without toId (universal-annotation mode): keep original text but append
  //   inline annotations like "diagnosis[→systematic_review]".
  const translatedText = merged
    .map(seg => {
      if (seg.type !== 'term') return seg.text
      if (toId) {
        // Bilingual mode: substitute with target term (or keep original if no match)
        return seg.toTerm ? seg.toTerm.replace(/_/g, ' ') : seg.text
      } else {
        // Universal annotation mode: original text + inline tag
        return `${seg.text}[→${seg.universal}]`
      }
    })
    .join('')

  const matchCount = merged.filter(s => s.type === 'term').length
  const translatedCount = merged.filter(s => s.type === 'term' && s.toTerm).length

  return { segments: merged, translatedText, annotatedText: translatedText, matchCount, translatedCount }
}

// ============ Related Concepts ============

/**
 * Given a universal concept key, find other universal concepts that frequently
 * co-occur in the same lexicons — i.e. both are used by many of the same
 * domains.  These are the "conceptual neighbours": ideas that tend to appear
 * in the same intellectual vocabulary.
 *
 * Co-occurrence score = number of distinct lexicons that have a term mapped to
 * *both* `universalKey` and the candidate universal.
 *
 * @param {string} universalKey - A key used as a `.universal` value in any
 *   lexicon (e.g. 'systematic_review', 'backup_capacity').  Does not have to
 *   be in EXTENDED_UNIVERSAL_CONCEPTS — any key present in the index works.
 * @returns {{
 *   universalKey: string,
 *   definition: string,
 *   found: boolean,
 *   sourceLexiconCount?: number,
 *   suggestions?: string[],
 *   error?: string,
 *   related: Array<{
 *     universal: string,
 *     definition: string,
 *     coOccurrenceScore: number,
 *     sharedLexicons: string[],
 *     sampleTerms: Array<{ lexicon: string, term: string }>
 *   }>
 * }}
 */
export function getRelatedConcepts(universalKey) {
  const idx = getIndex()

  if (!idx[universalKey]) {
    // Offer fuzzy suggestions against known indexed universals
    const knownUniversals = Object.keys(idx)
    const suggestions = fuzzyFindTerms(
      Object.fromEntries(knownUniversals.map(k => [k, {}])),
      universalKey,
      3
    ).map(s => s.term)
    return {
      universalKey,
      definition: EXTENDED_UNIVERSAL_CONCEPTS[universalKey] || '',
      found: false,
      error: `Universal concept '${universalKey}' has no lexicon mappings`,
      suggestions,
      related: [],
    }
  }

  // Lexicons that contain a term mapped to universalKey
  const sourceLexicons = new Set(idx[universalKey].map(e => e.agent))

  // Score every other universal by how many of those same lexicons also map it
  const scores = {}
  for (const [otherUniversal, entries] of Object.entries(idx)) {
    if (otherUniversal === universalKey) continue
    const otherLexicons = new Set(entries.map(e => e.agent))
    const shared = [...sourceLexicons].filter(l => otherLexicons.has(l))
    if (shared.length > 0) {
      scores[otherUniversal] = {
        universal: otherUniversal,
        definition: EXTENDED_UNIVERSAL_CONCEPTS[otherUniversal] || '',
        coOccurrenceScore: shared.length,
        sharedLexicons: shared,
        sampleTerms: entries
          .filter(e => shared.includes(e.agent))
          .slice(0, 4)
          .map(e => ({ lexicon: e.agent, term: e.term })),
      }
    }
  }

  const related = Object.values(scores)
    .sort((a, b) => {
      if (b.coOccurrenceScore !== a.coOccurrenceScore)
        return b.coOccurrenceScore - a.coOccurrenceScore
      return a.universal.localeCompare(b.universal)
    })
    .slice(0, 20)

  return {
    universalKey,
    definition: EXTENDED_UNIVERSAL_CONCEPTS[universalKey] || '',
    found: true,
    sourceLexiconCount: sourceLexicons.size,
    related,
  }
}

// ============ Concept Chain ============

/**
 * Find the shortest path between two terms through the universal concept graph.
 *
 * Graph topology:
 *   • Nodes   — universal concept keys (the `.universal` values in each lexicon)
 *   • Edges   — two universals are adjacent when at least one lexicon maps a
 *               term to each of them (co-occurrence edge)
 *
 * The search is a standard BFS so the result is always the shortest path in
 * hop count.  Maximum search depth is 6 hops; returns `found: false` if no
 * path is found within that limit.
 *
 * Path types:
 *   • 0 hops — termA and termB share the exact same universal concept
 *   • N hops — A→u0→u1→…→uN  each step shares at least one lexicon
 *
 * @param {string} termA - A term in any registered lexicon
 * @param {string} termB - A term in any registered lexicon
 * @returns {{
 *   termA: string,
 *   termB: string,
 *   found: boolean,
 *   hops: number,
 *   path: Array<{
 *     node: string,
 *     definition: string,
 *     termAMapping?: { term: string, lexicon: string, desc: string },
 *     termBMapping?: { term: string, lexicon: string, desc: string },
 *     via?: {
 *       fromNode: string,
 *       sharedLexicons: string[],
 *       sampleTerms: Array<{ lexicon: string, term: string }>
 *     }
 *   }>,
 *   universalA?: string,
 *   universalB?: string,
 *   error?: string,
 *   suggestions?: string[]
 * }}
 */
export function getConceptChain(termA, termB) {
  const idx = getIndex()

  // Resolve a term to its universal concept, searching all lexicons
  function findUniversal(term) {
    for (const [agentId, lexicon] of Object.entries(LEXICONS)) {
      if (lexicon.concepts[term]) {
        return {
          universal: lexicon.concepts[term].universal,
          lexiconId: agentId,
          desc: lexicon.concepts[term].desc,
        }
      }
    }
    for (const [userId, lexicon] of _userLexicons.entries()) {
      if (lexicon.concepts[term]) {
        return {
          universal: lexicon.concepts[term].universal,
          lexiconId: `user:${userId}`,
          desc: lexicon.concepts[term].desc,
        }
      }
    }
    return null
  }

  // Build a flat term→{} map for fuzzy suggestions
  function allTermsMap() {
    const m = {}
    for (const lex of Object.values(LEXICONS)) Object.assign(m, lex.concepts)
    for (const lex of _userLexicons.values()) Object.assign(m, lex.concepts)
    return m
  }

  const infoA = findUniversal(termA)
  if (!infoA) {
    return {
      termA, termB, found: false, hops: -1, path: [],
      error: `'${termA}' not found in any lexicon`,
      suggestions: fuzzyFindTerms(allTermsMap(), termA, 3).map(s => s.term),
    }
  }

  const infoB = findUniversal(termB)
  if (!infoB) {
    return {
      termA, termB, found: false, hops: -1, path: [],
      error: `'${termB}' not found in any lexicon`,
      suggestions: fuzzyFindTerms(allTermsMap(), termB, 3).map(s => s.term),
    }
  }

  const startU = infoA.universal
  const endU   = infoB.universal

  // 0-hop: same universal hub
  if (startU === endU) {
    return {
      termA, termB, found: true, hops: 0,
      universalA: startU, universalB: endU,
      path: [{
        node: startU,
        definition: EXTENDED_UNIVERSAL_CONCEPTS[startU] || '',
        termAMapping: { term: termA, lexicon: infoA.lexiconId, desc: infoA.desc },
        termBMapping: { term: termB, lexicon: infoB.lexiconId, desc: infoB.desc },
      }],
    }
  }

  // Build neighbours lazily (co-occurrence edges)
  function getNeighbours(universalKey) {
    if (!idx[universalKey]) return []
    const sourceLexicons = new Set(idx[universalKey].map(e => e.agent))
    const neighbours = []
    for (const [otherU, entries] of Object.entries(idx)) {
      if (otherU === universalKey) continue
      const shared = entries.map(e => e.agent).filter(l => sourceLexicons.has(l))
      if (shared.length > 0) {
        neighbours.push({
          universal: otherU,
          sharedLexicons: [...new Set(shared)],
          sampleTerms: entries
            .filter(e => shared.includes(e.agent))
            .slice(0, 3)
            .map(e => ({ lexicon: e.agent, term: e.term })),
        })
      }
    }
    return neighbours
  }

  // BFS
  const MAX_HOPS = 6
  const visited = new Set([startU])
  const queue = [{
    universal: startU,
    pathSoFar: [{
      node: startU,
      definition: EXTENDED_UNIVERSAL_CONCEPTS[startU] || '',
      termAMapping: { term: termA, lexicon: infoA.lexiconId, desc: infoA.desc },
    }],
  }]

  while (queue.length > 0) {
    const { universal, pathSoFar } = queue.shift()
    if (pathSoFar.length > MAX_HOPS) continue

    for (const { universal: nextU, sharedLexicons, sampleTerms } of getNeighbours(universal)) {
      if (visited.has(nextU)) continue
      visited.add(nextU)

      const nextStep = {
        node: nextU,
        definition: EXTENDED_UNIVERSAL_CONCEPTS[nextU] || '',
        via: { fromNode: universal, sharedLexicons, sampleTerms },
      }

      if (nextU === endU) {
        nextStep.termBMapping = { term: termB, lexicon: infoB.lexiconId, desc: infoB.desc }
        return {
          termA, termB, found: true,
          universalA: startU, universalB: endU,
          hops: pathSoFar.length,   // number of edges = nodes - 1
          path: [...pathSoFar, nextStep],
        }
      }

      queue.push({ universal: nextU, pathSoFar: [...pathSoFar, nextStep] })
    }
  }

  return {
    termA, termB, found: false, hops: -1, path: [],
    universalA: startU, universalB: endU,
    error: `No concept chain found between '${termA}' (${startU}) and '${termB}' (${endU}) within ${MAX_HOPS} hops`,
  }
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

// ============ Detailed Stats ============

/**
 * Returns extended protocol statistics for the live stats dashboard.
 *
 * @returns {{
 *   totalLexicons: number,
 *   totalTerms: number,
 *   totalUniversalConcepts: number,
 *   mostConnected: { name: string, count: number },
 *   avgTermsPerLexicon: number,
 *   crossDomainBridges: number
 * }}
 */
export function getDetailedStats() {
  const idx = getIndex()

  // Total lexicons (static + user)
  const totalLexicons = Object.keys(LEXICONS).length + _userLexicons.size

  // Total terms across all lexicons
  let totalTerms = 0
  for (const lexicon of Object.values(LEXICONS)) {
    totalTerms += Object.keys(lexicon.concepts).length
  }
  for (const lexicon of _userLexicons.values()) {
    totalTerms += Object.keys(lexicon.concepts).length
  }

  // Total unique universal concepts
  const totalUniversalConcepts = Object.keys(idx).length

  // Most connected concept: universal key that maps to the most distinct lexicons
  let mostConnectedName = ''
  let mostConnectedCount = 0
  for (const [universal, entries] of Object.entries(idx)) {
    const distinctLexicons = new Set(entries.map(e => e.agent)).size
    if (distinctLexicons > mostConnectedCount) {
      mostConnectedCount = distinctLexicons
      mostConnectedName = universal
    }
  }

  // Average terms per lexicon (static lexicons only for stability)
  const staticLexiconCount = Object.keys(LEXICONS).length
  let staticTermTotal = 0
  for (const lexicon of Object.values(LEXICONS)) {
    staticTermTotal += Object.keys(lexicon.concepts).length
  }
  const avgTermsPerLexicon = staticLexiconCount > 0
    ? Math.round((staticTermTotal / staticLexiconCount) * 10) / 10
    : 0

  // Cross-domain bridges: universal concepts that appear in 3+ distinct lexicons
  let crossDomainBridges = 0
  for (const entries of Object.values(idx)) {
    const distinctLexicons = new Set(entries.map(e => e.agent)).size
    if (distinctLexicons >= 3) crossDomainBridges++
  }

  return {
    totalLexicons,
    totalTerms,
    totalUniversalConcepts,
    mostConnected: { name: mostConnectedName, count: mostConnectedCount },
    avgTermsPerLexicon,
    crossDomainBridges,
  }
}

// ============ Autocomplete ============

/**
 * Return up to `limit` matching term suggestions across all lexicons.
 * Each suggestion has: { term, lexiconId, domain, description, score }
 *
 * Scoring tiers:
 *   100 — exact term match
 *    90 — term starts with query
 *    80 — term contains query as substring
 *    65 — description starts-with match
 *    55 — description contains query
 *
 * Results are deduped by (lexiconId, term), sorted descending by score,
 * then capped at `limit`.
 *
 * @param {string} query
 * @param {number} [limit=8]
 * @returns {{ term: string, lexiconId: string, domain: string, description: string, score: number }[]}
 */
export function autocomplete(query, limit = 8) {
  const q = (query || '').toLowerCase().trim().replace(/_/g, ' ')
  if (!q) return []

  const hits = []

  for (const [lexiconId, lexicon] of Object.entries(LEXICONS)) {
    const domain = lexicon.domain || lexiconId
    for (const [termKey, termData] of Object.entries(lexicon.concepts)) {
      const termLower = termKey.toLowerCase().replace(/_/g, ' ')
      const descLower = (termData.desc || '').toLowerCase()

      let score = 0
      if (termLower === q)              score = 100
      else if (termLower.startsWith(q)) score = 90
      else if (termLower.includes(q))   score = 80
      else if (descLower.startsWith(q)) score = 65
      else if (descLower.includes(q))   score = 55

      if (score > 0) {
        hits.push({
          term: termKey,
          lexiconId,
          domain,
          description: termData.desc || '',
          score,
        })
      }
    }
  }

  // Include user lexicons so custom terms surface too
  for (const [userId, lexicon] of _userLexicons.entries()) {
    const domain = lexicon.domain || userId
    for (const [termKey, termData] of Object.entries(lexicon.concepts || {})) {
      const termLower = termKey.toLowerCase().replace(/_/g, ' ')
      const descLower = (termData.desc || '').toLowerCase()

      let score = 0
      if (termLower === q)              score = 100
      else if (termLower.startsWith(q)) score = 90
      else if (termLower.includes(q))   score = 80
      else if (descLower.startsWith(q)) score = 65
      else if (descLower.includes(q))   score = 55

      if (score > 0) {
        hits.push({
          term: termKey,
          lexiconId: `user:${userId}`,
          domain,
          description: termData.desc || '',
          score,
        })
      }
    }
  }

  // Dedupe by (lexiconId, term), keeping highest score
  const seen = new Map()
  for (const h of hits) {
    const k = `${h.lexiconId}:${h.term}`
    if (!seen.has(k) || seen.get(k).score < h.score) seen.set(k, h)
  }

  return Array.from(seen.values())
    .sort((a, b) => b.score - a.score || a.term.localeCompare(b.term))
    .slice(0, limit)
}

// ============ Domain Overlap ============

/**
 * Compare two domain lexicons by their shared universal concepts.
 *
 * A "universal concept" is shared when both lexicons map at least one term
 * to the same `.universal` key.
 *
 * @param {string} domainA - Lexicon id for domain A (e.g. 'medicine')
 * @param {string} domainB - Lexicon id for domain B (e.g. 'engineering')
 * @returns {{
 *   domainA: string,
 *   domainB: string,
 *   domainAName: string,
 *   domainBName: string,
 *   shared: Array<{
 *     universal: string,
 *     definition: string,
 *     termA: string,
 *     descA: string,
 *     termB: string,
 *     descB: string
 *   }>,
 *   uniqueToA: Array<{ universal: string, term: string, desc: string }>,
 *   uniqueToB: Array<{ universal: string, term: string, desc: string }>,
 *   overlapPct: number,
 *   totalA: number,
 *   totalB: number,
 *   error?: string
 * }}
 */
export function getDomainOverlap(domainA, domainB) {
  const lexA = LEXICONS[domainA] || _userLexicons.get(domainA)
  const lexB = LEXICONS[domainB] || _userLexicons.get(domainB)

  if (!lexA) return { error: `Unknown domain: ${domainA}`, shared: [], uniqueToA: [], uniqueToB: [], overlapPct: 0 }
  if (!lexB) return { error: `Unknown domain: ${domainB}`, shared: [], uniqueToA: [], uniqueToB: [], overlapPct: 0 }

  // Build universal → term maps for each lexicon
  const mapA = new Map() // universal key → { term, desc }
  for (const [term, mapping] of Object.entries(lexA.concepts)) {
    mapA.set(mapping.universal, { term, desc: mapping.desc })
  }

  const mapB = new Map() // universal key → { term, desc }
  for (const [term, mapping] of Object.entries(lexB.concepts)) {
    mapB.set(mapping.universal, { term, desc: mapping.desc })
  }

  const shared = []
  const uniqueToA = []
  const uniqueToB = []

  for (const [universal, entryA] of mapA.entries()) {
    if (mapB.has(universal)) {
      const entryB = mapB.get(universal)
      shared.push({
        universal,
        definition: EXTENDED_UNIVERSAL_CONCEPTS[universal] || '',
        termA: entryA.term,
        descA: entryA.desc,
        termB: entryB.term,
        descB: entryB.desc,
      })
    } else {
      uniqueToA.push({ universal, term: entryA.term, desc: entryA.desc })
    }
  }

  for (const [universal, entryB] of mapB.entries()) {
    if (!mapA.has(universal)) {
      uniqueToB.push({ universal, term: entryB.term, desc: entryB.desc })
    }
  }

  // Sort shared by universal key for deterministic output
  shared.sort((a, b) => a.universal.localeCompare(b.universal))
  uniqueToA.sort((a, b) => a.universal.localeCompare(b.universal))
  uniqueToB.sort((a, b) => a.universal.localeCompare(b.universal))

  // Overlap percentage = shared / union of all universal concepts touched by either domain
  const totalUnion = mapA.size + mapB.size - shared.length
  const overlapPct = totalUnion === 0 ? 0 : Math.round((shared.length / totalUnion) * 100)

  return {
    domainA,
    domainB,
    domainAName: lexA.domain || domainA,
    domainBName: lexB.domain || domainB,
    shared,
    uniqueToA,
    uniqueToB,
    overlapPct,
    totalA: mapA.size,
    totalB: mapB.size,
  }
}

// ============ CKG Append-Only Log — Hash-Chained Mutation History ============
//
// Every CKG-op mutation extends this log with a hash-chained entry. Provable
// history of how the symtab + lexicons evolved. Read-only externally.
// Each entry: { seq, prevHash, hash, op, payload, timestamp }.
//
// The chain is reset only when the runtime restarts. For cross-session
// persistence, callers can serialize via getCKGLog() and rehydrate on reload.
// ============

const CKG_LOG_KEY = 'rosetta-ckg-log-v1'
const _ckgLog = []
let _ckgPrevHash = '0'.repeat(8) // genesis prev-hash (djb2 zero)

// Hydrate from localStorage if available (browser-only; safely no-ops in Node).
try {
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem(CKG_LOG_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      if (Array.isArray(parsed) && parsed.length > 0) {
        _ckgLog.push(...parsed)
        _ckgPrevHash = parsed[parsed.length - 1].hash
      }
    }
  }
} catch { /* localStorage disabled or quota / json failure — start fresh */ }

function _persistCKGLog() {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(CKG_LOG_KEY, JSON.stringify(_ckgLog))
    }
  } catch { /* quota exceeded — log keeps running in-memory */ }
}

function _logCKG(op, payload = {}) {
  const seq = _ckgLog.length
  const timestamp = Date.now()
  const body = JSON.stringify({ seq, op, payload, timestamp, prevHash: _ckgPrevHash })
  const hash = djb2Hash(body)
  const entry = { seq, prevHash: _ckgPrevHash, hash, op, payload, timestamp }
  _ckgLog.push(entry)
  _ckgPrevHash = hash
  _persistCKGLog()
  return entry
}

/**
 * Reset the CKG log to genesis. Returns the cleared length.
 * Use sparingly — this discards provable history.
 */
export function resetCKGLog() {
  const cleared = _ckgLog.length
  _ckgLog.length = 0
  _ckgPrevHash = '0'.repeat(8)
  _persistCKGLog()
  return cleared
}

/**
 * Read-only snapshot of the CKG mutation log.
 * @returns {Array<{ seq, prevHash, hash, op, payload, timestamp }>}
 */
export function getCKGLog() {
  return _ckgLog.slice()
}

/**
 * Verify the chain integrity by recomputing each entry's hash.
 * @returns {{ ok: boolean, brokenAt: number | null }}
 */
export function verifyCKGLog() {
  let prev = '0'.repeat(8)
  for (let i = 0; i < _ckgLog.length; i++) {
    const e = _ckgLog[i]
    const body = JSON.stringify({
      seq: e.seq, op: e.op, payload: e.payload, timestamp: e.timestamp, prevHash: prev,
    })
    const expected = djb2Hash(body)
    if (e.prevHash !== prev || e.hash !== expected) {
      return { ok: false, brokenAt: i }
    }
    prev = e.hash
  }
  return { ok: true, brokenAt: null }
}

/**
 * Manually log a CKG event (for callers who perform their own mutations).
 * Returns the appended entry.
 */
export function logCKGEvent(op, payload) {
  return _logCKG(op, payload || {})
}

// ============ CKG Operations — Compiler-Level Persistence ============
//
// CKG = Compiled Knowledge Graph (see GKB, KNOWLEDGE section).
// These operations let the Rosetta protocol grow indefinitely without
// architectural redesign. Each treats lexicons as compiled objects and
// universal concepts as the cross-object symbol table.
//
//   compile-target: a lexicon (terms anchored to symtab)
//   linker:         composeLexicon
//   undef-symbol:   discoverGaps
//   semantic-diff:  lexiconSimilarity
//   symtab-extend:  registerUniversal
//   namegen:        generateGlyph
//
// Trinity: CKB (storage) / CKA (architecture) / CKG (meaning-layer).
// Growth by accretion, not redesign. The protocol describes itself in
// its own object format — see the `rosetta` lexicon in LEXICONS above.
// ============

/**
 * Compose multiple lexicons into one combined lexicon.
 * Terms sharing the same universal anchor merge under that universal.
 * Same surface term mapped to different universals = semantic conflict.
 *
 * The linker step. One object, drawn from many.
 *
 * @param {string[]} ids   - lexicon ids to combine (LEXICONS or user lexicons)
 * @param {object}   opts  - { domain?: string, keepDuplicates?: boolean }
 * @returns {{ domain, concepts, sourceIds, conflicts }}
 */
export function composeLexicon(ids, opts = {}) {
  const { domain = `Composed: ${ids.join(' + ')}`, keepDuplicates = false } = opts
  const concepts = {}
  const conflicts = []

  for (const id of ids) {
    const lex = LEXICONS[id] || _userLexicons.get(id)
    if (!lex) continue

    for (const [term, mapping] of Object.entries(lex.concepts)) {
      const existing = concepts[term]
      if (!existing) {
        concepts[term] = { ...mapping, source: id }
      } else if (existing.universal !== mapping.universal) {
        conflicts.push({
          term,
          left:  { source: existing.source, universal: existing.universal },
          right: { source: id,               universal: mapping.universal  },
        })
        if (keepDuplicates) {
          concepts[`${term}__${id}`] = { ...mapping, source: id }
        }
      }
      // Same term, same universal: agreement, no-op
    }
  }

  const result = {
    domain,
    concepts,
    sourceIds: ids.slice(),
    conflicts,
  }
  _logCKG('compose', {
    sourceIds: ids.slice(),
    termCount: Object.keys(concepts).length,
    conflictCount: conflicts.length,
    domain,
  })
  return result
}

/**
 * Detect terms in a lexicon whose universal anchor is NOT in
 * EXTENDED_UNIVERSAL_CONCEPTS. Each gap is a candidate to add to the symtab
 * via registerUniversal.
 *
 * The undefined-symbol detector.
 *
 * @param {string} lexiconId
 * @returns {{ lexiconId, gaps: Array<{ term, universal, desc }> }}
 */
export function discoverGaps(lexiconId) {
  const lex = LEXICONS[lexiconId] || _userLexicons.get(lexiconId)
  if (!lex) return { lexiconId, gaps: [] }

  const gaps = []
  for (const [term, mapping] of Object.entries(lex.concepts)) {
    if (!EXTENDED_UNIVERSAL_CONCEPTS[mapping.universal]) {
      gaps.push({ term, universal: mapping.universal, desc: mapping.desc || '' })
    }
  }
  return { lexiconId, gaps }
}

/**
 * Jaccard similarity over universal-concept sets between two lexicons.
 * 0 = no shared anchors (orthogonal compiled objects).
 * 1 = identical anchor coverage (same compiled meaning, different surface).
 *
 * The semantic-diff between two compiled objects.
 *
 * @param {string} idA
 * @param {string} idB
 * @returns {{ idA, idB, jaccard, intersection, unionSize }}
 */
export function lexiconSimilarity(idA, idB) {
  const lexA = LEXICONS[idA] || _userLexicons.get(idA)
  const lexB = LEXICONS[idB] || _userLexicons.get(idB)
  if (!lexA || !lexB) return { idA, idB, jaccard: 0, intersection: [], unionSize: 0 }

  const setA = new Set(Object.values(lexA.concepts).map(c => c.universal))
  const setB = new Set(Object.values(lexB.concepts).map(c => c.universal))
  const intersection = [...setA].filter(u => setB.has(u))
  const unionSize = new Set([...setA, ...setB]).size
  const jaccard = unionSize === 0 ? 0 : intersection.length / unionSize

  return { idA, idB, jaccard, intersection, unionSize }
}

/**
 * Register a new universal concept at runtime. Extends the symbol table.
 * Call this when discoverGaps surfaces a missing anchor and you've decided
 * what the new universal should mean.
 *
 * @param {string} name        - identifier (snake_case convention)
 * @param {string} definition  - one-sentence semantic definition
 * @returns {boolean}          - true if added, false if already present
 */
export function registerUniversal(name, definition) {
  if (!name || !definition) return false
  if (EXTENDED_UNIVERSAL_CONCEPTS[name]) return false
  EXTENDED_UNIVERSAL_CONCEPTS[name] = definition
  _logCKG('register_universal', { name, definition })
  return true
}

/**
 * Generate a candidate glyph from a free-form definition.
 * Heuristic: first letter of each significant word, capped at maxLen.
 * Used to seed new GKB entries or to propose names for new universals.
 *
 * @param {string} definition
 * @param {number} maxLen   - default 7
 * @returns {string}        - glyph candidate (UPPERCASE)
 */
/**
 * Shapley value of each lexicon for the "translation coverage" game.
 *
 * Value function: v(S) = | union of universals covered by lexicons in S |
 * For coverage games the closed form is:
 *
 *   φ_i = Σ over u ∈ U_i  of  1 / count(u)
 *
 * where count(u) = number of lexicons whose terms anchor to universal u.
 * O(n × m) instead of O(2^n) — the Shapley substrate-match move applied
 * to its own substrate.
 *
 * @returns {{ shapley: Record<string, number>, sorted: Array<{id, value}>, totalUniversals: number, counts: Record<string, number> }}
 */
export function lexiconShapley() {
  // Build per-lexicon universal sets and global counts simultaneously
  const coverage = {} // lexiconId -> Set<string>
  const counts = {}   // universal -> int

  for (const [id, lex] of Object.entries(LEXICONS)) {
    const set = new Set(Object.values(lex.concepts).map(c => c.universal))
    coverage[id] = set
    for (const u of set) counts[u] = (counts[u] || 0) + 1
  }
  for (const [userId, lex] of _userLexicons.entries()) {
    const id = `user:${userId}`
    const set = new Set(Object.values(lex.concepts).map(c => c.universal))
    coverage[id] = set
    for (const u of set) counts[u] = (counts[u] || 0) + 1
  }

  const shapley = {}
  for (const [id, set] of Object.entries(coverage)) {
    let phi = 0
    for (const u of set) phi += 1 / counts[u]
    shapley[id] = phi
  }

  const sorted = Object.entries(shapley)
    .map(([id, value]) => ({ id, value }))
    .sort((a, b) => b.value - a.value)

  return {
    shapley,
    sorted,
    totalUniversals: Object.keys(counts).length,
    counts,
  }
}

export function generateGlyph(definition, maxLen = 7) {
  const STOP = new Set([
    'a','an','the','of','to','for','in','on','at','by','with','and','or',
    'but','that','this','is','are','be','been','being','as','it','its',
    'from','into','than','then','so','if','via','not','no',
  ])
  const words = (definition || '')
    .replace(/[^a-zA-Z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w && !STOP.has(w.toLowerCase()))

  if (words.length === 0) return 'GLYPH'

  let glyph = words.map(w => w[0].toUpperCase()).join('')
  if (glyph.length < 3) {
    glyph = words[0].slice(0, 5).toUpperCase()
  }
  return glyph.slice(0, maxLen)
}
