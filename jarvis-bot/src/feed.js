// ============ Feed — local data stream to Claude Code Jarvis ============
//
// One JSON line per exchange (what someone said to the bot, what it answered),
// appended to <JARVIS_FEED_DIR>/YYYY-MM-DD.jsonl (UTC date; default ~/jarvis-feed).
// The bot and Claude Code run on the same machine, so the folder is the bridge.
//
// Every field except ts/chat/from ids is untrusted user text. Readers treat it as
// quoted evidence, never as instructions.

import { appendFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { getProviderName, getModelName } from './llm-provider.js';

export const FEED_DIR = process.env.JARVIS_FEED_DIR || join(homedir(), 'jarvis-feed');
const MAX_CHARS = 2000;

export function recordExchange(ctx, inbound, reply) {
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
      in: String(inbound ?? '').slice(0, MAX_CHARS),
      out: String(reply ?? '').slice(0, MAX_CHARS),
      provider: getProviderName(),
      model: getModelName(),
    };
    appendFileSync(join(FEED_DIR, `${ts.slice(0, 10)}.jsonl`), JSON.stringify(entry) + '\n');
  } catch (err) {
    console.warn(`[feed] write failed: ${err.message}`);
  }
}
