#!/usr/bin/env node
// ============ Seed Attribution Graph — Licho's Ergon Blog Articles ============
//
// Seeds the passive attribution graph with the 8 Ergon blog articles by Licho
// that informed JUL's proportional reward implementation in mining.js.
//
// Run once: node scripts/seed-licho-attribution.js
// ============

import { initAttribution, recordSource, recordDerivation, recordOutput, getAuthorAttribution, getGraphStats, flushAttribution, SourceType } from '../src/passive-attribution.js';

async function main() {
  await initAttribution();

  // ============ Record Licho's Sources ============

  const sources = [
    {
      author: 'Licho',
      authorId: 'licho-ergon',
      type: SourceType.BLOG,
      title: 'Supply Shrinking',
      url: 'https://ergon.moe/blog/supply-shrinking',
      metadata: { date: '2023-10-17', platform: 'ergon.moe', tags: ['supply-sinks', 'lost-coins', 'fractional-reserve'] },
    },
    {
      author: 'Licho',
      authorId: 'licho-ergon',
      type: SourceType.BLOG,
      title: 'Escape Velocity',
      url: 'https://ergon.moe/blog/escape-velocity',
      metadata: { date: '2023-08-17', updated: '2023-11-21', platform: 'ergon.moe', tags: ['escape-velocity', 'supply-cap', 'proportional-reward'] },
    },
    {
      author: 'Licho',
      authorId: 'licho-ergon',
      type: SourceType.BLOG,
      title: 'What Is Money',
      url: 'https://ergon.moe/blog/what-is-money',
      metadata: { date: '2023-08-18', platform: 'ergon.moe', tags: ['money', 'liquidity', 'elastic-supply'] },
    },
    {
      author: 'Licho',
      authorId: 'licho-ergon',
      type: SourceType.BLOG,
      title: 'Ergon Is Mutual Credit',
      url: 'https://ergon.moe/blog/mutual-credit',
      metadata: { date: '2023-09-25', platform: 'ergon.moe', tags: ['mutual-credit', 'work-credit', 'possession'] },
    },
    {
      author: 'Licho',
      authorId: 'licho-ergon',
      type: SourceType.BLOG,
      title: 'What Are The Miners Working On, Actually',
      url: 'https://ergon.moe/blog/miners-truth',
      metadata: { date: '2023-10-02', platform: 'ergon.moe', tags: ['pow', 'truth-manufacturing', 'spv', 'difficulty'] },
    },
    {
      author: 'Licho',
      authorId: 'licho-ergon',
      type: SourceType.BLOG,
      title: 'Cyphercash Not Cryptocurrency',
      url: 'https://ergon.moe/blog/cyphercash',
      metadata: { date: '2024-08-28', platform: 'ergon.moe', tags: ['cyphercash', 'pyramid-critique', 'proportional-reward'] },
    },
    {
      author: 'Licho',
      authorId: 'licho-ergon',
      type: SourceType.BLOG,
      title: 'Coffee Is Subversive',
      url: 'https://ergon.moe/blog/coffee-subversive',
      metadata: { date: '2023-09-18', platform: 'ergon.moe', tags: ['financial-inclusion', 'permissionless', 'stability'] },
    },
    {
      author: 'Hooke',
      authorId: 'hooke-ergon',
      type: SourceType.BLOG,
      title: '(Un)Stable Building Blocks — DeFi Base Paradox',
      url: 'https://ergon.moe/blog/unstable-building-blocks',
      metadata: { date: '2023-09-21', platform: 'ergon.moe', tags: ['defi-paradox', 'elastic-base', 'collateral-spirals'] },
    },
  ];

  const sourceIds = [];
  for (const s of sources) {
    const result = recordSource(s);
    if (result) sourceIds.push(result.id);
  }

  console.log(`\nRecorded ${sourceIds.length} sources`);

  // ============ Record Derivations (How Sources Informed Our Work) ============

  // Derivation 1: Proportional reward formula
  const drv1 = recordDerivation({
    sourceIds: sourceIds.slice(0, 7), // All Licho sources
    output: 'JUL proportional reward formula in mining.js',
    description: 'Licho\'s Ergon model (proportional reward, Moore\'s law decay, escape velocity) directly informed the replacement of arbitrary exponential reward with work-proportional formula: reward = 2^difficulty × mooreDecay / CALIBRATION',
    sessionId: 'session-046',
  });

  // Derivation 2: Moore's law exact decay constant
  const drv2 = recordDerivation({
    sourceIds: [sourceIds[1]], // Escape Velocity article
    output: 'Exact Moore\'s law decay: 2^(-1/HALVING_EPOCHS) replacing integer ratio approximation',
    description: 'Licho\'s escape velocity derivation revealed the need for Moore\'s law decay. We improved on Ergon\'s integer ratio (99918/100000) with mathematically exact 2^(-1/N), eliminating compounding drift — error reduced from ~0.1% to 4.8×10⁻¹³',
    sessionId: 'session-046',
  });

  // Derivation 3: Escape velocity supply model
  const drv3 = recordDerivation({
    sourceIds: [sourceIds[1], sourceIds[0]], // Escape Velocity + Supply Shrinking
    output: 'getEscapeVelocity() function — theoretical max supply without hard cap',
    description: 'Licho\'s escape velocity formula (totalSupply + halvingTime/ln2 × reward × proofsPerEpoch) implemented as trustless supply bound. Three natural sinks (lost coins, compute burns, FR collapses) ensure actual supply stays well below theoretical max.',
    sessionId: 'session-046',
  });

  // Derivation 4: Cyphercash philosophy → JUL design
  const drv4 = recordDerivation({
    sourceIds: [sourceIds[3], sourceIds[5], sourceIds[6]], // Mutual Credit + Cyphercash + Coffee
    output: 'JUL positioned as cyphercash (mutual credit for compute), not speculative token',
    description: 'Licho\'s framing of proportional-reward currency as mutual credit (work done → credit issued → credit redeemed for compute) directly shaped JUL\'s identity: work-credit that burns for API access, not investment vehicle.',
    sessionId: 'session-046',
  });

  // Derivation 5: DeFi base paradox → TSS validation
  const drv5 = recordDerivation({
    sourceIds: [sourceIds[7]], // Hooke's (Un)Stable Building Blocks
    output: 'Validation of Trinomial Stability System (TSS) design',
    description: 'Hooke\'s DeFi base paradox analysis (building stable finance on hyper-deflationary base = liquidation cascades) independently validates Will\'s TSS Protocol: elastic base money prevents collateral spirals.',
    sessionId: 'session-046',
  });

  // Derivation 6: Knowledge primitives extraction
  const drv6 = recordDerivation({
    sourceIds: sourceIds, // All sources
    output: '13 knowledge primitives in elastic-money-primitives.md',
    description: 'All 8 articles distilled into 13 actionable knowledge primitives covering: money=liquidity, invisible hand, proportional reward, escape velocity, three sinks, the synthesis, mutual credit, DeFi base paradox, Hayek\'s denationalization, miners manufacture truth, cyphercash, coffee is subversive, pyramid critique.',
    sessionId: 'session-046',
  });

  const derivationIds = [drv1, drv2, drv3, drv4, drv5, drv6].filter(Boolean).map(d => d.id);

  console.log(`Recorded ${derivationIds.length} derivations`);

  // ============ Record Outputs (Shipped Code) ============

  recordOutput({
    derivationIds,
    evidenceHash: 'mining-js-proportional-reward-v1',
    value: 10, // High value — core economic mechanism
    description: 'mining.js: Ergon-model proportional reward with exact Moore\'s law decay, escape velocity, hash cost oracle',
    deployed: false, // Will deploy after verification
  });

  recordOutput({
    derivationIds: [drv6?.id].filter(Boolean),
    evidenceHash: 'elastic-money-primitives-md-v1',
    value: 5,
    description: 'elastic-money-primitives.md: 13 knowledge primitives extracted from Licho/Hooke articles',
    deployed: true,
  });

  console.log('\nRecorded 2 outputs');

  // ============ Show Results ============

  console.log('\n=== Attribution Graph Stats ===');
  console.log(JSON.stringify(getGraphStats(), null, 2));

  console.log('\n=== Licho Attribution ===');
  console.log(JSON.stringify(getAuthorAttribution('Licho'), null, 2));

  console.log('\n=== Hooke Attribution ===');
  console.log(JSON.stringify(getAuthorAttribution('Hooke'), null, 2));

  await flushAttribution();
  console.log('\nGraph saved to data/attribution-graph.json');
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
