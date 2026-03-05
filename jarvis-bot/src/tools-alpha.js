// ============ Alpha Intelligence — Full Token Report ============
//
// The killer combo command. Runs price + security + dev + social in parallel
// and produces a comprehensive alpha report.
//
// Commands:
//   /alpha <token>       — Full alpha intelligence report
//   /compare <a> <b>     — Side-by-side token comparison
//   /narrative            — Current crypto narrative analysis
// ============

const HTTP_TIMEOUT = 12000;

// ============ /alpha — Full Token Alpha Report ============

export async function getAlphaReport(query) {
  if (!query) return 'Usage: /alpha bitcoin\n\nRuns price + security + dev activity + social signals in parallel.';

  const token = query.toLowerCase().trim();

  // Map common names to CoinGecko IDs
  const ID_MAP = {
    btc: 'bitcoin', eth: 'ethereum', sol: 'solana', bnb: 'binancecoin',
    matic: 'matic-network', avax: 'avalanche-2', dot: 'polkadot',
    link: 'chainlink', uni: 'uniswap', aave: 'aave', arb: 'arbitrum',
    op: 'optimism', atom: 'cosmos', near: 'near', sui: 'sui',
    apt: 'aptos', doge: 'dogecoin', shib: 'shiba-inu', pepe: 'pepe',
    ada: 'cardano', xrp: 'ripple', ton: 'the-open-network',
  };

  const cgId = ID_MAP[token] || token;

  try {
    // Parallel fetch: price, market, dev activity, reddit sentiment
    const [priceData, globalData, redditData] = await Promise.allSettled([
      fetchJSON(`https://api.coingecko.com/api/v3/coins/${cgId}?localization=false&tickers=false&community_data=true&developer_data=true&sparkline=false`),
      fetchJSON('https://api.coingecko.com/api/v3/global'),
      fetchRedditSentiment(token),
    ]);

    const lines = [];

    // ---- Price & Market Section ----
    if (priceData.status === 'fulfilled') {
      const c = priceData.value;
      const price = c.market_data?.current_price?.usd;
      const change24h = c.market_data?.price_change_percentage_24h;
      const change7d = c.market_data?.price_change_percentage_7d;
      const change30d = c.market_data?.price_change_percentage_30d;
      const mcap = c.market_data?.market_cap?.usd;
      const vol24h = c.market_data?.total_volume?.usd;
      const ath = c.market_data?.ath?.usd;
      const athDate = c.market_data?.ath_date?.usd;
      const athDrop = c.market_data?.ath_change_percentage?.usd;
      const rank = c.market_cap_rank;
      const supply = c.market_data?.circulating_supply;
      const maxSupply = c.market_data?.max_supply;

      const name = c.name || query;
      const symbol = (c.symbol || query).toUpperCase();

      lines.push(`ALPHA REPORT: ${name} (${symbol})\n`);
      lines.push(`  PRICE & MARKET`);
      if (price) lines.push(`  Price: $${price.toLocaleString(undefined, { maximumFractionDigits: 8 })}`);
      if (change24h != null) lines.push(`  24h: ${change24h >= 0 ? '+' : ''}${change24h.toFixed(2)}%`);
      if (change7d != null) lines.push(`  7d: ${change7d >= 0 ? '+' : ''}${change7d.toFixed(2)}%`);
      if (change30d != null) lines.push(`  30d: ${change30d >= 0 ? '+' : ''}${change30d.toFixed(2)}%`);
      if (mcap) lines.push(`  MCap: $${formatLargeNumber(mcap)} (#${rank || '?'})`);
      if (vol24h) lines.push(`  24h Vol: $${formatLargeNumber(vol24h)}`);
      if (mcap && vol24h) lines.push(`  Vol/MCap: ${((vol24h / mcap) * 100).toFixed(2)}%`);
      if (ath) {
        const athDateStr = athDate ? new Date(athDate).toLocaleDateString() : '?';
        lines.push(`  ATH: $${ath.toLocaleString()} (${athDrop?.toFixed(1)}% from ATH, ${athDateStr})`);
      }
      if (supply) {
        const supplyStr = formatLargeNumber(supply);
        const maxStr = maxSupply ? formatLargeNumber(maxSupply) : 'Unlimited';
        lines.push(`  Supply: ${supplyStr} / ${maxStr}`);
      }

      // ---- Dev Activity ----
      const dev = c.developer_data;
      if (dev && (dev.forks || dev.stars || dev.commit_count_4_weeks)) {
        lines.push(`\n  DEV ACTIVITY`);
        if (dev.stars) lines.push(`  GitHub Stars: ${dev.stars.toLocaleString()}`);
        if (dev.forks) lines.push(`  Forks: ${dev.forks.toLocaleString()}`);
        if (dev.commit_count_4_weeks) lines.push(`  Commits (4w): ${dev.commit_count_4_weeks}`);
        if (dev.pull_requests_merged) lines.push(`  PRs Merged: ${dev.pull_requests_merged}`);
        if (dev.pull_request_contributors) lines.push(`  Contributors: ${dev.pull_request_contributors}`);

        // Dev score
        const devScore = (dev.commit_count_4_weeks || 0) > 50 ? 'High'
          : (dev.commit_count_4_weeks || 0) > 10 ? 'Medium' : 'Low';
        lines.push(`  Dev Score: ${devScore}`);
      }

      // ---- Community ----
      const community = c.community_data;
      if (community) {
        lines.push(`\n  SOCIAL`);
        if (community.twitter_followers) lines.push(`  Twitter: ${formatLargeNumber(community.twitter_followers)} followers`);
        if (community.reddit_subscribers) lines.push(`  Reddit: ${formatLargeNumber(community.reddit_subscribers)} subs`);
        if (community.reddit_average_posts_48h) lines.push(`  Reddit Posts (48h): ${community.reddit_average_posts_48h}`);
        if (community.reddit_average_comments_48h) lines.push(`  Reddit Comments (48h): ${community.reddit_average_comments_48h}`);
        if (community.telegram_channel_user_count) lines.push(`  Telegram: ${formatLargeNumber(community.telegram_channel_user_count)} members`);
      }

      // ---- Sentiment Score ----
      lines.push(`\n  SENTIMENT`);
      const sentimentScore = calculateSentiment(c, redditData);
      lines.push(`  Overall: ${sentimentScore.label} (${sentimentScore.score}/100)`);
      for (const factor of sentimentScore.factors) {
        lines.push(`    ${factor}`);
      }
    } else {
      lines.push(`Alpha report failed: Token "${query}" not found on CoinGecko.`);
      lines.push(`Try using the full name (e.g., "bitcoin" not "btc") or CoinGecko ID.`);
    }

    // ---- Market Context ----
    if (globalData.status === 'fulfilled') {
      const g = globalData.value.data;
      if (g) {
        lines.push(`\n  MARKET CONTEXT`);
        const btcDom = g.market_cap_percentage?.btc;
        const ethDom = g.market_cap_percentage?.eth;
        if (btcDom) lines.push(`  BTC Dom: ${btcDom.toFixed(1)}%`);
        if (ethDom) lines.push(`  ETH Dom: ${ethDom.toFixed(1)}%`);
        if (g.market_cap_change_percentage_24h_usd != null) {
          lines.push(`  Total MCap 24h: ${g.market_cap_change_percentage_24h_usd >= 0 ? '+' : ''}${g.market_cap_change_percentage_24h_usd.toFixed(2)}%`);
        }
      }
    }

    // ---- Reddit Sentiment ----
    if (redditData.status === 'fulfilled' && redditData.value) {
      const r = redditData.value;
      if (r.posts > 0) {
        lines.push(`\n  REDDIT BUZZ`);
        lines.push(`  Posts found: ${r.posts}`);
        lines.push(`  Avg Score: ${r.avgScore}`);
        lines.push(`  Top Post: "${r.topTitle}"`);
        lines.push(`  Sentiment: ${r.sentiment}`);
      }
    }

    return lines.join('\n');
  } catch (err) {
    return `Alpha report failed: ${err.message}`;
  }
}

// ============ /compare — Side-by-Side Token Comparison ============

export async function compareTokens(tokenA, tokenB) {
  if (!tokenA || !tokenB) return 'Usage: /compare bitcoin ethereum';

  const ID_MAP = {
    btc: 'bitcoin', eth: 'ethereum', sol: 'solana', bnb: 'binancecoin',
    matic: 'matic-network', avax: 'avalanche-2', dot: 'polkadot',
    link: 'chainlink', uni: 'uniswap', ada: 'cardano', xrp: 'ripple',
  };

  const idA = ID_MAP[tokenA.toLowerCase()] || tokenA.toLowerCase();
  const idB = ID_MAP[tokenB.toLowerCase()] || tokenB.toLowerCase();

  try {
    const [a, b] = await Promise.all([
      fetchJSON(`https://api.coingecko.com/api/v3/coins/${idA}?localization=false&tickers=false&community_data=true&developer_data=true&sparkline=false`),
      fetchJSON(`https://api.coingecko.com/api/v3/coins/${idB}?localization=false&tickers=false&community_data=true&developer_data=true&sparkline=false`),
    ]);

    const nameA = `${a.name} (${a.symbol.toUpperCase()})`;
    const nameB = `${b.name} (${b.symbol.toUpperCase()})`;

    const lines = [`${nameA} vs ${nameB}\n`];

    const metrics = [
      ['Price', fmtPrice(a.market_data?.current_price?.usd), fmtPrice(b.market_data?.current_price?.usd)],
      ['24h', fmtPct(a.market_data?.price_change_percentage_24h), fmtPct(b.market_data?.price_change_percentage_24h)],
      ['7d', fmtPct(a.market_data?.price_change_percentage_7d), fmtPct(b.market_data?.price_change_percentage_7d)],
      ['30d', fmtPct(a.market_data?.price_change_percentage_30d), fmtPct(b.market_data?.price_change_percentage_30d)],
      ['MCap', formatLargeNumber(a.market_data?.market_cap?.usd || 0), formatLargeNumber(b.market_data?.market_cap?.usd || 0)],
      ['Rank', `#${a.market_cap_rank || '?'}`, `#${b.market_cap_rank || '?'}`],
      ['24h Vol', formatLargeNumber(a.market_data?.total_volume?.usd || 0), formatLargeNumber(b.market_data?.total_volume?.usd || 0)],
      ['ATH Drop', fmtPct(a.market_data?.ath_change_percentage?.usd), fmtPct(b.market_data?.ath_change_percentage?.usd)],
      ['Commits/4w', String(a.developer_data?.commit_count_4_weeks || '?'), String(b.developer_data?.commit_count_4_weeks || '?')],
      ['Twitter', formatLargeNumber(a.community_data?.twitter_followers || 0), formatLargeNumber(b.community_data?.twitter_followers || 0)],
    ];

    const colW = 12;
    lines.push(`  ${'Metric'.padEnd(colW)} ${a.symbol.toUpperCase().padEnd(colW)} ${b.symbol.toUpperCase()}`);
    lines.push(`  ${'─'.repeat(colW)} ${'─'.repeat(colW)} ${'─'.repeat(colW)}`);
    for (const [label, valA, valB] of metrics) {
      lines.push(`  ${label.padEnd(colW)} ${valA.padEnd(colW)} ${valB}`);
    }

    return lines.join('\n');
  } catch (err) {
    return `Comparison failed: ${err.message}`;
  }
}

// ============ /narrative — Current Crypto Narrative Analysis ============

export async function getCurrentNarrative() {
  try {
    // Fetch trending + top gainers to detect narratives
    const [trending, categories] = await Promise.allSettled([
      fetchJSON('https://api.coingecko.com/api/v3/search/trending'),
      fetchJSON('https://api.coingecko.com/api/v3/coins/categories?order=market_cap_change_24h_desc'),
    ]);

    const lines = ['Current Crypto Narratives\n'];

    // Top trending coins
    if (trending.status === 'fulfilled') {
      const coins = trending.value.coins?.slice(0, 7) || [];
      if (coins.length > 0) {
        lines.push('  TRENDING');
        for (const c of coins) {
          const item = c.item;
          const priceChange = item.data?.price_change_percentage_24h?.usd;
          const changeStr = priceChange != null ? ` (${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(1)}%)` : '';
          lines.push(`    ${item.name} (${item.symbol})${changeStr} — #${item.market_cap_rank || '?'}`);
        }
      }
    }

    // Top gaining categories
    if (categories.status === 'fulfilled') {
      const cats = categories.value?.slice(0, 8) || [];
      if (cats.length > 0) {
        lines.push('\n  HOT CATEGORIES (24h)');
        for (const cat of cats) {
          const change = cat.market_cap_change_24h;
          if (change == null) continue;
          const changeStr = `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`;
          const mcap = cat.market_cap ? `$${formatLargeNumber(cat.market_cap)}` : '';
          lines.push(`    ${changeStr} ${cat.name} ${mcap ? `(${mcap})` : ''}`);
        }
      }
    }

    // Narrative detection from categories
    if (categories.status === 'fulfilled') {
      const cats = categories.value || [];
      const narratives = detectNarratives(cats);
      if (narratives.length > 0) {
        lines.push('\n  NARRATIVE SIGNALS');
        for (const n of narratives) {
          lines.push(`    ${n}`);
        }
      }
    }

    return lines.join('\n');
  } catch (err) {
    return `Narrative analysis failed: ${err.message}`;
  }
}

// ============ Helpers ============

function detectNarratives(categories) {
  const signals = [];
  for (const cat of categories.slice(0, 20)) {
    const name = (cat.name || '').toLowerCase();
    const change = cat.market_cap_change_24h || 0;
    if (change < 3) continue;

    if (name.includes('ai') || name.includes('artificial')) signals.push(`AI narrative heating up (+${change.toFixed(1)}%)`);
    else if (name.includes('meme')) signals.push(`Memecoin rotation active (+${change.toFixed(1)}%)`);
    else if (name.includes('defi') || name.includes('dex')) signals.push(`DeFi renaissance signal (+${change.toFixed(1)}%)`);
    else if (name.includes('layer 2') || name.includes('l2')) signals.push(`L2 narrative building (+${change.toFixed(1)}%)`);
    else if (name.includes('gaming') || name.includes('play')) signals.push(`GameFi interest rising (+${change.toFixed(1)}%)`);
    else if (name.includes('rwa') || name.includes('real world')) signals.push(`RWA tokenization trending (+${change.toFixed(1)}%)`);
    else if (name.includes('privacy') || name.includes('zero knowledge')) signals.push(`Privacy/ZK narrative active (+${change.toFixed(1)}%)`);
    else if (name.includes('depin')) signals.push(`DePIN infrastructure play (+${change.toFixed(1)}%)`);
  }
  return [...new Set(signals)].slice(0, 5);
}

function calculateSentiment(coinData, redditResult) {
  const factors = [];
  let score = 50; // neutral baseline

  const md = coinData.market_data;
  if (md) {
    // Price momentum
    const change24h = md.price_change_percentage_24h || 0;
    const change7d = md.price_change_percentage_7d || 0;
    if (change24h > 5) { score += 10; factors.push('Strong 24h momentum'); }
    else if (change24h < -5) { score -= 10; factors.push('Bearish 24h price action'); }
    if (change7d > 10) { score += 10; factors.push('Bullish weekly trend'); }
    else if (change7d < -10) { score -= 10; factors.push('Weak weekly trend'); }

    // Volume analysis
    const vol = md.total_volume?.usd || 0;
    const mcap = md.market_cap?.usd || 1;
    const volRatio = vol / mcap;
    if (volRatio > 0.3) { score += 8; factors.push('High volume/mcap ratio (interest spike)'); }
    else if (volRatio < 0.02) { score -= 5; factors.push('Low volume (apathy)'); }

    // ATH proximity
    const athDrop = md.ath_change_percentage?.usd || -100;
    if (athDrop > -10) { score += 5; factors.push('Near ATH (euphoria zone)'); }
    else if (athDrop < -80) { score -= 5; factors.push('Deep drawdown from ATH'); }
  }

  // Dev activity
  const dev = coinData.developer_data;
  if (dev?.commit_count_4_weeks > 50) { score += 8; factors.push('Active development'); }
  else if (dev?.commit_count_4_weeks === 0) { score -= 10; factors.push('No recent dev activity'); }

  // Reddit sentiment
  if (redditResult?.status === 'fulfilled' && redditResult.value?.sentiment === 'Bullish') {
    score += 5; factors.push('Bullish Reddit sentiment');
  }

  // Clamp
  score = Math.max(0, Math.min(100, score));
  const label = score >= 70 ? 'Bullish' : score >= 55 ? 'Slightly Bullish' : score >= 45 ? 'Neutral' : score >= 30 ? 'Slightly Bearish' : 'Bearish';

  return { score, label, factors };
}

async function fetchRedditSentiment(token) {
  try {
    const resp = await fetch(
      `https://www.reddit.com/search.json?q=${encodeURIComponent(token + ' crypto')}&sort=hot&limit=5&t=day`,
      { signal: AbortSignal.timeout(HTTP_TIMEOUT), headers: { 'User-Agent': 'JarvisBot/1.0' } }
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    const posts = data?.data?.children || [];
    if (posts.length === 0) return null;

    const scores = posts.map(p => p.data.score);
    const avgScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    const topTitle = posts[0]?.data?.title?.slice(0, 60) || '?';

    // Simple sentiment from upvote ratio
    const avgUpvoteRatio = posts.reduce((a, p) => a + (p.data.upvote_ratio || 0.5), 0) / posts.length;
    const sentiment = avgUpvoteRatio > 0.7 ? 'Bullish' : avgUpvoteRatio > 0.5 ? 'Neutral' : 'Bearish';

    return { posts: posts.length, avgScore, topTitle, sentiment };
  } catch {
    return null;
  }
}

function formatLargeNumber(n) {
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

function fmtPrice(p) {
  if (p == null) return '?';
  return `$${p.toLocaleString(undefined, { maximumFractionDigits: 6 })}`;
}

function fmtPct(p) {
  if (p == null) return '?';
  return `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`;
}

async function fetchJSON(url) {
  const resp = await fetch(url, {
    signal: AbortSignal.timeout(HTTP_TIMEOUT),
    headers: { 'Accept': 'application/json' },
  });
  return resp.json();
}
