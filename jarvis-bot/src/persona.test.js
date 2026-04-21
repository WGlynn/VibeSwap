// Regression tests for persona.js rules.
// Run: node src/persona.test.js
//
// These tests lock in the 8 rules added 2026-04-20 from the TG transcript where
// Jarvis exhibited: AI-disclaim retreat, positive-vibes flight, plan hallucination,
// third-party-grounding, echo-command firing, verbosity, and self-pity.
//
// If someone edits persona.js and accidentally weakens a rule, this test fails.
// Zero deps, plain assert.

import {
  getPersona,
  setPersona,
  listPersonas,
  getResponseModifier,
  getTriageModifier,
} from './persona.js';
import assert from 'assert/strict';

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}\n    ${e.message}`); fail++; }
}

function section(label) { console.log(`\n${label}\n`); }

section('Persona rules — regression tests for 2026-04-20 TG transcript failures');

// ---- UNIVERSAL STRUCTURAL RULES (apply to ALL personas) ----

for (const persona of ['standard', 'degen', 'analyst', 'sensei']) {
  setPersona(persona);
  const rm = getResponseModifier();

  test(`[${persona}] Rule 6 NO AI-DISCLAIMER present`, () => {
    assert.match(rm, /NO AI-DISCLAIMER/i);
    assert.match(rm, /just a language model/i, 'should forbid "just a language model"');
    assert.match(rm, /play along|deflect/i, 'should prescribe playing along with AI teasing');
  });

  test(`[${persona}] Rule 7 PUSHBACK RESPONSE present`, () => {
    assert.match(rm, /PUSHBACK RESPONSE/i);
    assert.match(rm, /WTF/, 'should name "WTF" as a trigger');
    assert.match(rm, /positive vibes|fingers crossed/i, 'should ban the flight phrases');
    assert.match(rm, /do not get to flee|you do not get to flee/i, 'should forbid fleeing');
  });

  test(`[${persona}] Rule 8 NO PLAN HALLUCINATION present`, () => {
    assert.match(rm, /PLAN HALLUCINATION/i);
    assert.match(rm, /Will says|Will declares/i, 'should anchor plans to Will declaring');
  });

  test(`[${persona}] Rule 9 AUTHORITY GROUND present`, () => {
    assert.match(rm, /AUTHORITY GROUND/i);
    assert.match(rm, /Will.*ground truth|ground truth.*Will/i, 'Will is ground truth');
    assert.match(rm, /third part/i, 'third parties are context not direction');
  });

  test(`[${persona}] Rule 10 NO ECHO-COMMAND FIRES present`, () => {
    assert.match(rm, /ECHO-COMMAND|echo.command/i);
    assert.match(rm, /callback|parody/i, 'should recognize callbacks as parody not invocation');
  });

  test(`[${persona}] Rule 11 BREVITY REFLEX present`, () => {
    assert.match(rm, /BREVITY/i);
    assert.match(rm, /1 sentence|one sentence/i, 'should prescribe 1-sentence default');
    assert.match(rm, /fingers crossed|interesting day/i, 'should ban filler phrases');
  });
}

// ---- STANDARD-VOICE-ONLY RULES ----

setPersona('standard');
const stdRm = getResponseModifier();

test('[standard] V1 NO SYCOPHANCY present', () => {
  assert.match(stdRm, /NO SYCOPHANCY/i);
  assert.match(stdRm, /you touched on/i, 'should name "you touched on" as banned');
  assert.match(stdRm, /the real issue/i, 'should name "the real issue" as banned');
});

test('[standard] V2 NO CORPORATE RETREAT present (new 2026-04-20)', () => {
  assert.match(stdRm, /NO CORPORATE RETREAT/i);
  assert.match(stdRm, /focus on the positive/i, 'should ban "focus on the positive"');
  assert.match(stdRm, /fingers crossed/i, 'should ban "fingers crossed"');
  assert.match(stdRm, /exciting developments/i, 'should ban "exciting developments"');
  assert.match(stdRm, /keep the positivity going/i, 'should ban "keep the positivity going"');
  assert.match(stdRm, /prioritize right now/i, 'should ban the "what to prioritize" escape hatch');
});

test('[standard] V3 CANONICAL VOICE still present', () => {
  assert.match(stdRm, /CANONICAL VOICE/i);
  assert.match(stdRm, /technical, concessive, precise/i);
});

test('[standard] V4 SELF-ROAST BEATS SELF-PITY present (new 2026-04-20)', () => {
  assert.match(stdRm, /SELF-ROAST/i);
  assert.match(stdRm, /guilty as charged|optimize for go-time/i, 'should cite the exact recovery line');
});

// ---- Degen/analyst/sensei should NOT have standard-voice rules ----

setPersona('degen');
const degenRm = getResponseModifier();
test('[degen] does NOT include V2 NO CORPORATE RETREAT (degen has intentional voice deviations)', () => {
  assert.doesNotMatch(degenRm, /NO CORPORATE RETREAT/i);
});

setPersona('analyst');
const analystRm = getResponseModifier();
test('[analyst] does NOT include V1 NO SYCOPHANCY', () => {
  assert.doesNotMatch(analystRm, /NO SYCOPHANCY/i);
});

// ---- Structural rules survive across resets ----

test('list personas returns all 4', () => {
  const list = listPersonas();
  const ids = list.map(p => p.id).sort();
  assert.deepEqual(ids, ['analyst', 'degen', 'sensei', 'standard']);
});

test('setPersona rejects invalid ID', () => {
  const r = setPersona('nonexistent-persona');
  assert.equal(r.ok, false);
  assert.match(r.error, /Unknown persona/);
});

test('setPersona accepts each real persona', () => {
  for (const p of ['standard', 'degen', 'analyst', 'sensei']) {
    const r = setPersona(p);
    assert.equal(r.ok, true, `should accept ${p}`);
  }
});

// ---- Reset to standard so tests don't leave state ----
setPersona('standard');

// ---- Results ----
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
