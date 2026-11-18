// ============ Engage gate, Layer 1: deterministic rules for addressed group messages (2026-11-17) ============
//
// Will: "a deterministic abuse check like JEV or a light version of it, combined with Gemini". This is
// Layer 1 of section 2 of Desktop/Research/vibeswap-sbt/DESIGN.md: plain rules in code, no model. For one
// group message addressed to the bot it returns a verdict and a reason code:
//   - 'ignore':   the bot does not engage (no reply, no model call);
//   - 'throttle': the gray zone. Today's airspace throttle decides; a Layer 2 judgment may weigh in later;
//   - 'allow':    no rule objects. Today's path applies as before (non-members still meet the throttle).
// The gate only decides. It never sends, mutes, bans or deletes; moderation stays in antispam.js.
//
// Rules, in order (ids from DESIGN 2.3; the thresholds are starting points, to be tuned from the log):
//   L1_owner           Will                                                         allow; nothing else runs
//   L2_noise           Will's noise flag is on in this chat                         ignore, members included
//   L3_burst           more than 3 addressed messages from this person in 60 s      ignore
//   L4_repeat          bigram Jaccard 0.8 or more against one of this person's last 10 addressed
//                      messages in the hour (messages of 3 or more bigrams only)    ignore
//   L5_links_mentions  3 or more links, or 4 or more @mentions (the bot's own aside) ignore
//   L6_new_linking     any link from someone whose first counted post here is under 24 h old   ignore
//   L7_reply_chain     more than 6 replies to the bot from this person in 15 min    throttle
//   L8_newcomer        first message in this chat under 10 min ago                  throttle
//   L9_trivial         a greeting or a bare invocation (the quick-reply path)       allow
// The first ignore rule that fires is the reason; `rules` lists every rule that fired. A trivial message
// is allowed even when L7 or L8 fired: it needs no judgment. L6 and L8 run only when the chat's logs reach
// back far enough to tell (`presence.since`); unknown presence means the rule does not fire.
//
// Fail safe: a rule that throws makes the verdict 'allow' with reason 'rule_error' (today's behavior for
// that message), logged once per rule.
//
// Wiring (the second half of this file): index.js calls runEngageGate for every addressed group message,
// with today's throttle decision already computed (checkAirspace, unchanged). ENGAGE_GATE sets the mode:
//   - unset or 'shadow' (the default, DESIGN S2.3): compute the verdict, act on today's decision only, and
//     log an 'engage_shadow' health event (rule ids, no text, no name) when a rule objects;
//   - 'live' (S2.4): act on the verdict ('engage_deny' event on an ignore);
//   - 'off': today's decision, nothing computed or kept.
// The Layer 2 hook point is the `layer2` option of decideEngagement (default noLayer2, which has no verdict).

import { bigrams, jaccardSimilarity } from './message-collision.js';
import { quickReply, isBareAck, normalizeForQuickReply } from './quick-reply.js';

// ============ Thresholds ============

export const BURST = { count: 3, windowMs: 60_000 };            // more than 3 in 60 s
export const REPEAT = { similarity: 0.8, last: 10, windowMs: 60 * 60_000, minBigrams: 3 };
export const LINK_FLOOD = { links: 3, mentions: 4 };
export const NEW_LINKING_MS = 24 * 60 * 60_000;                  // first counted post under 24 h old
export const REPLY_CHAIN = { count: 6, windowMs: 15 * 60_000 };  // more than 6 replies in 15 min
export const NEWCOMER_MS = 10 * 60_000;                          // first seen under 10 min ago

export const VERDICTS = ['allow', 'throttle', 'ignore'];
export const REASONS = [
  'L1_owner', 'L2_noise', 'L3_burst', 'L4_repeat', 'L5_links_mentions', 'L6_new_linking',
  'L7_reply_chain', 'L8_newcomer', 'L9_trivial', 'clean', 'rule_error',
];

// ============ Message features ============

const LINK_RE = /\bhttps?:\/\/\S+|\bwww\.\S+|\bt\.me\/\S+/gi;
const MENTION_RE = /(?:^|[^\w@])@(\w{3,32})/g;

// Links in the text, or in Telegram's entities when they hold more (a text_link hides its URL).
export function countLinks(text, entities = []) {
  const inText = (String(text ?? '').match(LINK_RE) || []).length;
  const inEntities = (entities || []).filter((e) => e && (e.type === 'url' || e.type === 'text_link')).length;
  return Math.max(inText, inEntities);
}

// @mentions other than the bot's own, plus mentions of people with no username (text_mention entities).
export function countMentions(text, botUsername = null, entities = []) {
  const bot = botUsername ? String(botUsername).toLowerCase() : null;
  let n = 0;
  for (const m of String(text ?? '').matchAll(MENTION_RE)) if (m[1].toLowerCase() !== bot) n++;
  return n + (entities || []).filter((e) => e && e.type === 'text_mention').length;
}

// Bigrams of the text with @mentions removed, so "@bot hi there" and "hi there @bot" compare as equal.
export function contentBigrams(text) {
  return bigrams(String(text ?? '').replace(/@\w+/g, ' '));
}

// One history row, as the tracker keeps it: the time and the bigrams, not the text.
export function historyEntry(ts, text) {
  return { ts, bigrams: contentBigrams(text) };
}

// A greeting, a thanks, an ack, a "you there?", a goodbye, or the bot's name or mention alone.
export function isTrivial(text, botUsername = null) {
  const t = normalizeForQuickReply(text, botUsername);
  if (!t || /^(jarvis|jar|j)$/i.test(t)) return true;
  return quickReply(text, { botUsername }) !== null || isBareAck(text, botUsername);
}

// ============ The rules ============

// presence: null when unknown, else { since, firstSeenTs, firstCountedTs }. `since` is the time of the
// chat's oldest logged message; a person with no counted post has firstCountedTs null.
const reaches = (presence, now, ms) => !!presence && presence.since != null && now - presence.since >= ms;

const RULES = [
  {
    id: 'L2_noise', verdict: 'ignore',
    fires: (m) => m.noiseFlagged,
  },
  {
    id: 'L3_burst', verdict: 'ignore',
    fires: (m) => 1 + m.history.addressed.filter((e) => m.now - e.ts < BURST.windowMs).length > BURST.count,
  },
  {
    id: 'L4_repeat', verdict: 'ignore',
    fires: (m) => {
      const cur = contentBigrams(m.text);
      if (cur.size < REPEAT.minBigrams) return false;
      return m.history.addressed
        .filter((e) => m.now - e.ts < REPEAT.windowMs)
        .slice(-REPEAT.last)
        .some((e) => e.bigrams.size >= REPEAT.minBigrams && jaccardSimilarity(cur, e.bigrams) >= REPEAT.similarity);
    },
  },
  {
    id: 'L5_links_mentions', verdict: 'ignore',
    fires: (m) => countLinks(m.text, m.entities) >= LINK_FLOOD.links
      || countMentions(m.text, m.botUsername, m.entities) >= LINK_FLOOD.mentions,
  },
  {
    id: 'L6_new_linking', verdict: 'ignore',
    fires: (m) => {
      if (countLinks(m.text, m.entities) === 0 || !reaches(m.presence, m.now, NEW_LINKING_MS)) return false;
      const first = m.presence.firstCountedTs;
      return first == null || m.now - first < NEW_LINKING_MS;
    },
  },
  {
    id: 'L7_reply_chain', verdict: 'throttle',
    fires: (m) => (m.isReplyToBot ? 1 : 0)
      + m.history.repliesToBot.filter((ts) => m.now - ts < REPLY_CHAIN.windowMs).length > REPLY_CHAIN.count,
  },
  {
    id: 'L8_newcomer', verdict: 'throttle',
    fires: (m) => reaches(m.presence, m.now, NEWCOMER_MS) && m.presence.firstSeenTs != null
      && m.now - m.presence.firstSeenTs < NEWCOMER_MS,
  },
  {
    id: 'L9_trivial', verdict: 'allow',
    fires: (m) => isTrivial(m.text, m.botUsername),
  },
];

const ruleErrorsLogged = new Set();

function logRuleErrorOnce(id, err, log) {
  if (ruleErrorsLogged.has(id)) return;
  ruleErrorsLogged.add(id);
  try { log(`[engage-gate] rule ${id} threw, falling back to today's behavior: ${err?.message ?? err}`, id); } catch {}
}

/**
 * Layer 1 verdict for one addressed group message. Never throws.
 *
 * input: {
 *   now, text, isOwner, noiseFlagged, isReplyToBot, botUsername, entities,
 *   history: { addressed: [{ ts, bigrams }], repliesToBot: [ts] }  // this person, this chat, before this message
 *   presence: null | { since, firstSeenTs, firstCountedTs }
 * }
 * Returns { verdict: 'allow' | 'throttle' | 'ignore', reason, rules }.
 */
export function evaluateLayer1(input, { log = console.warn } = {}) {
  const i = input || {};
  const m = {
    now: i.now ?? Date.now(),
    text: String(i.text ?? ''),
    isOwner: i.isOwner === true,
    noiseFlagged: i.noiseFlagged === true,
    isReplyToBot: i.isReplyToBot === true,
    botUsername: i.botUsername || null,
    entities: i.entities || [],
    presence: i.presence || null,
    history: { addressed: i.history?.addressed || [], repliesToBot: i.history?.repliesToBot || [] },
  };

  if (m.isOwner) return { verdict: 'allow', reason: 'L1_owner', rules: ['L1_owner'] };

  const fired = [];
  for (const rule of RULES) {
    let hit;
    try {
      hit = rule.fires(m) === true;
    } catch (err) {
      logRuleErrorOnce(rule.id, err, log);
      return { verdict: 'allow', reason: 'rule_error', rules: [rule.id] };
    }
    if (hit) fired.push(rule);
  }

  const ids = fired.map((r) => r.id);
  const deny = fired.find((r) => r.verdict === 'ignore');
  if (deny) return { verdict: 'ignore', reason: deny.id, rules: ids };
  if (ids.includes('L9_trivial')) return { verdict: 'allow', reason: 'L9_trivial', rules: ids };
  const gray = fired.find((r) => r.verdict === 'throttle');
  if (gray) return { verdict: 'throttle', reason: gray.id, rules: ids };
  return { verdict: 'allow', reason: 'clean', rules: ids };
}

// ============ Per-person history (memory only, like the airspace throttle; a restart resets it) ============

const HISTORY_MAX_KEYS = 5000;
const HISTORY_MAX_ROWS = 20;
const history = new Map(); // `${chatId}:${userId}` -> { addressed: [{ ts, bigrams }], repliesToBot: [ts] }

const historyKey = (chatId, userId) => `${chatId}:${userId}`;

function prunedRow(row, now) {
  row.addressed = row.addressed.filter((e) => now - e.ts < REPEAT.windowMs).slice(-HISTORY_MAX_ROWS);
  row.repliesToBot = row.repliesToBot.filter((ts) => now - ts < REPLY_CHAIN.windowMs).slice(-HISTORY_MAX_ROWS);
  return row;
}

// This person's addressed messages in this chat, before the current one. Times and bigrams, no text.
export function historyOf(chatId, userId, now = Date.now()) {
  const row = history.get(historyKey(chatId, userId));
  if (!row) return { addressed: [], repliesToBot: [] };
  const p = prunedRow(row, now);
  return { addressed: [...p.addressed], repliesToBot: [...p.repliesToBot] };
}

export function recordAddressed(chatId, userId, { ts = Date.now(), text = '', isReplyToBot = false } = {}) {
  const key = historyKey(chatId, userId);
  const row = history.get(key) || { addressed: [], repliesToBot: [] };
  history.delete(key); // re-insert, so the oldest key is the least recently active
  row.addressed.push(historyEntry(ts, text));
  if (isReplyToBot) row.repliesToBot.push(ts);
  history.set(key, prunedRow(row, ts));
  while (history.size > HISTORY_MAX_KEYS) history.delete(history.keys().next().value);
}

export function resetHistory() {
  history.clear();
}

// ============ Mode ============

export function gateMode(env = process.env) {
  const v = String(env.ENGAGE_GATE || '').trim().toLowerCase();
  return v === 'live' || v === 'off' ? v : 'shadow';
}

// ============ LAYER 2 HOOK POINT ============
// A Layer 2 judgment plugs in here, as the `layer2` option of decideEngagement (and runEngageGate). It is
// called only in the gray zone: a 'throttle' verdict, or a clean message from a non-member that today's
// throttle would drop; never for the owner, an ignore, a trivial message, or a quiet or tag-only chat.
// It gets { text (mentions stripped), layer1: { verdict, reason, rules } } and answers 'engage', 'ignore',
// 'throttle' or null. 'engage' replies, 'ignore' drops, 'throttle' and null leave today's decision. A
// throw counts as null. Timeouts, caching and what a down judge means for gray messages (DESIGN: no reply)
// belong to the judge itself (DESIGN S2.2). The default has no verdict, so nothing changes.
export const noLayer2 = async () => null;

const LAYER2_LABELS = new Set(['engage', 'ignore', 'throttle']);

/**
 * The final decision for one addressed group message, from the Layer 1 verdict, today's throttle
 * decision and the Layer 2 hook.
 *
 * { layer1, today: { shouldRespond, reason }, isOwner, isMember, chatMode, text }
 * Returns { respond, by: 'layer1' | 'layer2' | 'throttle', reason }.
 */
export async function decideEngagement({ layer1, today, isOwner = false, isMember = false, chatMode = 'normal', text = '' }, { layer2 = noLayer2 } = {}) {
  const todays = { respond: today?.shouldRespond !== false, by: 'throttle', reason: today?.reason ?? 'normal' };
  if (isOwner) return { respond: true, by: 'layer1', reason: 'L1_owner' };
  if (!layer1 || layer1.reason === 'rule_error') return todays;
  if (layer1.verdict === 'ignore') return { respond: false, by: 'layer1', reason: layer1.reason };

  const gray = layer1.verdict === 'throttle';
  const wouldDrop = layer1.verdict === 'allow' && layer1.reason !== 'L9_trivial' && !todays.respond && !isMember;
  const quietChat = chatMode === 'quiet' || chatMode === 'tag-only';
  if ((gray || wouldDrop) && !quietChat) {
    let v = null;
    try {
      v = await layer2({ text: String(text).replace(/@\w+/g, ' ').replace(/\s+/g, ' ').trim(), layer1: { ...layer1 } });
    } catch {
      v = null;
    }
    if (LAYER2_LABELS.has(v) && v !== 'throttle') {
      return { respond: v === 'engage', by: 'layer2', reason: v };
    }
  }
  return todays;
}

// ============ The gate for one message ============

const gateErrorsLogged = new Set();

/**
 * Run the engage gate on one addressed group message. Never throws: on any error it returns today's
 * decision, logged once.
 *
 * msg: { chatId, userId, text, entities, isReplyToBot, isOwner, isMember, botUsername, chatMode, now,
 *        noiseFlagged, presence }   // presence from first-seen.js, null when unknown
 * today: checkAirspace's { shouldRespond, reason } (for the owner, { shouldRespond: true })
 * opts: { mode, layer2, onEvent(event), log(line) }
 * Returns { respond, by, reason, verdict, rules, mode }. Events carry rule ids and verdicts only.
 */
export async function runEngageGate(msg, today, { mode = gateMode(), layer2 = noLayer2, onEvent = () => {}, log = console.warn } = {}) {
  const todays = { respond: today?.shouldRespond !== false, by: 'throttle', reason: today?.reason ?? 'normal', verdict: null, rules: [], mode };
  if (mode === 'off') return todays;
  const emit = (event) => { try { onEvent(event); } catch {} };
  try {
    const now = msg.now ?? Date.now();
    const layer1 = evaluateLayer1({
      now,
      text: msg.text,
      isOwner: msg.isOwner,
      noiseFlagged: msg.noiseFlagged,
      isReplyToBot: msg.isReplyToBot,
      botUsername: msg.botUsername,
      entities: msg.entities,
      presence: msg.presence,
      history: msg.isOwner ? undefined : historyOf(msg.chatId, msg.userId, now),
    }, {
      log: (line, rule) => { log(line); emit({ kind: 'engage_error', rule }); },
    });
    if (!msg.isOwner) recordAddressed(msg.chatId, msg.userId, { ts: now, text: msg.text, isReplyToBot: msg.isReplyToBot });

    const decision = await decideEngagement({
      layer1, today, isOwner: msg.isOwner, isMember: msg.isMember, chatMode: msg.chatMode, text: msg.text,
    }, { layer2 });
    const objected = layer1.verdict !== 'allow';

    if (mode === 'live') {
      if (!decision.respond && decision.by !== 'throttle') {
        emit({ kind: 'engage_deny', by: decision.by, reason: decision.reason, rules: layer1.rules });
      } else if (objected) {
        emit({ kind: 'engage_gray', reason: layer1.reason, rules: layer1.rules, respond: decision.respond });
      }
      return { ...decision, verdict: layer1.verdict, rules: layer1.rules, mode };
    }

    // shadow: today's decision acts; the gate's own is only logged
    if (objected || decision.respond !== todays.respond) {
      emit({
        kind: 'engage_shadow', verdict: layer1.verdict, reason: layer1.reason, rules: layer1.rules,
        wouldRespond: decision.respond, todayRespond: todays.respond,
      });
    }
    return { ...todays, verdict: layer1.verdict, rules: layer1.rules };
  } catch (err) {
    if (!gateErrorsLogged.has('gate')) {
      gateErrorsLogged.add('gate');
      try { log(`[engage-gate] gate threw, falling back to today's behavior: ${err?.message ?? err}`); } catch {}
      emit({ kind: 'engage_error', rule: 'gate' });
    }
    return todays;
  }
}
