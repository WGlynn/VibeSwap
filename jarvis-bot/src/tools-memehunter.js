// ============ Memecoin Hunter — Orchestration Layer ============
//
// Extends tools-scanner.js and tools-security.js with:
// 1. Composite risk scoring (0-100, higher = safer)
// 2. New token hunting with auto-security-check
// 3. Momentum + volume/liquidity ratio analysis
// 4. Background monitor that auto-posts alerts to TG
// 5. Human-in-the-loop approval flow (TG inline keyboards)
// 6. Trade execution via Uniswap V3 on Base
//
// Commands:
//   /hunt [chain]           — Scan new tokens, score them, show best candidates
//   /memescore <addr> [chain] — Deep risk score for a single token
//   /mememonitor [chain]    — Start background memecoin monitor (posts alerts)
//   /memestop              — Stop background monitor
//   /memestatus            — Monitor status
//   /memepending           — Show pending approval queue
// ============

import { ethers } from 'ethers';
import { sendTransaction, addToWhitelist, getWalletInfo } from './wallet.js';
import { config } from './config.js';
import { appendFile } from 'fs/promises';
import { join } from 'path';

const HTTP_TIMEOUT = 12000;
const DATA_DIR = process.env.DATA_DIR || './data';
const MEME_TRADE_LOG = join(DATA_DIR, 'meme-trades.jsonl');

// ============ Uniswap V3 on Base (for meme swaps) ============

const BASE_RPC = 'https://mainnet.base.org';
const memeProvider = new ethers.JsonRpcProvider(BASE_RPC);

const SWAP_ROUTER = '0x2626664c2603336E57B271c5C0b26F421741e481';
const QUOTER_V2 = '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a';
const WETH = '0x4200000000000000000000000000000000000006';

const QUOTER_ABI = [
  'function quoteExactInputSingle(tuple(address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
];
const ROUTER_ABI = [
  'function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) external payable returns (uint256 amountOut)',
  'function multicall(uint256 deadline, bytes[] data) external payable returns (bytes[] results)',
];
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
];

const quoterIface = new ethers.Interface(QUOTER_ABI);
const routerIface = new ethers.Interface(ROUTER_ABI);

// ============ Pending Approvals (Human-in-the-Loop) ============

const pendingApprovals = new Map(); // callbackId -> { token, scored, ethAmount, expiresAt, messageId, chatId }

// Cleanup expired approvals every 60s
setInterval(() => {
  const now = Date.now();
  for (const [id, approval] of pendingApprovals) {
    if (now > approval.expiresAt) {
      pendingApprovals.delete(id);
    }
  }
}, 60_000);

// Chains where GoPlus has GOOD coverage (EVM chains)
const GOPLUS_SUPPORTED = new Set(['1', '56', '137', '42161', '10', '43114', '8453']);

// GoPlus chain IDs
const CHAIN_IDS = {
  eth: '1', ethereum: '1',
  bsc: '56', bnb: '56',
  polygon: '137', matic: '137',
  arbitrum: '42161', arb: '42161',
  optimism: '10', op: '10',
  avalanche: '43114', avax: '43114',
  base: '8453',
  solana: 'solana', sol: 'solana',
};

function resolveChainId(input) {
  if (!input) return '8453';
  return CHAIN_IDS[input.toLowerCase()] || input;
}

// DEXScreener chain IDs
const DEX_CHAIN_MAP = {
  eth: 'ethereum', ethereum: 'ethereum',
  bsc: 'bsc', bnb: 'bsc',
  sol: 'solana', solana: 'solana',
  arb: 'arbitrum', arbitrum: 'arbitrum',
  base: 'base',
  polygon: 'polygon', matic: 'polygon',
  avax: 'avalanche', avalanche: 'avalanche',
  op: 'optimism', optimism: 'optimism',
};

function resolveDexChain(input) {
  if (!input) return 'base';
  return DEX_CHAIN_MAP[input.toLowerCase()] || input.toLowerCase();
}

// ============ /hunt — Scan + Score New Tokens ============

export async function huntMemecoins(chain) {
  const dexChain = resolveDexChain(chain);
  const goplusChain = resolveChainId(chain);

  try {
    // Step 1: Get new pairs from DEXScreener (multi-source)
    const pairs = await fetchNewPairs(dexChain);

    if (pairs.length === 0) {
      return `No new tokens found on ${dexChain}. Try: /hunt base, /hunt sol, /hunt eth`;
    }

    // Step 2: Score each token in parallel (max 8 for wider coverage)
    const candidates = pairs.slice(0, 8);
    const scored = await Promise.allSettled(
      candidates.map(p => scoreToken(p, goplusChain))
    );

    // Step 3: Sort by score, filter duds
    const results = scored
      .filter(r => r.status === 'fulfilled' && r.value)
      .map(r => r.value)
      .sort((a, b) => b.score - a.score);

    if (results.length === 0) {
      return `Found ${pairs.length} new tokens on ${dexChain} but none passed scoring. All likely rugs.`;
    }

    // Step 4: Format output
    const lines = [`MEMECOIN HUNT — ${dexChain.toUpperCase()}\n`];

    for (const r of results) {
      const scoreEmoji = r.score >= 70 ? '🟢' : r.score >= 40 ? '🟡' : '🔴';
      const riskLabel = r.score >= 70 ? 'LOW RISK' : r.score >= 40 ? 'MODERATE' : 'HIGH RISK';
      const tags = [];
      if (r.ageMs > 0 && r.ageMs < 7200000) tags.push('EARLY');
      if (r.volLiqRatio >= 2) tags.push('HOT');
      if (r.momentum > 0) tags.push('PUMPING');
      else if (r.momentum < -20) tags.push('DUMPING');
      const tagStr = tags.length > 0 ? ` [${tags.join(' ')}]` : '';

      lines.push(`${scoreEmoji} ${r.name} (${r.symbol}) — ${r.score}/100 ${riskLabel}${tagStr}`);
      lines.push(`  Price: ${r.price} | Liq: ${r.liquidity} | Vol: ${r.volume}`);
      lines.push(`  Age: ${r.age} | Buys/Sells: ${r.buys}/${r.sells} | V/L: ${r.volLiqRatio.toFixed(1)}x`);
      if (r.flags.length > 0) {
        lines.push(`  Flags: ${r.flags.join(', ')}`);
      }
      lines.push(`  /memescore ${r.address} ${chain || 'base'}`);
      lines.push('');
    }

    lines.push(`Scanned ${pairs.length} pairs, ${results.length} scored.`);
    return lines.join('\n');
  } catch (err) {
    return `Hunt failed: ${err.message}`;
  }
}

// ============ /memescore — Deep Risk Score for Single Token ============

export async function getMemeScore(address, chain) {
  if (!address) return 'Usage: /memescore 0x... [chain]\n\nDeep risk analysis for a single token.\nDefault chain: base';

  const goplusChain = resolveChainId(chain);
  const dexChain = resolveDexChain(chain);
  const hasGoPlus = GOPLUS_SUPPORTED.has(goplusChain);

  try {
    // Parallel fetch: GoPlus security + DEXScreener pair data
    const fetches = [fetchDexPair(address)];
    if (hasGoPlus) fetches.push(fetchGoPlus(address, goplusChain));

    const results = await Promise.allSettled(fetches);

    const pair = results[0].status === 'fulfilled' ? results[0].value : null;
    const security = hasGoPlus && results[1]?.status === 'fulfilled' ? results[1].value : null;

    if (!security && !pair) {
      return `Token ${address.slice(0, 10)}... not found on ${chain || 'base'}. Check the address and chain.`;
    }

    // Calculate composite score
    const { score, breakdown, flags } = calculateScore(security, pair, goplusChain);

    const lines = [];
    const scoreEmoji = score >= 70 ? '🟢' : score >= 40 ? '🟡' : '🔴';
    const riskLabel = score >= 70 ? 'LOW RISK' : score >= 40 ? 'MODERATE' : 'HIGH RISK';

    const name = security?.token_name || pair?.baseToken?.name || 'Unknown';
    const symbol = security?.token_symbol || pair?.baseToken?.symbol || '?';

    lines.push(`${scoreEmoji} ${name} (${symbol}) — ${score}/100 ${riskLabel}\n`);

    // Score breakdown — derive max from total (categories sum to 100)
    const hasSec = security !== null;
    lines.push('  SCORE BREAKDOWN');
    for (const [category, points] of Object.entries(breakdown)) {
      const filled = Math.max(0, Math.min(4, Math.round(points / Math.max(1, points + 5) * 4)));
      // Simple proportional bar — 4 blocks
      const pct = score > 0 ? (points / score * 100).toFixed(0) : 0;
      const bar = '█'.repeat(filled) + '░'.repeat(4 - filled);
      lines.push(`    ${category.padEnd(14)} ${bar} ${points} pts`);
    }
    lines.push(`    ${''.padEnd(14)}      = ${score}/100`);

    // Pair data
    if (pair) {
      const price = pair.priceUsd ? `$${parseFloat(pair.priceUsd).toLocaleString(undefined, { maximumFractionDigits: 8 })}` : '?';
      const liq = pair.liquidity?.usd ? `$${formatNum(pair.liquidity.usd)}` : '?';
      const vol = pair.volume?.h24 ? `$${formatNum(pair.volume.h24)}` : '?';
      const buys = pair.txns?.h24?.buys || 0;
      const sells = pair.txns?.h24?.sells || 0;
      const fdv = pair.fdv ? `$${formatNum(pair.fdv)}` : '?';
      const volLiq = getVolLiqRatio(pair);

      lines.push('\n  MARKET DATA');
      lines.push(`    Price: ${price}`);
      lines.push(`    Liquidity: ${liq} | FDV: ${fdv}`);
      lines.push(`    24h Volume: ${vol} (${volLiq.toFixed(1)}x liquidity)`);
      lines.push(`    24h Txns: ${buys} buys / ${sells} sells`);
      if (pair.priceChange) {
        const changes = [];
        if (pair.priceChange.m5 != null) changes.push(`5m: ${fmtPct(pair.priceChange.m5)}`);
        if (pair.priceChange.h1 != null) changes.push(`1h: ${fmtPct(pair.priceChange.h1)}`);
        if (pair.priceChange.h6 != null) changes.push(`6h: ${fmtPct(pair.priceChange.h6)}`);
        if (pair.priceChange.h24 != null) changes.push(`24h: ${fmtPct(pair.priceChange.h24)}`);
        if (changes.length) lines.push(`    Changes: ${changes.join(' | ')}`);
      }

      // Age
      if (pair.pairCreatedAt) {
        const ageMs = Date.now() - pair.pairCreatedAt;
        const ageStr = formatAge(pair.pairCreatedAt);
        const earlyTag = ageMs < 7200000 ? ' (EARLY — under 2h old)' : '';
        lines.push(`    Age: ${ageStr}${earlyTag}`);
      }
    }

    // Security data
    if (security) {
      lines.push('\n  CONTRACT SECURITY');
      if (security.buy_tax) lines.push(`    Buy Tax: ${(parseFloat(security.buy_tax) * 100).toFixed(1)}%`);
      if (security.sell_tax) lines.push(`    Sell Tax: ${(parseFloat(security.sell_tax) * 100).toFixed(1)}%`);
      lines.push(`    Open Source: ${security.is_open_source === '1' ? 'Yes' : 'No'}`);
      lines.push(`    Holders: ${security.holder_count || '?'} | LP Holders: ${security.lp_holder_count || '?'}`);

      const owner = security.owner_address;
      if (owner) {
        lines.push(`    Owner: ${owner === '0x0000000000000000000000000000000000000000' ? 'Renounced' : owner.slice(0, 10) + '...'}`);
      }
    } else if (!hasGoPlus) {
      lines.push(`\n  CONTRACT SECURITY`);
      lines.push(`    GoPlus not available on this chain — scoring based on market data only`);
    }

    // Flags
    if (flags.length > 0) {
      lines.push('\n  FLAGS');
      for (const f of flags) {
        lines.push(`    ${f}`);
      }
    }

    // Verdict
    lines.push('\n  VERDICT');
    if (score >= 70) lines.push('    Relatively safe for a new token. DYOR — low risk is not no risk.');
    else if (score >= 40) lines.push('    Proceed with caution. Multiple yellow flags. Small position only.');
    else lines.push('    Likely a rug or honeypot. Avoid unless you have inside info.');

    return lines.join('\n');
  } catch (err) {
    return `Score failed: ${err.message}`;
  }
}

// ============ /mememonitor — Background Memecoin Monitor ============

let monitorInterval = null;
let monitorState = { chain: 'base', seenTokens: new Set(), alertCount: 0, startedAt: null };

export function startMemeMonitor(chain, postAlert, sendTg) {
  if (monitorInterval) {
    return 'Monitor already running. Use /memestop to stop it first.';
  }

  const dexChain = resolveDexChain(chain);
  const goplusChain = resolveChainId(chain);
  const minScore = config.memehunter?.minAlertScore || 55;
  monitorState = { chain: dexChain, seenTokens: new Set(), alertCount: 0, startedAt: Date.now() };

  monitorInterval = setInterval(async () => {
    try {
      const pairs = await fetchNewPairs(dexChain);
      const newPairs = pairs.filter(p => {
        const key = p.baseToken?.address || p.pairAddress;
        if (!key || monitorState.seenTokens.has(key)) return false;
        monitorState.seenTokens.add(key);
        return true;
      });

      // Score new pairs
      for (const pair of newPairs.slice(0, 3)) {
        try {
          const scored = await scoreToken(pair, goplusChain);
          if (!scored) continue;

          // High-scoring tokens: send human-in-the-loop trade alert
          if (scored.score >= minScore && sendTg) {
            monitorState.alertCount++;
            await alertHuman(scored, sendTg);
            continue;
          }

          // Medium-scoring tokens: info-only alert (no trade button)
          if (scored.score >= 40) {
            monitorState.alertCount++;
            const emoji = scored.score >= 70 ? '🟢' : '🟡';
            const tags = [];
            if (scored.ageMs > 0 && scored.ageMs < 7200000) tags.push('EARLY');
            if (scored.volLiqRatio >= 2) tags.push('HOT');
            if (scored.momentum > 0) tags.push('PUMPING');
            const tagStr = tags.length > 0 ? ` [${tags.join(' ')}]` : '';

            const msg = [
              `${emoji} NEW TOKEN (#${monitorState.alertCount})${tagStr}`,
              `${scored.name} (${scored.symbol}) — ${scored.score}/100`,
              `Price: ${scored.price} | Liq: ${scored.liquidity} | V/L: ${scored.volLiqRatio.toFixed(1)}x`,
              `Age: ${scored.age} | ${scored.buys} buys / ${scored.sells} sells`,
              scored.flags.length > 0 ? `Flags: ${scored.flags.join(', ')}` : '',
              `/memescore ${scored.address} ${chain || 'base'}`,
            ].filter(Boolean).join('\n');

            if (postAlert) postAlert(msg);
          }
        } catch { /* skip failed scores */ }
      }

      // Prune seen set to prevent memory leak (keep last 500)
      if (monitorState.seenTokens.size > 500) {
        const arr = [...monitorState.seenTokens];
        monitorState.seenTokens = new Set(arr.slice(-300));
      }
    } catch (err) {
      console.error(`[memehunter] Monitor tick failed: ${err.message}`);
    }
  }, 60_000);

  return `Memecoin monitor started on ${dexChain.toUpperCase()}. Checking every 60s.\nTrade alerts for score ≥${minScore} (with approve/reject buttons).\nInfo alerts for score 40-${minScore - 1}.\nUse /memestop to stop.`;
}

export function stopMemeMonitor() {
  if (!monitorInterval) return 'No monitor running.';

  clearInterval(monitorInterval);
  monitorInterval = null;
  const duration = monitorState.startedAt ? formatAge(monitorState.startedAt) : '?';
  const result = `Monitor stopped. Ran for ${duration}, sent ${monitorState.alertCount} alerts, scanned ${monitorState.seenTokens.size} tokens.`;
  monitorState = { chain: 'base', seenTokens: new Set(), alertCount: 0, startedAt: null };
  return result;
}

export function getMonitorStatus() {
  if (!monitorInterval) return 'Monitor is not running. Start with /mememonitor [chain]';
  const duration = monitorState.startedAt ? formatAge(monitorState.startedAt) : '?';
  return `Monitor running on ${monitorState.chain.toUpperCase()} for ${duration}. ${monitorState.alertCount} alerts sent, ${monitorState.seenTokens.size} tokens scanned.`;
}

// ============ Scoring Engine ============

function getVolLiqRatio(pair) {
  const vol = pair?.volume?.h24 || 0;
  const liq = pair?.liquidity?.usd || 1;
  return vol / liq;
}

function getMomentum(pair) {
  if (!pair?.priceChange) return 0;
  // Weighted momentum: recent moves matter more
  const m5 = pair.priceChange.m5 || 0;
  const h1 = pair.priceChange.h1 || 0;
  const h24 = pair.priceChange.h24 || 0;
  return m5 * 0.5 + h1 * 0.3 + h24 * 0.2;
}

function calculateScore(security, pair, goplusChain) {
  const hasGoPlus = security !== null;
  const goplusSupported = GOPLUS_SUPPORTED.has(goplusChain);

  // Dynamic weighting: if GoPlus unavailable, redistribute security points to market categories
  // With GoPlus:    Honeypot(15) + Ownership(15) + Tokenomics(15) + Liquidity(25) + Activity(20) + Momentum(10) = 100
  // Without GoPlus: Honeypot(0)  + Ownership(0)  + Tokenomics(0)  + Liquidity(40) + Activity(40) + Momentum(20) = 100
  const secWeight = hasGoPlus ? 1.0 : 0.0;
  const mktBoost = hasGoPlus ? 1.0 : (goplusSupported ? 0.5 : 2.0); // Penalize missing data on supported chains

  const breakdown = {};
  const flags = [];

  // ---- Honeypot (max 15 pts with GoPlus) ----
  if (hasGoPlus) {
    let hp = 15;
    if (security.is_honeypot === '1') { hp = 0; flags.push('❌ HONEYPOT'); }
    if (security.selfdestruct === '1') { hp -= 8; flags.push('❌ Selfdestruct'); }
    if (security.external_call === '1') { hp -= 3; flags.push('⚠️ External call'); }
    if (security.cannot_sell_all === '1') { hp -= 8; flags.push('❌ Cannot sell all'); }
    if (security.cannot_buy === '1') { hp -= 8; flags.push('❌ Cannot buy'); }
    breakdown['Honeypot'] = Math.max(0, Math.min(15, hp));
  } else if (goplusSupported) {
    breakdown['Honeypot'] = 3; // Penalize — should have data but doesn't
    flags.push('⚠️ No security data (suspicious)');
  }
  // If GoPlus not supported for this chain, skip category entirely

  // ---- Ownership (max 15 pts with GoPlus) ----
  if (hasGoPlus) {
    let ow = 15;
    if (security.hidden_owner === '1') { ow -= 10; flags.push('❌ Hidden owner'); }
    if (security.can_take_back_ownership === '1') { ow -= 8; flags.push('❌ Can reclaim ownership'); }
    if (security.owner_change_balance === '1') { ow -= 12; flags.push('❌ Owner can change balances'); }
    const owner = security.owner_address;
    if (owner === '0x0000000000000000000000000000000000000000') {
      ow = Math.max(ow, 14);
      flags.push('✅ Ownership renounced');
    }
    if (security.is_proxy === '1') { ow -= 4; flags.push('⚠️ Proxy (upgradeable)'); }
    breakdown['Ownership'] = Math.max(0, Math.min(15, ow));
  } else if (goplusSupported) {
    breakdown['Ownership'] = 3;
  }

  // ---- Tokenomics (max 15 pts with GoPlus) ----
  if (hasGoPlus) {
    let tk = 15;
    const buyTax = parseFloat(security.buy_tax || '0');
    const sellTax = parseFloat(security.sell_tax || '0');
    if (buyTax > 0.1) { tk -= 7; flags.push(`⚠️ High buy tax: ${(buyTax * 100).toFixed(1)}%`); }
    else if (buyTax > 0.05) { tk -= 3; }
    if (sellTax > 0.1) { tk -= 7; flags.push(`⚠️ High sell tax: ${(sellTax * 100).toFixed(1)}%`); }
    else if (sellTax > 0.05) { tk -= 3; }
    if (security.is_mintable === '1') { tk -= 4; flags.push('⚠️ Mintable'); }
    if (security.slippage_modifiable === '1') { tk -= 4; flags.push('⚠️ Slippage modifiable'); }
    if (security.transfer_pausable === '1') { tk -= 4; flags.push('⚠️ Transfers pausable'); }
    if (security.is_blacklisted === '1') { tk -= 3; flags.push('⚠️ Has blacklist'); }
    if (security.is_open_source === '1') { flags.push('✅ Open source'); }
    else { tk -= 4; flags.push('⚠️ Not open source'); }
    breakdown['Tokenomics'] = Math.max(0, Math.min(15, tk));
  } else if (goplusSupported) {
    breakdown['Tokenomics'] = 3;
  }

  // ---- Liquidity (max 25 or 40 pts) ----
  const liqMax = hasGoPlus ? 25 : (goplusSupported ? 25 : 40);
  if (pair) {
    const liq = pair.liquidity?.usd || 0;
    let liqScore;
    if (liq >= 500000) liqScore = liqMax;
    else if (liq >= 100000) liqScore = liqMax * 0.9;
    else if (liq >= 50000) liqScore = liqMax * 0.75;
    else if (liq >= 10000) liqScore = liqMax * 0.55;
    else if (liq >= 5000) liqScore = liqMax * 0.35;
    else if (liq >= 1000) liqScore = liqMax * 0.2;
    else { liqScore = liqMax * 0.05; flags.push('⚠️ Very low liquidity'); }

    // Volume/Liquidity ratio bonus — high V/L = active market
    const volLiq = getVolLiqRatio(pair);
    if (volLiq >= 5) liqScore = Math.min(liqMax, liqScore + liqMax * 0.15);
    else if (volLiq >= 2) liqScore = Math.min(liqMax, liqScore + liqMax * 0.1);
    else if (volLiq < 0.1 && liq < 50000) { liqScore *= 0.8; flags.push('⚠️ Dead volume'); }

    // LP holder check (from GoPlus if available)
    const lpHolders = parseInt(security?.lp_holder_count || '0');
    if (hasGoPlus && lpHolders <= 1) { liqScore *= 0.75; flags.push('⚠️ Single LP holder'); }

    // FDV/Liquidity sanity — absurd FDV with tiny liquidity = exit scam setup
    const fdv = pair.fdv || 0;
    if (fdv > 0 && liq > 0 && fdv / liq > 100) {
      liqScore *= 0.7;
      flags.push('⚠️ FDV/Liq ratio extreme');
    }

    breakdown['Liquidity'] = Math.max(0, Math.round(Math.min(liqMax, liqScore)));
  } else {
    breakdown['Liquidity'] = Math.round(liqMax * 0.15);
  }

  // ---- Activity (max 20 or 40 pts) ----
  const actMax = hasGoPlus ? 20 : (goplusSupported ? 20 : 40);
  if (pair) {
    const buys = pair.txns?.h24?.buys || 0;
    const sells = pair.txns?.h24?.sells || 0;
    const total = buys + sells;

    let actScore;
    if (total >= 500) actScore = actMax;
    else if (total >= 100) actScore = actMax * 0.85;
    else if (total >= 50) actScore = actMax * 0.7;
    else if (total >= 20) actScore = actMax * 0.55;
    else if (total >= 5) actScore = actMax * 0.35;
    else { actScore = actMax * 0.1; flags.push('⚠️ Very low activity'); }

    // Buy/sell ratio — healthy buying pressure = good
    if (total > 10) {
      if (sells > buys * 3) {
        actScore *= 0.6;
        flags.push('❌ Heavy dump — 3x more sells than buys');
      } else if (sells > buys * 2) {
        actScore *= 0.75;
        flags.push('⚠️ Selling pressure');
      } else if (buys > sells * 2 && total >= 20) {
        actScore = Math.min(actMax, actScore * 1.1);
        flags.push('✅ Strong buy pressure');
      }
    }

    // Holder count (from GoPlus)
    const holders = parseInt(security?.holder_count || '0');
    if (hasGoPlus && holders > 0 && holders < 10) { actScore *= 0.7; flags.push('⚠️ Very few holders'); }
    else if (hasGoPlus && holders >= 1000) { flags.push('✅ Wide distribution'); }

    breakdown['Activity'] = Math.max(0, Math.round(Math.min(actMax, actScore)));
  } else {
    breakdown['Activity'] = Math.round(actMax * 0.15);
  }

  // ---- Momentum (max 10 or 20 pts) ----
  const momMax = hasGoPlus ? 10 : (goplusSupported ? 10 : 20);
  if (pair?.priceChange) {
    const m5 = pair.priceChange.m5 || 0;
    const h1 = pair.priceChange.h1 || 0;
    const h6 = pair.priceChange.h6 || 0;
    const h24 = pair.priceChange.h24 || 0;

    let momScore = momMax * 0.5; // Start neutral

    // Short-term momentum (5m, 1h) — most important for entry timing
    if (m5 > 20) { momScore += momMax * 0.2; flags.push('🚀 5m pump >20%'); }
    else if (m5 > 5) { momScore += momMax * 0.1; }
    else if (m5 < -20) { momScore -= momMax * 0.3; flags.push('📉 5m dump >20%'); }
    else if (m5 < -5) { momScore -= momMax * 0.1; }

    if (h1 > 50) { momScore += momMax * 0.15; flags.push('🚀 1h pump >50%'); }
    else if (h1 > 10) { momScore += momMax * 0.1; }
    else if (h1 < -30) { momScore -= momMax * 0.2; }
    else if (h1 < -10) { momScore -= momMax * 0.1; }

    // 24h trend — sustaining gains = healthy
    if (h24 > 100 && h1 > 0) { momScore += momMax * 0.1; }
    else if (h24 < -50) { momScore -= momMax * 0.15; flags.push('📉 24h down >50%'); }

    // Parabolic warning — up >200% in 24h often precedes crash
    if (h24 > 200 && m5 < 0) {
      flags.push('⚠️ Parabolic — may retrace');
    }

    breakdown['Momentum'] = Math.max(0, Math.round(Math.min(momMax, momScore)));
  } else {
    breakdown['Momentum'] = Math.round(momMax * 0.4);
  }

  const score = Object.values(breakdown).reduce((a, b) => a + b, 0);
  return { score, breakdown, flags };
}

async function scoreToken(pair, goplusChain) {
  const address = pair.baseToken?.address;
  if (!address) return null;

  const hasGoPlusSupport = GOPLUS_SUPPORTED.has(goplusChain);
  let security = null;
  if (hasGoPlusSupport) {
    try {
      security = await fetchGoPlus(address, goplusChain);
    } catch { /* proceed without security data */ }
  }

  const { score, flags } = calculateScore(security, pair, goplusChain);
  const volLiqRatio = getVolLiqRatio(pair);
  const momentum = getMomentum(pair);
  const ageMs = pair.pairCreatedAt ? Date.now() - pair.pairCreatedAt : -1;

  return {
    address,
    name: security?.token_name || pair.baseToken?.name || 'Unknown',
    symbol: security?.token_symbol || pair.baseToken?.symbol || '?',
    score,
    flags: flags.filter(f => f.startsWith('❌') || f.startsWith('⚠️')),
    price: pair.priceUsd ? `$${parseFloat(pair.priceUsd).toLocaleString(undefined, { maximumFractionDigits: 8 })}` : '?',
    liquidity: pair.liquidity?.usd ? `$${formatNum(pair.liquidity.usd)}` : '?',
    volume: pair.volume?.h24 ? `$${formatNum(pair.volume.h24)}` : '?',
    age: pair.pairCreatedAt ? formatAge(pair.pairCreatedAt) : '?',
    ageMs,
    buys: pair.txns?.h24?.buys || 0,
    sells: pair.txns?.h24?.sells || 0,
    volLiqRatio,
    momentum,
  };
}

// ============ API Helpers ============

async function fetchNewPairs(dexChain) {
  // Multi-source: token profiles + boosted tokens for wider coverage
  const [profileResp, boostResp] = await Promise.allSettled([
    fetch('https://api.dexscreener.com/token-profiles/latest/v1', { signal: AbortSignal.timeout(HTTP_TIMEOUT) }),
    fetch('https://api.dexscreener.com/token-boosts/latest/v1', { signal: AbortSignal.timeout(HTTP_TIMEOUT) }),
  ]);

  const seen = new Set();
  const tokenAddresses = [];

  // Source 1: Token profiles
  if (profileResp.status === 'fulfilled' && profileResp.value.ok) {
    const profiles = await profileResp.value.json();
    for (const p of (Array.isArray(profiles) ? profiles : [])) {
      if (p.chainId === dexChain && p.tokenAddress && !seen.has(p.tokenAddress)) {
        seen.add(p.tokenAddress);
        tokenAddresses.push(p.tokenAddress);
      }
    }
  }

  // Source 2: Boosted tokens
  if (boostResp.status === 'fulfilled' && boostResp.value.ok) {
    const boosts = await boostResp.value.json();
    for (const b of (Array.isArray(boosts) ? boosts : [])) {
      if (b.chainId === dexChain && b.tokenAddress && !seen.has(b.tokenAddress)) {
        seen.add(b.tokenAddress);
        tokenAddresses.push(b.tokenAddress);
      }
    }
  }

  if (tokenAddresses.length === 0) return [];

  // Batch-fetch pair data (limit 12 to stay within rate limits)
  const pairResults = await Promise.allSettled(
    tokenAddresses.slice(0, 12).map(addr => fetchDexPair(addr))
  );

  return pairResults
    .filter(r => r.status === 'fulfilled' && r.value)
    .map(r => r.value)
    .filter(p => p.liquidity?.usd > 1000)
    .sort((a, b) => (b.pairCreatedAt || 0) - (a.pairCreatedAt || 0));
}

async function fetchGoPlus(address, chainId) {
  const resp = await fetch(
    `https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${address}`,
    { signal: AbortSignal.timeout(HTTP_TIMEOUT) }
  );
  if (!resp.ok) throw new Error(`GoPlus ${resp.status}`);
  const data = await resp.json();
  if (data.code !== 1) return null;
  return data.result?.[address.toLowerCase()] || null;
}

async function fetchDexPair(address) {
  const resp = await fetch(
    `https://api.dexscreener.com/latest/dex/tokens/${address}`,
    { signal: AbortSignal.timeout(HTTP_TIMEOUT) }
  );
  if (!resp.ok) throw new Error(`DEXScreener ${resp.status}`);
  const data = await resp.json();
  const pairs = data.pairs || [];
  if (pairs.length === 0) return null;
  // Return highest liquidity pair
  return pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
}

// ============ Human-in-the-Loop: Alert → Approve → Execute ============

/**
 * Send a trade alert to the review chat with approve/reject inline keyboard.
 * @param {object} scored - Token data from scoreToken()
 * @param {function} sendTg - (chatId, text, opts) => Promise - sends TG message
 * @returns {string|null} callback ID if alert sent, null if skipped
 */
export async function alertHuman(scored, sendTg) {
  if (!sendTg) return null;

  const mc = config.memehunter;
  const chatId = mc.reviewChatId || config.ownerUserId;
  if (!chatId) return null;

  // Check pending limit
  if (pendingApprovals.size >= mc.maxPending) return null;

  const ethAmount = mc.maxPositionEth;
  const callbackId = `meme_${scored.address.slice(2, 10)}_${Date.now()}`;

  // Format alert
  const scoreEmoji = scored.score >= 70 ? '🟢' : scored.score >= 40 ? '🟡' : '🔴';
  const tags = [];
  if (scored.ageMs > 0 && scored.ageMs < 7200000) tags.push('EARLY');
  if (scored.volLiqRatio >= 2) tags.push('HOT');
  if (scored.momentum > 0) tags.push('PUMPING');
  const tagStr = tags.length ? ` [${tags.join(' ')}]` : '';

  const text = [
    `${scoreEmoji} MEME TRADE ALERT${tagStr}`,
    ``,
    `${scored.name} (${scored.symbol}) — ${scored.score}/100`,
    `Price: ${scored.price} | Liq: ${scored.liquidity}`,
    `Vol: ${scored.volume} | V/L: ${scored.volLiqRatio.toFixed(1)}x`,
    `Age: ${scored.age} | ${scored.buys} buys / ${scored.sells} sells`,
    scored.flags.length > 0 ? `\nFlags: ${scored.flags.join(', ')}` : '',
    ``,
    `Proposed: Buy ${ethAmount} ETH worth`,
    `Address: ${scored.address}`,
    ``,
    `Expires in ${Math.round(mc.approvalTimeoutMs / 60000)}min`,
  ].filter(Boolean).join('\n');

  try {
    const msg = await sendTg(chatId, text, {
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Ape In', callback_data: `meme_approve:${callbackId}` },
          { text: '❌ Skip', callback_data: `meme_reject:${callbackId}` },
        ]],
      },
    });

    pendingApprovals.set(callbackId, {
      token: scored.address,
      symbol: scored.symbol,
      name: scored.name,
      scored,
      ethAmount,
      expiresAt: Date.now() + mc.approvalTimeoutMs,
      messageId: msg?.message_id,
      chatId,
    });

    return callbackId;
  } catch (err) {
    console.error(`[memehunter] Alert send failed: ${err.message}`);
    return null;
  }
}

/**
 * Handle approve/reject callback from TG inline keyboard.
 * @param {string} action - 'meme_approve' or 'meme_reject'
 * @param {string} callbackId - The callback ID from the alert
 * @param {function} sendTg - (chatId, text) => Promise
 * @returns {string} Result message
 */
export async function handleMemeCallback(action, callbackId, sendTg) {
  const approval = pendingApprovals.get(callbackId);
  if (!approval) return 'Expired or already handled.';

  pendingApprovals.delete(callbackId);

  if (action === 'meme_reject') {
    return `❌ Skipped ${approval.symbol}`;
  }

  // action === 'meme_approve'
  if (sendTg) {
    await sendTg(approval.chatId, `⏳ Executing swap: ${approval.ethAmount} ETH → ${approval.symbol}...`);
  }

  const result = await executeMemeSwap(approval.token, approval.ethAmount, approval.scored);

  if (result.error) {
    const msg = `❌ Trade failed: ${result.error}`;
    if (sendTg) await sendTg(approval.chatId, msg);
    return msg;
  }

  const msg = [
    `✅ TRADE EXECUTED`,
    `${approval.ethAmount} ETH → ${approval.symbol}`,
    `Expected: ~${result.expectedTokens} ${approval.symbol}`,
    `Fee tier: ${result.feeTier / 10000}%`,
    `TX: ${result.explorer}`,
  ].join('\n');

  if (sendTg) await sendTg(approval.chatId, msg);
  return msg;
}

/**
 * Get pending approvals for display.
 */
export function getPendingApprovals() {
  if (pendingApprovals.size === 0) return 'No pending trade alerts.';

  const lines = [`PENDING APPROVALS (${pendingApprovals.size}/${config.memehunter.maxPending})\n`];
  for (const [id, a] of pendingApprovals) {
    const remaining = Math.max(0, Math.round((a.expiresAt - Date.now()) / 1000));
    lines.push(`${a.symbol} — ${a.ethAmount} ETH — ${remaining}s remaining`);
    lines.push(`  Score: ${a.scored.score}/100 | ${a.token.slice(0, 10)}...`);
  }
  return lines.join('\n');
}

// ============ Trade Execution: ETH → Meme Token via Uniswap V3 ============

/**
 * Find the best fee tier for a token pair by trying quotes.
 */
async function findBestFeeTier(tokenAddress, amountIn) {
  const feeTiers = config.memehunter.feeTiers;
  let bestQuote = null;
  let bestFee = null;

  for (const fee of feeTiers) {
    try {
      const calldata = quoterIface.encodeFunctionData('quoteExactInputSingle', [{
        tokenIn: WETH,
        tokenOut: tokenAddress,
        amountIn,
        fee,
        sqrtPriceLimitX96: 0n,
      }]);

      const result = await memeProvider.call({ to: QUOTER_V2, data: calldata });
      const decoded = quoterIface.decodeFunctionResult('quoteExactInputSingle', result);
      const amountOut = decoded[0];

      if (!bestQuote || amountOut > bestQuote) {
        bestQuote = amountOut;
        bestFee = fee;
      }
    } catch {
      // This fee tier doesn't have a pool — skip
    }
  }

  return bestQuote ? { amountOut: bestQuote, fee: bestFee } : null;
}

/**
 * Execute a swap: ETH → meme token on Uniswap V3 (Base).
 */
async function executeMemeSwap(tokenAddress, ethAmount, scored) {
  const walletInfo = getWalletInfo();
  if (!walletInfo.address) return { error: 'Wallet not initialized.' };
  if (walletInfo.unlocked === false) return { error: 'Wallet locked. Unlock first.' };

  const amountWei = ethers.parseEther(ethAmount.toString());

  // Find best pool
  const quote = await findBestFeeTier(tokenAddress, amountWei);
  if (!quote) return { error: `No Uniswap V3 pool found for ${scored?.symbol || tokenAddress.slice(0, 10)}` };

  // Get token decimals for display
  let decimals = 18;
  try {
    const token = new ethers.Contract(tokenAddress, ERC20_ABI, memeProvider);
    decimals = await token.decimals();
  } catch { /* default 18 */ }

  const slippageBps = config.memehunter.slippageBps;
  const minOut = quote.amountOut * BigInt(10000 - slippageBps) / 10000n;
  const expectedTokens = Number(quote.amountOut) / (10 ** Number(decimals));

  // Whitelist router
  addToWhitelist(SWAP_ROUTER);

  // Encode swap
  const swapCalldata = routerIface.encodeFunctionData('exactInputSingle', [{
    tokenIn: WETH,
    tokenOut: tokenAddress,
    fee: quote.fee,
    recipient: walletInfo.address,
    amountIn: amountWei,
    amountOutMinimum: minOut,
    sqrtPriceLimitX96: 0n,
  }]);

  const deadline = Math.floor(Date.now() / 1000) + 120;
  const data = routerIface.encodeFunctionData('multicall', [deadline, [swapCalldata]]);

  // Estimate USD value for spending limit check
  let ethPrice = 2000;
  try {
    const priceQuote = quoterIface.encodeFunctionData('quoteExactInputSingle', [{
      tokenIn: WETH,
      tokenOut: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC on Base
      amountIn: ethers.parseEther('1'),
      fee: 500,
      sqrtPriceLimitX96: 0n,
    }]);
    const priceResult = await memeProvider.call({ to: QUOTER_V2, data: priceQuote });
    const priceDecoded = quoterIface.decodeFunctionResult('quoteExactInputSingle', priceResult);
    ethPrice = Number(priceDecoded[0]) / 1e6;
  } catch { /* use default */ }

  const usdValue = parseFloat(ethAmount) * ethPrice;

  const result = await sendTransaction({
    to: SWAP_ROUTER,
    value: ethAmount.toString(),
    data,
    chain: 'base',
    usdValue,
  });

  if (result.error) return result;

  // Log the meme trade
  const trade = {
    timestamp: new Date().toISOString(),
    type: 'meme_buy',
    tokenAddress,
    symbol: scored?.symbol || '?',
    name: scored?.name || '?',
    ethIn: ethAmount.toString(),
    expectedTokens: expectedTokens.toFixed(4),
    feeTier: quote.fee,
    score: scored?.score || 0,
    txHash: result.hash,
    ethPrice,
    usdValue: usdValue.toFixed(2),
  };

  try {
    await appendFile(MEME_TRADE_LOG, JSON.stringify(trade) + '\n');
  } catch (err) {
    console.warn(`[memehunter] Trade log failed: ${err.message}`);
  }

  return {
    ...result,
    trade,
    expectedTokens: expectedTokens.toFixed(4),
    feeTier: quote.fee,
  };
}

// ============ Formatters ============

function formatNum(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

function formatAge(timestamp) {
  const ms = Date.now() - timestamp;
  if (ms < 60000) return 'just now';
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
  if (ms < 86400000) return `${Math.round(ms / 3600000)}h`;
  return `${Math.round(ms / 86400000)}d`;
}

function fmtPct(p) {
  if (p == null) return '?';
  return `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`;
}
