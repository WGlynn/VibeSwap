#!/usr/bin/env node
/**
 * Post-deployment verification script
 * Tests all critical routes and assets after Vercel deploy
 * Run: node scripts/verify-deployment.js [url]
 */

const PRODUCTION_URL = 'https://frontend-jade-five-87.vercel.app';

const CRITICAL_ROUTES = [
  '/',
  '/swap',
  '/pool',
  '/bridge',
  '/rewards',
  '/docs',
  '/about',
  '/activity',
];

const CRITICAL_ASSETS = [
  '/vibe-icon.svg',
];

async function checkRoute(baseUrl, route) {
  try {
    const response = await fetch(`${baseUrl}${route}`, { method: 'HEAD' });
    const status = response.status;
    const ok = status === 200;
    console.log(`  ${ok ? '✓' : '✗'} ${route} → ${status}`);
    return ok;
  } catch (err) {
    console.log(`  ✗ ${route} → ERROR: ${err.message}`);
    return false;
  }
}

async function checkAsset(baseUrl, asset) {
  try {
    const response = await fetch(`${baseUrl}${asset}`, { method: 'HEAD' });
    const status = response.status;
    const contentType = response.headers.get('content-type') || '';
    const ok = status === 200;
    console.log(`  ${ok ? '✓' : '✗'} ${asset} → ${status} (${contentType.split(';')[0]})`);
    return ok;
  } catch (err) {
    console.log(`  ✗ ${asset} → ERROR: ${err.message}`);
    return false;
  }
}

async function checkBuildVersion(baseUrl) {
  try {
    const response = await fetch(baseUrl);
    const html = await response.text();
    const match = html.match(/<!-- Build: (v\d+) -->/);
    if (match) {
      const version = match[1];
      const timestamp = parseInt(version.slice(1));
      const date = new Date(timestamp);
      const age = Date.now() - timestamp;
      const ageMinutes = Math.floor(age / 60000);
      console.log(`  ✓ Build version: ${version}`);
      console.log(`    Built: ${date.toISOString()} (${ageMinutes} minutes ago)`);
      return true;
    } else {
      console.log('  ✗ No build version found in HTML');
      return false;
    }
  } catch (err) {
    console.log(`  ✗ Failed to check build version: ${err.message}`);
    return false;
  }
}

async function checkCacheHeaders(baseUrl) {
  try {
    const response = await fetch(baseUrl, { method: 'HEAD' });
    const cacheControl = response.headers.get('cache-control') || '';
    const hasNoCache = cacheControl.includes('no-cache') || cacheControl.includes('no-store');
    console.log(`  ${hasNoCache ? '✓' : '✗'} Cache-Control: ${cacheControl}`);
    return hasNoCache;
  } catch (err) {
    console.log(`  ✗ Failed to check cache headers: ${err.message}`);
    return false;
  }
}

async function main() {
  const baseUrl = process.argv[2] || PRODUCTION_URL;
  console.log(`\n🔍 Verifying deployment: ${baseUrl}\n`);

  let allPassed = true;

  // Check routes
  console.log('Routes (SPA fallback):');
  for (const route of CRITICAL_ROUTES) {
    const ok = await checkRoute(baseUrl, route);
    if (!ok) allPassed = false;
  }

  // Check assets
  console.log('\nStatic assets:');
  for (const asset of CRITICAL_ASSETS) {
    const ok = await checkAsset(baseUrl, asset);
    if (!ok) allPassed = false;
  }

  // Check JS bundle exists
  console.log('\nJavaScript bundles:');
  try {
    const response = await fetch(baseUrl);
    const html = await response.text();
    const jsMatch = html.match(/src="(\/assets\/index-[^"]+\.js)"/);
    if (jsMatch) {
      const ok = await checkAsset(baseUrl, jsMatch[1]);
      if (!ok) allPassed = false;
    } else {
      console.log('  ✗ No main JS bundle found in HTML');
      allPassed = false;
    }
  } catch (err) {
    console.log(`  ✗ Failed to check JS bundles: ${err.message}`);
    allPassed = false;
  }

  // Check build version
  console.log('\nBuild version:');
  const versionOk = await checkBuildVersion(baseUrl);
  if (!versionOk) allPassed = false;

  // Check cache headers
  console.log('\nCache headers:');
  const cacheOk = await checkCacheHeaders(baseUrl);
  if (!cacheOk) allPassed = false;

  // Summary
  console.log('\n' + '─'.repeat(50));
  if (allPassed) {
    console.log('✅ All checks passed!\n');
    process.exit(0);
  } else {
    console.log('❌ Some checks failed!\n');
    process.exit(1);
  }
}

main();
