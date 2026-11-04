// ============ Files and backfills from Will's session (Will 2026-11-04) ============
// The session sent Blake a file by calling Telegram's sendDocument directly (message 35949 in
// -5590478415, replying to 35942). The bot never saw it, so it did not know the message existed.
// Will: "fix that please." Two routes in the /api/* block of index.js, next to POST /api/say and
// behind the same X-Api-Secret check (checked again here, as /api/email does):
// - POST /api/send-file { chatId, path, caption?, replyToMessageId?, note? } sends a file from the
//   outbox folder, then records "[sent file <name>] <caption> <note>" the way /api/say records text.
//   The note is a short digest of what the file says, so the bot can discuss it later.
// - POST /api/record { chatId, text, messageId?, replyToMessageId? } records a message the session
//   already sent directly. Nothing is sent.
// Only files inside <JARVIS_FEED_DIR>/outbox-files are sent: the real path must be inside it, the
// secret-file denylist (tool-guard.js) applies, and the size is capped at 20 MB.

import { stat, readFile } from 'fs/promises';
import { join, resolve, relative, isAbsolute, basename } from 'path';
import { FEED_DIR } from './feed.js';
import { realPath, isDeniedPath } from './tool-guard.js';

export const OUTBOX_DIR = join(FEED_DIR, 'outbox-files');
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

function reply(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}
const fail = (message) => Object.assign(new Error(message), { status: 400 });
// p is strictly inside dir (path.relative ignores case on Windows).
function inside(p, dir) {
  const r = relative(dir, p);
  return r !== '' && !isAbsolute(r) && r.split(/[\\/]/)[0] !== '..';
}

function chatIdOf(payload) {
  const chatId = String(payload.chatId ?? '');
  if (!/^-?\d+$/.test(chatId)) throw fail('chatId (numeric) is required');
  return chatId;
}

// The real path of a sendable file in the outbox. Nothing outside the outbox is touched.
export async function outboxFile(path, { outboxDir = OUTBOX_DIR, maxBytes = MAX_FILE_BYTES } = {}) {
  const asked = resolve(outboxDir, String(path ?? ''));
  const real = inside(asked, resolve(outboxDir)) ? realPath(asked) : null;
  if (!real || !inside(real, realPath(outboxDir))) throw fail(`only files inside ${outboxDir} can be sent`);
  if (isDeniedPath(real)) throw fail('that is a secret file (.env, a key, a token or a credential); it is not sent');
  const info = await stat(real).catch(() => null);
  if (!info?.isFile()) throw fail(`no file at ${path}`);
  if (info.size > maxBytes) throw fail(`the file is ${info.size} bytes, over the ${maxBytes}-byte cap`);
  return real;
}

export async function handleSendFileApi(req, res, { secret, readBody, telegram, record, outboxDir, maxBytes }) {
  if (!secret || req.headers['x-api-secret'] !== secret) return reply(res, 401, { error: 'Unauthorized' });
  try {
    const payload = JSON.parse(await readBody(req));
    const chatId = chatIdOf(payload);
    const caption = String(payload.caption ?? '').trim();
    const note = String(payload.note ?? '').trim();
    if (caption.length > 1024) throw fail('caption over 1024 characters (the Telegram limit)');
    const file = await outboxFile(payload.path, { outboxDir, maxBytes });
    const name = basename(file);
    const extra = {};
    if (caption) extra.caption = caption;
    if (payload.replyToMessageId) extra.reply_parameters = { message_id: Number(payload.replyToMessageId) };
    // The checked real path is what gets read, so the file sent is the file checked.
    const sent = await telegram.sendDocument(chatId, { source: await readFile(file), filename: name }, extra);
    record(chatId, [`[sent file ${name}]`, caption, note].filter(Boolean).join(' '),
      { replyToMessageId: payload.replyToMessageId, messageId: sent.message_id });
    console.log(`[api] /api/send-file sent ${name} to chat ${chatId} (message ${sent.message_id})`);
    reply(res, 200, { ok: true, messageId: sent.message_id });
  } catch (err) {
    reply(res, err.status || 400, { error: err.message });
  }
}

export async function handleRecordApi(req, res, { secret, readBody, record }) {
  if (!secret || req.headers['x-api-secret'] !== secret) return reply(res, 401, { error: 'Unauthorized' });
  try {
    const payload = JSON.parse(await readBody(req));
    const chatId = chatIdOf(payload);
    const text = String(payload.text ?? '').trim();
    if (!text) throw fail('text is required');
    if (text.length > 4000) throw fail('text over 4000 characters');
    record(chatId, text, { replyToMessageId: payload.replyToMessageId, messageId: payload.messageId });
    console.log(`[api] /api/record recorded ${text.length} chars for chat ${chatId}${payload.messageId ? ` (message ${payload.messageId})` : ''}`);
    reply(res, 200, { ok: true, recorded: true });
  } catch (err) {
    reply(res, err.status || 400, { error: err.message });
  }
}
