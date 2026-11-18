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
  try { log(`[engage-gate] rule ${id} threw, falling back to today's behavior: ${err?.message ?? err}`); } catch {}
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
