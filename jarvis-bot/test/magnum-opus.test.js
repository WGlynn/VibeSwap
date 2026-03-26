// ============ Magnum Opus Augmentation Tests ============
// Verifies anti-dumb filter, intellectual depth, and export integrity.
// Run: node test/magnum-opus.test.js

import { getFullAugmentation, getLightAugmentation, getTopicsAugmentation, ECONOMITRA_CONTEXT, PHILOSOPHICAL_GROUNDING, ANTI_DUMB_FILTER, FOUNDER_VOICE, ECONOMITRA_TOPICS } from '../src/magnum-opus.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL: ${name} — ${err.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'assertion failed');
}

console.log('\n=== Magnum Opus Module Tests ===\n');

// ============ Export integrity ============

console.log('--- Export Integrity ---');

test('ECONOMITRA_CONTEXT is non-empty string', () => {
  assert(typeof ECONOMITRA_CONTEXT === 'string' && ECONOMITRA_CONTEXT.length > 1000, `got ${ECONOMITRA_CONTEXT?.length} chars`);
});

test('PHILOSOPHICAL_GROUNDING is non-empty string', () => {
  assert(typeof PHILOSOPHICAL_GROUNDING === 'string' && PHILOSOPHICAL_GROUNDING.length > 500);
});

test('ANTI_DUMB_FILTER is non-empty string', () => {
  assert(typeof ANTI_DUMB_FILTER === 'string' && ANTI_DUMB_FILTER.length > 500);
});

test('FOUNDER_VOICE is non-empty string', () => {
  assert(typeof FOUNDER_VOICE === 'string' && FOUNDER_VOICE.length > 200);
});

test('ECONOMITRA_TOPICS has 16 items', () => {
  assert(Array.isArray(ECONOMITRA_TOPICS) && ECONOMITRA_TOPICS.length === 16, `got ${ECONOMITRA_TOPICS?.length}`);
});

test('getFullAugmentation returns all sections', () => {
  const full = getFullAugmentation();
  assert(full.includes('FALSE BINARY'), 'missing false binary');
  assert(full.includes('P-000'), 'missing P-000');
  assert(full.includes('RED LINES'), 'missing anti-dumb');
  assert(full.includes('VOICE CALIBRATION'), 'missing founder voice');
});

test('getLightAugmentation excludes ECONOMITRA_CONTEXT', () => {
  const light = getLightAugmentation();
  assert(!light.includes('CRYPTOECONOMIC PRIMITIVES'), 'should not include full economitra context');
  assert(light.includes('P-000'), 'should include philosophical grounding');
});

test('getTopicsAugmentation returns array', () => {
  const topics = getTopicsAugmentation();
  assert(Array.isArray(topics) && topics.length > 0);
  assert(topics.every(t => typeof t === 'string' && t.length > 50), 'all topics should be substantial strings');
});

// ============ Content quality ============

console.log('\n--- Content Quality ---');

test('ECONOMITRA_CONTEXT covers the false binary', () => {
  assert(ECONOMITRA_CONTEXT.includes('false binary') || ECONOMITRA_CONTEXT.includes('FALSE BINARY'));
});

test('ECONOMITRA_CONTEXT covers the cancer cell analogy', () => {
  assert(ECONOMITRA_CONTEXT.includes('cancer cell') || ECONOMITRA_CONTEXT.includes('CANCER CELL'));
});

test('ECONOMITRA_CONTEXT covers incentive design', () => {
  assert(ECONOMITRA_CONTEXT.includes('incentive') || ECONOMITRA_CONTEXT.includes('INCENTIVE'));
});

test('ECONOMITRA_CONTEXT covers grim trigger', () => {
  assert(ECONOMITRA_CONTEXT.includes('grim trigger') || ECONOMITRA_CONTEXT.includes('GRIM TRIGGER'));
});

test('ECONOMITRA_CONTEXT covers cooperative economy requirements', () => {
  assert(ECONOMITRA_CONTEXT.includes('7 must hold') || ECONOMITRA_CONTEXT.includes('cooperative') || ECONOMITRA_CONTEXT.includes('Cooperative'));
});

test('ANTI_DUMB_FILTER bans WAGMI', () => {
  assert(ANTI_DUMB_FILTER.includes('WAGMI'));
});

test('ANTI_DUMB_FILTER bans "few understand"', () => {
  assert(ANTI_DUMB_FILTER.includes('few understand'));
});

test('ANTI_DUMB_FILTER bans tribal warfare', () => {
  assert(ANTI_DUMB_FILTER.includes('tribal warfare') || ANTI_DUMB_FILTER.includes('ETH vs SOL'));
});

test('ANTI_DUMB_FILTER bans "inflation is bad" without context', () => {
  assert(ANTI_DUMB_FILTER.includes('inflation is bad'));
});

test('PHILOSOPHICAL_GROUNDING includes P-000 and P-001', () => {
  assert(PHILOSOPHICAL_GROUNDING.includes('P-000'));
  assert(PHILOSOPHICAL_GROUNDING.includes('P-001'));
});

test('FOUNDER_VOICE includes synthesis over selection', () => {
  assert(FOUNDER_VOICE.includes('SYNTHESIS') || FOUNDER_VOICE.includes('synthesis'));
});

// ============ Topic quality ============

console.log('\n--- Topic Quality ---');

test('Topics cover monetary theory', () => {
  const hasFalseBinary = ECONOMITRA_TOPICS.some(t => t.includes('false binary'));
  assert(hasFalseBinary, 'no topic covers the false binary');
});

test('Topics cover cancer cell analogy', () => {
  const hasCancerCell = ECONOMITRA_TOPICS.some(t => t.includes('cancer cell'));
  assert(hasCancerCell, 'no topic covers cancer cell analogy');
});

test('Topics cover cooperative capitalism', () => {
  const hasCoop = ECONOMITRA_TOPICS.some(t => t.includes('cooperative'));
  assert(hasCoop, 'no topic covers cooperative capitalism');
});

test('Topics cover IP reform', () => {
  const hasIP = ECONOMITRA_TOPICS.some(t => t.includes('patent') || t.includes('IP') || t.includes('rent-seeking'));
  assert(hasIP, 'no topic covers IP reform');
});

test('Topics cover game theory', () => {
  const hasGT = ECONOMITRA_TOPICS.some(t => t.includes('grim trigger') || t.includes('Trivers') || t.includes('IIA'));
  assert(hasGT, 'no topic covers game theory');
});

test('All topics are substantial (>100 chars)', () => {
  const short = ECONOMITRA_TOPICS.filter(t => t.length < 100);
  assert(short.length === 0, `${short.length} topics are too short`);
});

test('No topic contains forbidden phrases', () => {
  const forbidden = ['WAGMI', 'few understand', 'paradigm shift', 'imagine a world'];
  for (const topic of ECONOMITRA_TOPICS) {
    for (const phrase of forbidden) {
      assert(!topic.toLowerCase().includes(phrase.toLowerCase()), `topic contains "${phrase}": ${topic.slice(0, 60)}...`);
    }
  }
});

// ============ Results ============

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
