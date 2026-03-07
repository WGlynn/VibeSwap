// ============ Engagement & Combo Tools ============
//
// Commands:
//   /morning            — Daily crypto briefing (combo command)
//   /alpha <token>      — Full alpha report (combo: price + security + social)
//   /markets            — Traditional market hours
//   /fact               — Random interesting fact
//   /today              — On this day in history (Wikipedia)
//   /dog                — Random dog picture
//   /cat                — Random cat picture
//   /carbon <code>      — Beautiful code screenshot
//   /paste <text>       — Create a paste (dpaste)
//   /advice             — Random advice
// ============

const HTTP_TIMEOUT = 10000;

// ============ Morning Briefing (Combo Command) ============

export async function getMorningBriefing() {
  try {
    const [btcPrice, fearGreed, gasPrice, depeg] = await Promise.allSettled([
      fetchJSON('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true'),
      fetchJSON('https://api.alternative.me/fng/?limit=1'),
      fetchJSON('https://api.etherscan.io/api?module=gastracker&action=gasoracle'),
      fetchJSON('https://api.coingecko.com/api/v3/simple/price?ids=tether,usd-coin,dai&vs_currencies=usd'),
    ]);

    const lines = ['Good Morning! Daily Crypto Briefing\n'];
    const now = new Date();
    lines.push(`  ${now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}\n`);

    // Prices
    if (btcPrice.status === 'fulfilled') {
      const p = btcPrice.value;
      if (p.bitcoin) {
        const btcChange = p.bitcoin.usd_24h_change;
        lines.push(`  BTC: $${p.bitcoin.usd.toLocaleString()} (${btcChange >= 0 ? '+' : ''}${btcChange?.toFixed(1)}%)`);
      }
      if (p.ethereum) {
        const ethChange = p.ethereum.usd_24h_change;
        lines.push(`  ETH: $${p.ethereum.usd.toLocaleString()} (${ethChange >= 0 ? '+' : ''}${ethChange?.toFixed(1)}%)`);
      }
      if (p.solana) {
        const solChange = p.solana.usd_24h_change;
        lines.push(`  SOL: $${p.solana.usd.toLocaleString()} (${solChange >= 0 ? '+' : ''}${solChange?.toFixed(1)}%)`);
      }
    }

    // Fear & Greed
    if (fearGreed.status === 'fulfilled') {
      const fg = fearGreed.value.data?.[0];
      if (fg) {
        lines.push(`\n  Fear & Greed: ${fg.value}/100 (${fg.value_classification})`);
      }
    }

    // Gas
    if (gasPrice.status === 'fulfilled' && gasPrice.value.status === '1') {
      const g = gasPrice.value.result;
      lines.push(`  ETH Gas: ${g.ProposeGasPrice} gwei`);
    }

    // Stablecoin pegs
    if (depeg.status === 'fulfilled') {
      const d = depeg.value;
      const depegged = [];
      if (d.tether && Math.abs(d.tether.usd - 1) > 0.005) depegged.push(`USDT: $${d.tether.usd.toFixed(4)}`);
      if (d['usd-coin'] && Math.abs(d['usd-coin'].usd - 1) > 0.005) depegged.push(`USDC: $${d['usd-coin'].usd.toFixed(4)}`);
      if (d.dai && Math.abs(d.dai.usd - 1) > 0.005) depegged.push(`DAI: $${d.dai.usd.toFixed(4)}`);
      if (depegged.length > 0) {
        lines.push(`\n  ⚠️ DEPEG ALERT: ${depegged.join(', ')}`);
      } else {
        lines.push('  Stablecoins: All pegged');
      }
    }

    // Market hours
    lines.push(`\n  ${getMarketStatusLine()}`);

    return lines.join('\n');
  } catch (err) {
    return `Morning briefing failed: ${err.message}`;
  }
}

// ============ Traditional Market Hours ============

function getMarketStatusLine() {
  const now = new Date();

  const markets = [
    { name: 'NYSE', tz: 'America/New_York', open: 9.5, close: 16 },
    { name: 'LSE', tz: 'Europe/London', open: 8, close: 16.5 },
    { name: 'TSE', tz: 'Asia/Tokyo', open: 9, close: 15 },
    { name: 'HKEX', tz: 'Asia/Hong_Kong', open: 9.5, close: 16 },
  ];

  const statuses = [];
  for (const m of markets) {
    const localTime = new Date(now.toLocaleString('en-US', { timeZone: m.tz }));
    const hour = localTime.getHours() + localTime.getMinutes() / 60;
    const day = localTime.getDay();
    const isWeekend = day === 0 || day === 6;
    const isOpen = !isWeekend && hour >= m.open && hour < m.close;
    statuses.push(`${m.name}: ${isOpen ? '🟢' : '🔴'}`);
  }
  return `Markets: ${statuses.join(' | ')}`;
}

export function getMarketHours() {
  const now = new Date();
  const lines = ['Traditional Market Hours\n'];

  const markets = [
    { name: 'NYSE (US)', tz: 'America/New_York', open: '9:30 AM', close: '4:00 PM', openH: 9.5, closeH: 16 },
    { name: 'NASDAQ (US)', tz: 'America/New_York', open: '9:30 AM', close: '4:00 PM', openH: 9.5, closeH: 16 },
    { name: 'LSE (UK)', tz: 'Europe/London', open: '8:00 AM', close: '4:30 PM', openH: 8, closeH: 16.5 },
    { name: 'TSE (Japan)', tz: 'Asia/Tokyo', open: '9:00 AM', close: '3:00 PM', openH: 9, closeH: 15 },
    { name: 'HKEX (HK)', tz: 'Asia/Hong_Kong', open: '9:30 AM', close: '4:00 PM', openH: 9.5, closeH: 16 },
    { name: 'ASX (AUS)', tz: 'Australia/Sydney', open: '10:00 AM', close: '4:00 PM', openH: 10, closeH: 16 },
  ];

  for (const m of markets) {
    const localTime = new Date(now.toLocaleString('en-US', { timeZone: m.tz }));
    const hour = localTime.getHours() + localTime.getMinutes() / 60;
    const day = localTime.getDay();
    const isWeekend = day === 0 || day === 6;
    const isOpen = !isWeekend && hour >= m.openH && hour < m.closeH;
    const icon = isOpen ? '🟢' : '🔴';
    const localStr = localTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    lines.push(`  ${icon} ${m.name.padEnd(16)} ${isOpen ? 'OPEN' : 'CLOSED'} (${localStr} local)`);
  }

  lines.push('\n  Crypto markets: 24/7 🟢');
  return lines.join('\n');
}

// ============ Random Facts (numbersapi — no key) ============

export async function getRandomFact() {
  try {
    const resp = await fetch('https://uselessfacts.jsph.pl/api/v2/facts/random?language=en', {
      signal: AbortSignal.timeout(HTTP_TIMEOUT),
    });
    if (!resp.ok) throw new Error(`Facts API ${resp.status}`);
    const data = await resp.json();
    return `💡 ${data.text}`;
  } catch {
    // Fallback to numbersapi
    try {
      const resp = await fetch('http://numbersapi.com/random/trivia', {
        signal: AbortSignal.timeout(HTTP_TIMEOUT),
      });
      return `💡 ${await resp.text()}`;
    } catch (err) {
      return `Fact fetch failed: ${err.message}`;
    }
  }
}

// ============ On This Day (Wikipedia — no key) ============

export async function getOnThisDay() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');

  try {
    const resp = await fetch(
      `https://api.wikimedia.org/feed/v1/wikipedia/en/onthisday/events/${month}/${day}`,
      { signal: AbortSignal.timeout(HTTP_TIMEOUT), headers: { 'Accept': 'application/json' } }
    );
    if (!resp.ok) throw new Error(`Wikipedia ${resp.status}`);
    const data = await resp.json();
    const events = data.events || [];

    if (events.length === 0) return 'No events found for today.';

    // Pick 5 interesting ones (prioritize recent and tech-related)
    const sorted = events.sort((a, b) => (b.year || 0) - (a.year || 0));
    const selected = sorted.slice(0, 5);

    const lines = [`On This Day — ${now.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}\n`];
    for (const e of selected) {
      const year = e.year || '?';
      const text = e.text?.length > 120 ? e.text.slice(0, 120) + '...' : e.text;
      lines.push(`  ${year}: ${text}`);
    }
    return lines.join('\n');
  } catch (err) {
    return `On This Day failed: ${err.message}`;
  }
}

// ============ Dog & Cat Pics (free, no key) ============

export async function getRandomDog() {
  try {
    const resp = await fetch('https://dog.ceo/api/breeds/image/random', {
      signal: AbortSignal.timeout(HTTP_TIMEOUT),
    });
    const data = await resp.json();
    if (data.status !== 'success') return { error: 'Dog API unavailable.' };
    return { url: data.message };
  } catch (err) {
    return { error: `Dog pic failed: ${err.message}` };
  }
}

export async function getRandomCat() {
  try {
    const resp = await fetch('https://api.thecatapi.com/v1/images/search', {
      signal: AbortSignal.timeout(HTTP_TIMEOUT),
      headers: { 'Accept': 'application/json' },
    });
    const data = await resp.json();
    if (!data[0]?.url) return { error: 'Cat API unavailable.' };
    return { url: data[0].url };
  } catch (err) {
    return { error: `Cat pic failed: ${err.message}` };
  }
}

// ============ Code Screenshot (carbonara — free) ============

export async function getCodeScreenshot(code, language = 'javascript') {
  try {
    const resp = await fetch('https://carbonara.solopov.dev/api/cook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: code.slice(0, 2000),
        language,
        theme: 'dracula',
        backgroundColor: '#1a1a2e',
        windowControls: true,
        paddingVertical: '20px',
        paddingHorizontal: '20px',
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!resp.ok) throw new Error(`Carbonara ${resp.status}`);
    const buffer = Buffer.from(await resp.arrayBuffer());
    if (buffer.length < 500) throw new Error('Empty response');
    return { buffer };
  } catch (err) {
    return { error: `Code screenshot failed: ${err.message}` };
  }
}

// ============ Paste (dpaste — free, no key) ============

export async function createPaste(content, syntax = 'text', expiry = 7) {
  try {
    const body = new URLSearchParams({
      content: content.slice(0, 10000),
      syntax,
      expiry_days: String(Math.min(expiry, 365)),
    });

    const resp = await fetch('https://dpaste.org/api/', {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(HTTP_TIMEOUT),
    });
    if (!resp.ok) throw new Error(`dpaste ${resp.status}`);
    const url = (await resp.text()).trim();
    return `Paste created (expires in ${expiry}d):\n${url}`;
  } catch (err) {
    return `Paste creation failed: ${err.message}`;
  }
}

// ============ Random Advice (adviceslip — free) ============

export async function getAdvice() {
  try {
    const resp = await fetch('https://api.adviceslip.com/advice', {
      signal: AbortSignal.timeout(HTTP_TIMEOUT),
    });
    const data = await resp.json();
    return `💬 ${data.slip?.advice || 'No advice available.'}`;
  } catch (err) {
    return `Advice failed: ${err.message}`;
  }
}

// ============ Helpers ============

async function fetchJSON(url) {
  const resp = await fetch(url, {
    signal: AbortSignal.timeout(HTTP_TIMEOUT),
    headers: { 'Accept': 'application/json' },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}
