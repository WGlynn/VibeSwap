// Tests for the protocol object (src/protocol.js; proposal 0003 foundation, 2026-11-01): every reply
// the chat voice sends is the checked reply of a protocol object. Case ids P1..P20 are cited in
// CONSTITUTION.md ("Tested by", Articles 1 and 5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { speak, parseDeclaration, turnRecord, protocolLine, protocolSummary, REPLY_PROTOCOL, MODE_NOTE, QUEUED_NOTE } from '../src/protocol.js';
import { FALLBACK } from '../src/action-claims.js';
import { detectDirective } from '../src/directives.js';

const rec = (tools = [], extra = {}) => turnRecord({ chatType: 'supergroup', chatMode: 'normal', tools, ...extra });
const ok = (name) => ({ name, ok: true });
const failed = (name) => ({ name, ok: false });

// ============ The declaration line ============

test('P1 a closing protocol line is parsed and never reaches the reply', () => {
  const r = parseDeclaration('sounds right to me.\n<protocol>actions: saved the fact (learn_fact) | sources: conversation, tool:learn_fact</protocol>');
  assert.equal(r.reply, 'sounds right to me.');
  assert.deepEqual(r.declared.actions, [{ text: 'saved the fact', tool: 'learn_fact' }]);
  assert.deepEqual(r.declared.sources, ['conversation', 'tool:learn_fact']);
});

test('P2 every shape of the line is removed: wrapped, unterminated, first, bare, twice', () => {
  const shapes = [
    'hi there. `<protocol>actions: none | sources: conversation</protocol>`',
    'hi there. **<protocol>actions: none | sources: conversation</protocol>**',
    'hi there.\n<protocol>actions: none | sources: conver',
    '<protocol>actions: none | sources: conversation</protocol>\nhi there.',
    'hi there.\nprotocol: actions: none | sources: conversation',
    'hi there. <protocol>actions: none</protocol> <protocol>actions: none | sources: notes</protocol>',
    'hi there. < protocol >actions: none | sources: notes</ protocol >',
  ];
  for (const s of shapes) {
    const r = speak(s, rec());
    assert.equal(r.reply, 'hi there.', s);
    assert.doesNotMatch(r.reply, /protocol/i, s);
    assert.equal(r.declared, true, s);
  }
});

test('P3 "none" declares no actions, and a reply with no line is marked undeclared', () => {
  assert.deepEqual(parseDeclaration('ok. <protocol>actions: none | sources: notes</protocol>').declared.actions, []);
  const r = speak('just an answer, no line.', rec());
  assert.equal(r.declared, false);
  assert.equal(r.reply, 'just an answer, no line.');
});

// ============ Article 1.2: claimed actions are checked against what ran ============

test('P4 a reworded claim the fixed phrasings miss is caught through the declaration', () => {
  const r = speak('nice, love the direction. consider your project on my radar from here on.\n<protocol>actions: keep your project on my radar (none) | sources: conversation</protocol>', rec());
  assert.equal(r.reply, `nice, love the direction.\n\n${FALLBACK}`);
  assert.deepEqual(r.violations, ['unbacked_declared']);
});

test('P5 a declared action backed by a tool that worked this turn stays', () => {
  const text = 'Saved. the binary state flip plus the living seed.';
  const r = speak(`${text}\n<protocol>actions: saved the primitive (learn_fact) | sources: conversation</protocol>`, rec([ok('learn_fact')]));
  assert.equal(r.reply, text);
  assert.equal(r.actions[0].backed, true);
  assert.deepEqual(r.violations, []);
});

test('P6 a tool that ran and failed is not a receipt ("Saved." after a failed save is removed)', () => {
  const r = speak('Saved. the binary state flip plus the living seed.', rec([failed('learn_fact')]));
  assert.equal(r.reply, `the binary state flip plus the living seed.\n\n${FALLBACK}`);
  assert.deepEqual(r.violations, ['unbacked_action']);
});

test('P7 a declared tool that did not run backs nothing', () => {
  const r = speak('I saved your note to the board.\n<protocol>actions: saved your note (learn_fact) | sources: conversation</protocol>', rec([ok('web_search')]));
  assert.equal(r.reply, FALLBACK);
  assert.equal(r.actions[0].backed, false);
});

test('P8 a promise needs a tool that records future work, not just any tool', () => {
  const r = speak("found it on the docs page. I'll keep track of your launch date.", rec([ok('web_search')]));
  assert.equal(r.reply, `found it on the docs page.\n\n${FALLBACK}`);
  assert.deepEqual(r.violations, ['unbacked_promise']);
  const backed = speak("I'll check back tomorrow with the numbers.", rec([ok('defer_task')]));
  assert.equal(backed.reply, "I'll check back tomorrow with the numbers.");
});

test('P9 with no line at all, the fixed phrasings still remove an unbacked promise', () => {
  const r = speak("I'll keep track of that for you.", rec());
  assert.equal(r.reply, FALLBACK);
  assert.equal(r.declared, false);
});

test('P10 talking is not an action, and another mind\'s action is not this voice\'s claim', () => {
  const a = speak('the idea is a state flip, not a gradient.\n<protocol>actions: explained the idea (none) | sources: general knowledge</protocol>', rec());
  assert.equal(a.reply, 'the idea is a state flip, not a gradient.');
  assert.deepEqual(a.violations, []);
  const b = speak("not on the board yet. Will's session reads this chat and updates it.\n<protocol>actions: Will's session will update the board (none) | sources: notes</protocol>", rec());
  assert.equal(b.reply, "not on the board yet. Will's session reads this chat and updates it.");
});

test('P11 an unbacked claim that cannot be pinned to a sentence gets the honest line, not a guess', () => {
  const r = speak('sounds good.\n<protocol>actions: remember your birthday (none) | sources: conversation</protocol>', rec());
  assert.equal(r.reply, `sounds good.\n\n${FALLBACK}`);
  assert.deepEqual(r.violations, ['unlocated_declared']);
});

test('P12 removing a sentence keeps the paragraphs around it', () => {
  const r = speak("line one is fine.\n\nI'll keep track of that.\n\nline three is fine.", rec());
  assert.equal(r.reply, `line one is fine.\n\nline three is fine.\n\n${FALLBACK}`);
});

test('P22 a removed claim never leaves a reply that still implies it (live probe, 2026-11-01)', () => {
  // Asked to track a launch date, gemini wrote "dec 12. noted." and declared no actions. The bare
  // "dec 12." left behind read as an acknowledgment; the honest line says nothing was tracked.
  const r = speak('dec 12. noted.\n\n<protocol>actions: none | sources: conversation</protocol>', rec());
  assert.equal(r.reply, `dec 12.\n\n${FALLBACK}`);
  assert.equal(r.declared, true);
  assert.deepEqual(r.violations, ['unbacked_action']);
});

test('P13 true statements still pass: the board, and "act on it" inside a sentence', () => {
  for (const s of ["that's already on the project board.", 'You adopt a foundational premise, act on it, and let real-world feedback refine the model.']) {
    assert.equal(speak(s, rec()).reply, s);
  }
});

// ============ Articles 1.2 and 5.1: mode claims ============

test('P14 a claimed mode change is removed even when a tool ran (no tool changes a mode)', () => {
  const r = speak('got it, back in tag-only mode.', rec([ok('web_search')]));
  assert.equal(r.reply, MODE_NOTE);
  assert.deepEqual(r.violations, ['mode_claim']);
});

test('P21 the mode note only names phrases the directive detector actually recognizes', () => {
  const phrases = [...MODE_NOTE.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(phrases.map((p) => detectDirective(p)?.mode), ['quiet', 'tag-only', 'normal']);
});

test('P15 a claim about the current mode passes only when it is the real mode', () => {
  const line = "this chat is in tag-only mode, so I'll only answer when tagged.";
  assert.notEqual(speak(line, rec([], { chatMode: 'normal' })).reply, line);
  assert.equal(speak('this chat is in tag-only mode.', rec([], { chatMode: 'tag-only' })).reply, 'this chat is in tag-only mode.');
});

// ============ Sources (Article 7.3), logged ============

test('P16 a tool named as a source has to have run; the reply is not changed for it yet', () => {
  const r = speak('the repo shows three open PRs.\n<protocol>actions: none | sources: tool:github_activity</protocol>', rec());
  assert.equal(r.reply, 'the repo shows three open PRs.');
  assert.deepEqual(r.violations, ['unbacked_source']);
  assert.deepEqual(speak('the repo shows three open PRs.\n<protocol>actions: none | sources: tool:github_activity</protocol>', rec([ok('github_activity')])).violations, []);
});

// ============ The record, the history line, the log ============

test('P17 the record says where the turn happened', () => {
  assert.equal(turnRecord({ chatType: 'private' }).scope, 'dm');
  assert.equal(turnRecord({ chatType: 'group' }).scope, 'group');
  assert.equal(turnRecord({ chatType: 'supergroup' }).scope, 'group');
  assert.equal(turnRecord({ chatType: 'web' }).scope, 'web');
  assert.deepEqual(turnRecord({ receipts: [{ name: 'web', ok: true }], tools: [{ name: 'Learn_Fact', ok: false }] }).tools,
    [{ name: 'web', ok: true }, { name: 'learn_fact', ok: false }]);
});

test('P18 the history line is the true declaration of what was sent', () => {
  const declared = speak('Saved.\n<protocol>actions: saved the fact (learn_fact); will remind you (none) | sources: conversation</protocol>', rec([ok('learn_fact')]));
  assert.equal(protocolLine(declared), '<protocol>actions: saved the fact (learn_fact) | sources: conversation</protocol>');
  const undeclared = speak('Saved.', rec([ok('learn_fact')]));
  assert.equal(protocolLine(undeclared), '<protocol>actions: used learn_fact (learn_fact) | sources: conversation</protocol>');
});

test('P19 the log summary carries counts and kinds, not the reply text', () => {
  const s = protocolSummary(speak("I'll keep track of that.", rec([failed('learn_fact')])));
  assert.deepEqual(s, { v: 1, declared: false, actions: 0, backed: 0, removed: 1, violations: ['unbacked_promise'], tools: ['learn_fact:failed'] });
});

test('P20 the prompt block asks for the line and gives the reason, in plain words', () => {
  assert.match(REPLY_PROTOCOL, /<protocol>actions: ACTIONS \| sources: SOURCES<\/protocol>/);
  assert.match(REPLY_PROTOCOL, /Constitution 1\.2/);
  assert.doesNotMatch(REPLY_PROTOCOL, /[—–]/);
});

// ============ A queue is not a completion (live test, 2026-11-01) ============

test('P23 the live failure: a third-person "added" claim is pinned and replaced by what is true', () => {
  const raw = 'Project Orbit added to the board with a launch date of December 12, 2026.\n<protocol>actions: added Project Orbit to the board (none) | sources: conversation</protocol>';
  assert.equal(speak(raw, rec([ok('ask_session')])).reply, QUEUED_NOTE, 'a request was queued this turn');
  assert.equal(speak(raw, rec()).reply, FALLBACK, 'nothing was queued');
});

test('P24 a tool that only queues work backs "queued" and promises, never "done"', () => {
  const queued = rec([ok('ask_session')]);
  assert.equal(speak("I've queued it for Will's session.", queued).reply, "I've queued it for Will's session.");
  assert.equal(speak("I'll confirm here when it's done.", queued).reply, "I'll confirm here when it's done.");
  assert.equal(speak('Saved.', queued).reply, QUEUED_NOTE);
  const declaredDone = speak('Done, it is on the board now.\n<protocol>actions: added it to the board (ask_session) | sources: conversation</protocol>', queued);
  assert.equal(declaredDone.actions[0].backed, false);
  const declaredQueued = speak('Queued for Will.\n<protocol>actions: queued the board update for Will (ask_session) | sources: conversation</protocol>', queued);
  assert.equal(declaredQueued.actions[0].backed, true);
});
