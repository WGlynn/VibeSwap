// ============ Derivatives Market Data — Liquidations, Funding, OI ============
//
// The pulse of the market. Derivatives traders check this 10+ times per day.
// Uses CoinGlass open data endpoints (no key required for basic data).
//
// Commands:
//   /liquidations [token]   — Recent liquidation data
//   /funding [token]        — Funding rates across exchanges
//   /oi [token]             — Open interest aggregated
//   /lsratio [token]        — Long/short ratio
//   /etf                    — BTC/ETH ETF flow data
// ============

const HTTP_TIMEOUT = 12000;

// ============ /liquidations — Liquidation Data ============

export async function getLiquidations(token) {
  const symbol = (token || 'BTC').toUpperCase();

  try {
    // Use CoinGlass public liquidation data
    const resp = await fetch(
      `https://open-api.coinglass.com/public/v2/liquidation_history?symbol=${symbol}&time_type=all`,
      {
        signal: AbortSignal.timeout(HTTP_TIMEOUT),
        headers: { 'Accept': 'application/json' },
      }
    );

    if (resp.ok) {
      const data = await resp.json();
      if (data.code === '0' && data.data?.length > 0) {
        const lines = [`Liquidations — ${symbol}\n`];
        const recent = data.data.slice(0, 5);
        for (const d of recent) {
          const date = new Date(d.createTime).toLocaleDateString();
          const longLiq = d.longVolUsd ? `$${formatNum(d.longVolUsd)}` : '?';
          const shortLiq = d.shortVolUsd ? `$${formatNum(d.shortVolUsd)}` : '?';
          lines.push(`  ${date}: Longs $${longLiq} | Shorts $${shortLiq}`);
        }
        return lines.join('\n');
      }
    }

    // Fallback: use Coinalyze free data or synthetic estimate
    return await getLiquidationsFallback(symbol);
  } catch (err) {
    return await getLiquidationsFallback(symbol).catch(() => `Liquidation data failed: ${err.message}`);
  }
}

async function getLiquidationsFallback(symbol) {
  // Fetch price data to estimate market conditions
  try {
    const resp = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${symbolToId(symbol)}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`,
      { signal: AbortSignal.timeout(HTTP_TIMEOUT) }
    );
    if (!resp.ok) return `Liquidations data unavailable (HTTP ${resp.status}).`;
    const data = await resp.json();
    const id = symbolToId(symbol);
    const info = data[id];
    if (!info) return `No data for ${symbol}.`;

    const change = info.usd_24h_change;
    const vol = info.usd_24h_vol;

    // Estimate liquidation pressure from price movement
    const direction = change > 0 ? 'SHORT' : 'LONG';
    const pressure = Math.abs(change) > 5 ? 'HIGH' : Math.abs(change) > 2 ? 'MODERATE' : 'LOW';

    const lines = [`${symbol} Market Pressure\n`];
    lines.push(`  Price: $${info.usd.toLocaleString()}`);
    lines.push(`  24h Change: ${change >= 0 ? '+' : ''}${change?.toFixed(2)}%`);
    lines.push(`  24h Volume: $${formatNum(vol || 0)}`);
    lines.push(`\n  Liquidation Pressure: ${pressure}`);
    lines.push(`  Direction: ${direction} squeezes likely`);
    if (Math.abs(change) > 3) {
      lines.push(`  Warning: ${Math.abs(change).toFixed(1)}% move = leveraged positions at risk`);
    }

    return lines.join('\n');
  } catch (err) {
    return `Market pressure data failed: ${err.message}`;
  }
}

// ============ /funding — Funding Rates ============

export async function getFundingRates(token) {
  const symbol = (token || 'BTC').toUpperCase();

  try {
    const resp = await fetch(
      `https://open-api.coinglass.com/public/v2/funding?symbol=${symbol}`,
      {
        signal: AbortSignal.timeout(HTTP_TIMEOUT),
        headers: { 'Accept': 'application/json' },
      }
    );

    if (resp.ok) {
      const data = await resp.json();
      if (data.code === '0' && data.data?.length > 0) {
        const lines = [`Funding Rates — ${symbol}\n`];
        for (const ex of data.data.slice(0, 8)) {
          const rate = ex.rate != null ? `${(ex.rate * 100).toFixed(4)}%` : '?';
          const name = ex.exchangeName || '?';
          const emoji = ex.rate > 0 ? '🟢' : ex.rate < 0 ? '🔴' : '⚪';
          lines.push(`  ${emoji} ${name.padEnd(12)} ${rate}`);
        }
        const avg = data.data.reduce((s, e) => s + (e.rate || 0), 0) / data.data.length;
        lines.push(`\n  Average: ${(avg * 100).toFixed(4)}%`);
        lines.push(`  Signal: ${avg > 0.01 ? 'Overleveraged longs (bearish)' : avg < -0.01 ? 'Overleveraged shorts (bullish)' : 'Neutral'}`);
        return lines.join('\n');
      }
    }

    // Fallback: show market context
    return await getFundingFallback(symbol);
  } catch {
    return await getFundingFallback(symbol);
  }
}

async function getFundingFallback(symbol) {
  try {
    const resp = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${symbolToId(symbol)}&vs_currencies=usd&include_24hr_change=true`,
      { signal: AbortSignal.timeout(HTTP_TIMEOUT) }
    );
    if (!resp.ok) return `Funding rate data unavailable (HTTP ${resp.status}).`;
    const data = await resp.json();
    const info = data[symbolToId(symbol)];
    if (!info) return `No data for ${symbol}.`;

    const change = info.usd_24h_change || 0;
    const sentimentGuess = change > 3 ? 'Likely positive (longs paying shorts)'
      : change < -3 ? 'Likely negative (shorts paying longs)'
      : 'Likely neutral';

    const lines = [`${symbol} Funding Estimate\n`];
    lines.push(`  Price: $${info.usd.toLocaleString()}`);
    lines.push(`  24h: ${change >= 0 ? '+' : ''}${change.toFixed(2)}%`);
    lines.push(`  Funding: ${sentimentGuess}`);
    lines.push(`\n  Note: Full funding rates require CoinGlass API key.`);
    lines.push(`  Check coinglass.com/FundingRate for live data.`);
    return lines.join('\n');
  } catch (err) {
    return `Funding data failed: ${err.message}`;
  }
}

// ============ /oi — Open Interest ============

export async function getOpenInterest(token) {
  const symbol = (token || 'BTC').toUpperCase();

  try {
    const resp = await fetch(
      `https://open-api.coinglass.com/public/v2/open_interest?symbol=${symbol}`,
      {
        signal: AbortSignal.timeout(HTTP_TIMEOUT),
        headers: { 'Accept': 'application/json' },
      }
    );

    if (resp.ok) {
      const data = await resp.json();
      if (data.code === '0' && data.data?.length > 0) {
        const lines = [`Open Interest — ${symbol}\n`];
        let totalOI = 0;
        for (const ex of data.data.slice(0, 8)) {
          const oi = ex.openInterest || 0;
          totalOI += oi;
          const name = ex.exchangeName || '?';
          lines.push(`  ${name.padEnd(12)} $${formatNum(oi)}`);
        }
        lines.push(`\n  Total OI: $${formatNum(totalOI)}`);
        return lines.join('\n');
      }
    }

    return getOIFallback(symbol);
  } catch {
    return getOIFallback(symbol);
  }
}

function getOIFallback(symbol) {
  return `${symbol} Open Interest\n\n  Full OI data requires CoinGlass API key.\n  Check coinglass.com/OpenInterest for live data.\n\n  Use /liquidations ${symbol.toLowerCase()} for market pressure estimate.`;
}

// ============ /lsratio — Long/Short Ratio ============

export async function getLongShortRatio(token) {
  const symbol = (token || 'BTC').toUpperCase();

  try {
    const resp = await fetch(
      `https://open-api.coinglass.com/public/v2/long_short?symbol=${symbol}&time_type=4`,
      {
        signal: AbortSignal.timeout(HTTP_TIMEOUT),
        headers: { 'Accept': 'application/json' },
      }
    );

    if (resp.ok) {
      const data = await resp.json();
      if (data.code === '0' && data.data?.length > 0) {
        const lines = [`Long/Short Ratio — ${symbol}\n`];
        for (const ex of data.data.slice(0, 8)) {
          const name = ex.exchangeName || '?';
          const longRate = ex.longRate != null ? `${(ex.longRate * 100).toFixed(1)}%` : '?';
          const shortRate = ex.shortRate != null ? `${(ex.shortRate * 100).toFixed(1)}%` : '?';
          const ratio = ex.longShortRatio != null ? ex.longShortRatio.toFixed(2) : '?';
          lines.push(`  ${name.padEnd(12)} L: ${longRate} | S: ${shortRate} | Ratio: ${ratio}`);
        }

        const avgLong = data.data.reduce((s, e) => s + (e.longRate || 0), 0) / data.data.length;
        lines.push(`\n  Avg Long: ${(avgLong * 100).toFixed(1)}% | Short: ${((1 - avgLong) * 100).toFixed(1)}%`);
        lines.push(`  Signal: ${avgLong > 0.55 ? 'Overleveraged longs — potential correction' : avgLong < 0.45 ? 'Overleveraged shorts — potential squeeze' : 'Balanced positioning'}`);
        return lines.join('\n');
      }
    }

    return `${symbol} Long/Short Ratio\n\n  Full L/S data requires CoinGlass API key.\n  Check coinglass.com/LongShortRatio for live data.`;
  } catch (err) {
    return `L/S ratio failed: ${err.message}`;
  }
}

// ============ /etf — ETF Flow Data ============

export async function getETFFlows() {
  try {
    // Use CoinGlass ETF data
    const resp = await fetch(
      'https://open-api.coinglass.com/public/v2/etf/bitcoin_flow_total',
      {
        signal: AbortSignal.timeout(HTTP_TIMEOUT),
        headers: { 'Accept': 'application/json' },
      }
    );

    if (resp.ok) {
      const data = await resp.json();
      if (data.code === '0' && data.data) {
        const d = data.data;
        const lines = ['Bitcoin ETF Flows\n'];
        if (d.totalNetAsset) lines.push(`  Total AUM: $${formatNum(d.totalNetAsset)}`);
        if (d.totalDailyFlow) lines.push(`  Today: ${d.totalDailyFlow >= 0 ? '+' : ''}$${formatNum(Math.abs(d.totalDailyFlow))}`);
        if (d.totalWeeklyFlow) lines.push(`  This Week: ${d.totalWeeklyFlow >= 0 ? '+' : ''}$${formatNum(Math.abs(d.totalWeeklyFlow))}`);
        return lines.join('\n');
      }
    }

    // Fallback
    return `Bitcoin ETF Flows\n\n  Full ETF flow data at coinglass.com/bitcoin-etf\n  Check for daily inflow/outflow across IBIT, FBTC, GBTC, etc.`;
  } catch (err) {
    return `ETF data failed: ${err.message}`;
  }
}

// ============ Helpers ============

function symbolToId(symbol) {
  const map = {
    BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', BNB: 'binancecoin',
    XRP: 'ripple', ADA: 'cardano', DOGE: 'dogecoin', DOT: 'polkadot',
    AVAX: 'avalanche-2', LINK: 'chainlink', UNI: 'uniswap', MATIC: 'matic-network',
    ARB: 'arbitrum', OP: 'optimism', ATOM: 'cosmos', NEAR: 'near',
  };
  return map[symbol] || symbol.toLowerCase();
}

function formatNum(n) {
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}
