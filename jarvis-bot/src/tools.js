// ============ Community Tools — Free APIs for Telegram Utility ============
//
// Zero-cost tools that make Jarvis useful in group chats.
// All APIs are free with no API key required.
//
// Commands:
//   /price <token>     — Crypto price + 24h change (CoinGecko)
//   /trending          — Top trending tokens (CoinGecko)
//   /chart <token> [days] — Price chart as image (CoinGecko + QuickChart)
//   /fear              — Crypto Fear & Greed Index (alternative.me)
//   /gas               — ETH gas prices (Etherscan public)
//   /remind <time> <msg> — Set a reminder (in-memory)
//   /qr <text>         — Generate QR code image
//   /image <prompt>    — AI image generation (Pollinations.ai)
//   /convert <amt> <from> <to> — Crypto conversion (CoinGecko)
//   /tvl [protocol]    — DeFi TVL data (DeFi Llama)
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

// ============ AI Image Generation (Pollinations.ai — free, no key) ============

export function getImageUrl(prompt) {
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=512&height=512&nologo=true`;
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
