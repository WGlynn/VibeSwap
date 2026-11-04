// Tests for the knowledge-chain file sync containment and peer gating (src/knowledge-chain.js,
// 2026-11-04). GET /knowledge/file?path= read any file on the machine, an epoch's file_sync wrote
// any path, and GET /knowledge/files listed what had been read, all for anyone who could reach the
// port. Now a synced file is named by a key inside a sync root, a key received from a peer is
// stored under the synced dir only, GET /knowledge/file serves inventory keys only, and every route
// is for signed peers (index.js serveKnowledgeChainRoute). Temp dirs stand in for the roots.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, readFileSync, existsSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { createHash } from 'crypto';
import {
  syncKeyOf, syncedFilePath, publishFileSync, applyFileSyncChanges, getFileInventory, getFileContent,
  handleKnowledgeChainRequest, processKnowledgeChainBody,
} from '../src/knowledge-chain.js';
import { realPath } from '../src/tool-guard.js';

const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf-8').replace(/\r\n/g, '\n');
const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 32);

const root = mkdtempSync(join(tmpdir(), 'knowledge-chain-'));
const memory = join(root, 'memory');
const claude = join(root, 'repo', '.claude');
const synced = join(root, 'synced');
const roots = { memory, claude };
const put = (p, text) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); };
put(join(memory, 'MEMORY.md'), 'hello memory\n');
put(join(memory, 'sub', 'a.md'), 'nested\n');
put(join(memory, '.env'), 'X=fake\n');
put(join(memory, 'key.pem'), 'fake key\n');
put(join(claude, 'SESSION_STATE.md'), 'state\n');
put(join(root, 'repo', 'CLAUDE.md'), 'outside the roots\n');
put(join(root, 'elsewhere', 'plain.txt'), 'plain\n');
put(join(synced, 'memory', 'keep'), '');
symlinkSync(join(root, 'elsewhere'), join(memory, 'link'), 'junction');       // a junction out of a sync root
symlinkSync(join(root, 'elsewhere'), join(synced, 'memory', 'out'), 'junction'); // a junction out of the synced dir
after(() => rmSync(root, { recursive: true, force: true }));

test('K1 the sync key of a local file: root prefix plus the forward-slash relative path; outside, secret or linked out gives null', () => {
  assert.equal(syncKeyOf(join(memory, 'MEMORY.md'), roots), 'memory/MEMORY.md');
  assert.equal(syncKeyOf(join(memory, 'sub', 'a.md'), roots), 'memory/sub/a.md');
  assert.equal(syncKeyOf(join(claude, 'SESSION_STATE.md'), roots), 'claude/SESSION_STATE.md');
  for (const outside of [join(root, 'repo', 'CLAUDE.md'), join(root, 'elsewhere', 'plain.txt'), memory, claude, join(memory, '..', 'repo', 'CLAUDE.md'), '']) {
    assert.equal(syncKeyOf(outside, roots), null, outside);
  }
  for (const secret of [join(memory, '.env'), join(memory, 'key.pem'), join(claude, '.credentials.json')]) assert.equal(syncKeyOf(secret, roots), null, secret);
  assert.equal(syncKeyOf(join(memory, 'link', 'plain.txt'), roots), null); // real path leaves the root
  assert.equal(syncKeyOf(join(memory, 'MEMORY.md'), { memory: undefined, claude }), null); // an unset root is skipped
});

test('K2 where a received key is stored: strictly inside the synced dir, plain relative keys only, no secret file', () => {
  assert.equal(syncedFilePath('memory/MEMORY.md', synced), realPath(join(synced, 'memory', 'MEMORY.md')));
  assert.equal(syncedFilePath('claude/deep/er/SESSION_STATE.md', synced), realPath(join(synced, 'claude', 'deep', 'er', 'SESSION_STATE.md')));
  for (const bad of ['', '../x', 'memory/../../x', '/abs', '\\abs', 'C:/x', 'c:\\x', 'memory\\x', 'memory//x', './x', 'memory/./x', '.',
    '..', 'memory/.env', 'claude/key.pem', 'memory/.ssh/config', 'memory/token.json', 'x'.repeat(600), 'a\0b', 'memory/out/plain.txt', 'memory/keep/..']) {
    assert.equal(syncedFilePath(bad, synced), null, JSON.stringify(bad));
  }
});

test('K3 publishing a local file records it under its key; the inventory lists keys, and the key serves the file', async () => {
  const change = publishFileSync(join(memory, 'MEMORY.md'), 'hello memory\n', roots);
  assert.deepEqual(change, { type: 'file_sync', path: 'memory/MEMORY.md', contentHash: hash('hello memory\n'), content: 'hello memory\n', size: 13 });
  assert.equal(publishFileSync(join(memory, 'MEMORY.md'), 'hello memory\n', roots), null); // unchanged: not published again
  const big = 'y'.repeat(5000);
  assert.deepEqual(publishFileSync(join(memory, 'sub', 'a.md'), big, roots), { type: 'file_sync', path: 'memory/sub/a.md', contentHash: hash(big), content: null, size: 5000 });
  for (const no of [[join(memory, '.env'), 'X=fake\n'], [join(root, 'repo', 'CLAUDE.md'), 'outside\n'], [join(memory, 'link', 'plain.txt'), 'plain\n']]) {
    assert.equal(publishFileSync(no[0], no[1], roots), null, no[0]);
  }
  const entry = getFileInventory().find(e => e.path === 'memory/MEMORY.md');
  assert.deepEqual(Object.keys(entry).sort(), ['hash', 'lastUpdated', 'path', 'size']); // never the path on this machine
  assert.equal(entry.hash, hash('hello memory\n'));
  assert.equal(await getFileContent('memory/MEMORY.md'), 'hello memory\n');
  // Only keys in the inventory are served: a path, an unknown key, or the real path itself gives nothing.
  for (const notServed of [join(memory, 'MEMORY.md'), 'memory/.env', '../memory/MEMORY.md', 'C:/Windows/win.ini', '', undefined, 'memory/nope.md']) {
    assert.equal(await getFileContent(notServed), null, String(notServed));
  }
});

test('K4 a received file_sync is written under the synced dir only, with its hash checked; anything else is refused and nothing is written', async () => {
  const before = readdirSync(synced, { recursive: true }).length;
  const change = (path, content, extra = {}) => ({ type: 'file_sync', path, content, contentHash: hash(content), size: content.length, ...extra });
  const refused = [
    change('../../escape.txt', 'escape'),
    change('C:/Users/x/evil.txt', 'evil'),
    change('/etc/evil', 'evil'),
    change('memory\\back.md', 'back'),
    change('memory/.env', 'X=1'),
    change('memory/out/plain.txt', 'via junction'),
    change('memory/wrong-hash.md', 'content', { contentHash: hash('other') }),
    change('memory/too-big.md', 'z'.repeat(4097)),
    { type: 'file_sync', path: 'memory/no-content.md', content: 42, contentHash: 'x', size: 2 },
    { type: 'file_sync', path: 'memory/empty.md', content: '', contentHash: hash(''), size: 0 },
    { type: 'learned_fact', path: 'memory/not-a-sync.md', content: 'x', contentHash: hash('x') },
  ];
  assert.equal(await applyFileSyncChanges(refused, synced), 0);
  assert.equal(readdirSync(synced, { recursive: true }).length, before);
  assert.equal(existsSync(join(root, 'escape.txt')), false);
  assert.equal(existsSync(join(root, 'elsewhere', 'plain.txt')) && readFileSync(join(root, 'elsewhere', 'plain.txt'), 'utf-8'), 'plain\n');
  // A good one lands under the synced dir, is served by its key, and is not written twice.
  const good = change('memory/notes.md', 'from a peer\n');
  assert.equal(await applyFileSyncChanges([good], synced), 1);
  assert.equal(readFileSync(join(synced, 'memory', 'notes.md'), 'utf-8'), 'from a peer\n');
  assert.equal(await getFileContent('memory/notes.md'), 'from a peer\n');
  assert.equal(await applyFileSyncChanges([good], synced), 0);
  assert.equal(await applyFileSyncChanges(null, synced), 0);
  assert.equal(await applyFileSyncChanges('nope', synced), 0);
});

test('K5 the HTTP handlers: /knowledge/file serves a key from the inventory and nothing else', async () => {
  assert.equal(handleKnowledgeChainRequest('/knowledge/file', 'GET'), 'file');
  assert.equal(handleKnowledgeChainRequest('/knowledge/files', 'GET'), 'files');
  assert.equal(handleKnowledgeChainRequest('/knowledge-chain/epoch', 'POST'), 'epoch');
  assert.equal(handleKnowledgeChainRequest('/knowledge-chain/announce', 'POST'), 'announce');
  assert.equal(handleKnowledgeChainRequest('/knowledge/file', 'POST'), null);
  assert.deepEqual(await processKnowledgeChainBody('file', null, { path: 'memory/notes.md' }), { content: 'from a peer\n' });
  for (const path of ['C:/Windows/win.ini', join(synced, 'memory', 'notes.md'), '../x', 'memory/.env']) {
    assert.deepEqual(await processKnowledgeChainBody('file', null, { path }), { error: 'File not found' }, path);
  }
  assert.deepEqual(await processKnowledgeChainBody('file', null, {}), { error: 'Missing path parameter' });
  const files = await processKnowledgeChainBody('files');
  assert.ok(files.some(f => f.path === 'memory/notes.md') && files.every(f => !('file' in f)));
});

test('K6 index.js serves every knowledge route through one peer-gated helper, and every peer request is signed', () => {
  const idx = src('index.js');
  const helper = idx.slice(idx.indexOf('async function serveKnowledgeChainRoute(req, res, healthPort) {'), idx.indexOf("const HEARTBEAT_FILE = "));
  assert.ok(helper.length > 0, 'the helper exists');
  assert.ok(helper.indexOf('peerGate(req, payload, config.shard?.secret)') > -1 && helper.indexOf('peerGate(') < helper.indexOf('processKnowledgeChainBody('), 'the gate runs before the handler');
  assert.match(helper, /if \(denied\) \{ json\(denied\.status, \{ error: denied\.error \}\); return true; \}/);
  assert.equal((idx.match(/processKnowledgeChainBody\(/g) || []).length, 1, 'no knowledge route bypasses the helper');
  assert.equal((idx.match(/await serveKnowledgeChainRoute\(req, res, healthPort\)/g) || []).length, 2, 'both servers, primary and worker, use it');
  const kc = src('knowledge-chain.js');
  assert.equal((kc.match(/\bfetch\(/g) || []).length, 1, 'the one fetch is inside peerFetch');
  assert.match(kc, /function peerFetch\(peer, path, [\s\S]*?\.\.\.peerHeaders\(message, config\.shard\?\.secret\)/);
  assert.ok((kc.match(/await peerFetch\(/g) || []).length >= 7, 'announce, head, chain, epoch (broadcast and retry), fork chain, bootstrap files and file');
  assert.match(kc, /await applyFileSyncChanges\(epoch\.fileSyncData\);/); // a received epoch goes through the contained writer
  assert.match(src('memory.js'), /await syncFileChange\(filePath, content\);/);
});
