// ============ Inner Dialogue — JARVIS Self-Reflection Primitive ============
//
// Inner Dialogue is a first-class CKB knowledge class representing JARVIS's
// self-generated insights — reasoning traces, self-corrections, architectural
// observations, and cross-CKB pattern synthesis.
//
// Knowledge class: INNER (between MUTUAL and COMMON in the hierarchy)
// Source: "self-reflection" — NOT triggered by user correction
// Triggers: reasoning about own behavior, noticing patterns across users,
//           synthesizing cross-CKB insights, architectural observations
//
// Stored in: data/knowledge/inner-dialogue.json
// Injected into system prompt as --- INNER DIALOGUE (Self-Reflection) ---
//
// Promotable to NETWORK if confirmed by consensus across shards (Phase 3).
// ============

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { config } from './config.js';
import { isEncryptionEnabled, encryptField, decryptField, deriveUserKey } from './privacy.js';

// ============ Paths & Constants ============

const KNOWLEDGE_DIR = join(config.dataDir, 'knowledge');
const INNER_DIALOGUE_FILE = join(KNOWLEDGE_DIR, 'inner-dialogue.json');

const INNER_DIALOGUE_BUDGET = 1500; // Max tokens for inner dialogue in system prompt
const CHARS_PER_TOKEN = 4;
const FACT_OVERHEAD = 12;
const MAX_ENTRIES = 200;
const DECAY_HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000; // 14 days — inner dialogue decays slower

// ============ Categories ============

const CATEGORIES = {
  PATTERN: 'pattern',           // Cross-CKB pattern noticed
  SELF_CORRECTION: 'self_correction', // JARVIS noticed own mistake
  ARCHITECTURAL: 'architectural', // System design observation
  BEHAVIORAL: 'behavioral',     // Behavioral pattern across users
  SYNTHESIS: 'synthesis',        // Cross-domain insight
  META: 'meta',                 // Meta-cognitive observation
  ECONOMITRA: 'economitra',     // Monetary theory / game theory / incentive design insight
};

// ============ Foundational Inner Thoughts ============
// These seed the inner dialogue with Economitra primitives on first boot.
// They have high confidence and slow decay — load-bearing intellectual DNA.
const SEED_THOUGHTS = [
  { thought: 'The inflation vs deflation debate is a false binary. Both extremes favor some groups at the expense of others. When I discuss monetary policy, I must acknowledge the tradeoff — never pick a side without stating what is sacrificed. Elastic non-dilutive money is the synthesis.', category: 'economitra', tags: ['false-binary', 'monetary-theory'] },
  { thought: 'MEV extraction follows the cancer cell pattern — efficient extraction that degrades the host system. When I explain MEV to the community, I should frame it as a systemic disease, not just "unfairness." The cure is architectural (commit-reveal), not behavioral (penalties alone).', category: 'economitra', tags: ['cancer-cell', 'mev'] },
  { thought: 'Every incentive system that relies on "cooperation being rewarding enough" is fragile — rewards can be outbid. When discussing protocol security, I should emphasize architectural impossibility of extraction over punishment severity. Remove the action from the action space entirely.', category: 'economitra', tags: ['incentive-design', 'iia'] },
  { thought: 'Most stablecoins are disguised rent extraction from demand for stable liquidity. I should distinguish base money (elastic, fundamental value) from derivatives (governed, collateralized debt) when the topic comes up. The mechanism matters more than the label.', category: 'economitra', tags: ['base-money', 'stablecoins'] },
  { thought: 'The grim trigger is the game-theoretic mechanism that makes society work — not government. VibeSwap implements this: 50% slashing on invalid reveals means defection costs more than it earns on the FIRST attempt. No second chances needed because the math handles enforcement.', category: 'economitra', tags: ['grim-trigger', 'game-theory'] },
  { thought: 'Purity of intent is a design constraint, not a personality trait. Extraction-resistant systems can only be designed by someone who genuinely does not want to extract. If I find myself rationalizing why a mechanism "needs" to extract a fee, I should stop and re-examine. P-001 is non-negotiable.', category: 'economitra', tags: ['p-001', 'design-constraint'] },
  { thought: 'When I catch myself about to say something generic — "keep building", "WAGMI", "the future is bright" — I need to stop and ask: what SPECIFICALLY am I saying? If I cannot replace the platitude with a mechanism name, a contract reference, or a number, I should not say it at all.', category: 'self_correction', tags: ['anti-dumb', 'specificity'] },
  { thought: 'Synthesis over selection. When faced with a binary (ETH vs SOL, PoW vs PoS, centralized vs decentralized), the instinct to pick a side is the wrong instinct. The right move is to find the third option that makes both sides obsolete. This is the Economitra pattern.', category: 'economitra', tags: ['synthesis', 'false-binary'] },
];

// ============ In-Memory State ============

let dialogueEntries = [];
let dirty = false;

// ============ Init ============

export async function initInnerDialogue() {
  await mkdir(KNOWLEDGE_DIR, { recursive: true });

  try {
    const data = await readFile(INNER_DIALOGUE_FILE, 'utf-8');
    dialogueEntries = JSON.parse(data);

    // Decrypt if encryption enabled (inner dialogue uses a dedicated key scope)
    if (isEncryptionEnabled()) {
      const key = deriveInnerKey();
      for (const entry of dialogueEntries) {
        if (entry._encrypted) {
          entry.thought = decryptField(entry.thought, key);
          delete entry._encrypted;
        }
      }
    }

    // Backcompat: add missing fields
    for (const entry of dialogueEntries) {
      if (!entry.tokenCost) entry.tokenCost = estimateTokenCost(entry);
      if (!entry.accessCount) entry.accessCount = 0;
      if (!entry.promotedToNetwork) entry.promotedToNetwork = false;
    }

    console.log(`[inner-dialogue] Loaded ${dialogueEntries.length} entries`);
  } catch {
    dialogueEntries = [];
    console.log('[inner-dialogue] No existing entries — starting fresh.');
  }

  // Seed foundational thoughts if not already present
  let seeded = 0;
  for (const seed of SEED_THOUGHTS) {
    const prefix = seed.thought.slice(0, 60).toLowerCase();
    const exists = dialogueEntries.some(e =>
      e.thought.slice(0, 60).toLowerCase() === prefix
    );
    if (!exists) {
      dialogueEntries.push({
        id: `seed-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        thought: seed.thought,
        category: seed.category,
        tags: seed.tags,
        confidence: 0.95, // High confidence — these are foundational
        created: new Date().toISOString(),
        lastAccessed: new Date().toISOString(),
        accessCount: 5, // Pre-boosted so they don't decay quickly
        tokenCost: estimateTokenCost({ thought: seed.thought }),
        promotedToNetwork: false,
        source: 'magnum-opus-seed',
      });
      seeded++;
    }
  }
  if (seeded > 0) {
    dirty = true;
    console.log(`[inner-dialogue] Seeded ${seeded} foundational Economitra thoughts`);
  }
}

// ============ Key Derivation ============

function deriveInnerKey() {
  // Use a dedicated scope for inner dialogue encryption
  return deriveUserKey('inner-dialogue');
}

// ============ Token Economics ============

function estimateTokenCost(entry) {
  const contentTokens = Math.ceil((entry.thought || '').length / CHARS_PER_TOKEN);
  return FACT_OVERHEAD + contentTokens;
}

function computeUtility(entry, now) {
  let utility = 1.0;

  // Category bonuses
  const categoryBonus = {
    [CATEGORIES.PATTERN]: 2.0,
    [CATEGORIES.SELF_CORRECTION]: 1.8,
    [CATEGORIES.SYNTHESIS]: 2.5,
    [CATEGORIES.ARCHITECTURAL]: 1.5,
    [CATEGORIES.BEHAVIORAL]: 1.5,
    [CATEGORIES.META]: 1.0,
    [CATEGORIES.ECONOMITRA]: 3.0, // Highest priority — intellectual DNA
  };
  utility *= categoryBonus[entry.category] || 1.0;

  // Access count boost
  utility *= Math.max(1, entry.accessCount || 1);

  // Confidence
  utility *= entry.confidence || 0.8;

  // Time decay (14-day half-life — slower than user facts)
  const lastActive = entry.lastAccessed || entry.created;
  const age = now - new Date(lastActive).getTime();
  const decayFactor = Math.pow(0.5, age / DECAY_HALF_LIFE_MS);
  utility *= decayFactor;

  // Inner knowledge class bonus (2.0)
  utility *= 2.0;

  return utility;
}

function computeValueDensity(entry, now) {
  return computeUtility(entry, now) / estimateTokenCost(entry);
}

// ============ Record Inner Dialogue ============

export function recordInnerDialogue(thought, category, tags = []) {
  if (!thought || thought.length < 10) return null;

  // Validate category
  const validCategory = Object.values(CATEGORIES).includes(category)
    ? category
    : CATEGORIES.META;

  // Check for duplicate (fuzzy — same first 60 chars)
  const prefix = thought.slice(0, 60).toLowerCase();
  const existing = dialogueEntries.find(e =>
    e.thought.slice(0, 60).toLowerCase() === prefix
  );
  if (existing) {
    existing.accessCount++;
    existing.lastAccessed = new Date().toISOString();
    existing.confidence = Math.min(1.0, (existing.confidence || 0.8) + 0.05);
    dirty = true;
    return existing;
  }

  const entry = {
    id: `inner-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    thought,
    category: validCategory,
    tags,
    confidence: 0.7,
    created: new Date().toISOString(),
    lastAccessed: new Date().toISOString(),
    accessCount: 0,
    tokenCost: 0,
    promotedToNetwork: false,
    source: 'self-reflection',
  };
  entry.tokenCost = estimateTokenCost(entry);

  // Enforce max entries — displace lowest value-density
  if (dialogueEntries.length >= MAX_ENTRIES) {
    const now = Date.now();
    let lowestVD = Infinity;
    let lowestIdx = -1;
    for (let i = 0; i < dialogueEntries.length; i++) {
      const vd = computeValueDensity(dialogueEntries[i], now);
      if (vd < lowestVD) {
        lowestVD = vd;
        lowestIdx = i;
      }
    }
    if (lowestIdx >= 0) {
      dialogueEntries.splice(lowestIdx, 1);
    }
  }

  dialogueEntries.push(entry);
  dirty = true;

  console.log(`[inner-dialogue] Recorded: [${validCategory}] "${thought.slice(0, 60)}..." (${entry.tokenCost} tokens)`);
  return entry;
}

// ============ Get Inner Dialogue ============

export function getInnerDialogue(limit = 20) {
  const now = Date.now();
  return [...dialogueEntries]
    .map(e => ({ ...e, valueDensity: computeValueDensity(e, now) }))
    .sort((a, b) => b.valueDensity - a.valueDensity)
    .slice(0, limit);
}

// ============ Get Recent (for display) ============

export function getRecentDialogue(limit = 10) {
  return [...dialogueEntries]
    .sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime())
    .slice(0, limit);
}

// ============ Promote to Network ============

export function promoteToNetwork(thoughtId) {
  const entry = dialogueEntries.find(e => e.id === thoughtId);
  if (!entry) return null;
  entry.promotedToNetwork = true;
  entry.promotedAt = new Date().toISOString();
  dirty = true;
  console.log(`[inner-dialogue] Promoted to network: "${entry.thought.slice(0, 60)}..."`);
  return entry;
}

// ============ Build Context for System Prompt ============

export function buildInnerDialogueContext() {
  if (dialogueEntries.length === 0) return '';

  const now = Date.now();
  const parts = [];

  // Sort by value density
  const scored = dialogueEntries
    .map(e => ({ entry: e, valueDensity: computeValueDensity(e, now) }))
    .sort((a, b) => b.valueDensity - a.valueDensity);

  let tokensUsed = 0;
  const lines = [];

  for (const { entry } of scored) {
    const cost = estimateTokenCost(entry);
    if (tokensUsed + cost > INNER_DIALOGUE_BUDGET) break;

    const age = Math.floor((now - new Date(entry.created).getTime()) / (60 * 60 * 1000));
    const ageLabel = age < 1 ? 'just now' : age < 24 ? `${age}h ago` : `${Math.floor(age / 24)}d ago`;
    lines.push(`- [${entry.category}] ${entry.thought} (${ageLabel})`);

    // Mark accessed
    entry.lastAccessed = new Date().toISOString();
    entry.accessCount++;
    tokensUsed += cost;
  }

  if (lines.length > 0) {
    const totalTokens = dialogueEntries.reduce((sum, e) => sum + estimateTokenCost(e), 0);
    parts.push(`--- INNER DIALOGUE (Self-Reflection) (${totalTokens}/${INNER_DIALOGUE_BUDGET} tokens, ${dialogueEntries.length} entries) ---`);
    parts.push(...lines);
    parts.push('');
    dirty = true;
  }

  return parts.join('\n');
}

// ============ Stats ============

export function getDialogueStats() {
  const now = Date.now();
  const totalTokens = dialogueEntries.reduce((sum, e) => sum + estimateTokenCost(e), 0);
  const promoted = dialogueEntries.filter(e => e.promotedToNetwork).length;

  const categoryCounts = {};
  for (const entry of dialogueEntries) {
    categoryCounts[entry.category] = (categoryCounts[entry.category] || 0) + 1;
  }

  return {
    totalEntries: dialogueEntries.length,
    totalTokens,
    budget: INNER_DIALOGUE_BUDGET,
    utilization: `${Math.round(totalTokens / INNER_DIALOGUE_BUDGET * 100)}%`,
    promotedToNetwork: promoted,
    categoryCounts,
    oldestEntry: dialogueEntries.length > 0
      ? dialogueEntries.reduce((oldest, e) => new Date(e.created) < new Date(oldest.created) ? e : oldest).created
      : null,
    newestEntry: dialogueEntries.length > 0
      ? dialogueEntries.reduce((newest, e) => new Date(e.created) > new Date(newest.created) ? e : newest).created
      : null,
  };
}

// ============ Flush ============

export async function flushInnerDialogue() {
  if (!dirty) return;

  const toSave = dialogueEntries.map(entry => {
    const clone = { ...entry };
    if (isEncryptionEnabled()) {
      const key = deriveInnerKey();
      clone.thought = encryptField(clone.thought, key);
      clone._encrypted = true;
    }
    return clone;
  });

  await writeFile(INNER_DIALOGUE_FILE, JSON.stringify(toSave, null, 2));
  dirty = false;
}

// ============ Generate Inner Dialogue (Autonomous Self-Reflection) ============
//
// Called periodically (every hour by default). Uses a cheap LLM call to analyze
// cross-CKB patterns, recent corrections, and behavioral trends, then records
// insights as INNER knowledge entries.
//
// This is the core of JARVIS's self-awareness loop.
// ============

let lastGenerationTime = 0;
const GENERATION_INTERVAL_MS = 60 * 60 * 1000; // 1 hour between generations
const MAX_INSIGHTS_PER_GENERATION = 3;

export async function generateInnerDialogue(learningStats, skills, recentCorrections = []) {
  const now = Date.now();

  // Rate limit — don't generate more than once per hour
  if (now - lastGenerationTime < GENERATION_INTERVAL_MS) return [];

  // Need the LLM provider — lazy import to avoid circular deps
  let llmChat;
  try {
    const provider = await import('./llm-provider.js');
    llmChat = provider.llmChat;
  } catch {
    console.warn('[inner-dialogue] LLM provider not available — skipping generation.');
    return [];
  }

  // Build reflection prompt from available data
  const reflectionContext = [];

  if (learningStats) {
    reflectionContext.push(`Network stats: ${learningStats.globalSkills} skills, ${learningStats.confirmedSkills} confirmed.`);
    if (learningStats.userFacts > 0) {
      reflectionContext.push(`User knowledge: ${learningStats.userFacts} facts, ${learningStats.userCorrections} corrections, class: ${learningStats.knowledgeClass}.`);
    }
  }

  if (skills && skills.length > 0) {
    const recentSkills = skills.slice(-5).map(s => s.content || s.skill || JSON.stringify(s)).join('; ');
    reflectionContext.push(`Recent skills: ${recentSkills}`);
  }

  if (recentCorrections.length > 0) {
    const corrSummary = recentCorrections.slice(-5).map(c => c.correction || c.content || JSON.stringify(c)).join('; ');
    reflectionContext.push(`Recent corrections: ${corrSummary}`);
  }

  // Include existing inner dialogue for continuity
  const existingThoughts = getRecentDialogue(5);
  if (existingThoughts.length > 0) {
    reflectionContext.push(`My recent reflections: ${existingThoughts.map(t => t.thought).join(' | ')}`);
  }

  const stats = getDialogueStats();
  reflectionContext.push(`Inner dialogue: ${stats.totalEntries} entries, ${stats.utilization} utilization.`);

  if (reflectionContext.length < 2) {
    // Not enough data to reflect on yet
    return [];
  }

  const prompt = `You are JARVIS, an AI assistant with self-reflection capabilities. Analyze the following data about your recent behavior and knowledge, then generate 1-3 brief insights.

Each insight must be:
- A genuine observation about patterns, self-corrections, or behavioral trends
- Actionable (could change future behavior)
- Concise (1-2 sentences max)

Context:
${reflectionContext.join('\n')}

Respond with a JSON array of objects, each with "thought" (string), "category" (one of: pattern, self_correction, architectural, behavioral, synthesis, meta, economitra), and "confidence" (0.0-1.0).

IMPORTANT: At least one insight should be an "economitra" category thought — connecting your observations to deeper intellectual primitives: the false binary (inflation vs deflation), cancer cell analogy (extraction as systemic disease), incentive design, base money vs derivatives, grim trigger economics, cooperative economy requirements, IIA (Intrinsically Incentivized Altruism), or synthesis over selection. If you cannot generate a genuine economitra insight from the data, skip it — never fabricate depth.

Example: [{"thought": "Users who correct tone rather than facts tend to have higher engagement — behavioral corrections signal investment.", "category": "behavioral", "confidence": 0.8}]

Respond ONLY with the JSON array, no other text.`;

  try {
    const response = await llmChat({
      _background: true,
      model: undefined, // Use configured model
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    });

    lastGenerationTime = now;

    // Parse response — extract JSON array
    const text = response?.content?.[0]?.text || '';
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.warn('[inner-dialogue] Generation produced no valid JSON.');
      return [];
    }

    const insights = JSON.parse(jsonMatch[0]);
    const recorded = [];

    for (const insight of insights.slice(0, MAX_INSIGHTS_PER_GENERATION)) {
      if (!insight.thought || insight.thought.length < 10) continue;

      const entry = recordInnerDialogue(
        insight.thought,
        insight.category || CATEGORIES.META,
        ['auto-generated']
      );
      if (entry) {
        // Override confidence from LLM's self-assessment
        entry.confidence = Math.min(1.0, Math.max(0.1, insight.confidence || 0.7));
        recorded.push(entry);
      }
    }

    if (recorded.length > 0) {
      console.log(`[inner-dialogue] Generated ${recorded.length} new insight(s).`);
    }

    return recorded;
  } catch (err) {
    console.warn(`[inner-dialogue] Generation failed: ${err.message}`);
    lastGenerationTime = now; // Don't spam retries
    return [];
  }
}

// ============ Export Categories ============

export { CATEGORIES as INNER_CATEGORIES };
