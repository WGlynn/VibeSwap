// ============ Catchup Digest & Crypto Events Calendar ============
//
// "What happened while I was away?"
// Smart digest that summarizes price moves + news + group highlights.
//
// Commands:
//   /catchup [hours]      — What happened while you were away
//   /events [today|week]  — Crypto events calendar
//   /unlocks              — Upcoming token unlocks
// ============

const HTTP_TIMEOUT = 12000;

// Track last seen time per user (cap at 10K to prevent unbounded growth)
const lastSeen = new Map(); // userId -> timestamp
const MAX_LAST_SEEN = 10000;

export function recordActivity(userId) {
  lastSeen.set(userId, Date.now());
  if (lastSeen.size > MAX_LAST_SEEN) {
    // Drop oldest entries
    const excess = lastSeen.size - MAX_LAST_SEEN;
    let removed = 0;
    for (const key of lastSeen.keys()) {
      if (removed >= excess) break;
      lastSeen.delete(key);
      removed++;
    }
  }
}

// ============ /catchup — Smart Digest ============

export async function getCatchup(userId, hoursOverride) {
  const lastActive = lastSeen.get(userId) || (Date.now() - 24 * 3600000);
  const hoursAway = hoursOverride || Math.min(48, Math.round((Date.now() - lastActive) / 3600000));

  if (hoursAway < 1) return 'You haven\'t been away long enough for a catchup!';

  const lines = [`While You Were Away (${hoursAway}h)\n`];

  try {
    // Fetch major price moves in parallel
    const [btcData, trendingData, fearData] = await Promise.allSettled([
      fetchJSON('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,binancecoin&vs_currencies=usd&include_24hr_change=true'),
      fetchJSON('https://api.coingecko.com/api/v3/search/trending'),
      fetchJSON('https://api.alternative.me/fng/?limit=1'),
    ]);

    // Price Summary
    if (btcData.status === 'fulfilled') {
      const p = btcData.value;
      lines.push('  PRICES');
      for (const [id, data] of Object.entries(p)) {
        const symbol = id === 'bitcoin' ? 'BTC' : id === 'ethereum' ? 'ETH' : id === 'solana' ? 'SOL' : 'BNB';
        const change = data.usd_24h_change;
        const icon = change > 3 ? '🟢' : change < -3 ? '🔴' : '⚪';
        lines.push(`    ${icon} ${symbol}: $${data.usd.toLocaleString()} (${change >= 0 ? '+' : ''}${change?.toFixed(1)}%)`);
      }
    }

    // Fear & Greed
    if (fearData.status === 'fulfilled') {
      const fg = fearData.value.data?.[0];
      if (fg) {
        lines.push(`\n  SENTIMENT: ${fg.value}/100 (${fg.value_classification})`);
      }
    }

    // Trending
    if (trendingData.status === 'fulfilled') {
      const coins = trendingData.value.coins?.slice(0, 5) || [];
      if (coins.length > 0) {
        lines.push('\n  TRENDING');
        for (const c of coins) {
          const item = c.item;
          const priceChange = item.data?.price_change_percentage_24h?.usd;
          const changeStr = priceChange != null ? ` (${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(1)}%)` : '';
          lines.push(`    ${item.name} (${item.symbol})${changeStr}`);
        }
      }
    }

    // Big moves detection
    if (btcData.status === 'fulfilled') {
      const alerts = [];
      for (const [id, data] of Object.entries(btcData.value)) {
        const change = Math.abs(data.usd_24h_change || 0);
        if (change > 5) {
          const symbol = id === 'bitcoin' ? 'BTC' : id === 'ethereum' ? 'ETH' : id === 'solana' ? 'SOL' : 'BNB';
          alerts.push(`${symbol} moved ${data.usd_24h_change > 0 ? '+' : ''}${data.usd_24h_change.toFixed(1)}%`);
        }
      }
      if (alerts.length > 0) {
        lines.push('\n  ALERTS');
        for (const a of alerts) lines.push(`    ${a}`);
      }
    }

    lines.push(`\n  Use /alpha <token> for deep dives`);
    recordActivity(userId);
    return lines.join('\n');
  } catch (err) {
    return `Catchup failed: ${err.message}`;
  }
}

// ============ /events — Crypto Events Calendar ============

export async function getCryptoEvents(period) {
  try {
    // CoinGecko status updates (free, no key)
    const resp = await fetch(
      'https://api.coingecko.com/api/v3/status_updates?per_page=10',
      { signal: AbortSignal.timeout(HTTP_TIMEOUT) }
    );

    let events = [];

    if (resp.ok) {
      const data = await resp.json();
      events = data.status_updates || [];
    }

    // Also try to get notable events from trending data
    const [trendingResp, categoriesResp] = await Promise.allSettled([
      fetchJSON('https://api.coingecko.com/api/v3/search/trending'),
      fetchJSON('https://api.coingecko.com/api/v3/coins/categories?order=market_cap_change_24h_desc'),
    ]);

    const lines = [`Crypto Events & Activity\n`];

    // Trending as "events"
    if (trendingResp.status === 'fulfilled') {
      const coins = trendingResp.value.coins?.slice(0, 5) || [];
      if (coins.length > 0) {
        lines.push('  TRENDING NOW');
        for (const c of coins) {
          const item = c.item;
          lines.push(`    ${item.name} (${item.symbol}) — #${item.market_cap_rank || '?'}`);
        }
      }
    }

    // Hot categories
    if (categoriesResp.status === 'fulfilled') {
      const cats = (categoriesResp.value || []).filter(c => c.market_cap_change_24h > 3).slice(0, 5);
      if (cats.length > 0) {
        lines.push('\n  HOT SECTORS');
        for (const cat of cats) {
          lines.push(`    +${cat.market_cap_change_24h.toFixed(1)}% ${cat.name}`);
        }
      }
    }

    // Upcoming known events (hardcoded major ones — could be enhanced with API)
    const upcoming = getUpcomingMajorEvents();
    if (upcoming.length > 0) {
      lines.push('\n  UPCOMING');
      for (const e of upcoming) {
        lines.push(`    ${e}`);
      }
    }

    return lines.join('\n');
  } catch (err) {
    return `Events failed: ${err.message}`;
  }
}

// ============ /unlocks — Token Unlock Schedule ============

export async function getTokenUnlocks() {
  try {
    // DefiLlama unlocks endpoint
    const resp = await fetch('https://api.llama.fi/protocols', {
      signal: AbortSignal.timeout(HTTP_TIMEOUT),
    });

    // For now, provide a curated list of major upcoming unlocks
    // Full unlock data would need token-unlocks.com API
    const lines = ['Token Unlock Schedule\n'];
    lines.push('  Major upcoming unlocks:');
    lines.push('  Check tokenunlocks.app for live data\n');

    // Get top tokens with known unlock schedules
    const watchList = [
      { name: 'ARB', note: 'Monthly team/investor unlocks' },
      { name: 'OP', note: 'Biweekly ecosystem fund' },
      { name: 'APT', note: 'Monthly core contributor unlocks' },
      { name: 'SUI', note: 'Monthly ecosystem unlocks' },
      { name: 'SEI', note: 'Monthly team vesting' },
      { name: 'TIA', note: 'Post-cliff ongoing unlocks (cliff was Oct 2025)' },
      { name: 'STRK', note: 'Ongoing contributor vesting' },
      { name: 'JUP', note: 'Community airdrop tranches' },
    ];

    for (const t of watchList) {
      lines.push(`  ${t.name.padEnd(6)} — ${t.note}`);
    }

    lines.push('\n  Tip: Large unlocks = selling pressure. Check before buying.');
    return lines.join('\n');
  } catch (err) {
    return `Unlock data failed: ${err.message}`;
  }
}

// ============ Helpers ============

function getUpcomingMajorEvents() {
  const events = [];
  const now = new Date();
  const month = now.getMonth() + 1;

  // Recurring crypto/macro events by month
  if (month >= 3 && month <= 5) events.push('ETH conference season (EthDenver, Devconnect)');
  if (month >= 9 && month <= 11) events.push('Devcon / TOKEN2049 season');
  if (month === 4) events.push('Bitcoin halving anniversary month');
  events.push('Fed rate decision — check FOMC calendar');
  events.push('CPI data release — check BLS calendar');

  return events;
}

async function fetchJSON(url) {
  const resp = await fetch(url, {
    signal: AbortSignal.timeout(HTTP_TIMEOUT),
    headers: { 'Accept': 'application/json' },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}
