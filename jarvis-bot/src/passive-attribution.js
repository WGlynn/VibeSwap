// ============ Passive Attribution — Automatic Contribution Graph Ingestion ============
//
// When Jarvis absorbs knowledge from ANY source (blog, video, paper, code session,
// social media post, conversation), the source author is automatically attributed
// in the contribution graph. When that knowledge is USED (code written, design
// informed, mechanism adopted), the attribution chain flows to retroactive rewards.
//
// NO APPLICATION PROCESS. No bottleneck. It happens passively and robustly.
//
// Flow:
//   1. Source absorbed → recordSource(author, url, contentHash, type)
//   2. Knowledge used → recordDerivation(sourceId, output, description)
//   3. Output shipped → recordOutput(derivationId, evidenceHash, value)
//   4. Rewards flow → getAttributionChain(outputId) → Shapley weights
//
// The graph is append-only. Sources link to derivations link to outputs.
// Shapley distribution follows the chain: original author gets credit
// proportional to their contribution's influence on the final output.
//
// Supported source types:
//   - BLOG: articles, essays (e.g., Licho's Ergon blogs)
//   - VIDEO: YouTube, recorded talks
//   - PAPER: academic papers, whitepapers
//   - CODE: GitHub repos, commits, PRs
//   - SOCIAL: tweets, Telegram messages, forum posts
//   - CONVERSATION: direct interactions (DMs, group chats)
//   - SESSION: Claude Code sessions (code + design work)
//
// See: ContributionDAG.sol, RewardLedger.sol for on-chain settlement.
// ============

import { writeFile, readFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { createHash } from 'crypto';
import { config } from './config.js';

// ============ Constants ============

const DATA_DIR = config.dataDir;
const ATTRIBUTION_FILE = join(DATA_DIR, 'attribution-graph.json');
const MAX_SOURCES = 10000;
const MAX_DERIVATIONS = 50000;
const MAX_OUTPUTS = 50000;
const AUTO_SAVE_INTERVAL = 60_000;

// ============ Source Types ============

export const SourceType = {
  BLOG: 'BLOG',
  VIDEO: 'VIDEO',
  PAPER: 'PAPER',
  CODE: 'CODE',
  SOCIAL: 'SOCIAL',
  CONVERSATION: 'CONVERSATION',
  SESSION: 'SESSION',
};

// ============ State ============

let graph = {
  sources: [],       // { id, author, authorId, url, contentHash, type, title, timestamp, metadata }
  derivations: [],   // { id, sourceIds[], output, description, timestamp, sessionId }
  outputs: [],       // { id, derivationIds[], evidenceHash, value, description, timestamp, deployed }
};

let dirty = false;
let saveTimer = null;

// ============ Init ============

export async function initAttribution() {
  try {
    await mkdir(DATA_DIR, { recursive: true });
  } catch {}

  try {
    const raw = await readFile(ATTRIBUTION_FILE, 'utf-8');
    const loaded = JSON.parse(raw);
    if (loaded.sources && loaded.derivations && loaded.outputs) {
      graph = loaded;
    }
  } catch {
    console.log('[attribution] No existing graph — starting fresh');
  }

  // Auto-save timer
  saveTimer = setInterval(() => {
    if (dirty) flushAttribution();
  }, AUTO_SAVE_INTERVAL);

  console.log(`[attribution] Graph loaded — ${graph.sources.length} sources, ${graph.derivations.length} derivations, ${graph.outputs.length} outputs`);
}

// ============ Content Hashing ============

function hashContent(content) {
  return createHash('sha256').update(content).digest('hex');
}

function generateId(prefix, data) {
  const hash = createHash('sha256').update(JSON.stringify(data) + Date.now()).digest('hex');
  return `${prefix}_${hash.slice(0, 16)}`;
}

// ============ Source Recording ============

/**
 * Record a knowledge source that informed our work.
 * Idempotent — if a source with the same URL or contentHash exists, returns existing.
 *
 * @param {object} params
 * @param {string} params.author - Human-readable author name (e.g., "Licho")
 * @param {string} [params.authorId] - Unique identifier (wallet, GitHub handle, Telegram ID)
 * @param {string} [params.url] - Source URL (blog, video, repo)
 * @param {string} [params.contentHash] - SHA-256 of source content (for dedup)
 * @param {string} params.type - SourceType enum value
 * @param {string} [params.title] - Title of the work
 * @param {object} [params.metadata] - Any extra context (date, platform, tags)
 * @returns {{ id: string, isNew: boolean }}
 */
export function recordSource({ author, authorId, url, contentHash, type, title, metadata }) {
  if (!author || !type) {
    console.warn('[attribution] recordSource requires author and type');
    return null;
  }

  // Dedup by URL or contentHash
  const existing = graph.sources.find(s =>
    (url && s.url === url) || (contentHash && s.contentHash === contentHash)
  );
  if (existing) {
    // Update metadata if new info available
    if (authorId && !existing.authorId) existing.authorId = authorId;
    if (title && !existing.title) existing.title = title;
    if (metadata) existing.metadata = { ...existing.metadata, ...metadata };
    dirty = true;
    return { id: existing.id, isNew: false };
  }

  const source = {
    id: generateId('src', { author, url, type }),
    author,
    authorId: authorId || null,
    url: url || null,
    contentHash: contentHash || (url ? hashContent(url) : null),
    type,
    title: title || null,
    timestamp: Date.now(),
    metadata: metadata || {},
  };

  graph.sources.push(source);

  // Prune oldest if over limit
  if (graph.sources.length > MAX_SOURCES) {
    graph.sources = graph.sources.slice(-MAX_SOURCES);
  }

  dirty = true;
  console.log(`[attribution] Source recorded: "${title || url || author}" by ${author} (${type})`);
  return { id: source.id, isNew: true };
}

// ============ Derivation Recording ============

/**
 * Record that knowledge from one or more sources was USED to produce something.
 * A derivation links sources to an output description.
 *
 * @param {object} params
 * @param {string[]} params.sourceIds - IDs of sources that informed this work
 * @param {string} params.output - What was produced (e.g., "mining.js proportional reward formula")
 * @param {string} [params.description] - How the sources were used
 * @param {string} [params.sessionId] - Claude Code session ID for traceability
 * @returns {{ id: string }}
 */
export function recordDerivation({ sourceIds, output, description, sessionId }) {
  if (!sourceIds?.length || !output) {
    console.warn('[attribution] recordDerivation requires sourceIds and output');
    return null;
  }

  // Validate source IDs exist
  const validIds = sourceIds.filter(id => graph.sources.some(s => s.id === id));
  if (validIds.length === 0) {
    console.warn('[attribution] No valid source IDs found');
    return null;
  }

  const derivation = {
    id: generateId('drv', { sourceIds: validIds, output }),
    sourceIds: validIds,
    output,
    description: description || null,
    timestamp: Date.now(),
    sessionId: sessionId || null,
  };

  graph.derivations.push(derivation);

  if (graph.derivations.length > MAX_DERIVATIONS) {
    graph.derivations = graph.derivations.slice(-MAX_DERIVATIONS);
  }

  dirty = true;

  // Log the attribution chain
  const authors = validIds
    .map(id => graph.sources.find(s => s.id === id)?.author)
    .filter(Boolean);
  console.log(`[attribution] Derivation: "${output}" ← [${authors.join(', ')}]`);

  return { id: derivation.id };
}

// ============ Output Recording ============

/**
 * Record a shipped output (deployed code, published doc, etc.) that was
 * informed by one or more derivations. This is the terminal node —
 * the thing that generates value for retroactive rewards.
 *
 * @param {object} params
 * @param {string[]} params.derivationIds - IDs of derivations that produced this
 * @param {string} params.evidenceHash - Hash of the output artifact (commit hash, deploy hash)
 * @param {number} [params.value] - Estimated value weight (for Shapley distribution)
 * @param {string} [params.description] - What was shipped
 * @param {boolean} [params.deployed] - Whether this is live in production
 * @returns {{ id: string }}
 */
export function recordOutput({ derivationIds, evidenceHash, value, description, deployed }) {
  if (!derivationIds?.length || !evidenceHash) {
    console.warn('[attribution] recordOutput requires derivationIds and evidenceHash');
    return null;
  }

  const validIds = derivationIds.filter(id => graph.derivations.some(d => d.id === id));

  const output = {
    id: generateId('out', { derivationIds: validIds, evidenceHash }),
    derivationIds: validIds,
    evidenceHash,
    value: value || 1,
    description: description || null,
    timestamp: Date.now(),
    deployed: deployed || false,
  };

  graph.outputs.push(output);

  if (graph.outputs.length > MAX_OUTPUTS) {
    graph.outputs = graph.outputs.slice(-MAX_OUTPUTS);
  }

  dirty = true;
  console.log(`[attribution] Output shipped: "${description || evidenceHash.slice(0, 16)}" (value: ${output.value})`);
  return { id: output.id };
}

// ============ Attribution Chain Resolution ============

/**
 * Walk the full attribution chain from an output back to original sources.
 * Returns the Shapley-weighted contribution of each author.
 *
 * Distribution logic:
 *   - Each output distributes value to its derivations equally
 *   - Each derivation distributes to its sources equally
 *   - Authors accumulate across all paths
 *   - Final weights normalized to sum to 1.0
 */
export function getAttributionChain(outputId) {
  const output = graph.outputs.find(o => o.id === outputId);
  if (!output) return null;

  const authorWeights = {};

  for (const drvId of output.derivationIds) {
    const derivation = graph.derivations.find(d => d.id === drvId);
    if (!derivation) continue;

    const drvWeight = 1.0 / output.derivationIds.length;

    for (const srcId of derivation.sourceIds) {
      const source = graph.sources.find(s => s.id === srcId);
      if (!source) continue;

      const srcWeight = drvWeight / derivation.sourceIds.length;
      const authorKey = source.authorId || source.author;

      if (!authorWeights[authorKey]) {
        authorWeights[authorKey] = {
          author: source.author,
          authorId: source.authorId,
          weight: 0,
          sources: [],
        };
      }
      authorWeights[authorKey].weight += srcWeight;
      if (!authorWeights[authorKey].sources.includes(source.id)) {
        authorWeights[authorKey].sources.push(source.id);
      }
    }
  }

  // Normalize weights to sum to 1.0
  const totalWeight = Object.values(authorWeights).reduce((s, a) => s + a.weight, 0);
  if (totalWeight > 0) {
    for (const entry of Object.values(authorWeights)) {
      entry.weight = Math.round((entry.weight / totalWeight) * 10000) / 10000;
    }
  }

  return {
    outputId: output.id,
    description: output.description,
    value: output.value,
    deployed: output.deployed,
    authors: Object.values(authorWeights).sort((a, b) => b.weight - a.weight),
  };
}

// ============ Bulk Attribution Chain (all outputs for an author) ============

/**
 * Get all outputs that trace back to a specific author.
 * Returns total accumulated value weight across all outputs.
 */
export function getAuthorAttribution(authorNameOrId) {
  const lower = authorNameOrId.toLowerCase();
  const relevantSources = graph.sources.filter(s =>
    s.author.toLowerCase() === lower ||
    (s.authorId && s.authorId.toLowerCase() === lower)
  );

  if (relevantSources.length === 0) return null;

  const sourceIds = new Set(relevantSources.map(s => s.id));

  // Find derivations that use any of these sources
  const relevantDerivations = graph.derivations.filter(d =>
    d.sourceIds.some(id => sourceIds.has(id))
  );
  const derivationIds = new Set(relevantDerivations.map(d => d.id));

  // Find outputs that use any of these derivations
  const relevantOutputs = graph.outputs.filter(o =>
    o.derivationIds.some(id => derivationIds.has(id))
  );

  // Compute total weighted value
  let totalValue = 0;
  const outputDetails = [];

  for (const output of relevantOutputs) {
    const chain = getAttributionChain(output.id);
    if (!chain) continue;

    const authorEntry = chain.authors.find(a =>
      a.author.toLowerCase() === lower ||
      (a.authorId && a.authorId.toLowerCase() === lower)
    );

    if (authorEntry) {
      const weightedValue = output.value * authorEntry.weight;
      totalValue += weightedValue;
      outputDetails.push({
        outputId: output.id,
        description: output.description,
        weight: authorEntry.weight,
        weightedValue,
        deployed: output.deployed,
        timestamp: output.timestamp,
      });
    }
  }

  return {
    author: relevantSources[0].author,
    authorId: relevantSources[0].authorId,
    totalSources: relevantSources.length,
    totalDerivations: relevantDerivations.length,
    totalOutputs: relevantOutputs.length,
    totalWeightedValue: Math.round(totalValue * 1000) / 1000,
    sources: relevantSources.map(s => ({
      id: s.id,
      title: s.title,
      type: s.type,
      url: s.url,
      timestamp: s.timestamp,
    })),
    outputs: outputDetails.sort((a, b) => b.weightedValue - a.weightedValue),
  };
}

// ============ Convenience: Record from URL + Author in One Call ============

/**
 * One-shot attribution: record a source and immediately link it as informing
 * a specific piece of work. Used when Jarvis processes a link or article.
 *
 * @param {object} params
 * @param {string} params.author - Who created the source
 * @param {string} [params.authorId] - Unique ID for the author
 * @param {string} [params.url] - Source URL
 * @param {string} params.type - SourceType
 * @param {string} [params.title] - Title of source
 * @param {string} params.informedWork - What this source informed
 * @param {string} [params.sessionId] - Current session
 * @returns {{ sourceId: string, derivationId: string }}
 */
export function attributeSource({ author, authorId, url, type, title, informedWork, sessionId, metadata }) {
  const source = recordSource({ author, authorId, url, type, title, metadata });
  if (!source) return null;

  const derivation = recordDerivation({
    sourceIds: [source.id],
    output: informedWork,
    description: `Knowledge from ${author}'s "${title || url}" informed: ${informedWork}`,
    sessionId,
  });

  return {
    sourceId: source.id,
    derivationId: derivation?.id || null,
    isNewSource: source.isNew,
  };
}

// ============ Auto-Attribution from YouTube/Web Context ============

/**
 * Called automatically when Jarvis processes YouTube videos or web articles.
 * Extracts author from metadata and records attribution.
 *
 * @param {object} context - The context object from youtube.js or web-reader.js
 * @param {string} context.title - Page/video title
 * @param {string} [context.author] - Author if detected
 * @param {string} context.url - Source URL
 * @param {string} context.type - 'youtube' or 'web'
 */
export function autoAttributeContent(context) {
  if (!context?.url) return null;

  const type = context.type === 'youtube' ? SourceType.VIDEO : SourceType.BLOG;
  const author = context.author || extractAuthorFromUrl(context.url) || 'Unknown';

  return recordSource({
    author,
    url: context.url,
    type,
    title: context.title || null,
    metadata: {
      autoDetected: true,
      platform: context.type,
      processedAt: new Date().toISOString(),
    },
  });
}

/**
 * Best-effort author extraction from URL patterns.
 */
function extractAuthorFromUrl(url) {
  try {
    const u = new URL(url);
    // GitHub: github.com/username/repo
    if (u.hostname === 'github.com') {
      const parts = u.pathname.split('/').filter(Boolean);
      return parts[0] || null;
    }
    // Medium: medium.com/@username or username.medium.com
    if (u.hostname.includes('medium.com')) {
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts[0]?.startsWith('@')) return parts[0].slice(1);
      if (u.hostname !== 'medium.com') return u.hostname.split('.')[0];
    }
    // Twitter/X: twitter.com/username or x.com/username
    if (u.hostname === 'twitter.com' || u.hostname === 'x.com') {
      return u.pathname.split('/').filter(Boolean)[0] || null;
    }
    return null;
  } catch {
    return null;
  }
}

// ============ Graph Stats ============

export function getGraphStats() {
  const authorCounts = {};
  for (const s of graph.sources) {
    const key = s.authorId || s.author;
    authorCounts[key] = (authorCounts[key] || 0) + 1;
  }

  const topAuthors = Object.entries(authorCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([author, count]) => ({ author, sources: count }));

  return {
    totalSources: graph.sources.length,
    totalDerivations: graph.derivations.length,
    totalOutputs: graph.outputs.length,
    uniqueAuthors: Object.keys(authorCounts).length,
    topAuthors,
    sourcesByType: graph.sources.reduce((acc, s) => {
      acc[s.type] = (acc[s.type] || 0) + 1;
      return acc;
    }, {}),
  };
}

// ============ Persistence ============

export async function flushAttribution() {
  if (!dirty) return;
  try {
    await writeFile(ATTRIBUTION_FILE, JSON.stringify(graph, null, 2));
    dirty = false;
  } catch (err) {
    console.error(`[attribution] Failed to save: ${err.message}`);
  }
}

// ============ Cleanup ============

export function shutdownAttribution() {
  if (saveTimer) {
    clearInterval(saveTimer);
    saveTimer = null;
  }
  flushAttribution();
}
