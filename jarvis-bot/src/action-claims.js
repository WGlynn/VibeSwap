// ============ Fake-action gate ============
//
// Will 2026-10-28, after the bot answered "Start keeping track of everyone's projects" with a
// promise it could not keep: "we need a gate hook that never permits fake promises of actions."
//
// A reply may claim an action only when a tool actually ran in that turn (the caller passes the
// count). With no tool receipt, every sentence that claims a first-person action (done, doing,
// or promised) is removed. If nothing is left, one honest line goes out instead. The bot's own
// opinions, answers and questions pass untouched; only action claims are gated.

const VERBS = ['track', 'keep track', 'monitor', 'watch', 'log', 'note', 'record', 'save', 'store', 'remember', 'update', 'add', 'create', 'build', 'set up', 'schedule', 'remind', 'follow up', 'check back', 'get back', 'look into', 'dig into', 'investigate', 'ping', 'notify', 'alert', 'flag', 'report back', 'run', 'deploy', 'index', 'scan', 'sync', 'coordinate', 'maintain', 'start', 'begin', 'handle', 'take care', 'queue', 'file', 'open', 'close', 'send', 'post', 'forward', 'relay', 'pull', 'fetch', 'compile', 'summarize', 'document', 'write up', 'draft'];
const SUBJECT = "i(?:'ll| will| am going to| am now| am| have| had|'ve|'m now|'m|'d| can now| just| already)";
const CLAIM = new RegExp(String.raw`\b${SUBJECT}\s+(?:\w+\s+){0,3}(?:${VERBS.join('|')})(?:ed|ing|s)?\b`, 'i');
const STOCK = /\b(consider it (?:done|handled|logged|noted)|on it|done and done|noted and (?:saved|logged|stored)|will do|tracking (?:this|that|it) now|logged|noted)\b/i;
// True statements about the shared notes pass: the board, people, topics and repos notes are real
// files written by Will's session and loaded into this prompt, so "already on the project board" is honest.
const SUBJECTLESS = /^\s*(?:saved|logged|tracked|added|stored|recorded|updated|scheduled|filed|queued|bookmarked|pinned|remembered)\b(?!\s+by\b)/i;
const SHARED_STATE = /\b(project board|projects? note|my notes|the board|people note|topics note|repos note|shared notes|already (?:on|in) (?:the|my) (?:board|notes))\b/i;
const FALLBACK = "I can't take actions from this chat on my own. Will's Claude Code session reads it and acts.";

export function splitSentences(text) {
  return String(text || '').split(/(?<=[.!?])\s+|\n+/).filter(s => s.trim());
}

// Returns { text, changed, removed } where removed lists the dropped sentences (for the log).
export function gateFakeActions(text, { toolsRan = 0 } = {}) {
  const original = String(text || '');
  if (toolsRan > 0 || !original.trim()) return { text: original, changed: false, removed: [] };
  const kept = [];
  const removed = [];
  for (const s of splitSentences(original)) {
    // A reference to the shared board passes only as a statement of state, never as 'I added/will add'.
    const stateRef = SHARED_STATE.test(s) && !/\bI(?:'ve| have| had| just| am now|'m now| will|'ll| am going to)\b/i.test(s);
    const claims = (CLAIM.test(s) || STOCK.test(s) || SUBJECTLESS.test(s)) && !stateRef;
    (claims ? removed : kept).push(s);
  }
  if (!removed.length) return { text: original, changed: false, removed: [] };
  const out = kept.join(' ').trim();
  return { text: out || FALLBACK, changed: true, removed };
}
