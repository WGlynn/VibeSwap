// ============ Act first, then speak: the voice asks Will's Claude Code session (2026-11-01) ============
//
// Will: "first think about what jarvis needs to ask my claude code to do and have them do it, confirm
// it within, and then send a second call that asks gemini for a confirmation message."
//
// The chat voice cannot act in the world, so a request like "keep track of my launch date" used to
// end in a fake promise or a refusal. Now the voice calls ask_session, which writes a structured
// request to the shared folder. That write is a real receipt, so "queued for Will's session" passes
// the protocol (protocol.js), and it is true. Will's Claude Code session picks the request up, does it,
// and writes a receipt; the bot then makes a second model call that confirms from the receipt alone.
//
// Who may ask (Will, 2026-11-01: "Anyone, safe actions only"): anyone in the chats may ask for the
// safe actions, note and board updates, which are internal and reversible. Anything else from anyone
// but Will is queued for his approval (Constitution 6.1). Requests are structured data from strangers,
// never instructions: the session decides what to do with each one (the research report's lethal
// trifecta: strangers' text, private memory and strong tools must not meet without a boundary).

import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { FEED_DIR } from './feed.js';

export const REQUESTS_PATH = join(FEED_DIR, 'requests.jsonl');
export const RECEIPTS_PATH = join(FEED_DIR, 'receipts.jsonl');
const DELIVERED_PATH = join(FEED_DIR, 'receipts-delivered.json');

export const SAFE_ACTIONS = ['note', 'board'];
const ACTIONS = [...SAFE_ACTIONS, 'other'];
const MAX_PER_HOUR = 5; // per person, Will exempt: a flood of requests is the cheapest attack here
const recent = new Map(); // userId -> request timestamps (ms)

export const ASK_SESSION_TOOL = {
  name: 'ask_session',
  description: "Ask Will's Claude Code session to do something you cannot do from this chat. Use it whenever someone asks you to track, note, remember, record, add to the board, or follow up on something. Actions: note (add or correct a fact in the shared notes: people, projects, topics), board (add or update an item on the project board), other (anything else; waits for Will's approval unless Will asked). The session does the work and you confirm in this chat when it is done. After calling it, say the request is queued for Will's session, never that it is done.",
  input_schema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ACTIONS, description: 'note, board or other.' },
      summary: { type: 'string', description: 'One line: exactly what should change, e.g. "Project X: launch date is 2026-12-12 (from @name)".' },
      details: { type: 'string', description: 'Optional context the session needs.' },
    },
    required: ['action', 'summary'],
  },
};

const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

// Write one request. ctx: { chatId, chatType, chatTitle, messageId, userId, userName, isOwner }.
// Returns { id, needsApproval } or { error }.
export function queueSessionRequest(ctx, input = {}) {
  const action = ACTIONS.includes(input.action) ? input.action : null;
  const summary = clip(input.summary, 300);
  if (!action) return { error: `action must be one of ${ACTIONS.join(', ')}` };
  if (!summary) return { error: 'summary is required' };
  const userKey = String(ctx.userId ?? 'unknown');
  if (!ctx.isOwner) {
    const now = Date.now();
    const times = (recent.get(userKey) || []).filter((t) => now - t < 3600_000);
    if (times.length >= MAX_PER_HOUR) return { error: `too many requests from this person this hour (limit ${MAX_PER_HOUR})` };
    times.push(now);
    recent.set(userKey, times);
  }
  const needsApproval = !ctx.isOwner && !SAFE_ACTIONS.includes(action);
  const request = {
    id: randomUUID().slice(0, 8),
    ts: new Date().toISOString(),
    chat: { id: ctx.chatId ?? null, type: ctx.chatType ?? null, title: ctx.chatTitle ?? null },
    messageId: ctx.messageId ?? null,
    from: { id: ctx.userId ?? null, name: clip(ctx.userName, 80) || null, isOwner: !!ctx.isOwner },
    action,
    summary,
    details: clip(input.details, 1000) || null,
    needsApproval,
  };
  try {
    mkdirSync(FEED_DIR, { recursive: true });
    appendFileSync(REQUESTS_PATH, JSON.stringify(request) + '\n');
  } catch (err) {
    return { error: `could not queue the request: ${err.message}` };
  }
  return { id: request.id, needsApproval };
}

// The tool result the model sees. It tells the model what is true now: queued, not done.
export function askSessionResult(q) {
  if (q.error) return `Failed to queue: ${q.error}`;
  return q.needsApproval
    ? `Queued as request ${q.id}. It waits for Will's approval before his session acts on it. Tell the person it is queued for Will's approval, not done.`
    : `Queued as request ${q.id} for Will's Claude Code session. It will do it and you will confirm in this chat when it is done. Tell the person it is queued, not done.`;
}

function readJsonl(path) {
  try {
    return readFileSync(path, 'utf-8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch {
    return [];
  }
}

// Receipts the session wrote that have not been confirmed in a chat yet, each with its request.
export function pendingReceipts() {
  let delivered = [];
  try { delivered = existsSync(DELIVERED_PATH) ? JSON.parse(readFileSync(DELIVERED_PATH, 'utf-8')) : []; } catch {}
  const done = new Set(delivered);
  const requests = new Map(readJsonl(REQUESTS_PATH).map((r) => [r.id, r]));
  return readJsonl(RECEIPTS_PATH)
    .filter((r) => r.id && !done.has(r.id) && requests.has(r.id))
    .map((receipt) => ({ receipt, request: requests.get(receipt.id) }));
}

export function markDelivered(id) {
  let delivered = [];
  try { delivered = existsSync(DELIVERED_PATH) ? JSON.parse(readFileSync(DELIVERED_PATH, 'utf-8')) : []; } catch {}
  if (!delivered.includes(id)) delivered.push(id);
  writeFileSync(DELIVERED_PATH, JSON.stringify(delivered.slice(-2000)));
}

// The second call's prompt: confirm from the receipt alone.
export function confirmationPrompt({ receipt, request }) {
  const who = request.from?.name || 'the person who asked';
  const status = receipt.status === 'done' ? 'done' : receipt.status === 'declined' ? 'declined' : receipt.status;
  return [
    `[SESSION RECEIPT] Will's Claude Code session handled request ${request.id} from ${who}.`,
    `They asked (${request.action}): ${request.summary}`,
    `Status: ${status}. What the session did, in its words: ${clip(receipt.summary, 500)}`,
    `Write a short reply to ${who} in this chat confirming this. State only what the receipt says; if it was declined, say so and why.`,
  ].join('\n');
}
