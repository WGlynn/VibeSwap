// ============ Crypto Alerts & Market Movers — Free APIs ============
//
// Commands:
//   /gainers           — Top 24h gainers (CoinGecko)
//   /losers            — Top 24h losers (CoinGecko)
//   /volume            — Top volume movers (CoinGecko)
//   /nft <collection>  — NFT collection stats (free APIs)
//   /btc               — Quick BTC summary
//   /eth               — Quick ETH summary
//   /watchlist         — Personal price watchlist
//   /watch <token>     — Add token to watchlist
//   /unwatch <token>   — Remove from watchlist
// ============

const HTTP_TIMEOUT = 10000;

async function fetchCoinGecko(path) {
  const resp = await fetch(`https://api.coingecko.com/api/v3${path}`, {
    signal: AbortSignal.timeout(HTTP_TIMEOUT),
    headers: { 'Accept': 'application/json' },
  });
  if (!resp.ok) throw new Error(`CoinGecko ${resp.status}`);
  return resp.json();
}

function formatLargeNum(n) {
  if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toFixed(0);
}

// ============ Top Gainers (CoinGecko) ============

export async function getGainers() {
  try {
    const data = await fetchCoinGecko('/coins/markets?vs_currency=usd&order=percent_change_24h_desc&per_page=10&page=1&sparkline=false&price_change_percentage=24h');

    // CoinGecko's free sort might not be exact, so re-sort client side
    const sorted = data
      .filter(c => c.price_change_percentage_24h != null && c.market_cap > 10000000)
      .sort((a, b) => b.price_change_percentage_24h - a.price_change_percentage_24h)
      .slice(0, 10);

    if (sorted.length === 0) return 'No gainer data available.';

    const lines = ['Top 24h Gainers\n'];
    for (let i = 0; i < sorted.length; i++) {
      const c = sorted[i];
      const change = c.price_change_percentage_24h;
      const priceStr = c.current_price >= 1 ? `$${c.current_price.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : `$${c.current_price.toFixed(6)}`;
      lines.push(`  ${String(i + 1).padStart(2)}. ${c.symbol.toUpperCase().padEnd(6)} ${priceStr.padEnd(14)} +${change.toFixed(1)}%`);
    }
    return lines.join('\n');
  } catch (err) {
    return `Gainers lookup failed: ${err.message}`;
  }
}

// ============ Top Losers (CoinGecko) ============

export async function getLosers() {
  try {
    const data = await fetchCoinGecko('/coins/markets?vs_currency=usd&order=percent_change_24h_asc&per_page=15&page=1&sparkline=false&price_change_percentage=24h');

    const sorted = data
      .filter(c => c.price_change_percentage_24h != null && c.market_cap > 10000000)
      .sort((a, b) => a.price_change_percentage_24h - b.price_change_percentage_24h)
      .slice(0, 10);

    if (sorted.length === 0) return 'No loser data available.';

    const lines = ['Top 24h Losers\n'];
    for (let i = 0; i < sorted.length; i++) {
      const c = sorted[i];
      const change = c.price_change_percentage_24h;
      const priceStr = c.current_price >= 1 ? `$${c.current_price.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : `$${c.current_price.toFixed(6)}`;
      lines.push(`  ${String(i + 1).padStart(2)}. ${c.symbol.toUpperCase().padEnd(6)} ${priceStr.padEnd(14)} ${change.toFixed(1)}%`);
    }
    return lines.join('\n');
  } catch (err) {
    return `Losers lookup failed: ${err.message}`;
  }
}

// ============ Top Volume (CoinGecko) ============

export async function getTopVolume() {
  try {
    const data = await fetchCoinGecko('/coins/markets?vs_currency=usd&order=volume_desc&per_page=10&page=1&sparkline=false');

    const lines = ['Top 24h Volume\n'];
    for (let i = 0; i < Math.min(10, data.length); i++) {
      const c = data[i];
      const change = c.price_change_percentage_24h;
      const changeStr = change != null ? ` (${change >= 0 ? '+' : ''}${change.toFixed(1)}%)` : '';
      lines.push(`  ${String(i + 1).padStart(2)}. ${c.symbol.toUpperCase().padEnd(6)} Vol: $${formatLargeNum(c.total_volume)}${changeStr}`);
    }
    return lines.join('\n');
  } catch (err) {
    return `Volume lookup failed: ${err.message}`;
  }
}

// ============ Quick BTC/ETH Summary ============

export async function getQuickSummary(coinId) {
  try {
    const data = await fetchCoinGecko(`/coins/${coinId}?localization=false&tickers=false&community_data=false&developer_data=false`);
    const md = data.market_data;
    if (!md) return `No data for ${coinId}.`;

    const price = md.current_price?.usd;
    const change24h = md.price_change_percentage_24h;
    const change7d = md.price_change_percentage_7d;
    const change30d = md.price_change_percentage_30d;
    const mcap = md.market_cap?.usd;
    const vol = md.total_volume?.usd;
    const ath = md.ath?.usd;
    const athChange = md.ath_change_percentage?.usd;
    const supply = md.circulating_supply;
    const maxSupply = md.max_supply;

    const priceStr = price >= 1 ? `$${price.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : `$${price.toFixed(6)}`;

    const lines = [`${data.name} (${data.symbol?.toUpperCase()})\n`];
    lines.push(`  Price: ${priceStr}`);
    if (change24h != null) lines.push(`  24h: ${change24h >= 0 ? '+' : ''}${change24h.toFixed(2)}%`);
    if (change7d != null) lines.push(`  7d:  ${change7d >= 0 ? '+' : ''}${change7d.toFixed(2)}%`);
    if (change30d != null) lines.push(`  30d: ${change30d >= 0 ? '+' : ''}${change30d.toFixed(2)}%`);
    if (mcap) lines.push(`  MCap: $${formatLargeNum(mcap)}`);
    if (vol) lines.push(`  Volume: $${formatLargeNum(vol)}`);
    if (ath) lines.push(`  ATH: $${ath.toLocaleString()} (${athChange?.toFixed(1)}%)`);
    if (supply) {
      const supplyStr = `${formatLargeNum(supply)}`;
      const maxStr = maxSupply ? ` / ${formatLargeNum(maxSupply)}` : '';
      lines.push(`  Supply: ${supplyStr}${maxStr}`);
    }
    return lines.join('\n');
  } catch (err) {
    return `Lookup failed: ${err.message}`;
  }
}

// ============ Watchlist (in-memory, per user) ============

// userId -> Set of coin IDs
const watchlists = new Map();

const COIN_ALIASES = {
  btc: 'bitcoin', eth: 'ethereum', sol: 'solana', bnb: 'binancecoin',
  xrp: 'ripple', ada: 'cardano', dot: 'polkadot', avax: 'avalanche-2',
  link: 'chainlink', uni: 'uniswap', aave: 'aave', arb: 'arbitrum',
  op: 'optimism', sui: 'sui', apt: 'aptos', near: 'near', atom: 'cosmos',
  doge: 'dogecoin', shib: 'shiba-inu', pepe: 'pepe',
  ton: 'the-open-network', ltc: 'litecoin', ckb: 'nervos-network',
};

function resolveId(input) {
  return COIN_ALIASES[input.toLowerCase().trim()] || input.toLowerCase().trim();
}

export function addToWatchlist(userId, token) {
  const id = resolveId(token);
  if (!watchlists.has(userId)) watchlists.set(userId, new Set());
  const list = watchlists.get(userId);
  if (list.size >= 20) return 'Watchlist full (max 20 tokens). Remove one with /unwatch.';
  list.add(id);
  return `Added ${token.toUpperCase()} to your watchlist.`;
}

export function removeFromWatchlist(userId, token) {
  const id = resolveId(token);
  const list = watchlists.get(userId);
  if (!list || !list.has(id)) return `${token.toUpperCase()} is not on your watchlist.`;
  list.delete(id);
  return `Removed ${token.toUpperCase()} from your watchlist.`;
}

export async function getWatchlist(userId) {
  const list = watchlists.get(userId);
  if (!list || list.size === 0) return 'Your watchlist is empty. Add tokens with /watch ETH';

  const ids = [...list].join(',');
  try {
    const data = await fetchCoinGecko(`/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`);

    const lines = ['Your Watchlist\n'];
    for (const id of list) {
      const info = data[id];
      if (!info) {
        lines.push(`  ${id}: data unavailable`);
        continue;
      }
      const change = info.usd_24h_change;
      const changeStr = change != null ? ` (${change >= 0 ? '+' : ''}${change.toFixed(1)}%)` : '';
      const priceStr = info.usd >= 1 ? `$${info.usd.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : `$${info.usd.toFixed(6)}`;
      lines.push(`  ${id.padEnd(14)} ${priceStr}${changeStr}`);
    }
    return lines.join('\n');
  } catch (err) {
    return `Watchlist fetch failed: ${err.message}`;
  }
}

// ============ NFT Collection Stats (free CoinGecko NFT endpoint) ============

export async function getNFTStats(collection) {
  try {
    // CoinGecko has a free NFT endpoint
    const resp = await fetch(`https://api.coingecko.com/api/v3/nfts/${encodeURIComponent(collection.toLowerCase())}`, {
      signal: AbortSignal.timeout(HTTP_TIMEOUT),
      headers: { 'Accept': 'application/json' },
    });

    if (resp.status === 404) {
      // Try search
      const searchResp = await fetch(`https://api.coingecko.com/api/v3/nfts/list?per_page=250`, {
        signal: AbortSignal.timeout(HTTP_TIMEOUT),
      });
      if (searchResp.ok) {
        const list = await searchResp.json();
        const match = list.find(n =>
          n.name.toLowerCase().includes(collection.toLowerCase()) ||
          n.id.includes(collection.toLowerCase())
        );
        if (match) {
          const retryResp = await fetch(`https://api.coingecko.com/api/v3/nfts/${match.id}`, {
            signal: AbortSignal.timeout(HTTP_TIMEOUT),
          });
          if (retryResp.ok) {
            const data = await retryResp.json();
            return formatNFT(data);
          }
        }
      }
      return `NFT collection "${collection}" not found. Try the slug (e.g., "bored-ape-yacht-club").`;
    }

    if (!resp.ok) throw new Error(`CoinGecko ${resp.status}`);
    const data = await resp.json();
    return formatNFT(data);
  } catch (err) {
    return `NFT lookup failed: ${err.message}`;
  }
}

function formatNFT(data) {
  const floor = data.floor_price?.usd;
  const mcap = data.market_cap?.usd;
  const vol24h = data.volume_24h?.usd;
  const change24h = data.floor_price_24h_percentage_change;
  const owners = data.number_of_unique_addresses;
  const supply = data.total_supply;

  const lines = [`${data.name}\n`];
  if (floor != null) lines.push(`  Floor: $${floor.toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
  if (change24h != null) lines.push(`  24h: ${change24h >= 0 ? '+' : ''}${change24h.toFixed(1)}%`);
  if (mcap) lines.push(`  MCap: $${formatLargeNum(mcap)}`);
  if (vol24h) lines.push(`  24h Volume: $${formatLargeNum(vol24h)}`);
  if (owners) lines.push(`  Owners: ${owners.toLocaleString()}`);
  if (supply) lines.push(`  Supply: ${supply.toLocaleString()}`);
  if (data.native_currency) lines.push(`  Chain: ${data.native_currency}`);
  return lines.join('\n');
}
