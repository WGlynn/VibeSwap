// Tests for src/peer-auth.js (2026-11-04): the shard secret on every peer route. POST /shard/update
// and POST /shard/learn took requests from anyone who could reach port 8080: a forged Telegram
// update carrying the owner's id, or a token_alert sent to any chat. The HMAC-SHA256 scheme
// consensus.js already used for inter-shard calls is now one shared module, with a route gate that
// fails closed: no secret configured is 503, a missing or wrong signature is 401. Every secret here
// is a fake.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import {
  SIGNATURE_HEADER, canonicalJSON, signPeerMessage, verifyPeerSignature, peerMessageOf, peerHeaders, peerGate,
} from '../src/peer-auth.js';

// Source files carry CRLF or LF depending on the editor that last touched them; the assertions see LF.
const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf-8').replace(/\r\n/g, '\n');
const SECRET = 'fake-shard-secret-0001';
const OWNER = 8366932263;
const update = { update_id: 7, message: { message_id: 1, from: { id: OWNER }, chat: { id: -1001 }, text: '/commit all' } };

// A request the way Node hands it to the server: header names lowercased.
const request = (method, url, signature) => ({ method, url, headers: signature === undefined ? {} : { [SIGNATURE_HEADER]: signature } });
const signed = (method, url, body, secret = SECRET) => request(method, url, signPeerMessage(peerMessageOf(method, url, body), secret));

test('P1 canonical JSON: key order does not matter, undefined values drop, nesting is sorted', () => {
  const a = { b: 1, a: { d: [1, { z: 1, y: 2 }], c: 'x' }, u: undefined };
  const b = { a: { c: 'x', d: [1, { y: 2, z: 1 }] }, b: 1 };
  assert.equal(canonicalJSON(a), '{"a":{"c":"x","d":[1,{"y":2,"z":1}]},"b":1}');
  assert.equal(canonicalJSON(a), canonicalJSON(b));
  assert.equal(signPeerMessage(a, SECRET), signPeerMessage(b, SECRET));
  assert.equal(canonicalJSON(undefined), 'null');
  assert.equal(canonicalJSON(null), 'null');
  assert.equal(canonicalJSON([3, 'x']), '[3,"x"]');
  // What the sender signs is what the receiver parses: a JSON round trip of the same object agrees.
  assert.equal(signPeerMessage(JSON.parse(JSON.stringify(update)), SECRET), signPeerMessage(update, SECRET));
});

test('P2 no secret: nothing signs, nothing verifies, and the gate answers 503 before looking at a signature', () => {
  for (const none of [null, undefined, '']) {
    assert.equal(signPeerMessage(update, none), null);
    assert.deepEqual(peerHeaders(update, none), {});
    assert.equal(verifyPeerSignature(update, signPeerMessage(update, SECRET), none), false);
    const req = request('POST', '/shard/update', signPeerMessage(update, SECRET));
    assert.deepEqual(peerGate(req, update, none), { status: 503, error: 'Peer routes are disabled: no shard secret is configured' });
  }
});

test('P3 a missing, malformed, wrong or stale signature is 401; the right one passes', () => {
  const sig = signPeerMessage(update, SECRET);
  assert.match(sig, /^[0-9a-f]{64}$/);
  const denied = { status: 401, error: 'Authentication failed' };
  for (const bad of [undefined, '', 'nope', sig.slice(0, 63), sig + '0', sig.replace(/[0-9a-f]$/, c => (c === '0' ? '1' : '0')),
    signPeerMessage(update, 'another-fake-secret'), signPeerMessage({ ...update, update_id: 8 }, SECRET)]) {
    assert.deepEqual(peerGate(request('POST', '/shard/update', bad), update, SECRET), denied, String(bad));
  }
  assert.equal(peerGate(request('POST', '/shard/update', sig), update, SECRET), null);
  // A body tampered with after signing fails: the forged owner id is not fed to Telegraf.
  const forged = { ...update, message: { ...update.message, from: { id: OWNER } , text: '/gitcommit' } };
  assert.deepEqual(peerGate(request('POST', '/shard/update', sig), forged, SECRET), denied);
  // The header value is what peerHeaders sends.
  assert.deepEqual(peerHeaders(update, SECRET), { 'X-Shard-Signature': sig });
  // verifyPeerSignature never throws on odd input.
  for (const odd of [42, {}, [], null, 'zz'.repeat(32)]) assert.equal(verifyPeerSignature(update, odd, SECRET), false, String(odd));
});

test('P4 a GET signs its request target, path and query, and a signature is not valid across targets or methods', () => {
  assert.deepEqual(peerMessageOf('GET', '/knowledge/file?path=memory%2FMEMORY.md'), { get: '/knowledge/file?path=memory%2FMEMORY.md' });
  assert.deepEqual(peerMessageOf('POST', '/knowledge-chain/epoch', { height: 1 }), { height: 1 });
  assert.equal(peerGate(signed('GET', '/knowledge/files'), null, SECRET), null);
  assert.equal(peerGate(signed('GET', '/knowledge-chain/chain?since=0'), null, SECRET), null);
  const files = signed('GET', '/knowledge/files');
  assert.equal(peerGate({ ...files, url: '/knowledge/file?path=x' }, null, SECRET)?.status, 401); // another target
  assert.equal(peerGate({ ...files, url: '/knowledge/files?x=1' }, null, SECRET)?.status, 401); // the query counts
  assert.equal(peerGate({ ...files, method: 'POST' }, { get: '/knowledge/files' }, SECRET), null); // same message, by construction
  // A POST body signed as a body does not pass as a GET of a path, and the other way round.
  const epoch = signed('POST', '/knowledge-chain/epoch', { height: 1 });
  assert.equal(peerGate({ ...epoch, method: 'GET' }, null, SECRET)?.status, 401);
  assert.equal(peerGate({ ...signed('GET', '/knowledge-chain/head'), method: 'POST' }, { height: 1 }, SECRET)?.status, 401);
});

test('P5 index.js gates /shard/update and /shard/learn on the parsed body before acting; the router signs both', () => {
  const idx = src('index.js');
  assert.match(idx, /import \{ peerGate \} from '\.\/peer-auth\.js';/);
  const update = idx.slice(idx.indexOf("req.url === '/shard/update' && req.method === 'POST'"), idx.indexOf("req.url === '/shard/learn' && req.method === 'POST'"));
  assert.match(update, /const update = JSON\.parse\(body\);\n\s+const denied = peerGate\(req, update, config\.shard\?\.secret\);\n\s+if \(denied\) \{/);
  assert.ok(update.indexOf('peerGate(') < update.indexOf('await bot.handleUpdate(update)'), 'the gate runs before Telegraf sees the update');
  assert.match(update, /res\.writeHead\(denied\.status/);
  const learn = idx.slice(idx.indexOf("req.url === '/shard/learn' && req.method === 'POST'"), idx.indexOf("case 'token_alert':"));
  assert.match(learn, /const learned = JSON\.parse\(body\);\n\s+const denied = peerGate\(req, learned, config\.shard\?\.secret\);\n\s+if \(denied\) \{/);
  assert.ok(learn.indexOf('peerGate(') < learn.indexOf('switch (type)'), 'the gate runs before the learning switch');
  // The router: both dispatches carry the signature over the exact object it serializes.
  const router = src('shard-router.js');
  assert.match(router, /import \{ peerHeaders \} from '\.\/peer-auth\.js';/);
  assert.match(router, /headers: \{ 'Content-Type': 'application\/json', \.\.\.peerHeaders\(update, PEER_SECRET\) \},\n\s+body: JSON\.stringify\(update\),/);
  assert.match(router, /const message = \{ type, data, fromShard: excludeShard \|\| 'router' \};[\s\S]*?\.\.\.peerHeaders\(message, PEER_SECRET\) \},\n\s+body: JSON\.stringify\(message\),/);
  // One scheme: consensus.js signs and verifies through the shared module, nothing of its own.
  const consensus = src('consensus.js');
  assert.match(consensus, /import \{ canonicalJSON, signPeerMessage, verifyPeerSignature \} from '\.\/peer-auth\.js';/);
  assert.doesNotMatch(consensus, /createHmac/);
});
