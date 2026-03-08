#!/usr/bin/env node
// ============ End-to-End Mesh Verification ============
// Tests all 3 cells of the Mind Network are interlinked.
// Run: node scripts/mesh-test.js

const JARVIS_URL = process.env.JARVIS_URL || 'https://jarvis-vibeswap.fly.dev';
const VERCEL_URL = process.env.VERCEL_URL || 'https://frontend-jade-five-87.vercel.app';
const GITHUB_REPO = 'wglynn/vibeswap';

const results = { pass: 0, fail: 0, tests: [] };

function test(name, passed, detail) {
  results.tests.push({ name, passed, detail });
  if (passed) results.pass++;
  else results.fail++;
  console.log(`  ${passed ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function run() {
  console.log('CELLS WITHIN CELLS INTERLINKED — Mesh Verification\n');

  // Cell 1: JARVIS (Fly.io)
  console.log('[1] JARVIS (Fly.io)');
  try {
    const healthRes = await fetch(`${JARVIS_URL}/web/health`, { signal: AbortSignal.timeout(10000) });
    const health = await healthRes.json();
    test('Health endpoint', healthRes.ok, `status=${health.status}, uptime=${health.uptime}s`);
    test('Bot online', health.status === 'online', health.status);
  } catch (err) {
    test('Health endpoint', false, err.message);
    test('Bot online', false, 'unreachable');
  }

  try {
    const meshRes = await fetch(`${JARVIS_URL}/web/mesh`, { signal: AbortSignal.timeout(10000) });
    const mesh = await meshRes.json();
    test('Mesh endpoint', meshRes.ok, `status=${mesh.status}`);
    test('Mesh has 3 cells', mesh.cells?.length === 3, `found ${mesh.cells?.length || 0}`);
    test('Mesh has links', mesh.links?.length > 0, `${mesh.links?.length || 0} links`);
    test('Fly cell interlinked', mesh.cells?.find(c => c.id === 'fly-jarvis')?.status === 'interlinked');
  } catch (err) {
    test('Mesh endpoint', false, err.message);
  }

  try {
    const mindRes = await fetch(`${JARVIS_URL}/web/mind`, { signal: AbortSignal.timeout(10000) });
    const mind = await mindRes.json();
    test('Mind endpoint', mindRes.ok);
    test('Knowledge chain', mind.knowledgeChain?.height > 0, `height=${mind.knowledgeChain?.height}`);
  } catch (err) {
    test('Mind endpoint', false, err.message);
  }

  // Cell 2: GitHub
  console.log('\n[2] GitHub');
  try {
    const ghRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/commits?per_page=1`, {
      headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'mesh-test' },
      signal: AbortSignal.timeout(10000),
    });
    const [commit] = await ghRes.json();
    const age = Date.now() - new Date(commit.commit.committer.date).getTime();
    test('GitHub API', ghRes.ok);
    test('Recent commit', age < 7 * 86400000, `${commit.sha.slice(0, 7)} — ${Math.round(age / 3600000)}h ago`);
    test('Commit message', !!commit.commit.message, commit.commit.message.split('\n')[0].slice(0, 60));
  } catch (err) {
    test('GitHub API', false, err.message);
  }

  // Cell 3: Vercel (Frontend)
  console.log('\n[3] Vercel (Frontend)');
  try {
    const vRes = await fetch(VERCEL_URL, { signal: AbortSignal.timeout(10000) });
    test('Vercel responds', vRes.ok, `status=${vRes.status}`);
    const html = await vRes.text();
    test('Has root div', html.includes('id="root"'));
    test('Has manifest', html.includes('manifest.json'));
    test('Has service worker', html.includes('sw.js') || html.includes('serviceWorker'));
  } catch (err) {
    test('Vercel responds', false, err.message);
  }

  // Summary
  console.log(`\n${'='.repeat(50)}`);
  console.log(`MESH STATUS: ${results.fail === 0 ? 'FULLY INTERLINKED' : 'DEGRADED'}`);
  console.log(`Tests: ${results.pass} passed, ${results.fail} failed, ${results.pass + results.fail} total`);
  process.exit(results.fail > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Mesh test crashed:', err.message);
  process.exit(1);
});
