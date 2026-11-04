// ============ URL guard: one SSRF check for every URL outside input can make the bot fetch ============
// web_check (task-queue.js) fetched any URL, localhost included, so a deferred task could read
// http://127.0.0.1:8080/knowledge/file?path=... from chat while that route was open. The web reader
// (links in chat messages), the Limni terminal probes (URLs the model registers), scrape_page and
// fetch_repo take URLs from outside too. All of them come through here:
// - http and https only, no credentials in the URL;
// - the host is not localhost, a .localhost, .local, .internal or .arpa name, or the metadata name;
// - the host is resolved, and EVERY address it resolves to must be public: not loopback, private
//   (10/8, 172.16/12, 192.168/16), carrier NAT (100.64/10), link-local (169.254/16 with the cloud
//   metadata address, fe80::/10), unique local (fc00::/7), unspecified (0.0.0.0, ::), multicast,
//   reserved, documentation, NAT64 or 6to4. An IPv4-mapped IPv6 address is judged as its IPv4.
// - safeFetch connects to the address it checked (pinned, so an answer that changes between the
//   check and the connect does not get in), follows redirects itself and re-checks every hop, and
//   stops reading at a byte cap.
// Pure apart from DNS and the socket: the resolver and the transport can be passed in.

import { BlockList, isIP } from 'net';
import { lookup as dnsLookup } from 'dns/promises';
import http from 'http';
import https from 'https';

const USER_AGENT = 'JarvisBot/1.0 (VibeSwap; +https://vibeswap.io)';
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

const NOT_PUBLIC = new BlockList();
for (const [net, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) NOT_PUBLIC.addSubnet(net, bits, 'ipv4');
for (const [net, bits] of [
  ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['100::', 64], ['2001:db8::', 32], ['2002::', 16],
  ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
]) NOT_PUBLIC.addSubnet(net, bits, 'ipv6');

const DENIED_HOST = /^(localhost|.+\.localhost|.+\.local|.+\.internal|.+\.arpa|metadata\.google\.internal)$/i;

const refusal = (why) => Object.assign(new Error(`Refused: ${why}`), { refused: true });

// A literal address that may be fetched. An IPv4-mapped IPv6 address (::ffff:127.0.0.1, written
// either way) is judged as the IPv4 inside it.
export function isPublicAddress(address) {
  const family = isIP(address);
  if (!family) return false;
  if (family === 6) {
    const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (dotted) return isPublicAddress(dotted[1]);
    const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(address);
    if (hex) {
      const [hi, lo] = [parseInt(hex[1], 16), parseInt(hex[2], 16)];
      return isPublicAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
  }
  return !NOT_PUBLIC.check(address, family === 6 ? 'ipv6' : 'ipv4');
}

// The host of a parsed URL: brackets off an IPv6 literal, a trailing dot off a name.
const hostOf = (url) => url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();

// The synchronous part: a well-formed http(s) URL whose host is not a denied name or a non-public
// literal. (The WHATWG parser already turns 2130706433, 0x7f000001 and 127.1 into 127.0.0.1.)
export function parseHttpUrl(input) {
  let url;
  try { url = new URL(String(input ?? '')); } catch { throw refusal('not a valid URL'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw refusal('only http and https URLs are fetched');
  if (url.username || url.password) throw refusal('a URL carrying credentials is not fetched');
  const host = hostOf(url);
  if (!host || DENIED_HOST.test(host)) throw refusal(`${host || 'an empty host'} is not a public host`);
  if (isIP(host) && !isPublicAddress(host)) throw refusal(`${host} is not a public address`);
  return url;
}

// The full check: the URL parses, and every address its host resolves to is public. Returns the
// URL and the address to connect to. The resolver can be passed in (tests).
export async function checkUrl(input, { lookup = (host) => dnsLookup(host, { all: true }) } = {}) {
  const url = parseHttpUrl(input);
  const host = hostOf(url);
  let addresses;
  if (isIP(host)) {
    addresses = [{ address: host, family: isIP(host) }];
  } else {
    try { addresses = await lookup(host); } catch (err) { throw refusal(`${host} does not resolve (${err.code || err.message})`); }
    if (!Array.isArray(addresses) || addresses.length === 0) throw refusal(`${host} does not resolve`);
  }
  const bad = addresses.find(a => !isPublicAddress(a.address));
  if (bad) throw refusal(`${host} resolves to ${bad.address}, which is not a public address`);
  return { url, address: addresses[0].address, family: addresses[0].family || isIP(addresses[0].address) };
}

// One HTTP request to one checked address, redirects not followed, the body capped at maxBytes
// (the rest is not read; truncated says so). With a contentType pattern, a body of another type is
// not read at all (skipped). The connection goes to `address`; the URL's host still names the
// server (Host header and TLS name), so the certificate is checked against it.
export function httpRequest(url, { address, family, method = 'GET', headers = {}, body, timeoutMs = 10000, maxBytes = 512 * 1024, contentType } = {}) {
  return new Promise((resolve, reject) => {
    const lookup = (host, options, cb) => (options?.all ? cb(null, [{ address, family }]) : cb(null, address, family));
    let done = false;
    const finish = (err, value) => { if (done) return; done = true; clearTimeout(deadline); err ? reject(err) : resolve(value); };
    const req = (url.protocol === 'https:' ? https : http).request(url, {
      method, lookup, headers: { 'User-Agent': USER_AGENT, ...headers },
    }, (res) => {
      const status = res.statusCode;
      const base = { status, statusText: res.statusMessage || '', headers: res.headers, truncated: false, skipped: false };
      if (REDIRECTS.has(status) || (contentType && !contentType.test(String(res.headers['content-type'] || '')))) {
        res.resume();
        return finish(null, { ...base, body: '', skipped: !REDIRECTS.has(status) });
      }
      const chunks = [];
      let size = 0;
      let truncated = false;
      res.on('data', (chunk) => {
        if (truncated) return;
        if (size + chunk.length > maxBytes) {
          chunks.push(chunk.subarray(0, maxBytes - size));
          truncated = true;
          res.destroy();
          return finish(null, { ...base, body: Buffer.concat(chunks).toString('utf-8'), truncated });
        }
        chunks.push(chunk);
        size += chunk.length;
      });
      res.on('end', () => finish(null, { ...base, body: Buffer.concat(chunks).toString('utf-8') }));
      res.on('error', (err) => finish(err));
    });
    const deadline = setTimeout(() => req.destroy(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs);
    req.on('error', (err) => finish(err));
    if (body !== undefined) req.write(body);
    req.end();
  });
}

// The guarded fetch: check, connect to the checked address, follow at most maxRedirects redirects
// with the same check on every hop (a 303, or a 301/302 after a POST, turns into a GET), cap the
// body. Throws a 'Refused: ...' error for anything the guard rejects.
export async function safeFetch(input, options = {}) {
  const { lookup, transport = httpRequest, maxRedirects = 3 } = options;
  let { method = 'GET', body } = options;
  let current = input;
  for (let hop = 0; ; hop++) {
    const { url, address, family } = await checkUrl(current, lookup ? { lookup } : {});
    const res = await transport(url, { ...options, method, body, address, family });
    if (!REDIRECTS.has(res.status) || !res.headers?.location) return { ...res, url: url.href };
    if (hop >= maxRedirects) throw refusal(`more than ${maxRedirects} redirects from ${url.href}`);
    let next;
    try { next = new URL(res.headers.location, url).href; } catch { throw refusal(`a bad redirect location from ${url.href}`); }
    if (res.status === 303 || (method !== 'GET' && (res.status === 301 || res.status === 302))) { method = 'GET'; body = undefined; }
    current = next;
  }
}
