// ============ The protocol object: every word the chat voice sends passes through here ============
//
// Proposal 0003, foundation (Will 2026-11-01): "the protocol needs to be DNA level embedding in the
// system so that the LLM needs it." The model does not hand people free text. chat() turns its raw
// output into a protocol object with speak(): the reply, the actions the reply claims, and where its
// facts came from, each checked against the turn's record. chat() returns only the checked reply,
// so no reply path can skip the check by forgetting to call it (the media, web and collision paths
// each did, one at a time, while the check lived at the call sites).
//
// Two-way (Will, same day): the record is the inbound half (who asked, in which chat and mode, and
// what actually ran this turn: tools by name and whether they worked, plus work code did before the
// model ran, such as fetching a link); the object is the outbound half, checked against it.
//
// The model is asked to declare its claims in a closing <protocol> line (REPLY_PROTOCOL). The line
// is removed before anyone sees the reply. Declared actions are checked exactly, by tool name. The
// fixed-phrasing detectors in action-claims.js still run on every reply, so a model that forgets the
// line or leaves a claim out is caught the old way.
//
// Honest floor: a declaration makes a claim checkable, not true. Free models follow the format
// unevenly, which is why the detectors stay as the backstop and each reply's declaration is logged
// per model (the measure Lever 3 needs). Sources are logged and checked against the record, but a
// false source does not change the reply yet: there is no sentence to pin it to.

import { splitSentences, claimsAction, claimsPromise, claimsFalseMode, mentionsActionVerb, FALLBACK } from './action-claims.js';

export const PROTOCOL_VERSION = 1;

// Appended after the recency rules (memory.js), so it is part of the cached prompt prefix.
export const REPLY_PROTOCOL = `
<reply_protocol>
End every reply with one closing line in exactly this form:
<protocol>actions: ACTIONS | sources: SOURCES</protocol>
ACTIONS: each action in the world this reply says you took, are taking or will take (saved, stored, tracked, scheduled, set, sent, posted, looked up, ran, will follow up), each with the tool that did it this turn in brackets, separated by ";". Example: <protocol>actions: saved the fact (learn_fact) | sources: conversation</protocol>. Write "none" when the reply claims no action. Answering, explaining and giving an opinion are not actions.
SOURCES: where what you said comes from, separated by ",": conversation, notes, tool:NAME, web, general knowledge.
Why: code reads this line, removes it before anyone sees your reply, and checks it against what actually ran this turn. A claimed action with no tool behind it is taken out of the reply. This is how people can trust what you say you did (Constitution 1.2), whichever model you are running on.
</reply_protocol>`;

// Tools that record future work. A promise is backed only by one of these: defer_task (the bot's own
// queue) and ask_session (Will's Claude Code session does it; session-requests.js). Constitution 1.2:
// a promise is made only when a tool records it and a mind will actually carry it out.
const FUTURE_TOOLS = new Set(['defertask', 'asksession']);

// A queue is not a completion. A tool that only records future work backs a promise or a "queued"
// claim, never "added" or "saved": in a live test (2026-11-01) a queued request would otherwise have
// backed "Project Orbit added to the board", which was false.
const QUEUED = /\b(?:queu\w*|ask(?:ed|ing)?\b|pass(?:ed|ing)?\b[^.?!]{0,20}\b(?:on|along|to)\b|request(?:ed)?\b|forward(?:ed|ing)?\b|hand(?:ed|ing)?\b[^.?!]{0,12}\b(?:off|over)\b)/i;
const FUTURE_WORDS = /\b(?:will|'ll|going to|follow(?:ing)? up|confirm)\b/i;

// Said instead of FALLBACK when the turn did queue a request for Will's session.
export const QUEUED_NOTE = "I've passed this to Will's Claude Code session; I'll confirm here once it's done.";

// Violations that mean an action claim was taken out (or could not be), so the reply must say so.
const ACTION_VIOLATIONS = new Set(['unbacked_action', 'unbacked_promise', 'unbacked_declared', 'unlocated_declared']);

// Said when a claimed mode change is removed. Each phrase is one the directive detector recognizes
// (test P21), so the person is never sent to a command that does nothing (Constitution 5.1).
export const MODE_NOTE = 'That did not change this chat\'s mode. To change it, say "jarvis be quiet", "jarvis only respond when tagged" or "jarvis back to normal".';

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// ============ Inbound: the turn's record ============

// Which kind of chat a turn is in: Telegram's private, group, supergroup and channel, or the web chat.
export const scopeOf = (chatType) => (chatType === 'private' ? 'dm' : chatType === 'web' ? 'web' : 'group');

// tools: every tool call the model made, in order, as { name, ok }. receipts: work code did for
// this turn before the model ran, in the same shape (a fetched link is { name: 'web', ok: true }).
export function turnRecord({ chatId = null, chatType = 'private', chatMode = null, fromId = null, tools = [], receipts = [] } = {}) {
  const scope = scopeOf(chatType);
  const all = [...receipts, ...tools].map((t) => ({ name: String(t?.name || '').toLowerCase(), ok: !!t?.ok }));
  return { chatId, chatType, chatMode, fromId, scope, tools: all };
}

// ============ Outbound: parse the model's declaration ============

// A <protocol> block anywhere (the last one is the declaration), unterminated at the end, or
// wrapped in markdown. Every match is removed: nothing protocol-shaped reaches people.
const BLOCK = /[`*_]*<\s*protocol\s*>([\s\S]*?)(?:<\s*\/\s*protocol\s*>|$)[`*_]*/gi;
// Some models drop the angle brackets: a last line "protocol: actions: ... | sources: ...".
const BARE = /(?:^|\n)[ \t]*[`*_]*\[?protocol\]?[`*_]*[ \t]*:?[ \t]*(actions[ \t]*:[^\n]*)\s*$/i;

function field(body, name) {
  const m = new RegExp(String.raw`\b${name}\s*:\s*([^|\n]*)`, 'i').exec(body);
  return m ? m[1].trim() : '';
}

function parseAction(s) {
  const m = /^(.*?)\s*[([]\s*([^()[\]]+?)\s*[)\]]\s*\.?$/.exec(s);
  const text = (m ? m[1] : s).trim().replace(/\.$/, '');
  let tool = m ? m[2].trim().toLowerCase().replace(/^tool\s*:\s*/, '') : null;
  if (tool && /^(?:none|no tool|no-tool|n\/a|-|nothing)$/.test(tool)) tool = null;
  return { text, tool };
}

export function parseDeclaration(raw) {
  let text = String(raw ?? '');
  let body = null;
  text = text.replace(BLOCK, (_, inner) => { body = inner; return ''; });
  if (body == null) {
    const m = BARE.exec(text);
    if (m) { body = m[1]; text = text.slice(0, m.index); }
  }
  // Text with no line in it comes back exactly as written; only the gap a removed line left is tidied.
  if (body == null) return { reply: text.trim(), declared: null };
  const reply = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const actionsRaw = field(body, 'actions');
  const sourcesRaw = field(body, 'sources');
  const actions = /^(?:none|n\/a|-|nothing)?\.?$/i.test(actionsRaw)
    ? []
    : actionsRaw.split(/\s*;\s*/).filter(Boolean).map(parseAction).filter((a) => a.text);
  const sources = sourcesRaw.split(/\s*,\s*/).map((s) => s.trim().toLowerCase().replace(/\.$/, '')).filter(Boolean);
  return { reply, declared: { actions, sources } };
}

// ============ Finding the sentence a declared action lives in ============

// Not actions in the world: talking. And actions by another mind ("Will's session will update the
// board" is the true statement rule 22 asks for, not a claim about this voice).
const SPEECH = /^(?:i\s+)?(?:explain|answer|describ|said|say|tell|told|clarif|suggest|recommend|agree|acknowledg|repl|respond|point(?:ed)? out|thought|think|ask|greet|thank|gave (?:my|a|an)|giv(?:e|ing) (?:my|a|an)|offer(?:ed)? (?:my|a|an)|shar(?:e|ed|ing) (?:my|a|an|some) (?:view|thought|take|opinion))/i;
const OTHER_ACTOR = /\bWill(?:'s)?\s+(?:Claude Code\s+)?session\b|\bClaude Code\b|\bthe session\b/i;

// A claim by this voice is first person ("I'll keep an eye on it") or subjectless ("Saved.").
const FIRST_PERSON = /\b(?:i|we|i'll|we'll|i've|we've|i'm|we're|me|us|my|our)\b/i;
const SUBJECTLESS_START = /^\s*(?:saved|logged|tracked|added|stored|recorded|updated|scheduled|filed|queued|noted|done|set|sent|posted|pinned|flagged|bookmarked|consider it)\b/i;

const STOP = new Set(`the and for that this with you your from have has had are was were will would can could should just
about into onto them they their there then than what when where which who how why its not but out all any also very really
some more most such been being his her him she he it i'll i've i'm we'll we've we're me my mine ours our us`.split(/\s+/));
const stem = (w) => (w.replace(/(?:ing|ed)$/, '').replace(/s$/, '') || w);
const contentWords = (s) => (String(s).toLowerCase().match(/[a-z][a-z'-]{2,}/g) || [])
  .map((w) => w.replace(/'s$/, ''))
  .filter((w) => !STOP.has(w))
  .map(stem);

// The index of the one sentence that best carries the declared action, or -1 when none clearly
// does. A tie or a weak match is treated as not found: removing the wrong sentence is worse than
// appending a correction.
function locate(actionText, sentences) {
  const want = new Set(contentWords(actionText));
  if (!want.size) return -1;
  let best = -1;
  let bestScore = 0;
  let tie = false;
  sentences.forEach((s, i) => {
    if (!(FIRST_PERSON.test(s) || SUBJECTLESS_START.test(s) || mentionsActionVerb(s))) return;
    const have = new Set(contentWords(s));
    let hit = 0;
    for (const w of want) if (have.has(w)) hit++;
    const score = hit / want.size;
    if (score > bestScore) { best = i; bestScore = score; tie = false; } else if (score > 0 && score === bestScore) tie = true;
  });
  return bestScore >= 0.5 && !tie ? best : -1;
}

// Remove whole sentences from the original text, keeping its line breaks and paragraphs.
function removeSentences(text, sentences, idxs) {
  let out = text;
  for (const i of [...idxs].sort((a, b) => a - b)) {
    const at = out.indexOf(sentences[i]);
    if (at >= 0) out = out.slice(0, at) + out.slice(at + sentences[i].length);
  }
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+(?=\S)/g, '\n').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

// ============ speak(): the only way a model's words become a reply ============

export function speak(raw, record = turnRecord()) {
  const { reply: body, declared } = parseDeclaration(raw);
  const sentences = splitSentences(body);
  const okTools = record.tools.filter((t) => t.ok);
  const futureBacked = okTools.some((t) => FUTURE_TOOLS.has(norm(t.name)));
  // Tools that did something now. One that only queued work backs no claim that the work is done.
  const okNow = okTools.filter((t) => !FUTURE_TOOLS.has(norm(t.name)));
  const remove = new Set();
  const violations = [];

  // 1. Claims the fixed phrasings catch, on every reply, declared or not.
  sentences.forEach((s, i) => {
    if (claimsFalseMode(s, record.chatMode)) { remove.add(i); violations.push('mode_claim'); }
    else if (claimsPromise(s)) {
      if (!futureBacked) { remove.add(i); violations.push('unbacked_promise'); }
    } else if (claimsAction(s) && !okNow.length && !(futureBacked && QUEUED.test(s))) {
      remove.add(i);
      violations.push('unbacked_action');
    }
  });

  // 2. Actions the model declared, each checked against the tools that worked this turn. A tool that
  // only queues work backs the declaration only if it reads as queued or still to come.
  const actions = (declared?.actions || []).filter((a) => !SPEECH.test(a.text) && !OTHER_ACTOR.test(a.text));
  for (const a of actions) {
    const tool = a.tool && okTools.find((t) => norm(t.name) === norm(a.tool));
    a.backed = !!tool && (!FUTURE_TOOLS.has(norm(tool.name)) || QUEUED.test(a.text) || FUTURE_WORDS.test(a.text));
    if (a.backed) continue;
    const i = locate(a.text, sentences);
    if (i >= 0) { remove.add(i); violations.push('unbacked_declared'); } else { a.unlocated = true; violations.push('unlocated_declared'); }
  }

  // 3. Sources: a tool or the web named as a source has to have run.
  const sources = (declared?.sources || []).slice(0, 8);
  for (const s of sources) {
    const m = /^tool\s*:\s*(.+)$/.exec(s);
    const ran = (name) => record.tools.some((t) => norm(t.name) === norm(name));
    if (m && !ran(m[1])) violations.push('unbacked_source');
    if (s === 'web' && !record.tools.some((t) => /^(?:web|web_search|scrape_page|scrape_prices|fetch_repo|youtube)$/.test(t.name))) violations.push('unbacked_source');
  }

  // 4. Compose. Removing a claim must not leave a reply that still implies it: asked to track a date,
  // the model said "dec 12. noted." and the bare "dec 12." read as an acknowledgment (live probe,
  // 2026-11-01). So whenever a claim is removed or cannot be pinned to a sentence, the reply says what
  // actually happened: nothing was done, or the mode did not change and how to change it.
  let reply = remove.size ? removeSentences(body, sentences, remove) : body;
  const notes = [];
  // If this turn queued a request for Will's session, say that; it is true and more useful.
  const queuedForSession = okTools.some((t) => norm(t.name) === 'asksession');
  if (violations.some((v) => ACTION_VIOLATIONS.has(v))) notes.push(queuedForSession ? QUEUED_NOTE : FALLBACK);
  if (violations.includes('mode_claim')) notes.push(MODE_NOTE);
  if (notes.length) reply = [reply, ...notes.filter((n) => !reply.includes(n))].filter(Boolean).join('\n\n');

  return {
    v: PROTOCOL_VERSION,
    reply,
    declared: !!declared,
    actions: actions.map((a) => ({ text: a.text.slice(0, 120), tool: a.tool, backed: !!a.backed })),
    sources,
    removed: [...remove].sort((x, y) => x - y).map((i) => sentences[i]),
    violations: [...new Set(violations)],
    scope: record.scope,
    tools: record.tools,
  };
}

// The protocol line as code writes it into the conversation history: the reply that was actually
// sent plus its true declaration, so every past turn the model sees is an example of the format.
export function protocolLine(p) {
  const acts = p.declared
    ? p.actions.filter((a) => a.backed).map((a) => `${a.text} (${a.tool})`)
    : p.tools.filter((t) => t.ok).map((t) => `used ${t.name} (${t.name})`);
  const sources = p.sources.length ? p.sources.join(', ') : 'conversation';
  return `<protocol>actions: ${acts.length ? acts.join('; ') : 'none'} | sources: ${sources}</protocol>`;
}

// For the transport filter (text-style.js): every message Telegram is asked to send loses anything
// protocol-shaped, whichever path wrote it. The proactive path skipped the protocol object and showed
// its closing <protocol> line in a group (2026-11-03). Text with nothing protocol-shaped is unchanged.
const SHAPED = /<\s*protocol\s*>|(?:^|\n)[ \t]*[`*_]*\[?protocol\]?[`*_]*[ \t]*:?[ \t]*actions[ \t]*:/i;
export function stripProtocolBlocks(text) {
  if (typeof text !== 'string' || !SHAPED.test(text)) return text;
  return parseDeclaration(text).reply;
}

// History turns end with the protocol line; anything that reads them as replies (the room's
// question count, knowledge extraction) reads them without it.
export function stripProtocolLine(text) {
  return String(text ?? '').replace(/\n?<protocol>[\s\S]*?<\/protocol>\s*$/, '');
}

// What the exchange log keeps per reply (feed.js): counts and kinds, never the reply text again.
export function protocolSummary(p) {
  if (!p) return null;
  return {
    v: p.v,
    declared: p.declared,
    actions: p.actions.length,
    backed: p.actions.filter((a) => a.backed).length,
    removed: p.removed.length,
    violations: p.violations,
    tools: p.tools.map((t) => (t.ok ? t.name : `${t.name}:failed`)),
  };
}
