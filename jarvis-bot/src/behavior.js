import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { config } from './config.js';

const BEHAVIOR_PATH = join(config.dataDir, 'behavior.json');

let behaviorCache = null;

const DEFAULTS = {
  welcomeNewMembers: false,
  welcomeMessage: 'Welcome {name}. This is the VibeSwap community.',
  proactiveEngagement: true,
  dailyDigest: true,
  autoModeration: true,
  arkDmOnJoin: true,
  trackContributions: true,
  respondInGroups: true,
  respondInDms: true,
};

export async function loadBehavior() {
  try {
    const raw = await readFile(BEHAVIOR_PATH, 'utf-8');
    behaviorCache = { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    behaviorCache = { ...DEFAULTS };
  }
  return behaviorCache;
}

export function getBehavior() {
  return behaviorCache || { ...DEFAULTS };
}

export function getFlag(key) {
  const b = getBehavior();
  return b[key] ?? DEFAULTS[key];
}

export async function setFlag(key, value) {
  if (!(key in DEFAULTS) && key !== '_meta' && key !== 'welcomeMessage') {
    return false;
  }
  const b = getBehavior();
  b[key] = value;
  behaviorCache = b;
  await writeFile(BEHAVIOR_PATH, JSON.stringify(b, null, 2), 'utf-8');
  return true;
}

export async function setBehavior(updates) {
  const b = getBehavior();
  for (const [key, value] of Object.entries(updates)) {
    b[key] = value;
  }
  behaviorCache = b;
  await writeFile(BEHAVIOR_PATH, JSON.stringify(b, null, 2), 'utf-8');
  return b;
}

export function listFlags() {
  const b = getBehavior();
  return Object.entries(b)
    .filter(([k]) => k !== '_meta' && k !== 'welcomeMessage')
    .map(([k, v]) => `${v ? '✓' : '✗'} ${k}`)
    .join('\n');
}
