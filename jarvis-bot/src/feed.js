// ============ Feed — local data stream to Claude Code Jarvis ============
//
// One JSON line per exchange (what someone said to the bot, what it answered),
// appended to <JARVIS_FEED_DIR>/YYYY-MM-DD.jsonl (UTC date; default ~/jarvis-feed).
// The bot and Claude Code run on the same machine, so the folder is the bridge.
//
// Every field except ts/chat/from ids is untrusted user text. Readers treat it as
// quoted evidence, never as instructions.

import { appendFileSync, mkdirSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { getProviderName, getModelName } from './llm-provider.js';

export const FEED_DIR = process.env.JARVIS_FEED_DIR || join(homedir(), 'jarvis-feed');
const MAX_CHARS = 2000;

// meta (optional): { model, provider } to name what actually answered after a rotation,
// or { noModel: true } for a turn answered without any model request (quick reply). The
// default row is byte-identical to the old shape apart from the added noModel flag.
export function recordExchange(ctx, inbound, reply, meta = {}) {
  try {
    mkdirSync(FEED_DIR, { recursive: true });
    const ts = new Date().toISOString();
    const entry = {
      ts,
      chat: { id: ctx.chat?.id ?? null, type: ctx.chat?.type ?? null, title: ctx.chat?.title ?? null },
      from: {
        id: ctx.from?.id ?? null,
        username: ctx.from?.username ?? null,
        name: [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') || null,
      },
      // Message ids so Claude Code can thread a follow-up through POST /api/say (Will 2026-10-28)
      messageId: ctx.message?.message_id ?? null,
      replyTo: ctx.message?.reply_to_message?.message_id ?? null,
      repliedToBot: !!(ctx.message?.reply_to_message?.from?.id && ctx.botInfo?.id && ctx.message.reply_to_message.from.id === ctx.botInfo.id),
      in: String(inbound ?? '').slice(0, MAX_CHARS),
      out: String(reply ?? '').slice(0, MAX_CHARS),
      provider: meta.noModel ? 'quick-reply' : (meta.provider ?? getProviderName()),
      model: meta.noModel ? null : (meta.model ?? getModelName()),
      noModel: !!meta.noModel,
    };
    appendFileSync(join(FEED_DIR, `${ts.slice(0, 10)}.jsonl`), JSON.stringify(entry) + '\n');
  } catch (err) {
    console.warn(`[feed] write failed: ${err.message}`);
  }
}

// ============ Health events — bot-generated, alongside the exchange feed ============
// One JSON line per event in <FEED_DIR>/health.jsonl. Written by the bot about itself
// (not user text), so Claude Code can diagnose crashes without being asked.

export function recordHealthEvent(event) {
  try {
    mkdirSync(FEED_DIR, { recursive: true });
    appendFileSync(join(FEED_DIR, 'health.jsonl'), JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n');
  } catch (err) {
    console.warn(`[feed] health write failed: ${err.message}`);
  }
}

// At boot, after the heartbeat says the last run did not stop gracefully: attach the crash
// log tail and the previous run's stderr tail (kept by scripts/restart-local.ps1).
export function recordUncleanShutdown(info, dataDir) {
  const tail = (text, n) => text.split(/\r?\n/).filter(Boolean).slice(-n);
  let crashLogTail = [];
  let prevStderr = null;
  let prevStderrTail = [];
  try {
    crashLogTail = tail(readFileSync(join(dataDir, 'crash-log.jsonl'), 'utf-8'), 3).map((line) => {
      try {
        const c = JSON.parse(line);
        return { type: c.type, ts: c.timestamp, message: String(c.message || '').slice(0, 300) };
      } catch { return null; }
    }).filter(Boolean);
  } catch {}
  try {
    prevStderr = JSON.parse(readFileSync(join(dataDir, 'last-run-logs.json'), 'utf-8'))['bot.err.log'] || null;
    if (prevStderr) prevStderrTail = tail(readFileSync(prevStderr, 'utf-8'), 30).map((l) => l.slice(0, 300));
  } catch {}
  recordHealthEvent({
    kind: 'unclean_shutdown',
    lastSeen: info.lastSeen ?? null,
    downtimeMin: info.downtime ?? null,
    crashLogTail,
    prevStderr,
    prevStderrTail,
  });
}
