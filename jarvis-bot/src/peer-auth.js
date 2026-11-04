// ============ Peer auth: the shard secret on every peer route (2026-11-04) ============
// POST /shard/update, POST /shard/learn and the knowledge-chain routes took requests from anyone
// who could reach port 8080: a stranger could feed the bot a forged Telegram update (the owner's
// id included), read any file on disk through GET /knowledge/file?path=, or write any path through
// an epoch's file sync. The mesh already had one authentication, in consensus.js: each inter-shard
// POST is signed with HMAC-SHA256 over the canonical JSON of its body, keyed by SHARD_SECRET, in the
// X-Shard-Signature header. This module is that scheme, shared, plus a route gate that fails
// closed: no secret configured means 503, a missing or wrong signature means 401. A GET has no body,
// so it signs its request target (path and query) instead.
// Pure: the secret is passed in. Known limit: a signature has no timestamp or nonce, so a captured
// request could be replayed within what the route itself tolerates (consensus.js tracks proposal ids).

import { createHmac, timingSafeEqual } from 'crypto';

export const SIGNATURE_HEADER = 'x-shard-signature';

// JSON.stringify key order is not stable across engines, so keys are sorted, recursively. The value
// is first put through a JSON round trip, so what the sender signs is what the receiver parses:
// undefined-valued keys drop, a Date becomes its string, NaN becomes null.
export function canonicalJSON(value) {
  const json = JSON.stringify(value);
  return json === undefined ? 'null' : sortKeys(JSON.parse(json));
}

function sortKeys(v) {
  if (Array.isArray(v)) return '[' + v.map(sortKeys).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + sortKeys(v[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}

export function signPeerMessage(message, secret) {
  if (!secret) return null;
  return createHmac('sha256', String(secret)).update(canonicalJSON(message)).digest('hex');
}

// False without a secret (nothing verifies), on a missing or malformed signature, or on a mismatch.
export function verifyPeerSignature(message, signature, secret) {
  if (!secret || typeof signature !== 'string' || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(signPeerMessage(message, secret), 'hex'));
}

// What a request signs: the parsed JSON body of a POST, or { get: '<path?query>' } for a GET.
export function peerMessageOf(method, target, body) {
  return method === 'GET' ? { get: String(target ?? '') } : body;
}

// The headers of a signed request to a peer. Without a secret there is no header: the peer
// refuses the request, and that is the point.
export function peerHeaders(message, secret) {
  const signature = signPeerMessage(message, secret);
  return signature ? { 'X-Shard-Signature': signature } : {};
}

// The gate on a peer route. body is the parsed JSON of a POST (null for a GET). Returns null when
// the request is an authenticated peer, otherwise { status, error } to send back.
export function peerGate(req, body, secret) {
  if (!secret) return { status: 503, error: 'Peer routes are disabled: no shard secret is configured' };
  const message = peerMessageOf(req.method, req.url, body);
  if (!verifyPeerSignature(message, req.headers?.[SIGNATURE_HEADER], secret)) return { status: 401, error: 'Authentication failed' };
  return null;
}
