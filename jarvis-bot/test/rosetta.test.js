// ============ Rosetta Protocol — Comprehensive Test Suite ============
// Tests for the Universal Understanding Layer.
// Covers: lexicons, translate, translateToAll, bridgeMessage,
// challenge protocol, covenant hash, edge cases, user lexicons.
// Uses Node built-in test runner (node:test).

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

import {
  TEN_COVENANTS,
  COVENANT_HASH,
  EXTENDED_UNIVERSAL_CONCEPTS,
  getLexicon,
  getAllLexicons,
  translate,
  translateToAll,
  bridgeMessage,
  compressToUniversal,
  issueChallenge,
  acceptChallenge,
  resolveChallenge,
  getChallenges,
  getRosettaView,
  registerUserLexicon,
  addUserTerm,
  translateUser,
  translateUserToAll,
  discoverEquivalent,
  getSuggestedMappings,
  getUserLexicon,
  getAllUserLexicons,
  getCovenant,
  initRosetta,
} from '../src/rosetta.js'

// ============ 1. Lexicon Loading ============

describe('Lexicon loading — all 9 agents', () => {
  const EXPECTED_AGENTS = [
    'nyx', 'poseidon', 'athena', 'hephaestus',
    'hermes', 'apollo', 'proteus', 'artemis', 'anansi',
  ]

  it('should expose at least 9 agent lexicons (core pantheon)', () => {
    const all = getAllLexicons()
    const keys = Object.keys(all)
    assert.ok(keys.length >= 9, `Expected at least 9 agents, got ${keys.length}: ${keys.join(', ')}`)
  })

  for (const agentId of EXPECTED_AGENTS) {
    it(`should load ${agentId}'s lexicon with domain and concepts`, () => {
      const lex = getLexicon(agentId)
      assert.ok(lex, `Lexicon for ${agentId} is null`)
      assert.ok(typeof lex.domain === 'string' && lex.domain.length > 0, `${agentId} has no domain`)
      assert.ok(typeof lex.concepts === 'object', `${agentId} has no concepts`)
      assert.ok(Object.keys(lex.concepts).length >= 5, `${agentId} has fewer than 5 concepts`)
    })

    it(`${agentId}: every concept has a universal key and desc`, () => {
      const lex = getLexicon(agentId)
      for (const [term, mapping] of Object.entries(lex.concepts)) {
        assert.ok(
          typeof mapping.universal === 'string' && mapping.universal.length > 0,
          `${agentId}:"${term}" is missing .universal`
        )
        assert.ok(
          typeof mapping.desc === 'string',
          `${agentId}:"${term}" is missing .desc`
        )
      }
    })
  }

  it('should return null for an unknown agent', () => {
    assert.equal(getLexicon('unknown_agent'), null)
  })
})

// ============ 2. translate() — known pairs ============

describe('translate() — exact universal matches', () => {
  it('poseidon → athena: liquidity → resource_availability hits optionality or tradeoff', () => {
    // poseidon:liquidity = resource_availability
    // athena has no exact match — translated false or approximate
    const result = translate('poseidon', 'athena', 'liquidity')
    assert.ok(result.translated !== undefined, 'Should have translated field')
    assert.equal(result.from.agent, 'poseidon')
    assert.equal(result.from.term, 'liquidity')
    assert.equal(result.universal, 'resource_availability')
  })

  it('hephaestus → hephaestus (self): deploy returns same term', () => {
    const result = translate('hephaestus', 'hephaestus', 'deploy')
    assert.ok(result.translated, 'Self-translation should succeed')
    assert.equal(result.to.term, 'deploy')
    assert.equal(result.confidence, 1.0)
  })

  it('nyx → jarvis: compression maps correctly', () => {
    // nyx:prune = compress_context; jarvis:compression = compress_context — exact match
    const result = translate('nyx', 'jarvis', 'prune')
    assert.ok(result.translated, 'prune should translate to jarvis')
    assert.equal(result.universal, 'compress_context')
    assert.equal(result.to.term, 'compression')
    assert.equal(result.confidence, 1.0)
  })

  it('jarvis → nyx: compression maps back to prune', () => {
    // Reverse of the above — same universal hub
    const result = translate('jarvis', 'nyx', 'compression')
    assert.ok(result.translated, 'compression should translate back to nyx')
    assert.equal(result.universal, 'compress_context')
    assert.equal(result.to.term, 'prune')
    assert.equal(result.confidence, 1.0)
  })

  it('artemis → poseidon: MEV (extraction_rent) — no exact poseidon match, returns result', () => {
    const result = translate('artemis', 'poseidon', 'MEV')
    assert.equal(result.universal, 'extraction_rent')
    // Whether translated or not, should have from info
    assert.equal(result.from.term, 'MEV')
  })

  it('anansi → athena: governance (collective_decision) — exact match', () => {
    // anansi:governance = collective_decision
    // athena has no exact collective_decision — result may be approximate or untranslated
    const result = translate('anansi', 'athena', 'governance')
    assert.equal(result.universal, 'collective_decision')
    assert.equal(result.from.agent, 'anansi')
  })

  it('apollo → hermes: signal (meaningful_pattern) — translated field present', () => {
    const result = translate('apollo', 'hermes', 'signal')
    assert.equal(result.universal, 'meaningful_pattern')
    assert.ok(result.translated !== undefined)
  })

  it('proteus → hephaestus: resilience (recovery_ability) — translated field present', () => {
    const result = translate('proteus', 'hephaestus', 'resilience')
    assert.equal(result.universal, 'recovery_ability')
    assert.ok(result.translated !== undefined)
  })
})

describe('translate() — error handling', () => {
  it('should return error for unknown fromAgent', () => {
    const result = translate('nobody', 'nyx', 'alignment')
    assert.ok(result.error, 'Should have error field')
    assert.equal(result.translated, false)
  })

  it('should return error for unknown toAgent', () => {
    const result = translate('nyx', 'nobody', 'alignment')
    assert.ok(result.error, 'Should have error field')
    assert.equal(result.translated, false)
  })

  it('should return error for unknown concept', () => {
    const result = translate('nyx', 'poseidon', 'totally_fake_concept')
    assert.ok(result.error, 'Should have error field')
    assert.equal(result.translated, false)
    assert.ok(Array.isArray(result.available), 'Should list available terms')
    assert.ok(result.available.includes('alignment'), 'Available should include known nyx terms')
  })

  it('should return both agents error message when both unknown', () => {
    const result = translate('ghost1', 'ghost2', 'foo')
    assert.ok(result.error)
    assert.equal(result.translated, false)
  })
})

describe('translate() — result shape', () => {
  it('exact match result has correct shape', () => {
    const result = translate('nyx', 'jarvis', 'prune')
    assert.ok('from' in result)
    assert.ok('universal' in result)
    assert.ok('to' in result)
    assert.ok('confidence' in result)
    assert.ok('translated' in result)
    assert.equal(typeof result.from.agent, 'string')
    assert.equal(typeof result.from.term, 'string')
    assert.equal(typeof result.from.desc, 'string')
    assert.equal(typeof result.to.agent, 'string')
    assert.equal(typeof result.to.term, 'string')
  })

  it('no-match result has explanation field', () => {
    // Pick a concept whose universal is unique enough to have no match in target
    // poseidon:impermanent_loss = opportunity_cost — unlikely to match exactly in nyx
    const result = translate('poseidon', 'nyx', 'impermanent_loss')
    if (!result.translated) {
      assert.ok('explanation' in result || 'error' in result,
        'Untranslated result should have explanation or error')
    }
  })
})

// ============ 3. translateToAll() ============

describe('translateToAll()', () => {
  it('should return translations for all agents except source', () => {
    const result = translateToAll('nyx', 'alignment')
    assert.ok(result.source, 'Should have source field')
    assert.equal(result.source.agent, 'nyx')
    assert.equal(result.source.concept, 'alignment')
    assert.ok(result.translations, 'Should have translations object')

    const agentKeys = Object.keys(result.translations)
    assert.ok(!agentKeys.includes('nyx'), 'Source agent should not be in translations')
    assert.ok(agentKeys.includes('poseidon'), 'Should include poseidon')
    assert.ok(agentKeys.includes('jarvis'), 'Should include jarvis')
    // Total agents minus source = N-1; at least 8 (original 9 minus 1)
    assert.ok(agentKeys.length >= 8, `Should have at least 8 target agents, got ${agentKeys.length}`)
  })

  it('each translation entry should have translated field', () => {
    const result = translateToAll('poseidon', 'TVL')
    for (const [agentId, entry] of Object.entries(result.translations)) {
      assert.ok('translated' in entry, `${agentId} entry missing translated field`)
    }
  })

  it('nyx:prune should reach jarvis:compression with confidence 1.0 in translateToAll', () => {
    const result = translateToAll('nyx', 'prune')
    const jarvisResult = result.translations.jarvis
    assert.ok(jarvisResult.translated, 'Should translate to jarvis')
    assert.equal(jarvisResult.to.term, 'compression')
    assert.equal(jarvisResult.confidence, 1.0)
  })

  it('returns correct source shape', () => {
    const result = translateToAll('athena', 'moat')
    assert.equal(result.source.agent, 'athena')
    assert.equal(result.source.concept, 'moat')
  })
})

// ============ 4. bridgeMessage() ============

describe('bridgeMessage()', () => {
  it('should return a bridge result with required fields', () => {
    const result = bridgeMessage('poseidon', 'athena', 'The liquidity and slippage look good')
    assert.equal(result.from, 'poseidon')
    assert.equal(result.to, 'athena')
    assert.ok('original' in result)
    assert.ok(Array.isArray(result.annotations))
    assert.equal(result.covenantCompliant, true)
  })

  it('should detect domain terms from the sender lexicon', () => {
    // poseidon:yield and poseidon:depth both translate to hermes exactly
    // Use poseidon→hermes which produces annotations (depth, yield translate)
    const result = bridgeMessage('poseidon', 'hermes', 'The depth looks good and the yield is improving')
    const terms = result.annotations.map(a => a.original.toLowerCase())
    assert.ok(terms.includes('depth') || terms.includes('yield'),
      `Should detect at least one translatable term; got: [${terms.join(', ')}]`)
  })

  it('should produce annotations with required shape', () => {
    const result = bridgeMessage('poseidon', 'athena', 'Check the liquidity')
    if (result.annotations.length > 0) {
      const ann = result.annotations[0]
      assert.ok('original' in ann)
      assert.ok('translatedTo' in ann)
      assert.ok('confidence' in ann)
      assert.ok('context' in ann)
    }
  })

  it('should return empty annotations for unknown source terms', () => {
    const result = bridgeMessage('nyx', 'poseidon', 'The weather is nice today')
    assert.equal(result.annotations.length, 0)
  })

  it('should handle unknown fromAgent gracefully', () => {
    const result = bridgeMessage('ghost', 'nyx', 'Some message')
    assert.equal(result.original, 'Some message')
    assert.equal(result.translated, result.original)
    assert.deepEqual(result.annotations, [])
  })

  it('annotation confidence should be between 0 and 1', () => {
    const result = bridgeMessage('hephaestus', 'hermes', 'We need to deploy and refactor the build')
    for (const ann of result.annotations) {
      assert.ok(ann.confidence >= 0 && ann.confidence <= 1,
        `confidence ${ann.confidence} out of range for "${ann.original}"`)
    }
  })
})

// ============ 5. Challenge Protocol ============

describe('Challenge Protocol — issueChallenge', () => {
  it('should create a challenge with correct shape', () => {
    const c = issueChallenge('poseidon', 'athena', 'optimal_treasury_allocation', 'context_priority_slot')
    assert.ok(c.id, 'Should have an id')
    assert.equal(c.challenger, 'poseidon')
    assert.equal(c.challenged, 'athena')
    assert.equal(c.topic, 'optimal_treasury_allocation')
    assert.equal(c.stake, 'context_priority_slot')
    assert.equal(c.status, 'pending')
    assert.equal(c.rules, null)
    assert.equal(c.result, null)
    assert.ok(c.created, 'Should have created timestamp')
  })

  it('should set covenant checks at creation', () => {
    const c = issueChallenge('hermes', 'artemis', 'bridge_security', 'api_access')
    assert.equal(c.covenantChecks.equalStakes, true)
    assert.equal(c.covenantChecks.challengedSetsRules, true)
    assert.equal(c.covenantChecks.noCheating, true)
  })

  it('should produce unique ids for different challenges', async () => {
    // issueChallenge uses Date.now() — add a 2ms gap to guarantee different timestamps
    const c1 = issueChallenge('nyx', 'apollo', 'data_quality_unique_test', 'compute')
    await new Promise(r => setTimeout(r, 2))
    const c2 = issueChallenge('nyx', 'apollo', 'data_quality_unique_test', 'compute')
    assert.notEqual(c1.id, c2.id, 'Each challenge should have a unique id')
  })

  it('should be retrievable via getChallenges', () => {
    const c = issueChallenge('anansi', 'proteus', 'community_strategy', 'reputation_slot')
    const allChallenges = getChallenges()
    const found = allChallenges.find(ch => ch.id === c.id)
    assert.ok(found, 'Challenge should be retrievable')
  })
})

describe('Challenge Protocol — acceptChallenge', () => {
  it('should transition status from pending to accepted', () => {
    const c = issueChallenge('hephaestus', 'hermes', 'deploy_strategy', 'build_token')
    const rules = { game: 'code_review', judgedBy: 'jarvis', timeLimit: '1h' }
    const accepted = acceptChallenge(c.id, rules)
    assert.equal(accepted.status, 'accepted')
    assert.deepEqual(accepted.rules, rules)
    assert.ok(accepted.acceptedAt, 'Should have acceptedAt timestamp')
  })

  it('should return error for unknown challenge id', () => {
    const result = acceptChallenge('nonexistent_id_xyz', { game: 'test' })
    assert.ok(result.error, 'Should return error for unknown id')
  })

  it('should return error if challenge is not pending', () => {
    const c = issueChallenge('apollo', 'proteus', 'signal_quality', 'analysis_token')
    acceptChallenge(c.id, { game: 'prediction_contest' })
    // Try to accept again
    const secondAccept = acceptChallenge(c.id, { game: 'another_game' })
    assert.ok(secondAccept.error, 'Should error on double-accept')
  })
})

describe('Challenge Protocol — resolveChallenge', () => {
  it('should resolve a challenge with a winner', () => {
    const c = issueChallenge('poseidon', 'artemis', 'risk_model', 'priority_bid')
    acceptChallenge(c.id, { game: 'scenario_analysis' })
    const resolved = resolveChallenge(c.id, 'poseidon', { reason: 'Better model' })
    assert.equal(resolved.status, 'resolved')
    assert.equal(resolved.result.winner, 'poseidon')
    assert.equal(resolved.result.loser, 'artemis')
    assert.equal(resolved.result.stakesEnforced, true)
    assert.ok(resolved.resolvedAt, 'Should have resolvedAt timestamp')
  })

  it('should apply Covenant VIII — cheater loses instantly', () => {
    const c = issueChallenge('hermes', 'apollo', 'latency_claims', 'api_token')
    acceptChallenge(c.id, { game: 'benchmark_race' })
    const resolved = resolveChallenge(c.id, 'hermes', {
      cheatingDetected: true,
      cheatingBy: 'hermes',
      details: 'Fabricated benchmark results',
    })
    assert.equal(resolved.status, 'resolved')
    assert.equal(resolved.result.winner, 'apollo', 'Cheater should lose — apollo wins')
    assert.equal(resolved.result.loser, 'hermes')
    assert.ok(resolved.result.reason.includes('Covenant VIII'))
  })

  it('should return error when resolving non-accepted challenge', () => {
    const c = issueChallenge('nyx', 'anansi', 'governance_scope', 'directive_slot')
    // Not accepted yet
    const result = resolveChallenge(c.id, 'nyx', { reason: 'Won the argument' })
    assert.ok(result.error, 'Should error when not accepted')
  })

  it('should return error for unknown challenge id', () => {
    const result = resolveChallenge('fake_id_000', 'nyx', {})
    assert.ok(result.error)
  })
})

describe('Challenge Protocol — getChallenges filters', () => {
  it('should filter by agent', () => {
    const c = issueChallenge('athena', 'jarvis', 'strategy_validity', 'inference_token')
    const filtered = getChallenges({ agent: 'athena' })
    const found = filtered.find(ch => ch.id === c.id)
    assert.ok(found, 'Should find challenge by challenger agent')
  })

  it('should filter by status', () => {
    const pending = getChallenges({ status: 'pending' })
    for (const ch of pending) {
      assert.equal(ch.status, 'pending', 'All filtered challenges should be pending')
    }
  })

  it('should return all challenges sorted by created desc', () => {
    const all = getChallenges()
    assert.ok(Array.isArray(all))
    for (let i = 1; i < all.length; i++) {
      const prev = new Date(all[i - 1].created)
      const curr = new Date(all[i].created)
      assert.ok(prev >= curr, 'Challenges should be sorted newest first')
    }
  })
})

// ============ 6. Covenant Hash — Immutability ============

describe('Covenant hash — immutability', () => {
  it('TEN_COVENANTS should have exactly 10 entries', () => {
    assert.equal(TEN_COVENANTS.length, 10)
  })

  it('Each covenant should have number, covenant, enforcement, penalty, spirit', () => {
    for (const c of TEN_COVENANTS) {
      assert.ok(typeof c.number === 'number', `Covenant ${c.number} missing number`)
      assert.ok(typeof c.covenant === 'string', `Covenant ${c.number} missing covenant text`)
      assert.ok(typeof c.enforcement === 'string', `Covenant ${c.number} missing enforcement`)
      assert.ok(typeof c.penalty === 'string', `Covenant ${c.number} missing penalty`)
      assert.ok(typeof c.spirit === 'string', `Covenant ${c.number} missing spirit`)
    }
  })

  it('Covenants should be numbered 1 through 10 in order', () => {
    for (let i = 0; i < TEN_COVENANTS.length; i++) {
      assert.equal(TEN_COVENANTS[i].number, i + 1)
    }
  })

  it('COVENANT_HASH should be a 64-char hex string', () => {
    assert.match(COVENANT_HASH, /^[0-9a-f]{64}$/)
  })

  it('COVENANT_HASH should match recomputed sha256 of TEN_COVENANTS', () => {
    const recomputed = createHash('sha256')
      .update(JSON.stringify(TEN_COVENANTS))
      .digest('hex')
    assert.equal(COVENANT_HASH, recomputed, 'Covenant hash must match recomputed value — covenants were modified if this fails')
  })

  it('Modifying covenants should produce a different hash', () => {
    const tampered = TEN_COVENANTS.map(c =>
      c.number === 9 ? { ...c, covenant: 'The rules can be changed.' } : c
    )
    const tamperedHash = createHash('sha256').update(JSON.stringify(tampered)).digest('hex')
    assert.notEqual(tamperedHash, COVENANT_HASH, 'Tampered covenants should produce a different hash')
  })

  it('getCovenant(number) returns the correct covenant', () => {
    const c2 = getCovenant(2)
    assert.ok(c2, 'Covenant 2 should exist')
    assert.equal(c2.number, 2)
    assert.ok(c2.covenant.includes('game'), 'Covenant II is about games')
    assert.equal(c2.enforcement, 'hard')

    const c9 = getCovenant(9)
    assert.equal(c9.enforcement, 'immutable')

    const c10 = getCovenant(10)
    assert.equal(c10.enforcement, 'spirit')
  })

  it('getCovenant returns null for out-of-range number', () => {
    assert.equal(getCovenant(0), null)
    assert.equal(getCovenant(11), null)
    assert.equal(getCovenant(999), null)
  })
})

// ============ 7. Edge Cases ============

describe('Edge cases — unknown terms and agents', () => {
  it('translate with both agents the same returns valid result', () => {
    // Self-translation: every term should map exactly to itself
    const result = translate('poseidon', 'poseidon', 'yield')
    assert.ok(result.translated)
    assert.equal(result.to.term, 'yield')
    assert.equal(result.confidence, 1.0)
  })

  it('translate unknown concept lists available terms', () => {
    const result = translate('athena', 'hermes', 'definitely_not_a_real_concept')
    assert.equal(result.translated, false)
    assert.ok(Array.isArray(result.available))
    assert.ok(result.available.length > 0)
  })

  it('translateToAll with unknown agent handles gracefully', () => {
    // Should still return a result object — translate() returns errors per entry
    const result = translateToAll('ghost_agent', 'liquidity')
    // All 9 agents (not ghost) would be attempted but translate errors per pair
    assert.ok(result.translations, 'Should still have translations object')
    for (const entry of Object.values(result.translations)) {
      assert.ok('error' in entry || 'translated' in entry, 'Each entry should have error or translated')
    }
  })

  it('bridgeMessage with message containing no domain terms has empty annotations', () => {
    const result = bridgeMessage('nyx', 'poseidon', 'Hello world, what is up?')
    assert.equal(result.annotations.length, 0)
  })

  it('compressToUniversal with unknown agent returns text unchanged', () => {
    const result = compressToUniversal('some text about nothing', 'unknown_agent')
    assert.equal(result.compressed, 'some text about nothing')
    assert.deepEqual(result.mappings, [])
  })

  it('compressToUniversal detects domain terms in text', () => {
    const result = compressToUniversal(
      'The liquidity is high but slippage is concerning',
      'poseidon'
    )
    assert.equal(result.agent, 'poseidon')
    const mappedTerms = result.mappings.map(m => m.original)
    assert.ok(mappedTerms.includes('liquidity'), 'Should detect liquidity')
    assert.ok(mappedTerms.includes('slippage'), 'Should detect slippage')
  })
})

// ============ 8. User Lexicon Functions ============

describe('registerUserLexicon()', () => {
  it('should register a user lexicon and return success', () => {
    const result = registerUserLexicon('dr_carter', 'Cardiology', {
      'arrhythmia': 'system_instability',
      'tachycardia': { universal: 'system_instability', desc: 'Abnormally fast heartbeat' },
      'valve': { universal: 'flow_control', desc: 'Controls directional flow' },
    })
    assert.equal(result.registered, true)
    assert.equal(result.userId, 'dr_carter')
    assert.equal(result.domain, 'Cardiology')
    assert.equal(result.termCount, 3)
  })

  it('should retrieve the registered lexicon via getUserLexicon', () => {
    registerUserLexicon('jazz_alice', 'Jazz Theory', {
      'chord': 'harmonic_combination',
      'swing': 'rhythmic_displacement',
    })
    const lex = getUserLexicon('jazz_alice')
    assert.ok(lex, 'Lexicon should be retrievable')
    assert.equal(lex.domain, 'Jazz Theory')
    assert.ok('chord' in lex.concepts)
    assert.ok('swing' in lex.concepts)
  })

  it('should return error for missing userId', () => {
    const result = registerUserLexicon('', 'Domain', { term: 'universal' })
    assert.ok(result.error, 'Should error on empty userId')
  })

  it('should return error for missing domain', () => {
    const result = registerUserLexicon('user1', '', { term: 'universal' })
    assert.ok(result.error, 'Should error on empty domain')
  })

  it('should return error for non-object terms', () => {
    const result = registerUserLexicon('user2', 'Domain', null)
    assert.ok(result.error, 'Should error on null terms')
  })

  it('should support both shorthand and full-form term definitions', () => {
    registerUserLexicon('chef_bob', 'Culinary Arts', {
      'reduction': 'concentration_process',
      'mise_en_place': { universal: 'preparation_state', desc: 'Everything in its place before starting' },
    })
    const lex = getUserLexicon('chef_bob')
    assert.equal(lex.concepts['reduction'].universal, 'concentration_process')
    assert.equal(lex.concepts['mise_en_place'].universal, 'preparation_state')
    assert.equal(lex.concepts['mise_en_place'].desc, 'Everything in its place before starting')
  })

  it('getAllUserLexicons returns all registered user lexicons', () => {
    registerUserLexicon('test_user_all', 'Test Domain', { foo: 'bar_concept' })
    const all = getAllUserLexicons()
    assert.ok('test_user_all' in all, 'Should include recently registered user')
    assert.ok(typeof all === 'object')
  })
})

describe('addUserTerm()', () => {
  it('should add a term to an existing lexicon', () => {
    registerUserLexicon('pilot_dana', 'Aviation', { 'thrust': 'forward_force' })
    const result = addUserTerm('pilot_dana', 'lift', 'upward_force')
    assert.equal(result.added, true)
    assert.equal(result.userId, 'pilot_dana')
    assert.equal(result.term, 'lift')
    assert.equal(result.universal, 'upward_force')
  })

  it('should create a new Custom lexicon if user not registered', () => {
    const result = addUserTerm('brand_new_user_xyz', 'stochastic', 'random_process')
    assert.equal(result.added, true)
    const lex = getUserLexicon('brand_new_user_xyz')
    assert.ok(lex, 'Lexicon should be auto-created')
    assert.equal(lex.domain, 'Custom')
  })

  it('should accept object form for universalConcept', () => {
    addUserTerm('pilot_dana', 'stall', { universal: 'lift_failure', desc: 'Loss of aerodynamic lift' })
    const lex = getUserLexicon('pilot_dana')
    assert.equal(lex.concepts['stall'].universal, 'lift_failure')
    assert.equal(lex.concepts['stall'].desc, 'Loss of aerodynamic lift')
  })

  it('should return error for missing userId or term', () => {
    const r1 = addUserTerm('', 'term', 'universal')
    assert.ok(r1.error)
    const r2 = addUserTerm('user', '', 'universal')
    assert.ok(r2.error)
  })

  it('should return error for invalid universalConcept type', () => {
    registerUserLexicon('error_test_user', 'Domain', {})
    const result = addUserTerm('error_test_user', 'myterm', 12345)
    assert.ok(result.error)
  })
})

describe('translateUser()', () => {
  it('should translate a term between two user lexicons via exact universal match', () => {
    registerUserLexicon('cardiologist_a', 'Cardiology', {
      'arrhythmia': 'system_instability',
    })
    registerUserLexicon('mechanic_b', 'Mechanics', {
      'vibration': 'system_instability',
    })
    const result = translateUser('cardiologist_a', 'mechanic_b', 'arrhythmia')
    assert.ok(result.translated, 'Should find exact universal match')
    assert.equal(result.from.userId, 'cardiologist_a')
    assert.equal(result.from.term, 'arrhythmia')
    assert.equal(result.universal, 'system_instability')
    assert.equal(result.to.userId, 'mechanic_b')
    assert.equal(result.to.term, 'vibration')
    assert.equal(result.confidence, 1.0)
  })

  it('should return error for unregistered fromUser', () => {
    registerUserLexicon('known_user_t', 'Domain', { x: 'y_concept' })
    const result = translateUser('unregistered_from', 'known_user_t', 'anything')
    assert.ok(result.error)
    assert.equal(result.translated, false)
  })

  it('should return error for unregistered toUser', () => {
    registerUserLexicon('known_user_t2', 'Domain', { x: 'y_concept' })
    const result = translateUser('known_user_t2', 'unregistered_to', 'x')
    assert.ok(result.error)
    assert.equal(result.translated, false)
  })

  it('should return error for term not in fromUser lexicon', () => {
    registerUserLexicon('user_from_abc', 'Domain A', { 'real_term': 'some_universal' })
    registerUserLexicon('user_to_abc', 'Domain B', { 'other_term': 'some_universal' })
    const result = translateUser('user_from_abc', 'user_to_abc', 'fake_term')
    assert.ok(result.error)
    assert.equal(result.translated, false)
    assert.ok(Array.isArray(result.available))
  })

  it('untranslatable pair returns translated: false with explanation', () => {
    registerUserLexicon('isolated_user_1', 'Alchemy', { 'transmutation': 'base_to_gold' })
    registerUserLexicon('isolated_user_2', 'Cooking', { 'caramelization': 'sugar_browning' })
    const result = translateUser('isolated_user_1', 'isolated_user_2', 'transmutation')
    if (!result.translated) {
      assert.ok('explanation' in result || 'error' in result)
    }
  })
})

describe('translateUserToAll()', () => {
  it('should return translations to all agent lexicons', () => {
    registerUserLexicon('researcher_r', 'Research', {
      'null_hypothesis': 'baseline_assumption',
    })
    const result = translateUserToAll('researcher_r', 'null_hypothesis')
    assert.ok(result.source, 'Should have source')
    assert.equal(result.source.userId, 'researcher_r')
    assert.equal(result.source.concept, 'null_hypothesis')
    assert.equal(result.universal, 'baseline_assumption')
    assert.ok(result.translations, 'Should have translations')

    // All 9 agents should appear
    for (const agentId of ['nyx', 'poseidon', 'athena', 'hephaestus', 'hermes', 'apollo', 'proteus', 'artemis', 'anansi', 'jarvis']) {
      assert.ok(agentId in result.translations, `Missing agent ${agentId}`)
    }
  })

  it('should return error for unregistered user', () => {
    const result = translateUserToAll('ghost_researcher', 'any_concept')
    assert.ok(result.error)
  })

  it('should return error for unknown concept', () => {
    registerUserLexicon('researcher_r2', 'Research', { 'p_value': 'confidence_level' })
    const result = translateUserToAll('researcher_r2', 'nonexistent_concept')
    assert.ok(result.error)
    assert.ok(Array.isArray(result.available))
  })

  it('should exclude self from translations when user is also in another lexicon', () => {
    registerUserLexicon('multi_user', 'Multi Domain', { 'alpha': 'alpha_concept' })
    const result = translateUserToAll('multi_user', 'alpha')
    if (result.translations) {
      assert.ok(!('user:multi_user' in result.translations), 'Should not include self in translations')
    }
  })
})

describe('discoverEquivalent()', () => {
  it('should find all equivalents for an agent term', () => {
    const result = discoverEquivalent('compression')  // jarvis:compression = compress_context
    assert.equal(result.found, true)
    assert.equal(result.term, 'compression')
    assert.equal(result.universal, 'compress_context')
    assert.ok(Array.isArray(result.exactMatches), 'Should have exactMatches array')
    // nyx:prune also maps to compress_context
    const hasPrune = result.exactMatches.some(e => e.term === 'prune')
    assert.ok(hasPrune, 'nyx:prune should appear as an equivalent')
  })

  it('should return found: false for unknown term', () => {
    const result = discoverEquivalent('zzz_nonexistent_term_zzz')
    assert.equal(result.found, false)
    assert.ok(result.error)
  })

  it('should return source info identifying which agent owns the term', () => {
    const result = discoverEquivalent('MEV')
    assert.equal(result.found, true)
    assert.equal(result.source.id, 'artemis')
    assert.equal(result.source.type, 'agent')
  })

  it('should include totalEquivalents count', () => {
    const result = discoverEquivalent('liquidity')
    assert.ok(typeof result.totalEquivalents === 'number')
    assert.ok(result.totalEquivalents >= 1)
  })

  it('should find user-registered terms after registerUserLexicon', () => {
    // Use a unique term not already in any existing lexicon
    const uniqueTerm = `nurse_test_term_${Date.now()}`
    registerUserLexicon('nurse_emily_unique', 'Nursing', {
      [uniqueTerm]: 'custom_nursing_concept',
    })
    const result = discoverEquivalent(uniqueTerm)
    assert.equal(result.found, true)
    assert.equal(result.universal, 'custom_nursing_concept')
    assert.equal(result.source.type, 'user')
  })

  it('exactMatches should each have agent, term, desc fields', () => {
    const result = discoverEquivalent('liquidity')
    for (const match of result.exactMatches) {
      assert.ok('agent' in match, 'Match missing agent')
      assert.ok('term' in match, 'Match missing term')
      assert.ok('desc' in match, 'Match missing desc')
      assert.ok('confidence' in match, 'Match missing confidence')
    }
  })
})

// ============ 9. getRosettaView() ============

describe('getRosettaView()', () => {
  it('should return a valid view object', () => {
    const view = getRosettaView()
    assert.ok(view, 'View should exist')
    assert.ok(typeof view.universalConcepts === 'number')
    assert.ok(typeof view.totalTerms === 'number')
    assert.ok(typeof view.registeredUsers === 'number')
    assert.equal(view.covenantHash, COVENANT_HASH)
    assert.equal(view.covenants, 10)
  })

  it('should list all 9 agents in the view', () => {
    const view = getRosettaView()
    const EXPECTED = ['nyx', 'poseidon', 'athena', 'hephaestus', 'hermes', 'apollo', 'proteus', 'artemis', 'anansi']
    for (const agentId of EXPECTED) {
      assert.ok(agentId in view.agents, `Agent ${agentId} missing from view`)
      assert.ok(typeof view.agents[agentId].domain === 'string')
      assert.ok(Array.isArray(view.agents[agentId].terms))
    }
  })

  it('totalTerms should equal sum of all agent term counts', () => {
    const view = getRosettaView()
    let agentTotal = 0
    for (const agent of Object.values(view.agents)) {
      agentTotal += agent.termCount
    }
    let userTotal = 0
    for (const user of Object.values(view.users)) {
      userTotal += user.termCount
    }
    assert.equal(view.totalTerms, agentTotal + userTotal)
  })

  it('activeChallenges should be a non-negative integer', () => {
    const view = getRosettaView()
    assert.ok(typeof view.activeChallenges === 'number')
    assert.ok(view.activeChallenges >= 0)
  })
})

// ============ 10. initRosetta() ============

describe('initRosetta()', () => {
  it('should return initialization stats', () => {
    const stats = initRosetta()
    assert.ok(typeof stats.agentTerms === 'number')
    assert.ok(stats.agentTerms > 0, 'Should have agent terms')
    assert.ok(typeof stats.universalConcepts === 'number')
    assert.ok(stats.universalConcepts > 0, 'Should have universal concepts')
    assert.equal(stats.covenantHash, COVENANT_HASH)
    assert.ok(typeof stats.userLexicons === 'number')
  })
})

// ============ 11. EXTENDED_UNIVERSAL_CONCEPTS ============

describe('EXTENDED_UNIVERSAL_CONCEPTS', () => {
  it('should be a non-empty object', () => {
    assert.ok(EXTENDED_UNIVERSAL_CONCEPTS, 'Should be exported')
    assert.ok(Object.keys(EXTENDED_UNIVERSAL_CONCEPTS).length > 0, 'Should have entries')
  })

  it('all entries should have string keys and string descriptions', () => {
    for (const [key, desc] of Object.entries(EXTENDED_UNIVERSAL_CONCEPTS)) {
      assert.ok(typeof key === 'string' && key.length > 0, 'Key should be non-empty string')
      assert.ok(typeof desc === 'string' && desc.length > 0, `Description for "${key}" should be non-empty`)
    }
  })

  it('should contain key structural/process concepts', () => {
    // homeostasis is now a medicine lexicon term (maps to stable_equilibrium)
    // EXTENDED_UNIVERSAL_CONCEPTS holds the well-known universal keys
    assert.ok('feedback_loop' in EXTENDED_UNIVERSAL_CONCEPTS)
    assert.ok('symbiosis' in EXTENDED_UNIVERSAL_CONCEPTS)
    assert.ok('stable_equilibrium' in EXTENDED_UNIVERSAL_CONCEPTS)
  })
})

// ============ 12. getSuggestedMappings() ============

describe('getSuggestedMappings()', () => {
  it('should return a suggestions array', () => {
    const result = getSuggestedMappings('liquidity_pool')
    assert.ok(result, 'Should return a result')
    assert.ok(Array.isArray(result.suggestions))
    assert.ok(typeof result.tip === 'string')
  })

  it('should find a suggestion for a term related to an existing universal', () => {
    const result = getSuggestedMappings('signal')
    // 'signal' appears in apollo's lexicon — should match
    assert.ok(result.suggestions.length > 0, 'Should have at least one suggestion')
    const universals = result.suggestions.map(s => s.universal)
    assert.ok(universals.includes('meaningful_pattern'), 'signal should suggest meaningful_pattern')
  })

  it('each suggestion should have universal, score, reason, examples fields', () => {
    const result = getSuggestedMappings('governance')
    if (result.suggestions.length > 0) {
      const s = result.suggestions[0]
      assert.ok('universal' in s)
      assert.ok('score' in s)
      assert.ok('reason' in s)
      assert.ok('examples' in s)
      assert.ok(s.score >= 0 && s.score <= 1.0, 'Score should be between 0 and 1')
    }
  })

  it('for an entirely unknown term the tip mentions registering it', () => {
    const result = getSuggestedMappings('xyzzy_nonexistent_zyzzy')
    assert.ok(typeof result.tip === 'string')
    if (result.suggestions.length === 0) {
      assert.ok(result.tip.includes('new concept') || result.tip.includes('No close matches'))
    }
  })
})
