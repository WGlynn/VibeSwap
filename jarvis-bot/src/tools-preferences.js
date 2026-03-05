// ============ User Preferences & Portfolio Memory ============
//
// Persistent per-user preferences that survive restarts.
// JARVIS uses these for personalized responses and proactive alerts.
//
// Commands:
//   /portfolio [add|remove|show] — Track your crypto holdings
//   /setpref <key> <value>       — Set a preference
//   /prefs                        — View your preferences
//   /mywallet <address>          — Set your default wallet address
// ============

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { config } from './config.js';

const DATA_DIR = config.dataDir;
const PREFS_FILE = join(DATA_DIR, 'preferences.json');

// userId -> { portfolio: [{token, amount, chain}], prefs: {}, wallet: string, updatedAt }
const userPrefs = new Map();
let dirty = false;

// ============ Init / Persist ============

export async function initPreferences() {
  try {
    const data = await readFile(PREFS_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    for (const [userId, prefs] of Object.entries(parsed)) {
      userPrefs.set(Number(userId), prefs);
    }
    console.log(`[prefs] Loaded ${userPrefs.size} user preference profiles`);
  } catch {
    console.log('[prefs] No saved preferences — starting fresh');
  }
}

export async function flushPreferences() {
  if (!dirty) return;
  const obj = {};
  for (const [userId, prefs] of userPrefs) {
    obj[userId] = prefs;
  }
  await writeFile(PREFS_FILE, JSON.stringify(obj, null, 2));
  dirty = false;
}

function getOrCreate(userId) {
  if (!userPrefs.has(userId)) {
    userPrefs.set(userId, {
      portfolio: [],
      prefs: {},
      wallet: null,
      chains: [],
      updatedAt: Date.now(),
    });
  }
  return userPrefs.get(userId);
}

// ============ Portfolio ============

export function addToPortfolio(userId, token, amount, chain = 'eth') {
  const profile = getOrCreate(userId);
  if (profile.portfolio.length >= 30) return 'Portfolio limit reached (30 tokens).';

  const existing = profile.portfolio.find(p => p.token.toLowerCase() === token.toLowerCase() && p.chain === chain);
  if (existing) {
    existing.amount = amount;
    existing.updatedAt = Date.now();
  } else {
    profile.portfolio.push({ token: token.toLowerCase(), amount: parseFloat(amount) || 0, chain, updatedAt: Date.now() });
  }
  profile.updatedAt = Date.now();
  dirty = true;
  return `Added ${amount} ${token.toUpperCase()} (${chain}) to your portfolio.`;
}

export function removeFromPortfolio(userId, token) {
  const profile = getOrCreate(userId);
  const idx = profile.portfolio.findIndex(p => p.token.toLowerCase() === token.toLowerCase());
  if (idx === -1) return `${token.toUpperCase()} not in your portfolio.`;
  profile.portfolio.splice(idx, 1);
  profile.updatedAt = Date.now();
  dirty = true;
  return `Removed ${token.toUpperCase()} from your portfolio.`;
}

export async function getPortfolio(userId) {
  const profile = getOrCreate(userId);
  if (profile.portfolio.length === 0) {
    return 'Your portfolio is empty.\n\nUsage:\n  /portfolio add btc 0.5\n  /portfolio add eth 10 arbitrum\n  /portfolio remove btc\n  /portfolio show';
  }

  // Fetch current prices for all tokens
  const tokenIds = [...new Set(profile.portfolio.map(p => p.token))];
  let prices = {};
  try {
    const resp = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${tokenIds.join(',')}&vs_currencies=usd&include_24hr_change=true`,
      { signal: AbortSignal.timeout(10000) }
    );
    prices = await resp.json();
  } catch {}

  const lines = ['Your Portfolio\n'];
  let totalValue = 0;

  for (const holding of profile.portfolio) {
    const priceInfo = prices[holding.token];
    const price = priceInfo?.usd;
    const change24h = priceInfo?.usd_24h_change;
    const value = price ? price * holding.amount : null;
    if (value) totalValue += value;

    const priceStr = price ? `$${price.toLocaleString(undefined, { maximumFractionDigits: 6 })}` : '?';
    const valueStr = value ? `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '?';
    const changeStr = change24h != null ? ` (${change24h >= 0 ? '+' : ''}${change24h.toFixed(1)}%)` : '';

    lines.push(`  ${holding.token.toUpperCase()} — ${holding.amount} @ ${priceStr}${changeStr}`);
    lines.push(`    Value: ${valueStr} | Chain: ${holding.chain}`);
  }

  lines.push(`\n  Total Value: $${totalValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
  return lines.join('\n');
}

// ============ Preferences ============

const VALID_PREFS = {
  timezone: 'Your timezone (e.g., America/New_York, Europe/London)',
  currency: 'Preferred fiat currency (usd, eur, gbp)',
  language: 'Preferred language for responses',
  chain: 'Default blockchain (eth, bsc, polygon, arbitrum)',
  theme: 'Briefing style: detailed or compact',
  alerts: 'Price alert threshold percentage (e.g., 5)',
};

export function setPreference(userId, key, value) {
  const profile = getOrCreate(userId);
  if (!VALID_PREFS[key]) {
    return `Unknown preference "${key}".\n\nAvailable preferences:\n${Object.entries(VALID_PREFS).map(([k, v]) => `  ${k} — ${v}`).join('\n')}`;
  }
  profile.prefs[key] = value;
  profile.updatedAt = Date.now();
  dirty = true;
  return `Set ${key} = "${value}"`;
}

export function getPreferences(userId) {
  const profile = getOrCreate(userId);
  if (Object.keys(profile.prefs).length === 0 && !profile.wallet && profile.portfolio.length === 0) {
    return `No preferences set.\n\nUsage:\n  /setpref timezone America/New_York\n  /setpref currency eur\n  /setpref chain arbitrum\n  /mywallet 0x...\n  /portfolio add btc 0.5\n\nAvailable preferences:\n${Object.entries(VALID_PREFS).map(([k, v]) => `  ${k} — ${v}`).join('\n')}`;
  }

  const lines = ['Your Profile\n'];

  if (profile.wallet) {
    lines.push(`  Wallet: ${profile.wallet.slice(0, 10)}...${profile.wallet.slice(-4)}`);
  }
  if (Object.keys(profile.prefs).length > 0) {
    lines.push('  Preferences:');
    for (const [k, v] of Object.entries(profile.prefs)) {
      lines.push(`    ${k}: ${v}`);
    }
  }
  if (profile.portfolio.length > 0) {
    lines.push(`  Portfolio: ${profile.portfolio.length} tokens`);
  }
  if (profile.chains.length > 0) {
    lines.push(`  Chains: ${profile.chains.join(', ')}`);
  }

  return lines.join('\n');
}

// ============ Wallet ============

export function setWallet(userId, address) {
  if (!address?.startsWith('0x') || address.length !== 42) {
    return 'Usage: /mywallet 0x...\n\nSets your default wallet for balance checks and alerts.';
  }
  const profile = getOrCreate(userId);
  profile.wallet = address;
  profile.updatedAt = Date.now();
  dirty = true;
  return `Wallet set: ${address.slice(0, 10)}...${address.slice(-4)}`;
}

export function getWallet(userId) {
  return getOrCreate(userId).wallet;
}

// ============ Preference-Aware Context ============

export function getUserPreferenceContext(userId) {
  const profile = userPrefs.get(userId);
  if (!profile) return '';

  const parts = [];
  if (profile.prefs.timezone) parts.push(`timezone: ${profile.prefs.timezone}`);
  if (profile.prefs.currency) parts.push(`currency: ${profile.prefs.currency}`);
  if (profile.prefs.chain) parts.push(`preferred chain: ${profile.prefs.chain}`);
  if (profile.portfolio.length > 0) {
    parts.push(`portfolio: ${profile.portfolio.map(p => `${p.amount} ${p.token.toUpperCase()}`).join(', ')}`);
  }
  if (profile.wallet) parts.push(`wallet: ${profile.wallet.slice(0, 10)}...`);

  return parts.length > 0 ? `[User prefs: ${parts.join(' | ')}]` : '';
}

export function getPreferenceStats() {
  return {
    users: userPrefs.size,
    withPortfolio: [...userPrefs.values()].filter(p => p.portfolio.length > 0).length,
    withWallet: [...userPrefs.values()].filter(p => p.wallet).length,
  };
}
