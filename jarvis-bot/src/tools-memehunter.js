// ============ Memecoin Hunter — Orchestration Layer ============
//
// Extends tools-scanner.js and tools-security.js with:
// 1. Composite risk scoring (0-100, higher = safer)
// 2. New token hunting with auto-security-check
// 3. Liquidity monitoring via DEXScreener
// 4. Background monitor that auto-posts alerts to TG
//
// Commands:
//   /hunt [chain]           — Scan new tokens, score them, show best candidates
//   /score <address> [chain] — Deep risk score for a single token
//   /monitor [chain]        — Start background memecoin monitor (posts alerts)
//   /stopmonitor            — Stop background monitor
// ============

const HTTP_TIMEOUT = 12000;

// GoPlus chain IDs (same as tools-security.js)
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
  if (!input) return '8453'; // Default Base
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
    // Step 1: Get new pairs from DEXScreener
    const pairs = await fetchNewPairs(dexChain);

    if (pairs.length === 0) {
      return `No new tokens found on ${dexChain}. Try: /hunt base, /hunt sol, /hunt eth`;
    }

    // Step 2: Score each token in parallel (max 6 to stay within rate limits)
    const candidates = pairs.slice(0, 6);
    const scored = await Promise.allSettled(
      candidates.map(p => scoreToken(p, goplusChain))
    );

    // Step 3: Sort by score, filter duds
    const results = scored
      .filter(r => r.status === 'fulfilled' && r.value)
      .map(r => r.value)
      .sort((a, b) => b.score - a.score);

    if (results.length === 0) {
      return `Found ${pairs.length} new tokens on ${dexChain} but none passed security scoring. All likely rugs.`;
    }

    // Step 4: Format output
    const lines = [`MEMECOIN HUNT — ${dexChain.toUpperCase()}\n`];

    for (const r of results) {
      const scoreEmoji = r.score >= 70 ? '🟢' : r.score >= 40 ? '🟡' : '🔴';
      const riskLabel = r.score >= 70 ? 'LOW RISK' : r.score >= 40 ? 'MODERATE' : 'HIGH RISK';
      lines.push(`${scoreEmoji} ${r.name} (${r.symbol}) — ${r.score}/100 ${riskLabel}`);
      lines.push(`  Price: ${r.price} | Liq: ${r.liquidity} | Vol: ${r.volume}`);
      lines.push(`  Age: ${r.age} | Buys/Sells: ${r.buys}/${r.sells}`);
      if (r.flags.length > 0) {
        lines.push(`  Flags: ${r.flags.join(', ')}`);
      }
      lines.push(`  /score ${r.address} ${chain || 'base'}`);
      lines.push('');
    }

    lines.push(`Scanned ${pairs.length} pairs, ${results.length} scored.`);
    return lines.join('\n');
  } catch (err) {
    return `Hunt failed: ${err.message}`;
  }
}

// ============ /score — Deep Risk Score for Single Token ============

export async function getMemeScore(address, chain) {
  if (!address) return 'Usage: /score 0x... [chain]\n\nDeep risk analysis for a single token.\nDefault chain: base';

  const goplusChain = resolveChainId(chain);
  const dexChain = resolveDexChain(chain);

  try {
    // Parallel fetch: GoPlus security + DEXScreener pair data
    const [securityData, pairData] = await Promise.allSettled([
      fetchGoPlus(address, goplusChain),
      fetchDexPair(address),
    ]);

    const security = securityData.status === 'fulfilled' ? securityData.value : null;
    const pair = pairData.status === 'fulfilled' ? pairData.value : null;

    if (!security && !pair) {
      return `Token ${address.slice(0, 10)}... not found on ${chain || 'base'}. Check the address and chain.`;
    }

    // Calculate composite score
    const { score, breakdown, flags } = calculateScore(security, pair);

    const lines = [];
    const scoreEmoji = score >= 70 ? '🟢' : score >= 40 ? '🟡' : '🔴';
    const riskLabel = score >= 70 ? 'LOW RISK' : score >= 40 ? 'MODERATE' : 'HIGH RISK';

    const name = security?.token_name || pair?.baseToken?.name || 'Unknown';
    const symbol = security?.token_symbol || pair?.baseToken?.symbol || '?';

    lines.push(`${scoreEmoji} ${name} (${symbol}) — ${score}/100 ${riskLabel}\n`);

    // Score breakdown
    lines.push('  SCORE BREAKDOWN');
    for (const [category, points] of Object.entries(breakdown)) {
      const bar = '█'.repeat(Math.round(points / 5)) + '░'.repeat(Math.round((20 - points) / 5));
      lines.push(`    ${category.padEnd(14)} ${bar} ${points}/20`);
    }

    // Pair data
    if (pair) {
      const price = pair.priceUsd ? `$${parseFloat(pair.priceUsd).toLocaleString(undefined, { maximumFractionDigits: 8 })}` : '?';
      const liq = pair.liquidity?.usd ? `$${formatNum(pair.liquidity.usd)}` : '?';
      const vol = pair.volume?.h24 ? `$${formatNum(pair.volume.h24)}` : '?';
      const buys = pair.txns?.h24?.buys || 0;
      const sells = pair.txns?.h24?.sells || 0;
      const fdv = pair.fdv ? `$${formatNum(pair.fdv)}` : '?';

      lines.push('\n  MARKET DATA');
      lines.push(`    Price: ${price}`);
      lines.push(`    Liquidity: ${liq} | FDV: ${fdv}`);
      lines.push(`    24h Volume: ${vol}`);
      lines.push(`    24h Txns: ${buys} buys / ${sells} sells`);
      if (pair.priceChange) {
        const changes = [];
        if (pair.priceChange.m5 != null) changes.push(`5m: ${fmtPct(pair.priceChange.m5)}`);
        if (pair.priceChange.h1 != null) changes.push(`1h: ${fmtPct(pair.priceChange.h1)}`);
        if (pair.priceChange.h24 != null) changes.push(`24h: ${fmtPct(pair.priceChange.h24)}`);
        if (changes.length) lines.push(`    Changes: ${changes.join(' | ')}`);
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

// ============ /monitor — Background Memecoin Monitor ============

let monitorInterval = null;
let monitorState = { chain: 'base', seenTokens: new Set(), alertCount: 0, startedAt: null };

export function startMemeMonitor(chain, postAlert) {
  if (monitorInterval) {
    return 'Monitor already running. Use /stopmonitor to stop it first.';
  }

  const dexChain = resolveDexChain(chain);
  const goplusChain = resolveChainId(chain);
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
          if (scored && scored.score >= 40) {
            monitorState.alertCount++;
            const emoji = scored.score >= 70 ? '🟢' : '🟡';
            const msg = [
              `${emoji} NEW TOKEN ALERT (#${monitorState.alertCount})`,
              `${scored.name} (${scored.symbol}) — ${scored.score}/100`,
              `Price: ${scored.price} | Liq: ${scored.liquidity}`,
              `Age: ${scored.age} | ${scored.buys} buys / ${scored.sells} sells`,
              scored.flags.length > 0 ? `Flags: ${scored.flags.join(', ')}` : '',
              `/score ${scored.address} ${chain || 'base'}`,
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
  }, 60_000); // Check every 60 seconds

  return `Memecoin monitor started on ${dexChain.toUpperCase()}. Checking every 60s. Alerts for tokens scoring 40+. Use /stopmonitor to stop.`;
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
  if (!monitorInterval) return 'Monitor is not running. Start with /monitor [chain]';
  const duration = monitorState.startedAt ? formatAge(monitorState.startedAt) : '?';
  return `Monitor running on ${monitorState.chain.toUpperCase()} for ${duration}. ${monitorState.alertCount} alerts sent, ${monitorState.seenTokens.size} tokens scanned.`;
}

// ============ Scoring Engine ============

function calculateScore(security, pair) {
  const breakdown = {
    'Honeypot':     20,  // Start at max, deduct for red flags
    'Ownership':    20,
    'Tokenomics':   20,
    'Liquidity':    20,
    'Activity':     20,
  };
  const flags = [];

  // ---- Honeypot (20 points) ----
  if (security) {
    if (security.is_honeypot === '1') { breakdown['Honeypot'] = 0; flags.push('❌ HONEYPOT'); }
    else if (security.is_honeypot === '0') { /* keep 20 */ }
    if (security.selfdestruct === '1') { breakdown['Honeypot'] -= 10; flags.push('❌ Selfdestruct'); }
    if (security.external_call === '1') { breakdown['Honeypot'] -= 5; flags.push('⚠️ External call'); }
    if (security.cannot_sell_all === '1') { breakdown['Honeypot'] -= 10; flags.push('❌ Cannot sell all'); }
  } else {
    breakdown['Honeypot'] = 5; // Unknown = assume risky
    flags.push('⚠️ No security data');
  }

  // ---- Ownership (20 points) ----
  if (security) {
    if (security.hidden_owner === '1') { breakdown['Ownership'] -= 15; flags.push('❌ Hidden owner'); }
    if (security.can_take_back_ownership === '1') { breakdown['Ownership'] -= 10; flags.push('❌ Can reclaim ownership'); }
    if (security.owner_change_balance === '1') { breakdown['Ownership'] -= 15; flags.push('❌ Owner can change balances'); }
    const owner = security.owner_address;
    if (owner === '0x0000000000000000000000000000000000000000') {
      breakdown['Ownership'] = Math.max(breakdown['Ownership'], 18); // Renounced = good
      flags.push('✅ Ownership renounced');
    }
    if (security.is_proxy === '1') { breakdown['Ownership'] -= 5; flags.push('⚠️ Proxy (upgradeable)'); }
  } else {
    breakdown['Ownership'] = 5;
  }

  // ---- Tokenomics (20 points) ----
  if (security) {
    const buyTax = parseFloat(security.buy_tax || '0');
    const sellTax = parseFloat(security.sell_tax || '0');
    if (buyTax > 0.1) { breakdown['Tokenomics'] -= 10; flags.push(`⚠️ High buy tax: ${(buyTax * 100).toFixed(1)}%`); }
    else if (buyTax > 0.05) { breakdown['Tokenomics'] -= 5; }
    if (sellTax > 0.1) { breakdown['Tokenomics'] -= 10; flags.push(`⚠️ High sell tax: ${(sellTax * 100).toFixed(1)}%`); }
    else if (sellTax > 0.05) { breakdown['Tokenomics'] -= 5; }
    if (security.is_mintable === '1') { breakdown['Tokenomics'] -= 5; flags.push('⚠️ Mintable'); }
    if (security.slippage_modifiable === '1') { breakdown['Tokenomics'] -= 5; flags.push('⚠️ Slippage modifiable'); }
    if (security.transfer_pausable === '1') { breakdown['Tokenomics'] -= 5; flags.push('⚠️ Transfers pausable'); }
    if (security.is_blacklisted === '1') { breakdown['Tokenomics'] -= 5; flags.push('⚠️ Has blacklist'); }
    if (security.is_open_source === '1') { flags.push('✅ Open source'); }
    else { breakdown['Tokenomics'] -= 5; flags.push('⚠️ Not open source'); }
  } else {
    breakdown['Tokenomics'] = 5;
  }

  // ---- Liquidity (20 points) ----
  if (pair) {
    const liq = pair.liquidity?.usd || 0;
    if (liq >= 100000) breakdown['Liquidity'] = 20;
    else if (liq >= 50000) breakdown['Liquidity'] = 16;
    else if (liq >= 10000) breakdown['Liquidity'] = 12;
    else if (liq >= 5000) breakdown['Liquidity'] = 8;
    else if (liq >= 1000) breakdown['Liquidity'] = 4;
    else { breakdown['Liquidity'] = 2; flags.push('⚠️ Very low liquidity'); }

    // LP lock check via holder count
    const lpHolders = parseInt(security?.lp_holder_count || '0');
    if (lpHolders <= 1) { breakdown['Liquidity'] -= 5; flags.push('⚠️ Single LP holder'); }
  } else {
    breakdown['Liquidity'] = 5;
  }

  // ---- Activity (20 points) ----
  if (pair) {
    const buys = pair.txns?.h24?.buys || 0;
    const sells = pair.txns?.h24?.sells || 0;
    const total = buys + sells;

    if (total >= 100) breakdown['Activity'] = 20;
    else if (total >= 50) breakdown['Activity'] = 16;
    else if (total >= 20) breakdown['Activity'] = 12;
    else if (total >= 5) breakdown['Activity'] = 8;
    else { breakdown['Activity'] = 3; flags.push('⚠️ Very low activity'); }

    // Buy/sell ratio — heavy sells = dumping
    if (total > 10 && sells > buys * 2) {
      breakdown['Activity'] -= 5;
      flags.push('⚠️ Heavy selling pressure');
    }

    // Holder concentration
    const holders = parseInt(security?.holder_count || '0');
    if (holders > 0 && holders < 10) { breakdown['Activity'] -= 5; flags.push('⚠️ Very few holders'); }
  } else {
    breakdown['Activity'] = 5;
  }

  // Clamp all categories
  for (const key of Object.keys(breakdown)) {
    breakdown[key] = Math.max(0, Math.min(20, breakdown[key]));
  }

  const score = Object.values(breakdown).reduce((a, b) => a + b, 0);
  return { score, breakdown, flags };
}

async function scoreToken(pair, goplusChain) {
  const address = pair.baseToken?.address;
  if (!address) return null;

  let security = null;
  try {
    security = await fetchGoPlus(address, goplusChain);
  } catch { /* proceed without security data */ }

  const { score, flags } = calculateScore(security, pair);

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
    buys: pair.txns?.h24?.buys || 0,
    sells: pair.txns?.h24?.sells || 0,
  };
}

// ============ API Helpers ============

async function fetchNewPairs(dexChain) {
  // Strategy: fetch latest token profiles, filter by chain, then get pair data
  const profileResp = await fetch(
    'https://api.dexscreener.com/token-profiles/latest/v1',
    { signal: AbortSignal.timeout(HTTP_TIMEOUT) }
  );
  if (!profileResp.ok) throw new Error(`DEXScreener profiles ${profileResp.status}`);
  const profiles = await profileResp.json();

  // Filter profiles by chain
  const chainProfiles = (Array.isArray(profiles) ? profiles : [])
    .filter(p => p.chainId === dexChain && p.tokenAddress)
    .slice(0, 10); // Limit to avoid rate limits

  if (chainProfiles.length === 0) return [];

  // Batch-fetch pair data for discovered tokens
  const pairResults = await Promise.allSettled(
    chainProfiles.map(p => fetchDexPair(p.tokenAddress))
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
