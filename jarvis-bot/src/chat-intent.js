// ============ Chat Intent: cheap intent and humor tags, abstain when unsure ============
//
// Pure module (no imports, no state, no I/O) so the bot and scripts/chat-learning-report.mjs
// compute identical numbers. Regex only: no LLM call per message.
//
// tagIntent labels the INBOUND message banter / mechanism / critique, or abstains (intent
// null) with a reason: bare_invocation, phatic, weak (no cue scored 2), conflict (tie). A
// tiny classifier that guesses on everything is noise; abstaining is the point.
// tagHumor labels the bot REPLY joking (true) / straight (false) / unsure (null). "Joking" is a
// proxy: a short reply (<= 220 chars, <= 2 sentences) to a banter-tagged message, nothing more.
// Calibrated in-sample on the 44 feed rows of 2026-10-27..28: 15 tagged, 29 abstain.
//
// guidanceFor turns counted outcomes into at most two fixed-template lines. The templates can
// only say keep the wit, change up the bit, or re-check the claim. (No "answer first" line on
// mechanism turns: tagHumor never marks those joking, so there is nothing to count it from.)
// None of them can tell the bot to joke less or to agree more.

// ============ Thresholds ============
// N_MIN 20: at n=20 a Wilson 90% interval is at most about +-0.17 wide, and clearing a lower
// bound of 0.25 needs k >= 9 of 20. Below that a cell is anecdote, not evidence.
export const N_MIN = 20;
export const WINDOW_DAYS = 30;
export const Z = 1.645;           // two-sided 90%
export const LB_BAR = 0.25;       // Wilson lower bound a rate must clear before any line fires
export const KEEP_NEG_MAX = 0.10; // "keep the wit" also needs negatives at or under 10%
export const MAX_USER_SHARE = 0.75; // groups: one person cannot be the whole cell
export const MAX_LINES = 2;

// ============ Cues ============

// Register switch cue (moved from claude.js, Will + Jarvis 2026-10-28); claude.js re-exports it.
export const TECH_TURN = /\b(mechanism|architecture|consensus|finality|attribution|shapley|v\(s\)|proof of (?:work|stake|mind)|tokenomics|incentive|equilibri\w*|invariant|protocol|algorithm|complexity|latency|throughput|cadence|recall|apical|gradient|settle|noesis|oph|patch|cohomolog\w*|sybil|wash|calibration|regression|bug|stack trace|error|exception|commit|repo|deploy|contract|solidity|rust|python|node|api|schema|database|benchmark|experiment|seed|p-value|variance|sem|spearman|why does|how does|prove|derive|what breaks)\b/i;
const MECH_EXTRA = /\b(loop|rsi|fine[- ]?tune|throttle|issuance|context|session|privacy|rate[- ]?limit|feedback|model|weights|sync\w*|fees?|token|compute|limits?)\b/i;
const BOT_NAME = /@\w+|\bjarvis\b/gi;
const LAUGH = /\b(l+o+l+|l+m+f?a+o+\w*|ha(?:ha)+h?|he(?:he)+|rofl|kek|i'?m (?:dead|crying)|hilarious|funny|humou?r)\b|[\u{1F602}\u{1F923}\u{1F480}\u{1F62D}]/iu;
const CRITIQUE = /(^no[,.\s!]|\bthat'?s (?:incorrect|wrong|not (?:it|true|right|what))|\bwrong\b|\byou already said\b|\btry again\b|\bnot what i\b|\bi disagree\b|\bdoesn'?t (?:work|hold)\b|\bwon'?t work\b|\bflaw(?:ed)?\b|\bthe problem (?:is|with)\b|\baren'?t (?:happening|working)\b|\bisn'?t working\b|\bbroken\b|\bslop\b|\bmissed the point\b|\bnot really\b|\bbut (?:what|how|why) about\b)/i;
const PHATIC = /^(?:(?:hi|hello|hey|yo|gm|gn|sup|o7|ping)\b[^?]{0,30}|welcome(?: \S+){0,3}|are you (?:up|back|there|here)|where have you been|you there)[\s!?.\u{1FAE1}]*$/iu;
const SLANG = /\b(bro|bruh|bruv|lmao|lol|hopium|cope|ser|fren|ngl|fr|ong|based|meme\w*)\b/i;
const STATUS = /\b(back online|i'?m (?:here|up|awake)|what'?s on (?:the|your)|what are we working on|got it|on it)\b/i;

// ============ Tagging ============

export function tagIntent(text, isGroup) {
  const t = String(text || '').replace(BOT_NAME, '').replace(/\s+/g, ' ').trim();
  if (!t.replace(/[^\p{L}\p{N}]/gu, '')) return { intent: null, why: 'bare_invocation' };
  if (PHATIC.test(t)) return { intent: null, why: 'phatic' };
  const words = t.split(' ').length;
  const q = /\?/.test(t) || /^(?:what|how|why|when|where|who|(?:do|does|can|could|is|are|will) (?:you|it|this|that|we))\b/i.test(t);
  const tech = TECH_TURN.test(t);
  const short = words <= 10 && !q && !tech;
  const s = {
    critique: CRITIQUE.test(t) ? 3 : 0,
    mechanism: (tech ? 2 : 0) + (MECH_EXTRA.test(t) ? 1 : 0) + (words >= 15 ? 1 : 0),
    banter: (LAUGH.test(t) ? 2 : 0) + (SLANG.test(t) ? 1 : 0) + (short ? 1 : 0) + (short && isGroup ? 1 : 0),
  };
  const [top, second] = Object.entries(s).sort((a, b) => b[1] - a[1]);
  if (top[1] < 2) return { intent: null, why: 'weak' };
  if (second[1] >= top[1]) return { intent: null, why: 'conflict' };
  return { intent: top[0], why: 'ok' };
}

export function tagHumor(reply, intent) {
  const r = String(reply || '').trim();
  if (r.replace(/[^\p{L}]/gu, '').length < 4) return { humor: null, why: 'too_short' };
  if (r.length > 320 || /```|\n\s*(?:[-*]|\d+\.)\s/.test(r)) return { humor: false, why: 'long_or_structured' };
  if (STATUS.test(r)) return { humor: false, why: 'status_or_ack' };
  const sentences = r.split(/[.!?](?:\s|$)/).filter(Boolean).length;
  if (intent === 'banter' && r.length <= 220 && sentences <= 2) return { humor: true, why: 'short_reply_to_banter' };
  if (intent === 'mechanism' && TECH_TURN.test(r)) return { humor: false, why: 'mechanism_answer' };
  return { humor: null, why: 'unsure' };
}

// ============ Outcome Buckets ============

const POS = new Set(['thanks', 'laugh', 'followup', 'emoji', 'adoption', 'share']);
const NEG = new Set(['reask', 'correction', 'frustration']);
// Replies that trip self-eval's concession or hype patterns never earn positive credit.
const TAINT = new Set(['unearned_concession', 'hype_man']);

export function bucketOf(sig) {
  if (sig === 'silence') return 'sil';
  if (POS.has(sig)) return 'pos';
  if (NEG.has(sig)) return 'neg';
  return 'neu';
}

// ============ Aggregation ============

export function wilson(k, n, z = Z) {
  if (!n) return { lo: 0, hi: 1 };
  const p = k / n, z2 = z * z;
  const mid = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return { lo: Math.max(0, mid - half), hi: Math.min(1, mid + half) };
}

// events -> Map `${intent}|${humor}` -> counts. Abstained intents are skipped. Abstained
// humor is kept as `intent|null`: no humor template reads it, but critique merges over humor.
export function aggregate(events) {
  const cells = new Map();
  for (const e of events) {
    if (!e || !e.intent) continue;
    const key = `${e.intent}|${e.humor ?? null}`;
    const c = cells.get(key) || { n: 0, pos: 0, neg: 0, neu: 0, sil: 0, tainted: 0, users: {} };
    const tainted = (e.flags || []).some((f) => TAINT.has(f));
    const b = e.outcome || bucketOf(e.sig);
    c.n++;
    if (tainted) c.tainted++;
    if (b === 'pos' && tainted) c.neu++;
    else c[b]++;
    if (e.user != null) c.users[e.user] = (c.users[e.user] || 0) + 1;
    cells.set(key, c);
  }
  return cells;
}

function merge(list) {
  const m = { n: 0, pos: 0, neg: 0, neu: 0, sil: 0, tainted: 0, users: {} };
  for (const c of list) {
    for (const k of ['n', 'pos', 'neg', 'neu', 'sil', 'tainted']) m[k] += c[k];
    for (const [u, k] of Object.entries(c.users)) m.users[u] = (m.users[u] || 0) + k;
  }
  return m;
}

export const topUserShare = (c) => (c.n ? Math.max(0, ...Object.values(c.users)) / c.n : 0);

// ============ Guidance ============
// Only integer fills, never message text. Positives are never read for critique cells, so the
// bot cannot be rewarded for caving to pushback.

export function guidanceFor(cells, chatType) {
  const group = chatType !== 'private';
  const eligible = (c) => c && c.n >= N_MIN && (!group || topUserShare(c) <= MAX_USER_SHARE);
  const out = [];
  const bt = cells.get('banter|true');
  if (eligible(bt)) {
    const lo = wilson(bt.pos, bt.n).lo, nlo = wilson(bt.neg, bt.n).lo;
    if (lo >= LB_BAR && bt.neg / bt.n <= KEEP_NEG_MAX) {
      out.push({ m: lo - LB_BAR, line: `- Banter here: ${bt.pos} of ${bt.n} short replies to banter drew a laugh, thanks or a follow-up; ${bt.neg} drew a correction. The wit lands, keep it.` });
    }
    if (nlo >= LB_BAR) {
      out.push({ m: nlo - LB_BAR, line: `- Banter here: ${bt.neg} of ${bt.n} short replies to banter drew a correction or an 'already said that'. Change up the bit; the wit stays.` });
    }
  }
  const cr = merge([...cells].filter(([k]) => k.startsWith('critique|')).map(([, c]) => c));
  if (eligible(cr)) {
    const nlo = wilson(cr.neg, cr.n).lo;
    if (nlo >= LB_BAR) {
      out.push({ m: nlo - LB_BAR, line: `- Pushback here: ${cr.neg} of ${cr.n} replies to a correction were pushed back on again. Re-check the claim: fix it if wrong, hold it with the reason if right.` });
    }
  }
  return out.sort((a, b) => b.m - a.m).slice(0, MAX_LINES).map((x) => x.line);
}

export function formatGuidance(lines) {
  if (!lines || !lines.length) return '';
  return '\n\n## WHAT HAS LANDED IN THIS CHAT (counted from replies to you here, last 30 days; advice on register only, your voice and positions stay)\n' + lines.join('\n');
}
