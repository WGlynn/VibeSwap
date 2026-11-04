// Tests for email.js (2026-11-04). Will: "hook jarvis tg bot up to my Jarvis.proofofmind@gmail.com";
// Blake had asked in "Will, Blake and Jarvis" whether Jarvis can email. Gmail over IMAP and SMTP with an
// App Password: unseen mail from allowed senders is saved to the feed folder, anyone else's is left
// unread and unsaved, and mail goes out only through POST /api/email to allowed recipients. Every IMAP
// client and SMTP transport here is a fake: no test opens a connection.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs';
import { dirname, join } from 'path';
import { tmpdir } from 'os';

const FEED = mkdtempSync(join(tmpdir(), 'jarvis-feed-test-'));
const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf-8');
const rows = (f) => (existsSync(join(FEED, f)) ? readFileSync(join(FEED, f), 'utf-8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const ENV = { GMAIL_USER: 'jarvis@example.com', GMAIL_APP_PASSWORD: 'fake app pass', EMAIL_ALLOWED_SENDERS: 'Blake@Example.com, will@example.com', EMAIL_ALLOWED_RECIPIENTS: 'blake@example.com,will@example.com' };
let email;

before(async () => {
  // Fake values, set before any module loads. dotenv (config.js) never overrides a key that is already
  // set, so whatever .env holds, the real Gmail password never enters this process; a blank OLLAMA_URL
  // keeps llm-provider.js (loaded through feed.js) from warming a local model.
  Object.assign(process.env, { JARVIS_FEED_DIR: FEED, GMAIL_USER: '', GMAIL_APP_PASSWORD: '', EMAIL_ALLOWED_SENDERS: '', EMAIL_ALLOWED_RECIPIENTS: '', OLLAMA_URL: '' });
  email = await import('../src/email.js');
});

after(() => {
  email?.stopEmail();
  rmSync(FEED, { recursive: true, force: true });
});

async function capture(fn) {
  const lines = [];
  const saved = { log: console.log, warn: console.warn, error: console.error };
  for (const k of Object.keys(saved)) console[k] = (...args) => lines.push(args.join(' '));
  try {
    return { result: await fn(), lines };
  } finally {
    Object.assign(console, saved);
  }
}

// A raw RFC 822 message with a text part and base64 attachments.
function rawMail({ from, subject, text, messageId, attachments = [] }) {
  return [
    `From: ${from}`, 'To: jarvis@example.com', `Subject: ${subject}`, `Message-ID: ${messageId}`,
    'Date: Wed, 04 Nov 2026 15:00:00 +0000', 'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="b1"', '',
    '--b1', 'Content-Type: text/plain; charset=utf-8', '', text,
    ...attachments.flatMap((a) => ['--b1', 'Content-Type: application/octet-stream', `Content-Disposition: attachment; filename="${a.name}"`,
      'Content-Transfer-Encoding: base64', '', Buffer.from(a.content).toString('base64')]),
    '--b1--', '',
  ].join('\r\n');
}

// An IMAP client over a list of messages ({ uid, from: [addresses], source }), recording every call.
function fakeImap(messages) {
  const calls = [];
  const find = (uid) => messages.find((m) => String(m.uid) === String(uid));
  const client = {
    mailbox: { uidValidity: 7n },
    getMailboxLock: async (path) => { calls.push(['lock', path]); return { release: () => calls.push(['release']) }; },
    search: async (query, opts) => { calls.push(['search', query, opts]); return messages.filter((m) => !m.seen).map((m) => m.uid); },
    fetchAll: async (range, query, opts) => {
      calls.push(['fetchAll', range, query, opts]);
      return messages.filter((m) => range.includes(m.uid)).map((m) => ({ uid: m.uid, size: m.source.length, envelope: { from: m.from.map((address) => ({ address })) } }));
    },
    fetchOne: async (uid, query, opts) => { calls.push(['fetchOne', uid, query, opts]); return { uid: Number(uid), source: Buffer.from(find(uid).source) }; },
    messageFlagsAdd: async (uid, flags, opts) => { calls.push(['flags', uid, flags, opts]); find(uid).seen = true; return true; },
    logout: async () => { calls.push(['logout']); },
    close: () => calls.push(['close']),
  };
  return { calls, connect: async (cfg) => { calls.push(['connect', cfg.user]); return client; } };
}

test('E1 without GMAIL_USER and GMAIL_APP_PASSWORD, email is skipped with one log line and no connection', async () => {
  let connects = 0;
  for (const env of [{}, { GMAIL_USER: 'jarvis@example.com' }, { GMAIL_APP_PASSWORD: 'fake' }]) {
    const { result, lines } = await capture(() => email.startEmail({ env, connect: async () => { connects++; } }));
    assert.equal(result, null);
    assert.deepEqual(lines, ['[email] not configured']);
  }
  assert.equal(connects, 0);
  await assert.rejects(email.sendEmail({ to: 'blake@example.com', subject: 's', text: 't' }), { status: 503 });
  // index.js starts it at boot (the check above runs inside startEmail) and stops it at shutdown.
  const idx = src('index.js');
  assert.match(idx, /\n {2}startEmail\(\);\n/);
  assert.match(idx, /\n {4}stopCRPC\(\);\n {4}stopEmail\(\);\n/);
});

test('E2 only allowed senders are saved, then marked seen; anyone else is counted once, never downloaded, left unread', async () => {
  const cfg = email.emailConfig(ENV);
  const imap = fakeImap([
    { uid: 101, from: ['blake@EXAMPLE.com'], source: rawMail({ from: 'Blake <blake@example.com>', subject: 'Lesson 1', text: 'Here is the first lesson.', messageId: '<lesson1@example.com>',
      attachments: [{ name: 'notes.txt', content: 'lesson one' }, { name: '../../outside.txt', content: 'stays inside' }, { name: 'notes.txt', content: 'second notes' }, { name: 'video.mp4', content: 'x'.repeat(100) }] }) },
    { uid: 102, from: ['stranger@example.com'], source: rawMail({ from: 'stranger@example.com', subject: 'hi', text: 'buy now', messageId: '<s@example.com>' }) },
    { uid: 103, from: ['blake@example.com', 'stranger@example.com'], source: rawMail({ from: 'blake@example.com, stranger@example.com', subject: 'mixed', text: 'x', messageId: '<m@example.com>' }) },
  ]);
  const { result, lines } = await capture(() => email.pollInbox(cfg, { connect: imap.connect, maxAttachmentBytes: 64 }));
  assert.deepEqual(result, { saved: 1, others: 2 });
  assert.ok(lines.includes('[email] 2 unseen message(s) from senders not on EMAIL_ALLOWED_SENDERS: not saved, left unread'), lines.join('\n'));
  // The sender check ran on envelopes; only the allowed message was downloaded and marked seen.
  assert.deepEqual(imap.calls.filter((c) => c[0] === 'fetchOne').map((c) => c[1]), ['101']);
  assert.deepEqual(imap.calls.filter((c) => c[0] === 'flags').map((c) => [c[1], c[2]]), [['101', ['\\Seen']]]);
  assert.deepEqual(imap.calls.find((c) => c[0] === 'search').slice(1), [{ seen: false }, { uid: true }]);
  assert.ok(imap.calls.some((c) => c[0] === 'logout') && imap.calls.some((c) => c[0] === 'release'));

  const saved = rows('mail.jsonl');
  assert.equal(saved.length, 1);
  const row = saved[0];
  assert.deepEqual(Object.keys(row), ['ts', 'uid', 'from', 'subject', 'attachments', 'path']);
  assert.equal(row.uid, 101);
  assert.equal(row.from, 'blake@example.com');
  assert.equal(row.subject, 'Lesson 1');
  assert.match(row.path, /[\\/]mail[\\/]\d{4}-\d{2}-\d{2}[\\/]101$/);
  assert.equal(dirname(dirname(dirname(row.path))), FEED);
  assert.deepEqual(row.attachments, [
    { name: 'notes.txt', size: 10 },
    { name: 'outside.txt', size: 12 },
    { name: '2-notes.txt', size: 12 },
    { name: 'video.mp4', size: 100, skipped: 'too large' },
  ]);
  const headers = JSON.parse(readFileSync(join(row.path, 'headers.json'), 'utf-8'));
  assert.equal(headers.messageId, '<lesson1@example.com>');
  assert.equal(headers.subject, 'Lesson 1');
  assert.ok(headers.lines.includes('Subject: Lesson 1'));
  assert.match(readFileSync(join(row.path, 'body.txt'), 'utf-8'), /Here is the first lesson\./);
  // The "../../" attachment landed inside the message's own folder, and nothing outside it.
  assert.deepEqual(readdirSync(join(row.path, 'attachments')).sort(), ['2-notes.txt', 'notes.txt', 'outside.txt']);
  assert.equal(readFileSync(join(row.path, 'attachments', 'outside.txt'), 'utf-8'), 'stays inside');
  for (const dir of [row.path, dirname(row.path), dirname(dirname(row.path)), FEED]) assert.equal(existsSync(join(dir, 'outside.txt')), false, dir);

  // Next check: the others are not counted or fetched again, and 101 is seen now.
  imap.calls.length = 0;
  const again = await capture(() => email.pollInbox(cfg, { connect: imap.connect }));
  assert.deepEqual(again.result, { saved: 0, others: 0 });
  assert.deepEqual(again.lines, []);
  assert.equal(imap.calls.some((c) => c[0] === 'fetchAll' || c[0] === 'fetchOne'), false);
  assert.equal(rows('mail.jsonl').length, 1);
});

test('E3 attachment names cannot leave the folder, open a stream, or name a device', () => {
  for (const [name, safe] of [
    ['../../evil.txt', 'evil.txt'],
    ['..\\..\\Windows\\win.ini', 'win.ini'],
    ['C:\\Users\\Will\\.ssh\\id_rsa', 'id_rsa'],
    ['/etc/passwd', 'passwd'],
    ['lesson.pdf:hidden.exe', 'lesson.pdf_hidden.exe'],
    ['a\u0000b.txt', 'a_b.txt'],
    ['invoice\u202Etxt.exe', 'invoice_txt.exe'],
    ['CON', '_CON'],
    ['nul.txt', '_nul.txt'],
    ['com1.log', '_com1.log'],
    ['  .hidden.  ', 'hidden'],
    ['..', 'attachment-1'],
    ['', 'attachment-1'],
    [undefined, 'attachment-1'],
    ['Lesson 1 (Genesis).pdf', 'Lesson 1 (Genesis).pdf'],
  ]) assert.equal(email.safeFilename(name, 0), safe, JSON.stringify(name));
  const long = email.safeFilename(`${'x'.repeat(300)}.pdf`);
  assert.equal(long.length, 120);
  assert.ok(long.endsWith('.pdf'));
});

test('E4 outbound mail goes only to EMAIL_ALLOWED_RECIPIENTS; the rest is refused before any send, and a send is recorded without its body', async () => {
  const cfg = email.emailConfig(ENV);
  const sent = [];
  const transport = { sendMail: async (mail) => { sent.push(mail); return { messageId: '<out1@example.com>' }; } };
  for (const to of ['stranger@example.com', 'blake@example.com\r\nBcc: stranger@example.com', 'Blake <blake@example.com>',
    'blake@example.com, stranger@example.com', ['will@example.com', 'stranger@example.com']]) {
    const { lines } = await capture(() => assert.rejects(email.sendEmail({ to, subject: 'Lesson', text: 'body' }, { cfg, transport }), { status: 403 }));
    assert.match(lines.join('\n'), /\[email\] refused a send: 1 recipient\(s\) not on EMAIL_ALLOWED_RECIPIENTS/);
  }
  for (const to of ['', [], undefined]) await assert.rejects(email.sendEmail({ to, subject: 's', text: 't' }, { cfg, transport }), { status: 400 });
  assert.equal(sent.length, 0);
  assert.equal(rows('health.jsonl').filter((h) => h.kind === 'email_refused').length, 5);

  const { result } = await capture(() => email.sendEmail({ to: 'Blake@Example.com', subject: 'Lesson\r\nBcc: x@example.com', text: 'private body text' }, { cfg, transport }));
  assert.deepEqual(result, { messageId: '<out1@example.com>' });
  assert.deepEqual(sent, [{ from: 'jarvis@example.com', to: ['blake@example.com'], subject: 'Lesson Bcc: x@example.com', text: 'private body text' }]);
  const event = rows('health.jsonl').find((h) => h.kind === 'email_sent');
  assert.deepEqual({ ...event, ts: undefined }, { ts: undefined, kind: 'email_sent', to: ['blake@example.com'], subject: 'Lesson Bcc: x@example.com', length: 17 });
  assert.doesNotMatch(readFileSync(join(FEED, 'health.jsonl'), 'utf-8'), /private body text/);

  // A failing SMTP send is a 502 and is recorded, password scrubbed.
  const broken = { sendMail: async () => { throw new Error('Invalid login: fakeapppass rejected'); } };
  await capture(() => assert.rejects(email.sendEmail({ to: 'will@example.com', subject: 's', text: 't' }, { cfg, transport: broken }), { status: 502, message: 'send failed: Invalid login: [redacted] rejected' }));
  assert.equal(rows('health.jsonl').find((h) => h.kind === 'email_send_failed').error, 'Invalid login: [redacted] rejected');
});

test('E5 inReplyToUid threads a reply onto the saved message', async () => {
  const cfg = email.emailConfig(ENV);
  const imap = fakeImap([{ uid: 201, from: ['will@example.com'], source: rawMail({ from: 'will@example.com', subject: 'Plan', text: 'see attached', messageId: '<plan@example.com>' }) }]);
  await capture(() => email.pollInbox(cfg, { connect: imap.connect }));
  const sent = [];
  const transport = { sendMail: async (mail) => { sent.push(mail); return { messageId: '<r@example.com>' }; } };
  await capture(() => email.sendEmail({ to: 'will@example.com', text: 'got it', inReplyToUid: 201 }, { cfg, transport }));
  assert.equal(sent[0].subject, 'Re: Plan');
  assert.equal(sent[0].inReplyTo, '<plan@example.com>');
  assert.deepEqual(sent[0].references, ['<plan@example.com>']);
  await assert.rejects(email.sendEmail({ to: 'will@example.com', text: 'x', inReplyToUid: 999 }, { cfg, transport }), { status: 404 });
  await assert.rejects(email.sendEmail({ to: 'will@example.com', text: 'x', inReplyToUid: '../201' }, { cfg, transport }), { status: 404 });
  assert.equal(sent.length, 1);
});

test('E6 /api/email: a missing or wrong X-Api-Secret gets 401 before the body is read or anything is sent', async () => {
  let reads = 0;
  let sends = 0;
  const readBody = async () => { reads++; return JSON.stringify({ to: 'blake@example.com', subject: 's', text: 't' }); };
  const send = async () => { sends++; return { messageId: '<x@example.com>' }; };
  const call = async (headers, secret) => {
    const res = { status: 0, body: null, writeHead(s) { this.status = s; }, end(b) { this.body = JSON.parse(b); } };
    await email.handleEmailApi({ headers }, res, { secret, readBody, send });
    return res;
  };
  for (const [headers, secret] of [[{}, 'right'], [{ 'x-api-secret': 'wrong' }, 'right'], [{ 'x-api-secret': '' }, 'right'], [{ 'x-api-secret': '' }, null], [{}, undefined]]) {
    const res = await call(headers, secret);
    assert.equal(res.status, 401, JSON.stringify([headers, secret]));
    assert.deepEqual(res.body, { error: 'Unauthorized' });
  }
  assert.equal(reads + sends, 0);
  const ok = await call({ 'x-api-secret': 'right' }, 'right');
  assert.deepEqual([ok.status, ok.body, sends], [200, { ok: true, messageId: '<x@example.com>' }, 1]);

  // In index.js the route sits in the /api/* block, after the same secret check /api/say is behind.
  const idx = src('index.js');
  const block = idx.slice(idx.indexOf("} else if (req.url?.startsWith('/api/')) {"), idx.indexOf('// ============ Shard Proxy Processing ============'));
  const check = block.indexOf('if (!config.claudeCodeApiSecret || apiSecret !== config.claudeCodeApiSecret) {');
  assert.ok(check > -1 && check < block.indexOf("path === '/api/say'") && block.indexOf("path === '/api/say'") < block.indexOf("path === '/api/email'"), 'route order in the /api/* block');
  assert.match(block, /\} else if \(path === '\/api\/email' && req\.method === 'POST'\) \{\n\s+await handleEmailApi\(req, res, \{ secret: config\.claudeCodeApiSecret, readBody \}\);/);
});

test('E7 the chat model has no email tool: only index.js imports email.js, and no tool is named for mail', () => {
  const dir = new URL('../src/', import.meta.url);
  const files = readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith('.js') || f.endsWith('.mjs'));
  const importers = files.filter((f) => /['"](\.\.?\/)+email\.js['"]/.test(readFileSync(new URL(f.replace(/\\/g, '/'), dir), 'utf-8')));
  assert.deepEqual(importers, ['index.js']);
  assert.match(src('index.js'), /import \{ startEmail, stopEmail, handleEmailApi \} from '\.\/email\.js';/);
  for (const f of files) assert.doesNotMatch(readFileSync(new URL(f.replace(/\\/g, '/'), dir), 'utf-8'), /name: ['"][a-z_]*mail[a-z_]*['"]/i, f);
});

test('E8 a refused login is logged clearly without the password, recorded, and stops the checks; other failures keep checking; nothing throws', async () => {
  let connects = 0;
  const refused = Object.assign(new Error('Command failed'), { authenticationFailed: true, response: 'Invalid credentials (Failure) fakeapppass' });
  const { result, lines } = await capture(() => email.startEmail({ env: ENV, connect: async () => { connects++; throw refused; }, intervalMs: 10 }));
  assert.equal(result, undefined);
  assert.ok(lines.includes('[email] login failed for jarvis@example.com: Invalid credentials (Failure) [redacted]. Inbox checks stopped; fix GMAIL_APP_PASSWORD and restart.'), lines.join('\n'));
  assert.doesNotMatch(lines.join('\n'), /fakeapppass|fake app pass/);
  assert.deepEqual(rows('health.jsonl').filter((h) => h.kind === 'email_login_failed').map((h) => [h.user, h.error]), [['jarvis@example.com', 'Invalid credentials (Failure) [redacted]']]);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(connects, 1);

  // A network failure is a warning, and the next check still runs.
  connects = 0;
  const down = await capture(async () => {
    await email.startEmail({ env: ENV, connect: async () => { connects++; throw new Error('getaddrinfo ENOTFOUND imap.gmail.com'); }, intervalMs: 10 });
    await new Promise((r) => setTimeout(r, 200));
  });
  email.stopEmail();
  assert.ok(connects >= 2, `connects ${connects}`);
  assert.ok(down.lines.includes('[email] inbox check failed: getaddrinfo ENOTFOUND imap.gmail.com'), down.lines.join('\n'));
});
