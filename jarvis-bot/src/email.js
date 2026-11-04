// ============ Email: Gmail inbox into the feed, outbound mail only for Claude Code (2026-11-04) ============
//
// Will: "hook jarvis tg bot up to my Jarvis.proofofmind@gmail.com". Blake had asked in "Will, Blake and
// Jarvis" whether Jarvis can email, most likely for lesson files. v1, small and safe:
//
// - Inbound: every 2 minutes, unseen INBOX mail from EMAIL_ALLOWED_SENDERS is saved under
//   <FEED_DIR>/mail/YYYY-MM-DD/<uid>/ (headers.json, body.txt, attachments/), one line goes to
//   <FEED_DIR>/mail.jsonl, and the message is marked seen. Mail from anyone else is counted in a log
//   line, never downloaded, and left unread. Every byte of it is untrusted data; attachments are
//   written to disk, never opened or run, and in v1 nothing from a mail reaches the chat model.
// - Outbound: only POST /api/email (index.js, behind the X-Api-Secret check), only to
//   EMAIL_ALLOWED_RECIPIENTS. The chat model has no email tool, so the bot never mails on its own.
//
// Auth is a Gmail App Password (GMAIL_USER, GMAIL_APP_PASSWORD). It is never logged. A one-shot IMAP
// session per check, no IDLE: nothing stays connected between checks, so nothing needs reconnecting.

import { appendFile, mkdir, writeFile } from 'fs/promises';
import { readFileSync } from 'fs';
import { extname, join, resolve, sep } from 'path';
import { FEED_DIR, recordHealthEvent } from './feed.js';

const MAIL_DIR = join(FEED_DIR, 'mail');
const MAIL_LOG = join(FEED_DIR, 'mail.jsonl');
const CHECK_MS = 2 * 60 * 1000;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_MESSAGE_BYTES = 50 * 1024 * 1024; // Gmail's own receiving limit; anything bigger is not downloaded
const MESSAGE_ID = /^<[^<>\s]+>$/;

let active = null; // the config once started; sendEmail refuses without it
let timer = null;
let busy = false; // a slow check is never overlapped by the next one
let smtp = null;
let uidValidity = null;
const passedOver = new Set(); // unseen UIDs already counted and skipped, so each is logged and fetched once

const list = (v) => String(v || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const oneLine = (s) => String(s ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 300);
const httpError = (status, message) => Object.assign(new Error(message), { status });

export function emailConfig(env = process.env) {
  return {
    user: String(env.GMAIL_USER || '').trim(),
    pass: String(env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, ''), // Google shows it in groups of four
    senders: list(env.EMAIL_ALLOWED_SENDERS),
    recipients: list(env.EMAIL_ALLOWED_RECIPIENTS),
  };
}

// An error as one short line, with the password scrubbed out in case a library ever echoes it.
function why(err, cfg) {
  const text = String(err?.response || err?.message || err).replace(/\s+/g, ' ');
  return (cfg?.pass ? text.split(cfg.pass).join('[redacted]') : text).slice(0, 300);
}

// ============ Boot ============

// Returns null when not configured, otherwise the first check (it never rejects).
export function startEmail({ env = process.env, connect = openImap, intervalMs = CHECK_MS } = {}) {
  const cfg = emailConfig(env);
  if (!cfg.user || !cfg.pass) {
    console.log('[email] not configured');
    return null;
  }
  stopEmail();
  active = cfg;
  console.log(`[email] on for ${cfg.user}: INBOX checked every ${Math.round(intervalMs / 60000)} min, ${cfg.senders.length} allowed sender(s), ${cfg.recipients.length} allowed recipient(s)`);
  const check = async () => {
    if (busy) return;
    busy = true;
    try {
      await pollInbox(cfg, { connect });
    } catch (err) {
      if (err?.authenticationFailed) {
        clearInterval(timer);
        timer = null;
        console.error(`[email] login failed for ${cfg.user}: ${why(err, cfg)}. Inbox checks stopped; fix GMAIL_APP_PASSWORD and restart.`);
        recordHealthEvent({ kind: 'email_login_failed', user: cfg.user, error: why(err, cfg) });
      } else {
        console.warn(`[email] inbox check failed: ${why(err, cfg)}`);
      }
    } finally {
      busy = false;
    }
  };
  timer = setInterval(check, intervalMs);
  timer.unref?.();
  return check();
}

export function stopEmail() {
  clearInterval(timer);
  timer = null;
  try { smtp?.close?.(); } catch {}
  smtp = null;
  active = null;
  passedOver.clear();
}

// ============ Inbound ============

async function openImap(cfg) {
  const { ImapFlow } = await import('imapflow');
  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false, // its default logger prints every command
    disableAutoIdle: true,
  });
  // Without a listener, an 'error' event would crash the process.
  client.on('error', (err) => console.warn(`[email] imap: ${why(err, cfg)}`));
  try {
    await client.connect();
  } catch (err) {
    try { client.close(); } catch {}
    throw err;
  }
  return client;
}

export async function pollInbox(cfg, { connect = openImap, maxAttachmentBytes = MAX_ATTACHMENT_BYTES } = {}) {
  const client = await connect(cfg);
  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      const validity = client.mailbox?.uidValidity;
      if (validity != null && String(validity) !== String(uidValidity)) {
        passedOver.clear(); // UIDs from an older mailbox generation mean nothing now
        uidValidity = validity;
      }
      const uids = ((await client.search({ seen: false }, { uid: true })) || []).filter((u) => !passedOver.has(u));
      let saved = 0;
      let others = 0;
      if (!uids.length) return { saved, others };
      // Envelopes only: the sender check runs before any body is downloaded.
      for (const m of await client.fetchAll(uids, { uid: true, envelope: true, size: true }, { uid: true })) {
        const from = (m.envelope?.from || []).map((a) => String(a.address || '').toLowerCase());
        if (!from.length || !from.every((a) => cfg.senders.includes(a))) {
          passedOver.add(m.uid);
          others++;
          continue;
        }
        if (m.size > MAX_MESSAGE_BYTES) {
          passedOver.add(m.uid);
          console.warn(`[email] uid ${m.uid} from ${from.join(', ')} is over ${MAX_MESSAGE_BYTES / 1048576} MB: not downloaded, left unread`);
          continue;
        }
        try {
          const full = await client.fetchOne(String(m.uid), { uid: true, source: true }, { uid: true }); // BODY.PEEK: stays unread
          await saveMail({ uid: m.uid, from: from.join(', '), source: full.source, maxAttachmentBytes });
          await client.messageFlagsAdd(String(m.uid), ['\\Seen'], { uid: true });
          saved++;
        } catch (err) {
          console.warn(`[email] uid ${m.uid} not saved, left unread: ${why(err, cfg)}`);
        }
      }
      if (others) console.log(`[email] ${others} unseen message(s) from senders not on EMAIL_ALLOWED_SENDERS: not saved, left unread`);
      return { saved, others };
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => { try { client.close(); } catch {} });
  }
}

// An attachment name that stays one plain file inside the message folder: no directory part (either
// slash), no leading dots, no control, bidi or Windows-reserved characters (':' would open an NTFS
// stream), no device names such as CON or NUL, and a bounded length.
export function safeFilename(name, i = 0) {
  let base = String(name ?? '').split(/[\\/]/).pop()
    .replace(/[\x00-\x1f\x7f<>:"|?*\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '_')
    .replace(/^[\s.]+|[\s.]+$/g, '');
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(base)) base = `_${base}`;
  if (base.length > 120) {
    const ext = extname(base).slice(0, 20);
    base = base.slice(0, 120 - ext.length) + ext;
  }
  return base || `attachment-${i + 1}`;
}

async function saveMail({ uid, from, source, maxAttachmentBytes }) {
  const { simpleParser } = await import('mailparser');
  const mail = await simpleParser(source, { skipTextToHtml: true, skipImageLinks: true });
  const ts = new Date().toISOString();
  const dir = join(MAIL_DIR, ts.slice(0, 10), String(uid)); // UTC date, like the exchange feed
  const filesDir = join(dir, 'attachments');
  const addresses = (a) => [].concat(a || []).map((x) => x.text).join(', ');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'headers.json'), JSON.stringify({
    uid,
    messageId: mail.messageId || null,
    date: mail.date && !isNaN(mail.date) ? mail.date.toISOString() : null,
    from: addresses(mail.from),
    to: addresses(mail.to),
    cc: addresses(mail.cc),
    subject: mail.subject || '',
    inReplyTo: mail.inReplyTo || null,
    references: mail.references || null,
    lines: (mail.headerLines || []).map((h) => h.line),
  }, null, 2));
  await writeFile(join(dir, 'body.txt'), mail.text || '');
  const attachments = [];
  const used = new Set();
  for (const [i, a] of (mail.attachments || []).entries()) {
    const base = safeFilename(a.filename, i);
    let name = base;
    for (let k = 2; used.has(name.toLowerCase()); k++) name = `${k}-${base}`;
    used.add(name.toLowerCase());
    const size = a.content?.length ?? a.size ?? 0;
    const file = resolve(filesDir, name);
    if (size > maxAttachmentBytes) {
      attachments.push({ name, size, skipped: 'too large' });
    } else if (!file.startsWith(resolve(filesDir) + sep)) {
      attachments.push({ name, size, skipped: 'unsafe name' }); // cannot happen after safeFilename; the last check
    } else {
      await mkdir(filesDir, { recursive: true });
      await writeFile(file, a.content);
      attachments.push({ name, size });
    }
  }
  await appendFile(MAIL_LOG, JSON.stringify({ ts, uid, from, subject: oneLine(mail.subject), attachments, path: dir }) + '\n');
  console.log(`[email] saved uid ${uid} from ${from} (${attachments.length} attachment(s))`);
}

// The saved headers of an inbound message, for threading a reply onto it.
function savedHeaders(uid) {
  try {
    let row = null;
    for (const line of readFileSync(MAIL_LOG, 'utf-8').split('\n')) {
      try { const r = line && JSON.parse(line); if (r?.uid === uid) row = r; } catch {}
    }
    return row && JSON.parse(readFileSync(join(row.path, 'headers.json'), 'utf-8'));
  } catch {
    return null;
  }
}

// ============ Outbound ============

async function smtpTransport(cfg) {
  if (!smtp) {
    const { default: nodemailer } = await import('nodemailer');
    smtp = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: cfg.user, pass: cfg.pass } });
  }
  return smtp;
}

// payload: { to, subject, text, inReplyToUid? }. Every recipient must be exactly an allowed address.
export async function sendEmail(payload, { cfg = active, transport } = {}) {
  if (!cfg) throw httpError(503, 'email not configured');
  const to = [].concat(payload?.to ?? []).flatMap((t) => String(t).split(',')).map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (!to.length) throw httpError(400, 'to is required');
  const refused = to.filter((t) => !cfg.recipients.includes(t));
  if (refused.length) {
    console.warn(`[email] refused a send: ${refused.length} recipient(s) not on EMAIL_ALLOWED_RECIPIENTS`);
    recordHealthEvent({ kind: 'email_refused', to: refused.map(oneLine) });
    throw httpError(403, `not on EMAIL_ALLOWED_RECIPIENTS: ${refused.map(oneLine).join(', ')}`);
  }
  const text = String(payload?.text ?? '');
  if (!text.trim()) throw httpError(400, 'text is required');
  const mail = { from: cfg.user, to, subject: oneLine(payload?.subject), text };
  if (payload?.inReplyToUid != null) {
    const uid = Number(payload.inReplyToUid);
    const orig = Number.isInteger(uid) && uid > 0 ? savedHeaders(uid) : null;
    if (!orig) throw httpError(404, `no saved mail with uid ${oneLine(payload.inReplyToUid)}`);
    if (MESSAGE_ID.test(orig.messageId || '')) {
      mail.inReplyTo = orig.messageId;
      mail.references = [...[].concat(orig.references || []).filter((r) => MESSAGE_ID.test(r)), orig.messageId];
    }
    if (!mail.subject) mail.subject = /^re:/i.test(oneLine(orig.subject)) ? oneLine(orig.subject) : `Re: ${oneLine(orig.subject)}`;
  }
  if (!mail.subject) throw httpError(400, 'subject is required');
  const event = { to, subject: mail.subject, length: text.length };
  let info;
  try {
    info = await (transport || await smtpTransport(cfg)).sendMail(mail);
  } catch (err) {
    recordHealthEvent({ kind: 'email_send_failed', ...event, error: why(err, cfg) });
    throw httpError(502, `send failed: ${why(err, cfg)}`);
  }
  recordHealthEvent({ kind: 'email_sent', ...event });
  console.log(`[email] sent ${text.length} chars to ${to.join(', ')}`);
  return { messageId: info?.messageId || null };
}

// POST /api/email. index.js runs it behind the same X-Api-Secret check as every /api/* route; the
// check is repeated here so the route stays closed even if it is ever moved.
export async function handleEmailApi(req, res, { secret, readBody, send = sendEmail }) {
  const reply = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (!secret || req.headers['x-api-secret'] !== secret) return reply(401, { error: 'Unauthorized' });
  try {
    const payload = JSON.parse(await readBody(req));
    reply(200, { ok: true, ...(await send(payload)) });
  } catch (err) {
    reply(err.status || 400, { error: err.message });
  }
}
