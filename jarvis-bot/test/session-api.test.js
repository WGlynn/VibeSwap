// Tests for POST /api/send-file and POST /api/record (src/session-api.js, Will 2026-11-04). The session
// sent Blake a file by calling Telegram's sendDocument directly (message 35949 in -5590478415, replying
// to 35942), so the bot never saw it and could not discuss it later. Now the session sends files
// through the bot, from one outbox folder, and backfills what it already sent directly. Telegram is a
// fake: no test calls the API.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, readFileSync } from 'fs';
import { tmpdir, homedir } from 'os';
import { join, dirname } from 'path';
import { handleSendFileApi, handleRecordApi, OUTBOX_DIR, MAX_FILE_BYTES } from '../src/session-api.js';

const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf-8');
const SECRET = 'right';
const GROUP = '-5590478415';
const LEVIN = '# Levin\nThe spectrum picture.\n';
const OUTSIDE = (dir) => ({ error: `only files inside ${dir} can be sent` });

// A stand-in feed dir: the outbox with a file to send and two secret files, a file beside the outbox,
// and a plain dir outside it reached through a junction inside the outbox.
const root = mkdtempSync(join(tmpdir(), 'session-api-'));
const outbox = join(root, 'jarvis-feed', 'outbox-files');
const put = (p, text) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); };
put(join(outbox, 'levin-notes.md'), LEVIN);
put(join(outbox, '.env'), 'CLAUDE_CODE_API_SECRET=fake\n');
put(join(outbox, 'deploy', 'key.pem'), 'fake key\n');
put(join(root, 'jarvis-feed', 'notes.txt'), 'beside the outbox\n');
put(join(root, 'elsewhere', 'plain.txt'), 'plain\n');
symlinkSync(join(root, 'elsewhere'), join(outbox, 'elsewhere-link'), 'junction');
after(() => rmSync(root, { recursive: true, force: true }));

// A fake Telegram that records each sendDocument and answers with the message id.
function fakeTelegram() {
  const t = { sent: [] };
  t.sendDocument = async (chatId, file, extra) => {
    t.sent.push({ chatId, filename: file.filename, content: file.source.toString('utf-8'), extra });
    return { message_id: 35949 };
  };
  return t;
}

// Calls a handler the way index.js does, capturing the response, body reads, sends and records.
async function call(handler, { headers = { 'x-api-secret': SECRET }, secret = SECRET, body, maxBytes } = {}) {
  const telegram = fakeTelegram();
  const records = [];
  let reads = 0;
  const res = { status: 0, body: null, writeHead(s) { this.status = s; }, end(b) { this.body = JSON.parse(b); } };
  await handler({ headers }, res, {
    secret, telegram, outboxDir: outbox, maxBytes,
    readBody: async () => { reads++; return JSON.stringify(body); },
    record: (chatId, text, ids) => records.push({ chatId, text, ...ids }),
  });
  return { status: res.status, body: res.body, reads, sent: telegram.sent, records };
}

test('S1 a missing or wrong X-Api-Secret gets 401 before the body is read, nothing sent or recorded', async () => {
  const body = { chatId: GROUP, path: 'levin-notes.md', text: 'hi' };
  for (const handler of [handleSendFileApi, handleRecordApi]) {
    for (const [headers, secret] of [[{}, SECRET], [{ 'x-api-secret': 'wrong' }, SECRET], [{ 'x-api-secret': '' }, SECRET],
      [{ 'x-api-secret': '' }, ''], [{}, undefined]]) {
      const r = await call(handler, { headers, secret, body });
      assert.deepEqual([r.status, r.body, r.reads, r.sent.length, r.records.length], [401, { error: 'Unauthorized' }, 0, 0, 0],
        `${handler.name} ${JSON.stringify([headers, secret])}`);
    }
  }
});

test('S2 a path outside the outbox is refused, ../ and a junction included, and nothing is sent', async () => {
  for (const path of ['../notes.txt', 'deploy/../../notes.txt', join(root, 'jarvis-feed', 'notes.txt'), '..', '.', 'elsewhere-link/plain.txt']) {
    const r = await call(handleSendFileApi, { body: { chatId: GROUP, path } });
    assert.deepEqual([r.status, r.body, r.sent.length, r.records.length], [400, OUTSIDE(outbox), 0, 0], path);
  }
});

test('S3 a secret file inside the outbox is refused', async () => {
  for (const path of ['.env', 'deploy/key.pem', 'DEPLOY/KEY.PEM']) {
    if (path === 'DEPLOY/KEY.PEM' && process.platform !== 'win32') continue; // case-insensitive names are a Windows thing
    const r = await call(handleSendFileApi, { body: { chatId: GROUP, path } });
    assert.deepEqual([r.status, r.body, r.sent.length, r.records.length],
      [400, { error: 'that is a secret file (.env, a key, a token or a credential); it is not sent' }, 0, 0], path);
  }
});

test('S4 a send goes to Telegram as a document, then is recorded with its caption and note', async () => {
  const r = await call(handleSendFileApi, { body: {
    chatId: GROUP, path: 'levin-notes.md', caption: 'Notes from the call', replyToMessageId: 35942,
    note: 'Levin: bioelectric patterns as the spectrum picture; three open questions for Blake.',
  } });
  assert.deepEqual([r.status, r.body], [200, { ok: true, messageId: 35949 }]);
  assert.deepEqual(r.sent, [{ chatId: GROUP, filename: 'levin-notes.md', content: LEVIN,
    extra: { caption: 'Notes from the call', reply_parameters: { message_id: 35942 } } }]);
  assert.deepEqual(r.records, [{ chatId: GROUP, replyToMessageId: 35942, messageId: 35949,
    text: '[sent file levin-notes.md] Notes from the call Levin: bioelectric patterns as the spectrum picture; three open questions for Blake.' }]);
  // With no caption or note the record is the file name alone, and an absolute path inside works.
  const bare = await call(handleSendFileApi, { body: { chatId: GROUP, path: join(outbox, 'levin-notes.md') } });
  assert.deepEqual([bare.sent[0].extra, bare.records[0].text], [{}, '[sent file levin-notes.md]']);
});

test('S5 /api/record sends nothing and records the message', async () => {
  const r = await call(handleRecordApi, { body: { chatId: GROUP, text: '[sent file levin-notes.md] Notes from the call', messageId: 35949, replyToMessageId: 35942 } });
  assert.deepEqual([r.status, r.body, r.sent.length], [200, { ok: true, recorded: true }, 0]);
  assert.deepEqual(r.records, [{ chatId: GROUP, text: '[sent file levin-notes.md] Notes from the call', replyToMessageId: 35942, messageId: 35949 }]);
  for (const body of [{ chatId: GROUP, text: '  ' }, { chatId: 'blake', text: 'x' }, { text: 'x' }]) {
    const bad = await call(handleRecordApi, { body });
    assert.deepEqual([bad.status, bad.records.length], [400, 0], JSON.stringify(body));
  }
});

test('S6 a file over the size cap, a missing file and a bad chat id are refused before any send', async () => {
  const big = await call(handleSendFileApi, { body: { chatId: GROUP, path: 'levin-notes.md' }, maxBytes: 10 });
  assert.deepEqual([big.status, big.body, big.sent.length], [400, { error: `the file is ${Buffer.byteLength(LEVIN)} bytes, over the 10-byte cap` }, 0]);
  const missing = await call(handleSendFileApi, { body: { chatId: GROUP, path: 'gone.pdf' } });
  assert.deepEqual([missing.status, missing.body, missing.sent.length], [400, { error: 'no file at gone.pdf' }, 0]);
  const chat = await call(handleSendFileApi, { body: { chatId: 'blake', path: 'levin-notes.md' } });
  assert.deepEqual([chat.status, chat.sent.length], [400, 0]);
  assert.equal(MAX_FILE_BYTES, 20 * 1024 * 1024);
  assert.equal(OUTBOX_DIR, join(process.env.JARVIS_FEED_DIR || join(homedir(), 'jarvis-feed'), 'outbox-files'));
});

test('S7 index.js serves both routes beside /api/say, behind its secret check, recording the way it does', () => {
  const idx = src('index.js');
  const block = idx.slice(idx.indexOf("} else if (req.url?.startsWith('/api/')) {"), idx.indexOf('// ============ Shard Proxy Processing ============'));
  const at = (s) => block.indexOf(s);
  const check = at('if (!config.claudeCodeApiSecret || apiSecret !== config.claudeCodeApiSecret) {');
  assert.ok(check > -1 && check < at("path === '/api/say'") && at("path === '/api/say'") < at("path === '/api/send-file'")
    && at("path === '/api/send-file'") < at("path === '/api/record'"), 'route order in the /api/* block');
  assert.match(block, /await handleSendFileApi\(req, res, \{ secret: config\.claudeCodeApiSecret, readBody, telegram: bot\.telegram, record: recordSessionPost \}\);/);
  assert.match(block, /await handleRecordApi\(req, res, \{ secret: config\.claudeCodeApiSecret, readBody, record: recordSessionPost \}\);/);
  assert.match(block, /const sent = await bot\.telegram\.sendMessage\(chatId, text, extra\);\n\s+recordSessionPost\(chatId, text, \{ replyToMessageId: payload\.replyToMessageId \}\);/);
  // The one recorder: the receipt note, collision history, and the group context window.
  const recorder = idx.slice(idx.indexOf('const recordSessionPost = '), idx.indexOf('const httpServer = createServer('));
  assert.match(recorder, /if \(payload\.replyToMessageId\) noteSessionReply\(chatId, payload\.replyToMessageId\);\n\s+recordOutgoing\(chatId, text\);\n\s+if \(chatId\.startsWith\('-'\)\) pushGroupMessage\(chatId, 'JARVIS', text\.slice\(0, 500\), payload\.messageId \?\? null, true\);/);
});
