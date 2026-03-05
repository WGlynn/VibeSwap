// ============ Token Launch Scanner — DEXScreener + GoPlus ============
//
// Detect new token launches across chains in real-time.
// DEXScreener API is free and unlimited.
//
// Commands:
//   /scanner [chain]      — Latest token launches (filtered)
//   /newpairs [chain]     — Raw new pairs (unfiltered)
//   /hot                  — DEXScreener trending tokens
//   /dexsearch <query>    — Search tokens on DEXScreener
//   /pair <address>       — Pair details
// ============

const HTTP_TIMEOUT = 12000;

const CHAIN_MAP = {
  eth: 'ethereum', ethereum: 'ethereum',
  bsc: 'bsc', bnb: 'bsc', binance: 'bsc',
  sol: 'solana', solana: 'solana',
  arb: 'arbitrum', arbitrum: 'arbitrum',
  base: 'base',
  polygon: 'polygon', matic: 'polygon',
  avax: 'avalanche', avalanche: 'avalanche',
  op: 'optimism', optimism: 'optimism',
  ton: 'ton',
};

// ============ /scanner — Filtered New Launches ============

export async function scanNewTokens(chain) {
  const chainId = chain ? (CHAIN_MAP[chain.toLowerCase()] || chain.toLowerCase()) : null;

  try {
    // DEXScreener latest token profiles (boosted/promoted tokens)
    const url = chainId
      ? `https://api.dexscreener.com/token-profiles/latest/v1`
      : `https://api.dexscreener.com/token-profiles/latest/v1`;

    const resp = await fetch(url, {
      signal: AbortSignal.timeout(HTTP_TIMEOUT),
      headers: { 'Accept': 'application/json' },
    });
    if (!resp.ok) throw new Error(`DEXScreener ${resp.status}`);
    const profiles = await resp.json();

    // Filter by chain if specified
    let filtered = Array.isArray(profiles) ? profiles : [];
    if (chainId) {
      filtered = filtered.filter(p => p.chainId === chainId);
    }

    if (filtered.length === 0) {
      return `No new token launches found${chainId ? ` on ${chainId}` : ''}.\n\nTry: /scanner sol, /scanner base, /scanner eth`;
    }

    const lines = [`New Token Launches${chainId ? ` — ${chainId.toUpperCase()}` : ''}\n`];
    const shown = filtered.slice(0, 8);

    for (const token of shown) {
      const name = token.description?.slice(0, 40) || token.tokenAddress?.slice(0, 10) || '?';
      const chain = token.chainId || '?';
      const addr = token.tokenAddress ? `${token.tokenAddress.slice(0, 8)}...` : '?';
      const hasIcon = token.icon ? 'yes' : 'no';
      lines.push(`  ${chain.toUpperCase()} | ${name}`);
      lines.push(`    ${addr} | Icon: ${hasIcon}`);
      if (token.links?.length > 0) {
        const site = token.links.find(l => l.type === 'website');
        const twitter = token.links.find(l => l.type === 'twitter');
        const parts = [];
        if (site) parts.push(`Web: ${site.url?.slice(0, 30)}`);
        if (twitter) parts.push(`X: @${twitter.url?.split('/').pop()}`);
        if (parts.length > 0) lines.push(`    ${parts.join(' | ')}`);
      }
    }

    if (filtered.length > 8) {
      lines.push(`\n  ... and ${filtered.length - 8} more`);
    }
    lines.push(`\n  Use /dexsearch <name> for details`);

    return lines.join('\n');
  } catch (err) {
    return `Token scanner failed: ${err.message}`;
  }
}

// ============ /newpairs — Raw New Pairs ============

export async function getNewPairs(chain) {
  const chainId = chain ? (CHAIN_MAP[chain.toLowerCase()] || chain.toLowerCase()) : 'solana';

  try {
    const resp = await fetch(
      `https://api.dexscreener.com/latest/dex/pairs/${chainId}`,
      { signal: AbortSignal.timeout(HTTP_TIMEOUT) }
    );
    if (!resp.ok) throw new Error(`DEXScreener ${resp.status}`);
    const data = await resp.json();
    const pairs = data.pairs || [];

    if (pairs.length === 0) return `No pairs found on ${chainId}.`;

    // Sort by creation time (newest first) and filter low liquidity
    const sorted = pairs
      .filter(p => p.liquidity?.usd > 1000)
      .sort((a, b) => (b.pairCreatedAt || 0) - (a.pairCreatedAt || 0))
      .slice(0, 8);

    const lines = [`New Pairs — ${chainId.toUpperCase()}\n`];
    for (const p of sorted) {
      const name = `${p.baseToken?.symbol || '?'}/${p.quoteToken?.symbol || '?'}`;
      const price = p.priceUsd ? `$${parseFloat(p.priceUsd).toLocaleString(undefined, { maximumFractionDigits: 8 })}` : '?';
      const liq = p.liquidity?.usd ? `$${formatNum(p.liquidity.usd)}` : '?';
      const vol = p.volume?.h24 ? `$${formatNum(p.volume.h24)}` : '?';
      const change5m = p.priceChange?.m5;
      const change1h = p.priceChange?.h1;
      const changeStr = change5m != null ? `5m: ${change5m >= 0 ? '+' : ''}${change5m.toFixed(1)}%` : '';
      const age = p.pairCreatedAt ? formatAge(p.pairCreatedAt) : '?';

      lines.push(`  ${name} | ${price}`);
      lines.push(`    Liq: ${liq} | Vol: ${vol} | ${changeStr} | Age: ${age}`);
    }

    return lines.join('\n');
  } catch (err) {
    return `New pairs failed: ${err.message}`;
  }
}

// ============ /hot — DEXScreener Boosted Tokens ============

export async function getHotTokens() {
  try {
    const resp = await fetch('https://api.dexscreener.com/token-boosts/top/v1', {
      signal: AbortSignal.timeout(HTTP_TIMEOUT),
    });
    if (!resp.ok) throw new Error(`DEXScreener ${resp.status}`);
    const data = await resp.json();

    if (!Array.isArray(data) || data.length === 0) return 'No trending tokens found.';

    const lines = ['DEXScreener Hot Tokens\n'];
    const seen = new Set();

    for (const token of data.slice(0, 12)) {
      const key = `${token.chainId}-${token.tokenAddress}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const chain = (token.chainId || '?').toUpperCase();
      const addr = token.tokenAddress ? `${token.tokenAddress.slice(0, 8)}...` : '?';
      const desc = token.description?.slice(0, 50) || addr;
      const amount = token.totalAmount ? `${token.totalAmount} boosts` : '';

      lines.push(`  ${chain} | ${desc}`);
      if (amount) lines.push(`    ${amount} | ${addr}`);
    }

    lines.push('\n  Use /dexsearch <name> for full details');
    return lines.join('\n');
  } catch (err) {
    return `Hot tokens failed: ${err.message}`;
  }
}

// ============ /dexsearch — Token Search ============

export async function dexSearch(query) {
  if (!query) return 'Usage: /dexsearch pepe\n\nSearches DEXScreener for token pairs.';

  try {
    const resp = await fetch(
      `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`,
      { signal: AbortSignal.timeout(HTTP_TIMEOUT) }
    );
    if (!resp.ok) throw new Error(`DEXScreener ${resp.status}`);
    const data = await resp.json();
    const pairs = data.pairs || [];

    if (pairs.length === 0) return `No results for "${query}".`;

    // Show top 6 results sorted by liquidity
    const sorted = pairs
      .sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))
      .slice(0, 6);

    const lines = [`DEXScreener: "${query}"\n`];
    for (const p of sorted) {
      const name = `${p.baseToken?.symbol || '?'}/${p.quoteToken?.symbol || '?'}`;
      const chain = (p.chainId || '?').toUpperCase();
      const price = p.priceUsd ? `$${parseFloat(p.priceUsd).toLocaleString(undefined, { maximumFractionDigits: 8 })}` : '?';
      const liq = p.liquidity?.usd ? `$${formatNum(p.liquidity.usd)}` : '?';
      const vol24 = p.volume?.h24 ? `$${formatNum(p.volume.h24)}` : '?';
      const change24 = p.priceChange?.h24;
      const changeStr = change24 != null ? `(${change24 >= 0 ? '+' : ''}${change24.toFixed(1)}%)` : '';
      const dex = p.dexId || '?';

      lines.push(`  ${name} on ${chain} (${dex})`);
      lines.push(`    ${price} ${changeStr} | Liq: ${liq} | Vol: ${vol24}`);
    }

    return lines.join('\n');
  } catch (err) {
    return `Search failed: ${err.message}`;
  }
}

// ============ /pair — Pair Details ============

export async function getPairDetails(address) {
  if (!address) return 'Usage: /pair 0x...\n\nGet detailed info for a DEX pair.';

  try {
    // Try searching by token address across chains
    const resp = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${address}`,
      { signal: AbortSignal.timeout(HTTP_TIMEOUT) }
    );
    if (!resp.ok) throw new Error(`DEXScreener ${resp.status}`);
    const data = await resp.json();
    const pairs = data.pairs || [];

    if (pairs.length === 0) return `No pairs found for ${address.slice(0, 10)}...`;

    // Show the highest liquidity pair
    const p = pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];

    const lines = [`${p.baseToken?.name || '?'} (${p.baseToken?.symbol || '?'})\n`];
    lines.push(`  Chain: ${(p.chainId || '?').toUpperCase()} | DEX: ${p.dexId || '?'}`);
    lines.push(`  Pair: ${p.baseToken?.symbol}/${p.quoteToken?.symbol}`);

    if (p.priceUsd) lines.push(`  Price: $${parseFloat(p.priceUsd).toLocaleString(undefined, { maximumFractionDigits: 8 })}`);
    if (p.priceChange) {
      const changes = [];
      if (p.priceChange.m5 != null) changes.push(`5m: ${p.priceChange.m5 >= 0 ? '+' : ''}${p.priceChange.m5.toFixed(1)}%`);
      if (p.priceChange.h1 != null) changes.push(`1h: ${p.priceChange.h1 >= 0 ? '+' : ''}${p.priceChange.h1.toFixed(1)}%`);
      if (p.priceChange.h6 != null) changes.push(`6h: ${p.priceChange.h6 >= 0 ? '+' : ''}${p.priceChange.h6.toFixed(1)}%`);
      if (p.priceChange.h24 != null) changes.push(`24h: ${p.priceChange.h24 >= 0 ? '+' : ''}${p.priceChange.h24.toFixed(1)}%`);
      if (changes.length > 0) lines.push(`  ${changes.join(' | ')}`);
    }

    if (p.liquidity?.usd) lines.push(`  Liquidity: $${formatNum(p.liquidity.usd)}`);
    if (p.volume?.h24) lines.push(`  24h Volume: $${formatNum(p.volume.h24)}`);
    if (p.txns?.h24) {
      const buys = p.txns.h24.buys || 0;
      const sells = p.txns.h24.sells || 0;
      lines.push(`  24h Txns: ${buys} buys / ${sells} sells`);
    }
    if (p.fdv) lines.push(`  FDV: $${formatNum(p.fdv)}`);
    if (p.pairCreatedAt) lines.push(`  Created: ${formatAge(p.pairCreatedAt)}`);

    if (p.url) lines.push(`\n  ${p.url}`);
    lines.push(`\n  Security: /rugcheck ${address}`);

    return lines.join('\n');
  } catch (err) {
    return `Pair details failed: ${err.message}`;
  }
}

// ============ Helpers ============

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
