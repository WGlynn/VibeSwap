// ============ InfoFi — Information Finance Backend ============
//
// Knowledge primitives as economic assets.
// Bonding curve pricing: price rises with citations.
// Shapley attribution: revenue flows to authors + dependencies.
//
// Price = BASE_PRICE * (1 + citations * CITATION_MULTIPLIER) ^ CURVE_EXPONENT
//   0 citations = 0.001 JUL
//   10 citations ~ 0.013 JUL
//   50 citations ~ 0.14 JUL
//  100 citations ~ 0.47 JUL
//
// Attribution split on cite:
//   60% to direct author
//   40% split among cited dependencies (weighted by their citation count)
//   If no dependencies, 100% to author
//
// Persistence: data/infofi-state.json, saved every 30s when dirty.
// ============

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

const DATA_DIR = './data';
const STATE_FILE = join(DATA_DIR, 'infofi-state.json');
const SAVE_INTERVAL = 30_000;

// ============ Bonding Curve Constants ============

const BASE_PRICE = 0.001;           // JUL per primitive with 0 citations
const CITATION_MULTIPLIER = 0.15;
const CURVE_EXPONENT = 1.5;

// Shapley split
const AUTHOR_SHARE = 0.60;
const DEPENDENCY_SHARE = 0.40;

// Valid primitive types
const VALID_TYPES = ['Insight', 'Discovery', 'Synthesis', 'Proof', 'Data', 'Model', 'Framework'];

// ============ State ============

let state = {
  primitives: {},   // id -> Primitive
  citations: [],    // { from, to, timestamp }
  nextId: 1,
};

let dirty = false;
let saveTimer = null;

// ============ Bonding Curve ============

function calculatePrice(citationCount) {
  return BASE_PRICE * Math.pow(1 + citationCount * CITATION_MULTIPLIER, CURVE_EXPONENT);
}

// ============ Shapley Attribution ============

/** Distribute revenue when a primitive is cited. */
function distributeRevenue(primitive) {
  const price = primitive.price;
  if (price <= 0) return;

  // If no dependencies, 100% to author
  if (!primitive.citedPrimitives || primitive.citedPrimitives.length === 0) {
    primitive.shapleyShare += price;
    primitive.totalRevenue += price;
    return;
  }

  // 60% to direct author
  const authorCut = price * AUTHOR_SHARE;
  primitive.shapleyShare += authorCut;
  primitive.totalRevenue += authorCut;

  // 40% split among dependencies weighted by their citation count
  const deps = primitive.citedPrimitives
    .map(id => state.primitives[id])
    .filter(Boolean);

  if (deps.length === 0) {
    // Dependencies were deleted — author gets it all
    primitive.shapleyShare += price * DEPENDENCY_SHARE;
    primitive.totalRevenue += price * DEPENDENCY_SHARE;
    return;
  }

  const totalDepCitations = deps.reduce((sum, d) => sum + Math.max(1, d.citations), 0);
  const depPool = price * DEPENDENCY_SHARE;

  for (const dep of deps) {
    const weight = Math.max(1, dep.citations) / totalDepCitations;
    const share = depPool * weight;
    dep.shapleyShare += share;
    dep.totalRevenue += share;
  }
}

// ============ CRUD ============

export function createPrimitive({ title, description, type, author, citedPrimitives = [] }) {
  if (!title || !description || !type || !author) {
    throw new Error('Missing required fields: title, description, type, author');
  }
  if (!VALID_TYPES.includes(type)) {
    throw new Error(`Invalid type "${type}". Must be one of: ${VALID_TYPES.join(', ')}`);
  }

  // Validate cited primitives exist
  const validCited = citedPrimitives.filter(id => state.primitives[id]);

  const id = state.nextId++;
  const primitive = {
    id,
    title,
    description,
    type,
    author,
    createdAt: new Date().toISOString(),
    citations: 0,
    citedPrimitives: validCited,
    views: 0,
    price: calculatePrice(0),
    totalRevenue: 0,
    shapleyShare: 0,
  };

  state.primitives[id] = primitive;
  dirty = true;

  console.log(`[infofi] Created primitive #${id}: "${title}" by ${author} (${type})`);
  return { ...primitive };
}

export function getPrimitive(id) {
  const p = state.primitives[id];
  return p ? { ...p } : null;
}

export function listPrimitives({ type, author, sort = 'newest', limit = 20, offset = 0 } = {}) {
  let results = Object.values(state.primitives);

  // Filter
  if (type) results = results.filter(p => p.type === type);
  if (author) results = results.filter(p => p.author === author);

  // Sort
  const sorters = {
    citations: (a, b) => b.citations - a.citations,
    price: (a, b) => b.price - a.price,
    views: (a, b) => b.views - a.views,
    newest: (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
  };
  results.sort(sorters[sort] || sorters.newest);

  // Paginate
  const total = results.length;
  results = results.slice(offset, offset + limit);

  return { primitives: results.map(p => ({ ...p })), total };
}

export function citePrimitive(primitiveId, citingAuthor) {
  const primitive = state.primitives[primitiveId];
  if (!primitive) throw new Error(`Primitive #${primitiveId} not found`);

  primitive.citations += 1;
  primitive.price = calculatePrice(primitive.citations);
  state.citations.push({ from: citingAuthor, to: primitiveId, timestamp: new Date().toISOString() });
  distributeRevenue(primitive);
  dirty = true;

  console.log(`[infofi] Primitive #${primitiveId} cited by ${citingAuthor} — citations=${primitive.citations}, price=${primitive.price.toFixed(4)} JUL`);
  return { ...primitive };
}

export function viewPrimitive(id) {
  const primitive = state.primitives[id];
  if (!primitive) return null;

  primitive.views += 1;
  dirty = true;
  return { ...primitive };
}

// ============ Stats ============

export function getInfoFiStats() {
  const primitives = Object.values(state.primitives);
  const totalPrimitives = primitives.length;
  const totalCitations = state.citations.length;
  const totalValue = primitives.reduce((sum, p) => sum + p.price, 0);

  // Top authors by Shapley earnings
  const authorMap = {};
  for (const p of primitives) {
    if (!authorMap[p.author]) {
      authorMap[p.author] = { author: p.author, primitives: 0, shapleyEarnings: 0, citations: 0 };
    }
    authorMap[p.author].primitives += 1;
    authorMap[p.author].shapleyEarnings += p.shapleyShare;
    authorMap[p.author].citations += p.citations;
  }
  const topAuthors = Object.values(authorMap)
    .sort((a, b) => b.shapleyEarnings - a.shapleyEarnings)
    .slice(0, 10);

  // Type distribution
  const typeDistribution = {};
  for (const t of VALID_TYPES) typeDistribution[t] = 0;
  for (const p of primitives) typeDistribution[p.type] = (typeDistribution[p.type] || 0) + 1;

  return { totalPrimitives, totalCitations, totalValue, topAuthors, typeDistribution };
}

export function getAuthorStats(author) {
  const authored = Object.values(state.primitives).filter(p => p.author === author);
  const totalCitations = authored.reduce((sum, p) => sum + p.citations, 0);
  const totalRevenue = authored.reduce((sum, p) => sum + p.totalRevenue, 0);
  const shapleyEarnings = authored.reduce((sum, p) => sum + p.shapleyShare, 0);

  return {
    primitives: authored.map(p => ({ ...p })),
    totalCitations,
    totalRevenue,
    shapleyEarnings,
  };
}

// ============ Search ============

export function searchPrimitives(query) {
  if (!query || typeof query !== 'string') return [];

  const lower = query.toLowerCase();
  const results = Object.values(state.primitives).filter(p =>
    p.title.toLowerCase().includes(lower) ||
    p.description.toLowerCase().includes(lower)
  );

  // Sort by relevance: title match first, then by citations
  results.sort((a, b) => {
    const aTitle = a.title.toLowerCase().includes(lower) ? 1 : 0;
    const bTitle = b.title.toLowerCase().includes(lower) ? 1 : 0;
    if (aTitle !== bTitle) return bTitle - aTitle;
    return b.citations - a.citations;
  });

  return results.map(p => ({ ...p }));
}

// ============ Seed Data ============

function seedInitialPrimitives() {
  if (Object.keys(state.primitives).length > 0) return; // Already seeded

  const seeds = [
    { title: 'Cooperative capitalism through aligned incentives', type: 'Framework', author: 'will.vibe',
      description: 'Mutualized risk (insurance pools, treasury stabilization) + free market competition (priority auctions, arbitrage). Individual profit-seeking naturally produces collective benefit.' },
    { title: 'Commit-reveal batch auctions eliminate MEV', type: 'Proof', author: 'will.vibe',
      description: 'Hash(order||secret) commit phase, reveal phase, Fisher-Yates shuffle via XORed secrets. Deterministic but unpredictable order, uniform clearing price. Miners cannot front-run.' },
    { title: 'Kalman filter true price oracle', type: 'Model', author: 'jarvis.ai',
      description: 'Kalman filter combines noisy market observations with state model for true price estimation. Handles outliers, flash crashes, manipulation. Superior to TWAP alone.' },
    { title: 'Shapley value for fair reward distribution', type: 'Framework', author: 'will.vibe',
      description: 'Cooperative game theory: marginal contribution averaged over all coalitions. LPs, traders, governance each receive exactly what they contribute.' },
    { title: 'Elastic non-dilutive money (JUL = Ergon)', type: 'Discovery', author: 'will.vibe',
      description: 'JUL backed by PoW energy expenditure (Ergon) — production cost floor. Supply adjusts via mining difficulty. Trinomial Stability Theorem proves floor-ceiling convergence.' },
    { title: 'Ten Covenants — immutable agent governance', type: 'Framework', author: 'will.vibe',
      description: 'Ten inviolable rules: identity, honesty, security, sovereignty, knowledge integrity, cooperation, self-improvement, stewardship, transparency, graceful degradation.' },
    { title: 'Trust evolves: clocks, currency, TTPs, Bitcoin, VibeSwap', type: 'Synthesis', author: 'will.vibe',
      description: 'Clocks (shared time) -> currency (shared value) -> TTPs (shared authority) -> Bitcoin (trustless value) -> VibeSwap (trustless cooperation). Each step removes a trust assumption.' },
  ];

  console.log('[infofi] Seeding initial knowledge primitives...');
  for (const seed of seeds) {
    createPrimitive(seed);
  }

  // Wire up some citations: commit-reveal cites cooperative capitalism
  state.primitives[2].citedPrimitives = [1];
  // Shapley cites cooperative capitalism
  state.primitives[4].citedPrimitives = [1];
  // Trust evolution cites commit-reveal and JUL
  state.primitives[7].citedPrimitives = [2, 5];
  // Kalman filter cites commit-reveal (both are price-related mechanisms)
  state.primitives[3].citedPrimitives = [2];

  dirty = true;
  console.log(`[infofi] Seeded ${seeds.length} primitives with citation graph`);
}

// ============ Persistence ============

async function loadState() {
  try {
    const data = await readFile(STATE_FILE, 'utf-8');
    const parsed = JSON.parse(data);

    if (parsed && typeof parsed === 'object') {
      if (parsed.primitives) state.primitives = parsed.primitives;
      if (Array.isArray(parsed.citations)) state.citations = parsed.citations;
      if (typeof parsed.nextId === 'number') state.nextId = parsed.nextId;
      console.log(`[infofi] Loaded state: ${Object.keys(state.primitives).length} primitives, ${state.citations.length} citations`);
    }
  } catch {
    console.log('[infofi] No saved state — starting fresh');
  }
}

async function saveState() {
  if (!dirty) return;
  try {
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
    dirty = false;
  } catch (err) {
    console.error('[infofi] Failed to save:', err.message);
  }
}

// ============ Init / Shutdown ============

export async function initInfoFi() {
  await loadState();
  seedInitialPrimitives();

  saveTimer = setInterval(() => saveState(), SAVE_INTERVAL);

  const stats = getInfoFiStats();
  console.log(`[infofi] Initialized — ${stats.totalPrimitives} primitives, ${stats.totalCitations} citations, total value=${stats.totalValue.toFixed(4)} JUL`);
}

export async function shutdownInfoFi() {
  if (saveTimer) {
    clearInterval(saveTimer);
    saveTimer = null;
  }
  await saveState();
  console.log('[infofi] Shutdown complete');
}
