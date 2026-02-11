#!/usr/bin/env node
/**
 * Post-build validation script
 * Ensures critical files exist and are valid after build
 */
import { existsSync, readFileSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(__dirname, '../dist');

let allPassed = true;

function check(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    console.log(`  ✗ ${message}`);
    allPassed = false;
  }
}

console.log('\n🔍 Validating build output...\n');

// 1. Check dist directory exists
check(existsSync(distDir), 'dist/ directory exists');

// 2. Check index.html exists and has required elements
const indexPath = resolve(distDir, 'index.html');
if (existsSync(indexPath)) {
  check(true, 'index.html exists');

  const html = readFileSync(indexPath, 'utf8');
  check(html.includes('<!-- Build: v'), 'index.html has build version');
  check(html.includes('<div id="root">'), 'index.html has #root element');
  check(html.includes('script type="module"'), 'index.html has module script');
  check(html.includes('__vibeswapLoaded'), 'index.html has load timeout handler');
} else {
  check(false, 'index.html exists');
}

// 3. Check assets directory
const assetsDir = resolve(distDir, 'assets');
if (existsSync(assetsDir)) {
  check(true, 'assets/ directory exists');

  const files = readdirSync(assetsDir);
  const hasMainJS = files.some(f => f.startsWith('index-') && f.endsWith('.js'));
  const hasMainCSS = files.some(f => f.startsWith('index-') && f.endsWith('.css'));
  const hasVendorReact = files.some(f => f.includes('vendor-react'));
  const hasVendorWallet = files.some(f => f.includes('vendor-wallet'));

  check(hasMainJS, 'Main JavaScript bundle exists');
  check(hasMainCSS, 'Main CSS bundle exists');
  check(hasVendorReact, 'React vendor bundle exists');
  check(hasVendorWallet, 'Wallet vendor bundle exists');

  // Check bundle sizes
  files.forEach(f => {
    if (f.endsWith('.js') && !f.endsWith('.map')) {
      const path = resolve(assetsDir, f);
      const size = readFileSync(path).length;
      const sizeKB = Math.round(size / 1024);
      if (sizeKB > 2000) {
        console.log(`  ⚠ ${f}: ${sizeKB}KB (large bundle)`);
      }
    }
  });
} else {
  check(false, 'assets/ directory exists');
}

// 4. Check for source maps (optional in production builds)
if (existsSync(assetsDir)) {
  const files = readdirSync(assetsDir);
  const hasSourceMaps = files.some(f => f.endsWith('.map'));
  if (hasSourceMaps) {
    console.log(`  ✓ Source maps generated`);
  } else {
    console.log(`  ℹ Source maps omitted (production build)`);
  }
}

// Summary
console.log('\n' + '─'.repeat(50));
if (allPassed) {
  console.log('✅ Build validation passed!\n');
  process.exit(0);
} else {
  console.log('❌ Build validation failed!\n');
  process.exit(1);
}
