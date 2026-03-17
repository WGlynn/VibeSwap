#!/usr/bin/env node
/**
 * Slippage Comparison Demo — Continuous AMM vs VibeSwap Batch Auction
 *
 * Run: node script/slippage-demo.js
 *
 * Shows Frank exactly what his institutional clients would save.
 * No contracts needed — pure math simulation.
 */

const POOL_ETH = 10_000;          // 10,000 ETH in pool
const POOL_USDC = 28_000_000;     // 28M USDC (@ $2800/ETH)
const UNI_FEE = 0.003;            // 0.30% Uniswap V3
const VIBE_FEE = 0.0005;          // 0.05% VibeSwap
const MEV_BPS = 0.003;            // 30 bps MEV (conservative estimate)

// Institutional order set — mixed direction, various sizes
const orders = [
  { eth: 50,  dir: 'SELL', client: 'OTC Desk A' },
  { eth: 10,  dir: 'BUY',  client: 'Hedge Fund B' },
  { eth: 100, dir: 'SELL', client: 'OTC Desk A' },
  { eth: 5,   dir: 'SELL', client: 'Retail' },
  { eth: 25,  dir: 'BUY',  client: 'Hedge Fund C' },
  { eth: 75,  dir: 'SELL', client: 'OTC Desk D' },
  { eth: 200, dir: 'SELL', client: 'Block Trade E' },
  { eth: 15,  dir: 'BUY',  client: 'Hedge Fund B' },
  { eth: 30,  dir: 'SELL', client: 'OTC Desk A' },
  { eth: 40,  dir: 'BUY',  client: 'Arb Bot F' },
];

console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║     EXECUTION QUALITY COMPARISON: Continuous vs Batch       ║');
console.log('║     Pool: 10,000 ETH / 28,000,000 USDC ($2,800/ETH)       ║');
console.log('╚══════════════════════════════════════════════════════════════╝');
console.log('');

// ============ CONTINUOUS AMM (Sequential) ============

console.log('┌─── CONTINUOUS AMM (Uniswap V2/V3 Math) ────────────────────┐');
console.log('│  Orders execute sequentially. Each one walks the curve.     │');
console.log('│  Fee: 0.30%  |  MEV: ~30 bps  |  Slippage: cumulative     │');
console.log('└─────────────────────────────────────────────────────────────┘');
console.log('');

let r0 = POOL_ETH;
let r1 = POOL_USDC;
let totalContinuousFees = 0;
let totalContinuousSlippage = 0;
let totalMEV = 0;
let totalVolume = 0;

console.log('  #  Dir   Size     Client          Eff. Price    Slippage   MEV Cost');
console.log('  ── ────  ──────── ───────────────  ──────────── ────────── ─────────');

orders.forEach((o, i) => {
  const spotBefore = r1 / r0;
  const usdValue = o.eth * 2800;
  totalVolume += usdValue;

  let effectivePrice, slippagePct, fee, mev;

  if (o.dir === 'SELL') {
    const afterFee = o.eth * (1 - UNI_FEE);
    const out = (r1 * afterFee) / (r0 + afterFee);
    effectivePrice = out / o.eth;
    fee = o.eth * UNI_FEE * spotBefore;
    slippagePct = ((spotBefore - effectivePrice) / spotBefore) * 100;
    r0 += o.eth;
    r1 -= out;
  } else {
    const usdcIn = o.eth * spotBefore;
    const afterFee = usdcIn * (1 - UNI_FEE);
    const ethOut = (r0 * afterFee) / (r1 + afterFee);
    effectivePrice = usdcIn / ethOut;
    fee = usdcIn * UNI_FEE;
    slippagePct = ((effectivePrice - spotBefore) / spotBefore) * 100;
    r1 += usdcIn;
    r0 -= ethOut;
  }

  mev = usdValue * MEV_BPS;
  totalContinuousFees += usdValue * UNI_FEE;
  totalContinuousSlippage += usdValue * (slippagePct / 100);
  totalMEV += mev;

  const num = String(i + 1).padStart(2);
  const dir = o.dir.padEnd(4);
  const size = `${o.eth} ETH`.padEnd(8);
  const client = o.client.padEnd(15);
  const price = `$${effectivePrice.toFixed(2)}`.padStart(12);
  const slip = `${slippagePct.toFixed(3)}%`.padStart(10);
  const mevStr = `$${mev.toFixed(0)}`.padStart(9);

  console.log(`  ${num} ${dir}  ${size} ${client}  ${price} ${slip} ${mevStr}`);
});

console.log('');

// ============ BATCH AUCTION (VibeSwap) ============

console.log('┌─── BATCH AUCTION (VibeSwap) ────────────────────────────────┐');
console.log('│  All orders settle at ONE clearing price. Net flow only.    │');
console.log('│  Fee: 0.05%  |  MEV: $0  |  Slippage: net-flow based      │');
console.log('└─────────────────────────────────────────────────────────────┘');
console.log('');

const totalSell = orders.filter(o => o.dir === 'SELL').reduce((s, o) => s + o.eth, 0);
const totalBuy = orders.filter(o => o.dir === 'BUY').reduce((s, o) => s + o.eth, 0);
const netFlow = totalSell - totalBuy;

// Net flow clearing price (only the net imbalance moves the curve)
const afterFee = netFlow * (1 - VIBE_FEE);
const netOut = (POOL_USDC * afterFee) / (POOL_ETH + afterFee);
const clearingPrice = netOut / netFlow;
const spotPrice = POOL_USDC / POOL_ETH;
const batchSlippage = ((spotPrice - clearingPrice) / spotPrice) * 100;
const totalBatchFees = totalVolume * VIBE_FEE;

console.log(`  Net flow: ${totalSell} ETH sold — ${totalBuy} ETH bought = ${netFlow} ETH net sell`);
console.log(`  Clearing price: $${clearingPrice.toFixed(2)} (uniform for ALL participants)`);
console.log(`  Batch slippage: ${batchSlippage.toFixed(3)}% (net-flow only, not cumulative)`);
console.log(`  MEV extracted: $0.00 (structurally impossible)`);
console.log('');

// ============ COMPARISON ============

console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║                    EXECUTION QUALITY DELTA                  ║');
console.log('╠══════════════════════════════════════════════════════════════╣');
console.log(`║  Total order volume:   $${(totalVolume).toLocaleString().padStart(12)}                       ║`);
console.log('║                                                              ║');
console.log(`║  Continuous fees:      $${totalContinuousFees.toFixed(0).padStart(12)}  (0.30%)              ║`);
console.log(`║  Batch fees:           $${totalBatchFees.toFixed(0).padStart(12)}  (0.05%)              ║`);
console.log(`║  Fee savings:          $${(totalContinuousFees - totalBatchFees).toFixed(0).padStart(12)}                       ║`);
console.log('║                                                              ║');
console.log(`║  MEV extracted (cont): $${totalMEV.toFixed(0).padStart(12)}  (~30 bps)            ║`);
console.log(`║  MEV extracted (batch):$${String(0).padStart(13)}  (0 bps)              ║`);
console.log(`║  MEV savings:          $${totalMEV.toFixed(0).padStart(12)}  (100% elimination)   ║`);
console.log('║                                                              ║');
const totalSavings = (totalContinuousFees - totalBatchFees) + totalMEV;
console.log(`║  ► TOTAL SAVINGS:      $${totalSavings.toFixed(0).padStart(12)}  per batch            ║`);
console.log(`║  ► SAVINGS RATE:       ${((totalSavings / totalVolume) * 10000).toFixed(1).padStart(10)} bps                    ║`);
console.log('╚══════════════════════════════════════════════════════════════╝');
console.log('');
console.log('  For institutional flow at this volume level:');
console.log(`  → $${totalSavings.toFixed(0)} saved per 10-second batch`);
console.log(`  → $${(totalSavings * 6 * 24).toFixed(0)} saved per day (batches every 10s, 8hr trading day)`);
console.log(`  → $${(totalSavings * 6 * 24 * 252).toFixed(0)} saved per year (252 trading days)`);
console.log('');
console.log('  "If execution is fragmented, value leaks.');
console.log('   If execution is controlled, flow compounds." — Frank Zou');
console.log('');
console.log('  VibeSwap: execution quality as a cryptographic guarantee.');
