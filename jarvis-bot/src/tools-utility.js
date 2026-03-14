// ============ Utility Tools — General Purpose Free APIs ============
//
// Commands:
//   /weather <city>          — Weather forecast (Open-Meteo, no key)
//   /wiki <topic>            — Wikipedia summary
//   /define <word>           — Dictionary definition (Free Dictionary API)
//   /translate <lang> <text> — Translation (MyMemory API, free)
//   /calc <expression>       — Math calculator (built-in)
//   /time <city/tz>          — World clock
//   /shorten <url>           — URL shortener (TinyURL, free)
// ============

const HTTP_TIMEOUT = 10000;

// ============ Weather (Open-Meteo — completely free, no key) ============

export async function getWeather(city) {
  try {
    // Step 1: Geocode the city name
    const geoResp = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en`,
      { signal: AbortSignal.timeout(HTTP_TIMEOUT) }
    );
    const geoData = await geoResp.json();
    const loc = geoData.results?.[0];
    if (!loc) return `City "${city}" not found. Try a different spelling.`;

    // Step 2: Get weather
    const wxResp = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=3`,
      { signal: AbortSignal.timeout(HTTP_TIMEOUT) }
    );
    const wxData = await wxResp.json();
    const cur = wxData.current;
    const daily = wxData.daily;

    if (!cur) return 'Weather data unavailable.';

    const condition = weatherCodeToText(cur.weather_code);
    const tempC = cur.temperature_2m;
    const tempF = (tempC * 9/5 + 32).toFixed(1);
    const feelsC = cur.apparent_temperature;
    const feelsF = (feelsC * 9/5 + 32).toFixed(1);

    const lines = [`${loc.name}, ${loc.country}\n`];
    lines.push(`  ${condition}`);
    lines.push(`  Temp: ${tempC}°C / ${tempF}°F`);
    lines.push(`  Feels: ${feelsC}°C / ${feelsF}°F`);
    lines.push(`  Humidity: ${cur.relative_humidity_2m}%`);
    lines.push(`  Wind: ${cur.wind_speed_10m} km/h`);

    if (daily?.time) {
      lines.push('');
      for (let i = 0; i < Math.min(3, daily.time.length); i++) {
        const hi = daily.temperature_2m_max[i];
        const lo = daily.temperature_2m_min[i];
        const rain = daily.precipitation_probability_max[i];
        const dayName = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : new Date(daily.time[i]).toLocaleDateString('en', { weekday: 'short' });
        lines.push(`  ${dayName}: ${lo}°–${hi}°C | Rain: ${rain}%`);
      }
    }

    return lines.join('\n');
  } catch (err) {
    return `Weather lookup failed: ${err.message}`;
  }
}

function weatherCodeToText(code) {
  const codes = {
    0: 'Clear sky', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast',
    45: 'Foggy', 48: 'Rime fog', 51: 'Light drizzle', 53: 'Moderate drizzle',
    55: 'Dense drizzle', 61: 'Light rain', 63: 'Moderate rain', 65: 'Heavy rain',
    71: 'Light snow', 73: 'Moderate snow', 75: 'Heavy snow', 77: 'Snow grains',
    80: 'Light showers', 81: 'Moderate showers', 82: 'Heavy showers',
    85: 'Light snow showers', 86: 'Heavy snow showers',
    95: 'Thunderstorm', 96: 'Thunderstorm + hail', 99: 'Heavy thunderstorm + hail',
  };
  return codes[code] || `Weather code ${code}`;
}

// ============ Wikipedia Summary ============

export async function getWiki(topic) {
  try {
    const resp = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topic)}`,
      { signal: AbortSignal.timeout(HTTP_TIMEOUT), headers: { 'Accept': 'application/json' } }
    );
    if (resp.status === 404) return `No Wikipedia article found for "${topic}".`;
    if (!resp.ok) throw new Error(`Wikipedia ${resp.status}`);
    const data = await resp.json();

    if (data.type === 'disambiguation') {
      return `"${topic}" has multiple meanings on Wikipedia. Try being more specific.`;
    }

    const title = data.title || topic;
    const extract = data.extract || 'No summary available.';
    // Trim to reasonable length for Telegram
    const summary = extract.length > 800 ? extract.slice(0, 800) + '...' : extract;

    return `${title}\n\n${summary}\n\nRead more: ${data.content_urls?.desktop?.page || ''}`;
  } catch (err) {
    return `Wikipedia lookup failed: ${err.message}`;
  }
}

// ============ Dictionary Definition (Free Dictionary API) ============

export async function getDefinition(word) {
  try {
    const resp = await fetch(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
      { signal: AbortSignal.timeout(HTTP_TIMEOUT) }
    );
    if (resp.status === 404) return `No definition found for "${word}".`;
    if (!resp.ok) throw new Error(`Dictionary ${resp.status}`);
    const data = await resp.json();

    const entry = data[0];
    if (!entry) return `No definition found for "${word}".`;

    const lines = [`${entry.word}`];
    if (entry.phonetic) lines[0] += ` ${entry.phonetic}`;
    lines.push('');

    // Show up to 3 meanings
    const meanings = entry.meanings?.slice(0, 3) || [];
    for (const m of meanings) {
      lines.push(`  ${m.partOfSpeech}:`);
      const defs = m.definitions?.slice(0, 2) || [];
      for (const d of defs) {
        lines.push(`    - ${d.definition}`);
        if (d.example) lines.push(`      "${d.example}"`);
      }
    }

    // Synonyms
    const syns = meanings.flatMap(m => m.synonyms || []).slice(0, 5);
    if (syns.length > 0) {
      lines.push(`\n  Synonyms: ${syns.join(', ')}`);
    }

    return lines.join('\n');
  } catch (err) {
    return `Definition lookup failed: ${err.message}`;
  }
}

// ============ Translation (MyMemory — free, no key, 5000 chars/day) ============

const LANG_ALIASES = {
  en: 'en', english: 'en', eng: 'en',
  es: 'es', spanish: 'es', esp: 'es',
  fr: 'fr', french: 'fr', fra: 'fr',
  de: 'de', german: 'de', deu: 'de',
  it: 'it', italian: 'it', ita: 'it',
  pt: 'pt', portuguese: 'pt', por: 'pt',
  ru: 'ru', russian: 'ru', rus: 'ru',
  zh: 'zh-CN', chinese: 'zh-CN', cn: 'zh-CN', mandarin: 'zh-CN',
  ja: 'ja', japanese: 'ja', jpn: 'ja',
  ko: 'ko', korean: 'ko', kor: 'ko',
  ar: 'ar', arabic: 'ar', ara: 'ar',
  hi: 'hi', hindi: 'hi', hin: 'hi',
  tr: 'tr', turkish: 'tr', tur: 'tr',
  nl: 'nl', dutch: 'nl', nld: 'nl',
  pl: 'pl', polish: 'pl', pol: 'pl',
  uk: 'uk', ukrainian: 'uk', ukr: 'uk',
  sv: 'sv', swedish: 'sv', swe: 'sv',
};

function resolveLang(input) {
  return LANG_ALIASES[input.toLowerCase()] || input.toLowerCase();
}

export async function translateText(targetLang, text) {
  const to = resolveLang(targetLang);
  try {
    const resp = await fetch(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 500))}&langpair=autodetect|${to}`,
      { signal: AbortSignal.timeout(HTTP_TIMEOUT) }
    );
    const data = await resp.json();
    if (data.responseStatus !== 200 && data.responseStatus !== '200') {
      return `Translation failed: ${data.responseDetails || 'Unknown error'}`;
    }

    const translated = data.responseData?.translatedText;
    if (!translated) return 'Translation returned empty result.';

    const detectedLang = data.responseData?.detectedLanguage || '?';
    return `Translation (${detectedLang} -> ${to}):\n\n${translated}`;
  } catch (err) {
    return `Translation failed: ${err.message}`;
  }
}

// ============ Math Calculator (built-in, safe eval) ============

export function calculate(expression) {
  try {
    // Sanitize: only allow math characters
    const sanitized = expression.replace(/[^0-9+\-*/().%^, episincostaqlgbrhf]/gi, '');
    if (!sanitized || sanitized.length > 200) return 'Invalid expression.';

    // Replace common math functions with Math.* equivalents
    let expr = sanitized
      .replace(/\^/g, '**')
      .replace(/\bsqrt\(/gi, 'Math.sqrt(')
      .replace(/\babs\(/gi, 'Math.abs(')
      .replace(/\bsin\(/gi, 'Math.sin(')
      .replace(/\bcos\(/gi, 'Math.cos(')
      .replace(/\btan\(/gi, 'Math.tan(')
      .replace(/\blog\(/gi, 'Math.log10(')
      .replace(/\bln\(/gi, 'Math.log(')
      .replace(/\bfloor\(/gi, 'Math.floor(')
      .replace(/\bceil\(/gi, 'Math.ceil(')
      .replace(/\bround\(/gi, 'Math.round(')
      .replace(/\bpi\b/gi, 'Math.PI')
      .replace(/\be\b/gi, 'Math.E');

    // Block prototype/constructor access attempts
    if (/constructor|prototype|__proto__|this|self|global|process|require|import|window/i.test(expr)) {
      return 'Invalid expression — only math operations allowed.';
    }

    // Safe evaluation using Function constructor (no access to globals)
    const fn = new Function('Math', `"use strict"; return (${expr})`);
    const result = fn(Math);

    if (typeof result !== 'number' || !isFinite(result)) {
      return 'Result is not a finite number.';
    }

    // Format nicely
    const formatted = Number.isInteger(result) ? result.toLocaleString() :
      Math.abs(result) >= 1 ? result.toLocaleString('en-US', { maximumFractionDigits: 6 }) :
      result.toPrecision(8);

    return `${expression} = ${formatted}`;
  } catch (err) {
    return `Calculation error: ${err.message}`;
  }
}

// ============ World Clock ============

const TIMEZONE_MAP = {
  // Cities
  'new york': 'America/New_York', 'nyc': 'America/New_York', 'ny': 'America/New_York',
  'los angeles': 'America/Los_Angeles', 'la': 'America/Los_Angeles', 'sf': 'America/Los_Angeles',
  'chicago': 'America/Chicago',
  'london': 'Europe/London', 'uk': 'Europe/London',
  'paris': 'Europe/Paris', 'berlin': 'Europe/Berlin', 'amsterdam': 'Europe/Amsterdam',
  'tokyo': 'Asia/Tokyo', 'japan': 'Asia/Tokyo',
  'shanghai': 'Asia/Shanghai', 'beijing': 'Asia/Shanghai', 'china': 'Asia/Shanghai',
  'singapore': 'Asia/Singapore', 'sg': 'Asia/Singapore',
  'dubai': 'Asia/Dubai', 'uae': 'Asia/Dubai',
  'sydney': 'Australia/Sydney', 'melbourne': 'Australia/Melbourne',
  'mumbai': 'Asia/Kolkata', 'delhi': 'Asia/Kolkata', 'india': 'Asia/Kolkata',
  'seoul': 'Asia/Seoul', 'korea': 'Asia/Seoul',
  'hong kong': 'Asia/Hong_Kong', 'hk': 'Asia/Hong_Kong',
  'toronto': 'America/Toronto', 'moscow': 'Europe/Moscow',
  'istanbul': 'Europe/Istanbul', 'cairo': 'Africa/Cairo',
  'lagos': 'Africa/Lagos', 'nairobi': 'Africa/Nairobi',
  'sao paulo': 'America/Sao_Paulo', 'buenos aires': 'America/Argentina/Buenos_Aires',
  // Abbreviations
  'est': 'America/New_York', 'cst': 'America/Chicago', 'mst': 'America/Denver',
  'pst': 'America/Los_Angeles', 'gmt': 'Europe/London', 'utc': 'UTC',
  'cet': 'Europe/Paris', 'jst': 'Asia/Tokyo', 'ist': 'Asia/Kolkata',
  'aest': 'Australia/Sydney', 'kst': 'Asia/Seoul',
};

export function getWorldTime(query) {
  const tz = TIMEZONE_MAP[query.toLowerCase()] || query;
  try {
    const now = new Date();
    const options = {
      timeZone: tz,
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: true,
    };
    const formatted = now.toLocaleString('en-US', options);
    const offset = new Intl.DateTimeFormat('en', { timeZone: tz, timeZoneName: 'shortOffset' })
      .formatToParts(now)
      .find(p => p.type === 'timeZoneName')?.value || '';

    return `${tz}\n\n  ${formatted}\n  ${offset}`;
  } catch {
    return `Unknown timezone "${query}". Try a city name (e.g., "tokyo") or timezone (e.g., "America/New_York").`;
  }
}

// ============ URL Shortener (TinyURL — free, no key) ============

export async function shortenUrl(url) {
  // Basic URL validation
  if (!url.match(/^https?:\/\/.+/i)) {
    if (!url.includes('.')) return 'Invalid URL. Include the full URL starting with http(s)://';
    url = 'https://' + url;
  }

  try {
    const resp = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`, {
      signal: AbortSignal.timeout(HTTP_TIMEOUT),
    });
    if (!resp.ok) throw new Error(`TinyURL ${resp.status}`);
    const short = await resp.text();
    return `${short}`;
  } catch (err) {
    return `URL shortening failed: ${err.message}`;
  }
}
