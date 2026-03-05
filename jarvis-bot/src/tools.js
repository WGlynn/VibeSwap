// ============ Community Tools — Free APIs for Telegram Utility ============
//
// Zero-cost tools that make Jarvis useful in group chats.
// All APIs are free with no API key required.
//
// Crypto Commands:
//   /price <token>     — Crypto price + 24h change (CoinGecko)
//   /trending          — Top trending tokens (CoinGecko)
//   /chart <token> [days] — Price chart as image (CoinGecko + QuickChart)
//   /fear              — Crypto Fear & Greed Index (alternative.me)
//   /gas               — ETH gas prices (Etherscan public)
//   /convert <amt> <from> <to> — Crypto conversion (CoinGecko)
//   /tvl [protocol]    — DeFi TVL data (DeFi Llama)
//   /ath <token>       — All-time high + distance (CoinGecko)
//   /dominance         — BTC dominance + market overview (CoinGecko)
//   /yields [chain]    — Top DeFi yields by APY (DeFi Llama)
//   /chains            — Chain TVL rankings (DeFi Llama)
//   /stables           — Stablecoin market data (DeFi Llama)
//   /dex               — DEX volume rankings (DeFi Llama)
//   /wallet <address>  — ETH wallet balance (Etherscan)
//
// Utility Commands:
//   /remind <time> <msg> — Set a reminder (in-memory)
//   /qr <text>         — Generate QR code image
//   /image <prompt>    — AI image generation (Pollinations.ai)
// ============

const HTTP_TIMEOUT = 10000;

// ============ CoinGecko (Free, no key) ============

async function fetchCoinGecko(path) {
  const resp = await fetch(`https://api.coingecko.com/api/v3${path}`, {
    signal: AbortSignal.timeout(HTTP_TIMEOUT),
    headers: { 'Accept': 'application/json' },
  });
  if (!resp.ok) throw new Error(`CoinGecko ${resp.status}`);
  return resp.json();
}

// Resolve common ticker symbols to CoinGecko IDs
const COIN_ALIASES = {
  btc: 'bitcoin', eth: 'ethereum', sol: 'solana', bnb: 'binancecoin',
  xrp: 'ripple', ada: 'cardano', dot: 'polkadot', avax: 'avalanche-2',
  matic: 'matic-network', pol: 'matic-network', link: 'chainlink',
  uni: 'uniswap', aave: 'aave', arb: 'arbitrum', op: 'optimism',
  sui: 'sui', apt: 'aptos', near: 'near', atom: 'cosmos',
  doge: 'dogecoin', shib: 'shiba-inu', pepe: 'pepe',
  ton: 'the-open-network', trx: 'tron', ltc: 'litecoin',
  fil: 'filecoin', icp: 'internet-computer', ckb: 'nervos-network',
};

function resolveCoinId(input) {
  const lower = input.toLowerCase().trim();
  return COIN_ALIASES[lower] || lower;
}

export async function getPrice(token) {
  const id = resolveCoinId(token);
  try {
    const data = await fetchCoinGecko(`/simple/price?ids=${id}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`);
    const info = data[id];
    if (!info) {
      // Try search
      const search = await fetchCoinGecko(`/search?query=${encodeURIComponent(token)}`);
      if (search.coins?.length > 0) {
        const coin = search.coins[0];
        const retry = await fetchCoinGecko(`/simple/price?ids=${coin.id}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`);
        const retryInfo = retry[coin.id];
        if (retryInfo) {
          return formatPrice(coin.name, coin.symbol.toUpperCase(), retryInfo);
        }
      }
      return `Token "${token}" not found. Try the full name (e.g., "ethereum") or symbol (e.g., "ETH").`;
    }
    // Get the name from a quick search
    const search = await fetchCoinGecko(`/search?query=${encodeURIComponent(id)}`);
    const name = search.coins?.find(c => c.id === id)?.name || id;
    const symbol = search.coins?.find(c => c.id === id)?.symbol?.toUpperCase() || token.toUpperCase();
    return formatPrice(name, symbol, info);
  } catch (err) {
    return `Price lookup failed: ${err.message}`;
  }
}

function formatPrice(name, symbol, info) {
  const price = info.usd;
  const change = info.usd_24h_change;
  const mcap = info.usd_market_cap;
  const vol = info.usd_24h_vol;

  const arrow = change >= 0 ? '+' : '';
  const priceStr = price >= 1 ? `$${price.toLocaleString('en-US', { maximumFractionDigits: 2 })}` :
                   price >= 0.01 ? `$${price.toFixed(4)}` : `$${price.toFixed(8)}`;

  let lines = [`${name} (${symbol})\n`];
  lines.push(`  Price: ${priceStr}`);
  if (change != null) lines.push(`  24h: ${arrow}${change.toFixed(2)}%`);
  if (mcap) lines.push(`  MCap: $${formatLargeNum(mcap)}`);
  if (vol) lines.push(`  Volume: $${formatLargeNum(vol)}`);
  return lines.join('\n');
}

function formatLargeNum(n) {
  if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toFixed(0);
}

// ============ Trending ============

export async function getTrending() {
  try {
    const data = await fetchCoinGecko('/search/trending');
    const coins = data.coins?.slice(0, 10) || [];
    if (coins.length === 0) return 'No trending data available.';

    const lines = ['Trending on CoinGecko\n'];
    for (let i = 0; i < coins.length; i++) {
      const c = coins[i].item;
      const priceChange = c.data?.price_change_percentage_24h?.usd;
      const changeStr = priceChange != null ? ` (${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(1)}%)` : '';
      lines.push(`  ${i + 1}. ${c.name} (${c.symbol.toUpperCase()})${changeStr}`);
    }
    return lines.join('\n');
  } catch (err) {
    return `Trending lookup failed: ${err.message}`;
  }
}

// ============ Chart (CoinGecko + QuickChart URL) ============

export async function getChart(token, days = 7) {
  const id = resolveCoinId(token);
  try {
    const data = await fetchCoinGecko(`/coins/${id}/market_chart?vs_currency=usd&days=${days}`);
    if (!data.prices?.length) return { error: `No chart data for "${token}".` };

    const prices = data.prices;
    // Sample ~50 points for the chart
    const step = Math.max(1, Math.floor(prices.length / 50));
    const sampled = prices.filter((_, i) => i % step === 0);

    const labels = sampled.map(p => {
      const d = new Date(p[0]);
      return days <= 1 ? `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}` :
             days <= 30 ? `${d.getMonth() + 1}/${d.getDate()}` :
             `${d.getMonth() + 1}/${d.getDate()}`;
    });
    const values = sampled.map(p => p[1]);

    const startPrice = values[0];
    const endPrice = values[values.length - 1];
    const isUp = endPrice >= startPrice;

    // Build QuickChart URL (no npm dependency needed)
    const chartConfig = {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: `${token.toUpperCase()} (${days}d)`,
          data: values,
          borderColor: isUp ? '#00c853' : '#ff1744',
          backgroundColor: isUp ? 'rgba(0,200,83,0.1)' : 'rgba(255,23,68,0.1)',
          fill: true,
          pointRadius: 0,
          borderWidth: 2,
        }],
      },
      options: {
        plugins: { legend: { display: true } },
        scales: {
          y: { ticks: { callback: (v) => '$' + v.toLocaleString() } },
          x: { ticks: { maxTicksLimit: 8 } },
        },
      },
    };

    const chartUrl = `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chartConfig))}&w=600&h=300&bkg=white`;
    return { url: chartUrl, caption: `${token.toUpperCase()} — ${days}d chart\nStart: $${startPrice.toFixed(2)} | End: $${endPrice.toFixed(2)} | ${isUp ? '+' : ''}${((endPrice - startPrice) / startPrice * 100).toFixed(2)}%` };
  } catch (err) {
    return { error: `Chart failed: ${err.message}` };
  }
}

// ============ Fear & Greed Index ============

export async function getFearGreed() {
  try {
    const resp = await fetch('https://api.alternative.me/fng/?limit=1', {
      signal: AbortSignal.timeout(HTTP_TIMEOUT),
    });
    const data = await resp.json();
    const entry = data.data?.[0];
    if (!entry) return 'Fear & Greed data unavailable.';

    const value = parseInt(entry.value);
    const label = entry.value_classification;
    const bar = generateBar(value);

    return `Crypto Fear & Greed Index\n\n  ${bar} ${value}/100\n  Sentiment: ${label}\n  Updated: ${new Date(entry.timestamp * 1000).toLocaleDateString()}`;
  } catch (err) {
    return `Fear & Greed lookup failed: ${err.message}`;
  }
}

function generateBar(value) {
  const filled = Math.round(value / 5);
  return '[' + '#'.repeat(filled) + '-'.repeat(20 - filled) + ']';
}

// ============ Gas Prices ============

export async function getGasPrices() {
  try {
    // Use public Etherscan gas tracker (no key needed for this endpoint)
    const resp = await fetch('https://api.etherscan.io/api?module=gastracker&action=gasoracle', {
      signal: AbortSignal.timeout(HTTP_TIMEOUT),
    });
    const data = await resp.json();
    if (data.status !== '1') {
      // Fallback: try blocknative
      return 'Gas data temporarily unavailable. Try again later.';
    }
    const r = data.result;
    return `ETH Gas Prices (Gwei)\n\n  Slow: ${r.SafeGasPrice} gwei\n  Average: ${r.ProposeGasPrice} gwei\n  Fast: ${r.FastGasPrice} gwei\n  Base Fee: ${r.suggestBaseFee ? parseFloat(r.suggestBaseFee).toFixed(1) : '?'} gwei`;
  } catch (err) {
    return `Gas price lookup failed: ${err.message}`;
  }
}

// ============ Reminders (in-memory) ============

const activeReminders = new Map(); // chatId:userId -> [{ timeout, message, at }]

export function setReminder(chatId, userId, username, timeStr, message, replyFn) {
  const ms = parseTimeStr(timeStr);
  if (!ms || ms < 5000) return 'Invalid time. Use format: 30s, 5m, 2h, 1d';
  if (ms > 7 * 24 * 60 * 60 * 1000) return 'Max reminder time is 7 days.';

  const key = `${chatId}:${userId}`;
  const at = Date.now() + ms;

  const timeout = setTimeout(() => {
    replyFn(`Reminder for @${username}: ${message}`);
    // Clean up
    const reminders = activeReminders.get(key);
    if (reminders) {
      const idx = reminders.findIndex(r => r.at === at);
      if (idx >= 0) reminders.splice(idx, 1);
      if (reminders.length === 0) activeReminders.delete(key);
    }
  }, ms);

  if (!activeReminders.has(key)) activeReminders.set(key, []);
  activeReminders.get(key).push({ timeout, message, at });

  const readable = formatDuration(ms);
  return `Reminder set for ${readable} from now.`;
}

function parseTimeStr(str) {
  const match = str.match(/^(\d+)(s|m|h|d)$/i);
  if (!match) return null;
  const n = parseInt(match[1]);
  const unit = match[2].toLowerCase();
  const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return n * (multipliers[unit] || 0);
}

function formatDuration(ms) {
  if (ms >= 86400000) return `${Math.round(ms / 86400000)}d`;
  if (ms >= 3600000) return `${Math.round(ms / 3600000)}h`;
  if (ms >= 60000) return `${Math.round(ms / 60000)}m`;
  return `${Math.round(ms / 1000)}s`;
}

// ============ QR Code ============

export function getQRUrl(text) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(text)}`;
}

// ============ AI Image Generation ============
// Try multiple free providers. Fetch image as buffer (Telegram rejects
// some external URLs) and return it for upload.

const IMAGE_PROVIDERS = [
  // Pollinations.ai — free, no key
  (prompt) => `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=512&height=512&nologo=true`,
  // Pollinations v2 endpoint
  (prompt) => `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}`,
];

export async function generateImage(prompt) {
  for (const urlFn of IMAGE_PROVIDERS) {
    const url = urlFn(prompt);
    try {
      const resp = await fetch(url, {
        signal: AbortSignal.timeout(30000),
        redirect: 'follow',
      });
      if (!resp.ok) continue;
      const contentType = resp.headers.get('content-type') || '';
      if (!contentType.startsWith('image/')) continue;
      const buffer = Buffer.from(await resp.arrayBuffer());
      if (buffer.length < 1000) continue; // Too small = error page
      return { buffer, contentType };
    } catch {
      continue;
    }
  }
  return null;
}

// Legacy URL function (kept for fallback)
export function getImageUrl(prompt) {
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=512&height=512`;
}

// ============ Crypto Conversion ============

export async function convertCrypto(amount, from, to) {
  const fromId = resolveCoinId(from);
  const toId = resolveCoinId(to);

  try {
    // Both crypto
    const data = await fetchCoinGecko(`/simple/price?ids=${fromId},${toId}&vs_currencies=usd`);
    const fromPrice = data[fromId]?.usd;
    const toPrice = data[toId]?.usd;

    if (!fromPrice && !toPrice) return `Could not find prices for "${from}" or "${to}".`;
    if (!fromPrice) return `Could not find price for "${from}".`;

    if (to.toLowerCase() === 'usd') {
      const result = amount * fromPrice;
      return `${amount} ${from.toUpperCase()} = $${result.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
    }

    if (!toPrice) return `Could not find price for "${to}".`;
    const result = (amount * fromPrice) / toPrice;
    return `${amount} ${from.toUpperCase()} = ${result.toLocaleString('en-US', { maximumFractionDigits: 6 })} ${to.toUpperCase()}`;
  } catch (err) {
    return `Conversion failed: ${err.message}`;
  }
}

// ============ All-Time High (CoinGecko) ============

export async function getATH(token) {
  const id = resolveCoinId(token);
  try {
    const data = await fetchCoinGecko(`/coins/${id}?localization=false&tickers=false&community_data=false&developer_data=false`);
    const md = data.market_data;
    if (!md) return `No data found for "${token}".`;

    const ath = md.ath?.usd;
    const athDate = md.ath_date?.usd;
    const athChange = md.ath_change_percentage?.usd;
    const current = md.current_price?.usd;

    if (!ath) return `No ATH data for "${token}".`;

    const priceStr = current >= 1 ? `$${current.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : `$${current.toFixed(6)}`;
    const athStr = ath >= 1 ? `$${ath.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : `$${ath.toFixed(6)}`;
    const dateStr = athDate ? new Date(athDate).toLocaleDateString() : '?';

    return `${data.name} (${data.symbol?.toUpperCase()})\n\n  Current: ${priceStr}\n  ATH: ${athStr} (${dateStr})\n  From ATH: ${athChange?.toFixed(1)}%\n  Rank: #${data.market_cap_rank || '?'}`;
  } catch (err) {
    return `ATH lookup failed: ${err.message}`;
  }
}

// ============ Market Dominance + Overview (CoinGecko) ============

export async function getDominance() {
  try {
    const data = await fetchCoinGecko('/global');
    const g = data.data;
    if (!g) return 'Market data unavailable.';

    const btcDom = g.market_cap_percentage?.btc?.toFixed(1);
    const ethDom = g.market_cap_percentage?.eth?.toFixed(1);
    const totalMcap = g.total_market_cap?.usd;
    const totalVol = g.total_volume?.usd;
    const change = g.market_cap_change_percentage_24h_usd;

    const lines = ['Crypto Market Overview\n'];
    if (totalMcap) lines.push(`  Total MCap: $${formatLargeNum(totalMcap)}`);
    if (change != null) lines.push(`  24h Change: ${change >= 0 ? '+' : ''}${change.toFixed(2)}%`);
    if (totalVol) lines.push(`  24h Volume: $${formatLargeNum(totalVol)}`);
    if (btcDom) lines.push(`  BTC Dominance: ${btcDom}%`);
    if (ethDom) lines.push(`  ETH Dominance: ${ethDom}%`);
    lines.push(`  Active Cryptos: ${g.active_cryptocurrencies?.toLocaleString() || '?'}`);
    return lines.join('\n');
  } catch (err) {
    return `Market overview failed: ${err.message}`;
  }
}

// ============ Top DeFi Yields (DeFi Llama) ============

export async function getYields(chain) {
  try {
    const resp = await fetch('https://yields.llama.fi/pools', {
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) throw new Error(`DeFi Llama ${resp.status}`);
    const data = await resp.json();
    let pools = data.data || [];

    // Filter by chain if specified
    if (chain) {
      const chainLower = chain.toLowerCase();
      pools = pools.filter(p => p.chain?.toLowerCase() === chainLower);
    }

    // Sort by APY, filter out tiny/dead pools
    pools = pools
      .filter(p => p.tvlUsd > 100000 && p.apy > 0 && p.apy < 10000)
      .sort((a, b) => b.apy - a.apy)
      .slice(0, 10);

    if (pools.length === 0) return chain ? `No significant yields found on ${chain}.` : 'No yield data available.';

    const title = chain ? `Top Yields on ${chain}\n` : 'Top DeFi Yields\n';
    const lines = [title];
    for (let i = 0; i < pools.length; i++) {
      const p = pools[i];
      lines.push(`  ${i + 1}. ${p.project} — ${p.symbol}`);
      lines.push(`     APY: ${p.apy.toFixed(2)}% | TVL: $${formatLargeNum(p.tvlUsd)} | ${p.chain}`);
    }
    return lines.join('\n');
  } catch (err) {
    return `Yields lookup failed: ${err.message}`;
  }
}

// ============ Chain Rankings (DeFi Llama) ============

export async function getChains() {
  try {
    const resp = await fetch('https://api.llama.fi/v2/chains', {
      signal: AbortSignal.timeout(HTTP_TIMEOUT),
    });
    if (!resp.ok) throw new Error(`DeFi Llama ${resp.status}`);
    const data = await resp.json();

    const chains = data
      .filter(c => c.tvl > 0)
      .sort((a, b) => b.tvl - a.tvl)
      .slice(0, 15);

    const lines = ['Top Chains by TVL\n'];
    for (let i = 0; i < chains.length; i++) {
      const c = chains[i];
      lines.push(`  ${String(i + 1).padStart(2)}. ${c.name.padEnd(14)} $${formatLargeNum(c.tvl)}`);
    }
    return lines.join('\n');
  } catch (err) {
    return `Chain rankings failed: ${err.message}`;
  }
}

// ============ Stablecoin Market (DeFi Llama) ============

export async function getStables() {
  try {
    const resp = await fetch('https://stablecoins.llama.fi/stablecoins?includePrices=true', {
      signal: AbortSignal.timeout(HTTP_TIMEOUT),
    });
    if (!resp.ok) throw new Error(`DeFi Llama ${resp.status}`);
    const data = await resp.json();
    const stables = (data.peggedAssets || [])
      .filter(s => s.circulating?.peggedUSD > 100000000)
      .sort((a, b) => (b.circulating?.peggedUSD || 0) - (a.circulating?.peggedUSD || 0))
      .slice(0, 10);

    if (stables.length === 0) return 'No stablecoin data available.';

    let totalMcap = 0;
    const lines = ['Stablecoin Market\n'];
    for (let i = 0; i < stables.length; i++) {
      const s = stables[i];
      const mcap = s.circulating?.peggedUSD || 0;
      totalMcap += mcap;
      lines.push(`  ${String(i + 1).padStart(2)}. ${s.name.padEnd(10)} $${formatLargeNum(mcap)}`);
    }
    lines.unshift(`Stablecoin Market — Total: $${formatLargeNum(totalMcap)}\n`);
    lines.shift(); // remove duplicate header
    return lines.join('\n');
  } catch (err) {
    return `Stablecoins lookup failed: ${err.message}`;
  }
}

// ============ DEX Volume Rankings (DeFi Llama) ============

export async function getDexVolume() {
  try {
    const resp = await fetch('https://api.llama.fi/overview/dexs?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true', {
      signal: AbortSignal.timeout(HTTP_TIMEOUT),
    });
    if (!resp.ok) throw new Error(`DeFi Llama ${resp.status}`);
    const data = await resp.json();
    const dexes = (data.protocols || [])
      .filter(d => d.total24h > 0)
      .sort((a, b) => b.total24h - a.total24h)
      .slice(0, 10);

    if (dexes.length === 0) return 'No DEX volume data available.';

    const totalVol = data.total24h || dexes.reduce((s, d) => s + d.total24h, 0);
    const lines = [`DEX Volume Rankings — 24h Total: $${formatLargeNum(totalVol)}\n`];
    for (let i = 0; i < dexes.length; i++) {
      const d = dexes[i];
      const change = d.change_1d;
      const changeStr = change != null ? ` (${change >= 0 ? '+' : ''}${change.toFixed(1)}%)` : '';
      lines.push(`  ${String(i + 1).padStart(2)}. ${d.name.padEnd(14)} $${formatLargeNum(d.total24h)}${changeStr}`);
    }
    return lines.join('\n');
  } catch (err) {
    return `DEX volume lookup failed: ${err.message}`;
  }
}

// ============ Wallet Balance (Etherscan, free) ============

export async function getWalletBalance(address) {
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return 'Invalid Ethereum address. Format: 0x...';
  }
  try {
    const resp = await fetch(`https://api.etherscan.io/api?module=account&action=balance&address=${address}&tag=latest`, {
      signal: AbortSignal.timeout(HTTP_TIMEOUT),
    });
    const data = await resp.json();
    if (data.status !== '1') return 'Could not fetch wallet balance.';

    const balanceWei = BigInt(data.result);
    const balanceEth = Number(balanceWei) / 1e18;

    // Get ETH price
    const priceData = await fetchCoinGecko('/simple/price?ids=ethereum&vs_currencies=usd');
    const ethPrice = priceData.ethereum?.usd || 0;
    const usdValue = balanceEth * ethPrice;

    const short = `${address.slice(0, 6)}...${address.slice(-4)}`;
    return `Wallet ${short}\n\n  ETH: ${balanceEth.toFixed(4)}\n  USD: $${usdValue.toLocaleString('en-US', { maximumFractionDigits: 2 })}\n  ETH Price: $${ethPrice.toLocaleString()}`;
  } catch (err) {
    return `Wallet lookup failed: ${err.message}`;
  }
}

// ============ DeFi Llama TVL (free, no key) ============

export async function getTVL(protocol) {
  try {
    if (protocol) {
      const resp = await fetch(`https://api.llama.fi/protocol/${encodeURIComponent(protocol)}`, {
        signal: AbortSignal.timeout(HTTP_TIMEOUT),
      });
      if (!resp.ok) return `Protocol "${protocol}" not found on DeFi Llama.`;
      const data = await resp.json();
      return `${data.name}\n\n  TVL: $${formatLargeNum(data.currentChainTvls?.total || data.tvl?.[data.tvl.length - 1]?.totalLiquidityUSD || 0)}\n  Category: ${data.category || 'N/A'}\n  Chains: ${(data.chains || []).join(', ') || 'N/A'}`;
    }

    // Global TVL
    const resp = await fetch('https://api.llama.fi/v2/historicalChainTvl', {
      signal: AbortSignal.timeout(HTTP_TIMEOUT),
    });
    const data = await resp.json();
    const latest = data[data.length - 1];
    return `Total DeFi TVL\n\n  TVL: $${formatLargeNum(latest?.tvl || 0)}\n  Date: ${new Date(latest?.date * 1000).toLocaleDateString()}`;
  } catch (err) {
    return `TVL lookup failed: ${err.message}`;
  }
}
