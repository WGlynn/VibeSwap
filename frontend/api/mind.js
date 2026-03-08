// Vercel Edge: JARVIS Mind Network proxy
// Caches /web/mind and /web/health responses at the edge
// Reduces load on Fly.io shards, provides fallback when primary is down

const JARVIS_PRIMARY = 'https://jarvis-vibeswap.fly.dev';
const JARVIS_SHARDS = [
  'https://jarvis-vibeswap.fly.dev',
  'https://jarvis-shard-1.fly.dev',
  'https://jarvis-shard-eu.fly.dev',
  'https://jarvis-shard-ap.fly.dev',
];

// In-memory cache (persists across warm invocations)
let cachedMind = null;
let cachedHealth = null;
let lastMindFetch = 0;
let lastHealthFetch = 0;
const MIND_TTL = 15_000;   // 15s cache for mind data
const HEALTH_TTL = 10_000; // 10s cache for health

async function fetchWithFallback(path, timeout = 5000) {
  for (const base of JARVIS_SHARDS) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      const res = await fetch(`${base}${path}`, { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) return await res.json();
    } catch {
      // Try next shard
    }
  }
  return null;
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const type = req.query?.type || 'mind';
  const now = Date.now();

  if (type === 'health') {
    if (cachedHealth && (now - lastHealthFetch) < HEALTH_TTL) {
      return res.status(200).json({ ...cachedHealth, cached: true });
    }
    const data = await fetchWithFallback('/web/health');
    if (data) {
      cachedHealth = data;
      lastHealthFetch = now;
      return res.status(200).json({ ...data, cached: false, edge: true });
    }
    // All shards down — return cached or offline
    return res.status(200).json(cachedHealth || { status: 'offline', edge: true, cached: true });
  }

  // Mind data
  if (cachedMind && (now - lastMindFetch) < MIND_TTL) {
    return res.status(200).json({ ...cachedMind, cached: true });
  }
  const data = await fetchWithFallback('/web/mind');
  if (data) {
    cachedMind = data;
    lastMindFetch = now;
    return res.status(200).json({ ...data, cached: false, edge: true });
  }
  return res.status(200).json(cachedMind || { error: 'Mind network unreachable', edge: true });
}
