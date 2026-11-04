// Tests for src/url-guard.js (2026-11-04): one SSRF check for every URL that outside input can make
// the bot fetch. web_check (task-queue.js) fetched any URL, localhost included, so a deferred task
// could read the bot's own port from chat; the web reader's host-name check let a public name that
// resolves to 127.0.0.1 through. No test here touches the network: DNS and the transport are faked,
// and the real transport is exercised against a server on 127.0.0.1 with the address pinned.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { createServer } from 'http';
import { isPublicAddress, parseHttpUrl, checkUrl, safeFetch, httpRequest } from '../src/url-guard.js';
import { createTask } from '../src/task-queue.js';

// Source files carry CRLF or LF depending on the editor that last touched them; the assertions see LF.
const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf-8').replace(/\r\n/g, '\n');
const refusal = (why) => ({ refused: true, message: `Refused: ${why}` });
const rejects = (promise, why) => assert.rejects(promise, refusal(why));

test('U1 the address table: loopback, private, link-local, carrier NAT, multicast, reserved and the IPv6 forms are not public', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '140.82.112.3', '203.0.112.1', '2606:4700::1111', '2a00:1450:4001::1']) {
    assert.equal(isPublicAddress(ip), true, ip);
  }
  for (const ip of ['127.0.0.1', '127.1.2.3', '10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
    '100.64.0.1', '100.127.255.255', '0.0.0.0', '0.1.2.3', '224.0.0.1', '240.0.0.1', '255.255.255.255', '192.0.0.1', '192.0.2.1',
    '198.18.0.1', '198.51.100.1', '203.0.113.1', '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', '2001:db8::1',
    '2002:7f00:1::1', '64:ff9b::7f00:1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.1.1.1', '::ffff:a01:101', 'nope', '']) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
  assert.equal(isPublicAddress('::ffff:8.8.8.8'), true);
});

test('U2 parseHttpUrl: http(s) only, no credentials, no local names, no non-public literals, in any spelling', () => {
  const cases = [
    ['ftp://example.com/x', 'only http and https URLs are fetched'],
    ['file:///etc/passwd', 'only http and https URLs are fetched'],
    ['javascript:alert(1)', 'only http and https URLs are fetched'],
    ['http://user:pw@example.com/', 'a URL carrying credentials is not fetched'],
    ['http://localhost:8080/knowledge/file?path=x', 'localhost is not a public host'],
    ['http://LOCALHOST/', 'localhost is not a public host'],
    ['http://bot.localhost/', 'bot.localhost is not a public host'],
    ['http://printer.local/', 'printer.local is not a public host'],
    ['http://db.internal/', 'db.internal is not a public host'],
    ['http://metadata.google.internal/computeMetadata/v1/', 'metadata.google.internal is not a public host'],
    ['http://1.0.0.127.in-addr.arpa/', '1.0.0.127.in-addr.arpa is not a public host'],
    ['http://127.0.0.1:8080/', '127.0.0.1 is not a public address'],
    ['http://127.1/', '127.0.0.1 is not a public address'],
    ['http://0x7f000001/', '127.0.0.1 is not a public address'],
    ['http://2130706433/', '127.0.0.1 is not a public address'],
    ['http://0177.0.0.1/', '127.0.0.1 is not a public address'],
    ['http://[::1]:8080/', '::1 is not a public address'],
    ['http://[::ffff:127.0.0.1]/', '::ffff:7f00:1 is not a public address'], // the URL parser's spelling of the mapped address
    ['http://[fe80::1]/', 'fe80::1 is not a public address'],
    ['http://169.254.169.254/latest/meta-data/', '169.254.169.254 is not a public address'],
    ['http://10.0.0.5/', '10.0.0.5 is not a public address'],
    ['http://192.168.0.1/', '192.168.0.1 is not a public address'],
    ['http://0.0.0.0:8080/', '0.0.0.0 is not a public address'],
    ['not a url', 'not a valid URL'],
    ['', 'not a valid URL'],
    [undefined, 'not a valid URL'],
  ];
  for (const [input, why] of cases) assert.throws(() => parseHttpUrl(input), refusal(why), String(input));
  // Names that need DNS pass this step; the resolved address is checked by checkUrl.
  assert.equal(parseHttpUrl('https://example.com/a?b=1').href, 'https://example.com/a?b=1');
  assert.equal(parseHttpUrl('http://8.8.8.8/x').hostname, '8.8.8.8');
  assert.equal(parseHttpUrl('https://Example.COM./').hostname, 'example.com.');
});

test('U3 checkUrl: every resolved address must be public; a literal is never looked up', async () => {
  const resolving = (table) => {
    const calls = [];
    const lookup = async (host) => { calls.push(host); if (!(host in table)) throw Object.assign(new Error('x'), { code: 'ENOTFOUND' }); return table[host]; };
    return { lookup, calls };
  };
  const dns = resolving({
    'public.example': [{ address: '93.184.216.34', family: 4 }],
    'rebind.example': [{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }],
    'inside.example': [{ address: '10.0.0.7', family: 4 }],
    'six.example': [{ address: '::1', family: 6 }],
    'empty.example': [],
  });
  const ok = await checkUrl('https://public.example/path', dns);
  assert.deepEqual([ok.url.href, ok.address, ok.family], ['https://public.example/path', '93.184.216.34', 4]);
  await rejects(checkUrl('https://rebind.example/', dns), 'rebind.example resolves to 127.0.0.1, which is not a public address');
  await rejects(checkUrl('https://inside.example/', dns), 'inside.example resolves to 10.0.0.7, which is not a public address');
  await rejects(checkUrl('https://six.example/', dns), 'six.example resolves to ::1, which is not a public address');
  await rejects(checkUrl('https://empty.example/', dns), 'empty.example does not resolve');
  await rejects(checkUrl('https://gone.example/', dns), 'gone.example does not resolve (ENOTFOUND)');
  await rejects(checkUrl('http://127.0.0.1/', dns), '127.0.0.1 is not a public address');
  const literal = await checkUrl('http://8.8.8.8/', dns);
  assert.equal(literal.address, '8.8.8.8');
  assert.deepEqual(dns.calls, ['public.example', 'rebind.example', 'inside.example', 'six.example', 'empty.example', 'gone.example']);
});

test('U4 safeFetch: every redirect hop is checked again, the hop count is capped, and a 303 turns a POST into a GET', async () => {
  const lookup = async (host) => ({
    'a.example': [{ address: '93.184.216.34', family: 4 }],
    'b.example': [{ address: '93.184.216.35', family: 4 }],
  })[host] || [{ address: '127.0.0.1', family: 4 }];
  const seen = [];
  const transport = async (url, opts) => {
    seen.push({ href: url.href, address: opts.address, method: opts.method, body: opts.body });
    const routes = {
      'https://a.example/to-local': { status: 302, headers: { location: 'http://127.0.0.1:8080/health' } },
      'https://a.example/to-name': { status: 302, headers: { location: 'http://internal.example/' } },
      'https://a.example/loop': { status: 301, headers: { location: 'https://a.example/loop' } },
      'https://a.example/post': { status: 303, headers: { location: 'https://b.example/landed' } },
      'https://a.example/bad': { status: 302, headers: { location: 'http://[bad' } },
      'https://a.example/nowhere': { status: 302, headers: {} },
      'https://b.example/landed': { status: 200, headers: {}, body: 'landed' },
      'https://a.example/page': { status: 200, headers: { 'content-type': 'text/html' }, body: '<p>hi</p>' },
    };
    return { statusText: '', body: '', truncated: false, skipped: false, ...routes[url.href] };
  };
  const opts = { lookup, transport };
  const page = await safeFetch('https://a.example/page', opts);
  assert.deepEqual([page.status, page.body, page.url], [200, '<p>hi</p>', 'https://a.example/page']);
  await rejects(safeFetch('https://a.example/to-local', opts), '127.0.0.1 is not a public address');
  await rejects(safeFetch('https://a.example/to-name', opts), 'internal.example resolves to 127.0.0.1, which is not a public address');
  await rejects(safeFetch('https://a.example/loop', opts), 'more than 3 redirects from https://a.example/loop');
  await rejects(safeFetch('https://a.example/loop', { ...opts, maxRedirects: 0 }), 'more than 0 redirects from https://a.example/loop');
  await rejects(safeFetch('https://a.example/bad', opts), 'a bad redirect location from https://a.example/bad');
  const nowhere = await safeFetch('https://a.example/nowhere', opts); // a redirect with no location is returned as it is
  assert.equal(nowhere.status, 302);
  seen.length = 0;
  const landed = await safeFetch('https://a.example/post', { ...opts, method: 'POST', body: '{"x":1}' });
  assert.equal(landed.body, 'landed');
  assert.deepEqual(seen.map(s => [s.href, s.address, s.method, s.body]), [
    ['https://a.example/post', '93.184.216.34', 'POST', '{"x":1}'],
    ['https://b.example/landed', '93.184.216.35', 'GET', undefined],
  ]);
  await rejects(safeFetch('http://localhost/', opts), 'localhost is not a public host'); // refused before any transport
});

test('U5 httpRequest connects to the pinned address, caps the body, skips a wrong content type and does not follow a redirect', async () => {
  const server = createServer((req, res) => {
    if (req.url === '/big') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('x'.repeat(10000)); }
    else if (req.url === '/json') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"a":1}'); }
    else if (req.url === '/redirect') { res.writeHead(302, { location: 'http://127.0.0.1/' }); res.end('moved'); }
    else { res.writeHead(200, { 'content-type': 'text/plain' }); res.end(`host=${req.headers.host} ua=${req.headers['user-agent']} m=${req.method}`); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  after(() => server.close());
  const port = server.address().port;
  const at = (path, opts = {}) => httpRequest(new URL(`http://pinned.example:${port}${path}`), { address: '127.0.0.1', family: 4, timeoutMs: 5000, ...opts });
  const plain = await at('/plain');
  assert.deepEqual([plain.status, plain.body, plain.truncated, plain.skipped], [200, `host=pinned.example:${port} ua=JarvisBot/1.0 (VibeSwap; +https://vibeswap.io) m=GET`, false, false]);
  const big = await at('/big', { maxBytes: 1000 });
  assert.deepEqual([big.status, big.body.length, big.truncated], [200, 1000, true]);
  const skipped = await at('/json', { contentType: /text\/html/ });
  assert.deepEqual([skipped.status, skipped.body, skipped.skipped], [200, '', true]);
  const html = await at('/big', { contentType: /text\/html/, maxBytes: 20000 });
  assert.deepEqual([html.body.length, html.skipped], [10000, false]);
  const redirect = await at('/redirect');
  assert.deepEqual([redirect.status, redirect.headers.location, redirect.body], [302, 'http://127.0.0.1/', '']);
  const posted = await at('/plain', { method: 'POST', body: '{}' , headers: { 'Content-Type': 'application/json' } });
  assert.match(posted.body, /m=POST$/);
});

test('U6 a web_check task to a local or non-http URL is refused at creation, before it is queued', () => {
  for (const [url, why] of [
    ['http://localhost:8080/health', 'localhost is not a public host'],
    ['http://127.0.0.1:8080/knowledge/file?path=C:/Users/x/.env', '127.0.0.1 is not a public address'],
    ['http://169.254.169.254/latest/meta-data/', '169.254.169.254 is not a public address'],
    ['file:///C:/Users/x/.env', 'only http and https URLs are fetched'],
    [undefined, 'not a valid URL'],
  ]) {
    assert.deepEqual(createTask({ type: 'web_check', url, description: 'check it', chatId: '1', requestedBy: 'stranger' }),
      { error: `Refused: ${why}` }, String(url));
  }
});

test('U7 the fetchers of outside URLs go through the guard: web_check and the web reader', () => {
  const tq = src('task-queue.js');
  assert.match(tq, /import \{ safeFetch, parseHttpUrl \} from '\.\/url-guard\.js';/);
  const webCheck = tq.slice(tq.indexOf('web_check: async (task) =>'), tq.indexOf('price_check: async'));
  assert.match(webCheck, /await safeFetch\(task\.url, \{ timeoutMs: 10_000, maxBytes: 256 \* 1024 \}\)/);
  assert.doesNotMatch(webCheck, /\bfetch\(/);
  assert.match(tq, /if \(type === 'web_check'\) \{\n\s+try \{ parseHttpUrl\(url\); \} catch \(err\) \{ return \{ error: err\.message \}; \}/);
  const reader = src('web-reader.js');
  assert.match(reader, /import \{ safeFetch \} from '\.\/url-guard\.js';/);
  assert.match(reader, /const response = await safeFetch\(url, \{\n\s+timeoutMs: FETCH_TIMEOUT_MS,\n\s+maxBytes: MAX_RESPONSE_BYTES,\n\s+maxRedirects: 3,\n\s+contentType: HTML_TYPES,/);
  assert.doesNotMatch(reader, /\bfetch\(/);
  assert.doesNotMatch(reader, /BLOCKED_HOSTS|isBlockedUrl/); // the old host-name denylist is gone, not duplicated
});
