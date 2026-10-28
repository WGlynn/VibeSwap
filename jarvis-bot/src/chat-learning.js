// ============ Chat Learning: outcome per chat x intent x humor, guidance only with evidence ============
//
// The learning-through-chat loop. Each answered message becomes a PENDING exchange tagged
// with the inbound intent and the reply's humor (chat-intent.js). The NEXT human message in
// the same chat that can be attributed to it closes it with an outcome scored by
// reward-signal.js classifySignal; ten minutes with nothing attributable closes it as silence.
//
// Closed rows go to <dataDir>/chat-learning/events.jsonl: ids and labels only, NO message text.
// A per-chat guidance line (fixed templates + counts, see chat-intent.js guidanceFor) is
// recomputed on each close and injected into the prompt after the frozen prefix. Every change
// to that line is written to health.jsonl; scripts/chat-learning-report.mjs shows the numbers.
// Kill switch: JARVIS_CHAT_GUIDANCE_OFF=1 keeps the counting but injects nothing.
//
// Attribution, in order (at most ONE pending closes per inbound):
//   a. reply-to-bot: the pending whose reply text starts like the replied-to message
//   b. same user, within the silence window, and not a reply to some other bot message
//   c. otherwise nothing: unattributable, so abstain
// Banter exchanges are scored without the re-ask check (a second "lol" is not a re-ask) and
// without bare-slang frustration ("bruh" after a joke is banter, not pushback).
// events.jsonl is rewritten at boot when most of it has aged out of the window.
// Pending exchanges live in memory; a restart drops them (not counted, not mis-counted).

import { appendFileSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tagIntent, tagHumor, bucketOf, aggregate, guidanceFor, formatGuidance, WINDOW_DAYS } from './chat-intent.js';
import { classifySignal } from './reward-signal.js';
import { stripDashes } from './text-style.js';
import { recordHealthEvent } from './feed.js';

// ============ Constants ============

const SILENCE_MS = 10 * 60_000;
const SAME_USER_MS = SILENCE_MS; // shorter would let a late answer close as silence
const MAX_PENDING = 5;   // per chat; the oldest is dropped (not counted) past this
const HEAD = 40;         // chars of normalized reply used to match a reply-to
const WINDOW_MS = WINDOW_DAYS * 86_400_000;

// ============ State ============

let EVENTS = null;
let events = [];
const pending = new Map();       // chatId -> [{ ts, user, msg, chatType, in, outHead, intent, iw, humor, hw, flags }]
const guidanceCache = new Map(); // chatId -> injected block ('' or the formatted lines)
let sweepTimer = null;

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, HEAD);

// ============ Init ============

export async function initChatLearning(dataDir) {
  try {
    const dir = join(dataDir || 'data', 'chat-learning');
    mkdirSync(dir, { recursive: true });
    EVENTS = join(dir, 'events.jsonl');
    events = [];
    pending.clear();
    guidanceCache.clear();
    const cutoff = Date.now() - WINDOW_MS;
    let lines = 0;
    try {
      for (const line of readFileSync(EVENTS, 'utf-8').split('\n')) {
        if (!line) continue;
        lines++;
        try {
          const e = JSON.parse(line);
          if (Date.parse(e.ts) >= cutoff) events.push(e);
        } catch {}
      }
    } catch {}
    // Compact: keep the file near the window instead of growing forever
    if (lines > 2 * events.length) writeFileSync(EVENTS, events.map((e) => JSON.stringify(e) + '\n').join(''));
    // Prime the cache silently: a boot is not a guidance change
    const types = new Map(events.map((e) => [e.chat, e.type]));
    for (const [chat, type] of types) guidanceCache.set(chat, computeGuidance(chat, type, Date.now()));
    if (sweepTimer) clearInterval(sweepTimer);
    sweepTimer = setInterval(() => sweep(), 60_000);
    sweepTimer.unref?.();
    const live = [...guidanceCache.values()].filter(Boolean).length;
    console.log(`[chat-learning] Initialized: ${events.length} events in window, ${live} chat(s) with guidance`);
  } catch (err) {
    console.warn(`[chat-learning] init failed: ${err.message}`);
  }
}

// ============ Inbound: close at most one pending ============

export function noteInbound(ctx, now = Date.now()) {
  try {
    const m = ctx?.message;
    const text = m?.text;
    if (!EVENTS || !text || ctx.from?.is_bot || text.startsWith('/')) return;
    const chat = String(ctx.chat?.id);
    const list = pending.get(chat);
    if (!list?.length) return;
    let hit = null, by = null;
    const rt = m.reply_to_message;
    if (rt?.from?.id && ctx.botInfo?.id && rt.from.id === ctx.botInfo.id) {
      // A reply to a bot message we are not tracking is about that message: abstain
      const head = norm(rt.text || rt.caption);
      hit = head ? [...list].reverse().find((p) => p.outHead === head) : null;
      if (!hit) return;
      by = 'reply';
    } else {
      hit = [...list].reverse().find((p) => p.user === ctx.from?.id && now - p.ts <= SAME_USER_MS);
      if (!hit) return;
      by = 'same_user';
    }
    const banter = hit.intent === 'banter';
    close(chat, hit, classifySignal(text, banter ? null : hit.in, { banter }).type, by, now);
  } catch (err) {
    console.warn(`[chat-learning] noteInbound: ${err.message}`);
  }
}

// ============ Exchange: open a pending ============

export function noteExchange(ctx, inbound, reply, { flags = [] } = {}, now = Date.now()) {
  try {
    if (!EVENTS || !reply) return;
    const chat = String(ctx.chat?.id);
    const chatType = ctx.chat?.type || null;
    const ti = tagIntent(inbound, chatType !== 'private');
    const th = tagHumor(reply, ti.intent);
    const list = pending.get(chat) || [];
    list.push({
      ts: now, user: ctx.from?.id ?? null, msg: ctx.message?.message_id ?? null, chatType,
      in: String(inbound || ''), outHead: norm(stripDashes(reply)), // as Telegram stores it
      intent: ti.intent, iw: ti.why, humor: th.humor, hw: th.why, flags,
    });
    while (list.length > MAX_PENDING) list.shift();
    pending.set(chat, list);
  } catch (err) {
    console.warn(`[chat-learning] noteExchange: ${err.message}`);
  }
}

// ============ Silence sweep ============

export function sweep(now = Date.now()) {
  try {
    for (const [chat, list] of pending) {
      for (const p of list.filter((x) => now - x.ts > SILENCE_MS)) close(chat, p, 'silence', 'timeout', now);
    }
  } catch (err) {
    console.warn(`[chat-learning] sweep: ${err.message}`);
  }
}

// ============ Close + guidance ============

function close(chat, p, sig, by, now) {
  const list = pending.get(chat) || [];
  const i = list.indexOf(p);
  if (i >= 0) list.splice(i, 1);
  if (!list.length) pending.delete(chat);
  const row = {
    ts: new Date(p.ts).toISOString(), chat, type: p.chatType, user: p.user, msg: p.msg,
    intent: p.intent, iw: p.iw, humor: p.humor, hw: p.hw, sig, outcome: bucketOf(sig), by, flags: p.flags,
  };
  appendFileSync(EVENTS, JSON.stringify(row) + '\n');
  events.push(row);
  const cutoff = now - WINDOW_MS;
  if (Date.parse(events[0].ts) < cutoff) events = events.filter((e) => Date.parse(e.ts) >= cutoff);
  const next = computeGuidance(chat, p.chatType, now);
  if (next !== (guidanceCache.get(chat) || '')) {
    guidanceCache.set(chat, next);
    recordHealthEvent({ kind: 'chat_guidance', chat, chatType: p.chatType, lines: next ? next.split('\n').filter((l) => l.startsWith('- ')) : [] });
  }
}

function computeGuidance(chat, chatType, now) {
  const cutoff = now - WINDOW_MS;
  const rows = events.filter((e) => e.chat === chat && Date.parse(e.ts) >= cutoff);
  return formatGuidance(guidanceFor(aggregate(rows), chatType));
}

// ============ Prompt hook ============

export function chatGuidance(chatId) {
  try {
    if (process.env.JARVIS_CHAT_GUIDANCE_OFF) return '';
    return guidanceCache.get(String(chatId)) || '';
  } catch { return ''; }
}
