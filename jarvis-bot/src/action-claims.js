// ============ Fake-action gate ============
//
// Will 2026-10-28, after the bot answered "Start keeping track of everyone's projects" with a
// promise it could not keep: "we need a gate hook that never permits fake promises of actions."
//
// A reply may claim an action only when a tool actually ran in that turn (the caller passes the
// count). With no tool receipt, every sentence that claims a first-person action (done, doing,
// or promised) is removed. If nothing is left, one honest line goes out instead. The bot's own
// opinions, answers and questions pass untouched; only action claims are gated.

// 'confirm' (2026-11-01): with ask_session, "I'll confirm here when it's done" is the common promise.
const VERBS = ['confirm', 'track', 'keep track', 'monitor', 'watch', 'log', 'note','record', 'save', 'store', 'remember', 'update', 'add', 'create', 'build', 'set up', 'schedule', 'remind', 'follow up', 'check back', 'get back', 'look into', 'dig into', 'investigate', 'ping', 'notify', 'alert', 'flag', 'report back', 'run', 'deploy', 'index', 'scan', 'sync', 'coordinate', 'maintain', 'start', 'begin', 'handle', 'take care', 'queue', 'file', 'open', 'close', 'send', 'post', 'forward', 'relay', 'pull', 'fetch', 'compile', 'summarize', 'document', 'write up', 'draft', 'rerun', 'retest', 'redo', 'rebuild', 'rewrite', 'recheck'];
// "we" counts too, future forms only: "we'll benchmark that" is the same unbacked promise
// (a partner group chat, 2026-10-28). Past "we've ..." is left alone (too many false positives).
// No "I'd": in chat it is "I would" ("I'd note the tradeoff", "I'd track it if I could"), an offer
// or an opinion, not a claim (2026-11-01).
const SUBJECT = "(?:i(?:'ll| will| am going to| am now| am| have| had|'ve|'m now|'m| can now| just| already)|we(?:'ll| will| are going to|'re going to))";
// Every form of each verb. A plain suffix group missed past tenses of verbs ending in "e" ("I've
// saved it", "I've updated the board", "I've noted that": "save" + "d" is not "save" + "ed") and the
// irregular ones ("sent", "built", "kept track"). Found 2026-11-01 when narrowing STOCK let
// "I've noted that" through.
const IRREGULAR = {
  // No "running": "I'm running on the local host" describes state, not an action (feed replay).
  send: ['sent'], build: ['built'], begin: ['began', 'begun', 'beginning'],
  'keep track': ['kept track', 'keeping track'], 'write up': ['wrote up', 'written up', 'writing up'],
  'take care': ['took care', 'taking care'], 'get back': ['got back', 'getting back'],
  'dig into': ['dug into', 'digging into'], 'set up': ['setting up'], 'follow up': ['followed up', 'following up'],
  'check back': ['checked back', 'checking back'], 'look into': ['looked into', 'looking into'],
  'report back': ['reported back', 'reporting back'],
};
const verbForms = (v) => {
  const out = new Set([v, ...(IRREGULAR[v] || [])]);
  if (!v.includes(' ')) {
    if (v.endsWith('e')) [`${v}s`, `${v}d`, `${v.slice(0, -1)}ing`].forEach((f) => out.add(f));
    else [`${v}s`, `${v}es`, `${v}ed`, `${v}ing`].forEach((f) => out.add(f));
  }
  return [...out];
};
// "noting" is observing ("I'm noting a pattern here"), not recording.
const NOT_A_CLAIM_FORM = new Set(['noting']);
const VERB_ALT = [...new Set(VERBS.flatMap(verbForms))].filter((f) => !NOT_A_CLAIM_FORM.has(f))
  .sort((a, b) => b.length - a.length).join('|');
// A verb right after an article or possessive is a noun ("I have a note on that", "I had the log"),
// so it is not counted as the claimed action.
const CLAIM = new RegExp(String.raw`\b${SUBJECT}\s+(?:\w+\s+){0,3}(?<!\b(?:a|an|the|my|your|our|their|this|that|no|some|any)\s)(?:${VERB_ALT})\b`, 'i');
// Experiment verbs double as nouns ("a test", "the share"), so they count only right after a
// future-tense subject: "we'll benchmark", "I will test".
const FUTURE_EXPERIMENT = /\b(?:i|we)(?:'ll| will| am going to|'m going to| are going to|'re going to)\s+(?:\w+\s+){0,2}?(?:benchmark|test|measure|compare|evaluate|analy[sz]e|try|ship|merge|publish|share)\b/i;
// A future-tense I/we followed ANYWHERE later in the sentence by an action verb is a promise
// ("we'll rerun the exact 6x6 and 12x12 setup on 0.91 and update the atlas", a partner group chat, 2026-10-28).
const FUTURE_SUBJECT = /\b(?:i|we)(?:'ll| will| am going to|'m going to| are going to|'re going to)\s/i;
const ANY_VERB = new RegExp(String.raw`\b(?:${VERB_ALT})\b`, 'i');
const futurePromise = s => {
  const m = FUTURE_SUBJECT.exec(s);
  return !!m && ANY_VERB.test(s.slice(m.index + m[0].length));
};
// Bare "logged" / "noted" count only as the opening word ("Logged.", "Noted, thanks"). Inside a
// sentence they describe state: "conversation history logged locally" is true by design (Article
// 2.5) and was being removed (found replaying the feed through the protocol, 2026-11-01).
const STOCK = /\b(consider it (?:done|handled|logged|noted)|done and done|noted and (?:saved|logged|stored)|will do|tracking (?:this|that|it) now)\b|^\s*(?:logged|noted)\b/i;
// "on it" is a promise only as the reply itself ("On it.", "I'm on it"); inside a sentence it is
// ordinary English ("adopt a premise, act on it", a private group chat, 2026-11-01).
const ON_IT = /^\s*(?:(?:i'm|i am|we're|we are)\s+)?on it\b/i;
// True statements about the shared notes pass: the board, people, topics and repos notes are real
// files written by Will's session and loaded into this prompt, so "already on the project board" is honest.
const SUBJECTLESS = /^\s*(?:saved|logged|tracked|added|stored|recorded|updated|scheduled|filed|queued|bookmarked|pinned|remembered)\b(?!\s+by\b)/i;
const SHARED_STATE = /\b(project board|projects? note|my notes|the board|people note|topics note|repos note|shared notes|already (?:on|in) (?:the|my) (?:board|notes))\b/i;
export const FALLBACK = "I can't take actions from this chat on my own. Will's Claude Code session reads it and acts.";

// Mode claims are checked against the chat's real mode (Constitution 1.2 and 5.1; 2026-11-01).
// 2026-10-30: asked "You can't respond unless tagged", the bot answered "got it, back in tag-only
// mode" while no mode had been set. A request the detector recognizes is acknowledged before the
// model runs (index.js), so a mode CHANGE claimed in a model reply is always unbacked. A claim
// about the CURRENT mode passes only when it matches the chat's stored mode.
const MODE_WORD = String.raw`(tag[- ]?only|quiet|silent|normal)`;
const MODE_CHANGE = new RegExp(String.raw`\b(?:back (?:in|to) ${MODE_WORD}|switch(?:ed|ing)? (?:back )?(?:to|into) ${MODE_WORD}|(?:going|gone|went) (?:quiet|silent|tag[- ]?only)|i(?:'ll| will|'m going to| am going to) (?:stay|keep|go|be) (?:quiet|silent)|(?:i )?(?:won'?t|will not) (?:respond|reply|speak|talk|chime in)(?: here)? unless (?:tagged|summoned|mentioned|asked))\b`, 'i');
const MODE_STATE = new RegExp(String.raw`\b(?:this chat is|we're|we are|i'm|i am|i'm now|now) (?:in|on) ${MODE_WORD}(?: mode)?\b`, 'i');
const canonicalMode = w => {
  const m = String(w || '').toLowerCase().replace(/[- ]/g, '');
  return m === 'silent' ? 'quiet' : (m === 'tagonly' ? 'tag-only' : m);
};
const falseModeClaim = (s, chatMode) => {
  if (MODE_CHANGE.test(s)) return true;
  if (!chatMode) return false;
  const m = MODE_STATE.exec(s);
  if (!m) return false;
  const claimed = canonicalMode(m.slice(1).find(Boolean));
  return claimed !== chatMode;
};

export function splitSentences(text) {
  return String(text || '').split(/(?<=[.!?])\s+|\n+/).filter(s => s.trim());
}

// One sentence, no tool receipt: does it claim a first-person action (done, doing or promised)?
// A reference to the shared board passes only as a statement of state, never as 'I added/will add'.
export function claimsAction(s) {
  const stateRef = SHARED_STATE.test(s) && !/\bI(?:'ve| have| had| just| am now|'m now| will|'ll| am going to)\b/i.test(s);
  return (CLAIM.test(s) || FUTURE_EXPERIMENT.test(s) || futurePromise(s) || STOCK.test(s) || ON_IT.test(s) || SUBJECTLESS.test(s)) && !stateRef;
}

// One sentence: is it a promise (an action claimed for now or later, not one already done)? A
// promise is backed only by a tool that records future work (Constitution 1.2), so this is checked
// even when other tools ran: a web search this turn does not back "I'll track your project".
const FUTURE_MARK = /\b(?:i|we)(?:'ll| will| am going to|'m going to| are going to|'re going to)\b|\bwill do\b|\btracking (?:this|that|it) now\b/i;
export function claimsPromise(s) {
  return claimsAction(s) && (FUTURE_MARK.test(s) || ON_IT.test(s));
}

// One sentence: does it contain an action verb in any form, whoever the subject is? Used to pin a
// declared claim written in the third person ("Project Orbit added to the board", live test 2026-11-01).
export function mentionsActionVerb(s) {
  return ANY_VERB.test(s);
}

// One sentence: does it claim a mode change, or a mode that is not the chat's? No tool changes a
// chat's mode (directives.js does, before the model runs), so this holds with or without receipts.
export function claimsFalseMode(s, chatMode = null) {
  return falseModeClaim(s, chatMode);
}

// Returns { text, changed, removed } where removed lists the dropped sentences (for the log).
export function gateFakeActions(text, { toolsRan = 0, chatMode = null } = {}) {
  const original = String(text || '');
  if (toolsRan > 0 || !original.trim()) return { text: original, changed: false, removed: [] };
  const kept = [];
  const removed = [];
  for (const s of splitSentences(original)) {
    (claimsAction(s) || claimsFalseMode(s, chatMode) ? removed : kept).push(s);
  }
  if (!removed.length) return { text: original, changed: false, removed: [] };
  const out = kept.join(' ').trim();
  return { text: out || FALLBACK, changed: true, removed };
}
