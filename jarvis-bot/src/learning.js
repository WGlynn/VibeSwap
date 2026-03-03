// ============ Learning Engine — CKB Economic Model ============
//
// Implements the Nervos CKB cryptoeconomic model for AI knowledge:
//
//   1 CKB = 1 byte of state occupation
//   1 token ≈ 4 chars of knowledge occupation
//
// Core principles:
// - State is scarce. Every fact occupies tokens from a finite budget.
// - Value density = utility / cost. High-density facts survive, low-density die.
// - Utility decays over time (synaptic pruning). Unused knowledge fades.
// - Bounded capacity. New knowledge at capacity displaces the weakest.
// - Self-correcting. The system naturally selects for compressed, useful knowledge.
//
// Knowledge Lifecycle: SHARED → MUTUAL → COMMON → NETWORK
// Economic Lifecycle: occupy → access → decay → prune/promote
//
// Tragedy of the Commons Prevention:
// - No fact persists without ongoing utility (state rent)
// - Total state is bounded by token budget (finite organism resources)
// - Apoptosis removes low-value-density facts (immune system)
// - Cancer (unbounded growth) is structurally impossible
//
// CKB Governance (from JarvisxWill_CKB.md):
// - Promotion: explicit statement OR proven utility OR non-contradiction
// - Demotion: explicit deprecation OR superseded OR proven false OR decayed
// ============

import Anthropic from '@anthropic-ai/sdk';
import { writeFile, readFile, mkdir, appendFile } from 'fs/promises';
import { join } from 'path';
import { config } from './config.js';
import { encryptUserCKB, decryptUserCKB, encryptGroupCKB, decryptGroupCKB, encryptSkills, verifySkills, signCorrection, isEncryptionEnabled } from './privacy.js';
import { getStateStore } from './state-store.js';
import { buildInnerDialogueContext } from './inner-dialogue.js';
import { propose, PROPOSAL_TYPES, onCommit } from './consensus.js';
import { isMultiShard } from './shard.js';

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

// ============ Paths ============

const KNOWLEDGE_DIR = join(config.dataDir, 'knowledge');
const USERS_DIR = join(KNOWLEDGE_DIR, 'users');
const GROUPS_DIR = join(KNOWLEDGE_DIR, 'groups');
const CORRECTIONS_FILE = join(KNOWLEDGE_DIR, 'corrections.jsonl');
const SKILLS_FILE = join(KNOWLEDGE_DIR, 'skills.json');
const ECONOMICS_LOG = join(KNOWLEDGE_DIR, 'economics.jsonl');

// ============ Economic Constants ============
// These are the "protocol parameters" — the CKB equivalent of block size limits.

const ECONOMICS = {
  // Token budgets (1 token ≈ 4 chars)
  USER_CKB_BUDGET: 2000,      // Max tokens per user CKB in system prompt
  GROUP_CKB_BUDGET: 3000,     // Max tokens per group CKB
  SKILL_BUDGET: 1500,         // Max tokens for network skills

  // Fact costs
  FACT_OVERHEAD: 12,          // Base token cost per fact (formatting, category tag, etc.)
  CHARS_PER_TOKEN: 4,         // Approximation: 4 chars ≈ 1 token

  // Utility decay (synaptic pruning)
  DECAY_HALF_LIFE_MS: 7 * 24 * 60 * 60 * 1000,  // 7 days — utility halves weekly
  MIN_UTILITY: 0.01,          // Below this = effectively dead (prune candidate)

  // Value density thresholds
  PRUNE_THRESHOLD: 0.05,      // Value density below this → apoptosis
  PROMOTE_THRESHOLD: 5.0,     // Value density above this → candidate for compression

  // Confirmation bonuses (CKB state rent = ongoing cost, confirmations = ongoing value)
  CONFIRMATION_MULTIPLIER: 1.5, // Each confirmation multiplies utility by this

  // Capacity enforcement
  MAX_FACTS_PER_USER: 100,    // Hard cap on raw fact count
  MAX_FACTS_PER_GROUP: 150,
  MAX_SKILLS: 50,
};

// ============ CKB Knowledge Classes ============

const KNOWLEDGE_CLASSES = {
  SHARED: 'shared',       // Just exchanged. Cost: full token price. Low utility.
  MUTUAL: 'mutual',       // Confirmed. Cost: full. Moderate utility.
  INNER: 'inner',         // Self-reflection. Cost: full. Higher base utility (JARVIS trusts own analysis).
  COMMON: 'common',       // Proven reliable. Cost: reduced (compressed). High utility.
  NETWORK: 'network',     // Universal skill. Cost: shared across all CKBs.
};

// ============ In-Memory State ============

const userKnowledge = new Map();
const groupKnowledge = new Map();
let skills = [];
let dirty = false;

// ============ Token Economics ============

function estimateTokenCost(fact) {
  const contentTokens = Math.ceil((fact.content || '').length / ECONOMICS.CHARS_PER_TOKEN);
  return ECONOMICS.FACT_OVERHEAD + contentTokens;
}

function computeUtility(fact, now) {
  // Base utility from confirmations
  let utility = Math.pow(ECONOMICS.CONFIRMATION_MULTIPLIER, fact.confirmed - 1);

  // Multiply by confidence
  utility *= (fact.confidence || 0.8);

  // Multiply by access count (how often this fact was loaded into context)
  utility *= Math.max(1, fact.accessCount || 1);

  // Apply time decay (exponential half-life)
  const lastActive = fact.lastAccessed || fact.lastConfirmed || fact.created;
  const age = now - new Date(lastActive).getTime();
  const decayFactor = Math.pow(0.5, age / ECONOMICS.DECAY_HALF_LIFE_MS);
  utility *= decayFactor;

  // Knowledge class bonus — higher classes resist decay
  const classBonus = {
    [KNOWLEDGE_CLASSES.SHARED]: 1.0,
    [KNOWLEDGE_CLASSES.MUTUAL]: 1.5,
    [KNOWLEDGE_CLASSES.INNER]: 2.0,
    [KNOWLEDGE_CLASSES.COMMON]: 3.0,
    [KNOWLEDGE_CLASSES.NETWORK]: 5.0,
  };
  utility *= classBonus[fact.knowledgeClass || KNOWLEDGE_CLASSES.SHARED] || 1.0;

  return utility;
}

function computeValueDensity(fact, now) {
  const utility = computeUtility(fact, now);
  const cost = estimateTokenCost(fact);
  return utility / cost;
}

function computeCKBOccupation(facts) {
  let totalTokens = 0;
  for (const fact of facts) {
    totalTokens += estimateTokenCost(fact);
  }
  return totalTokens;
}

// ============ Apoptosis (Pruning) ============
// Remove facts whose value density has fallen below threshold.
// This is the immune system — it prevents knowledge cancer.

function apoptosis(facts, budget) {
  const now = Date.now();
  const scored = facts.map(f => ({
    fact: f,
    valueDensity: computeValueDensity(f, now),
    tokenCost: estimateTokenCost(f),
  }));

  // Remove facts below prune threshold
  const alive = scored.filter(s => s.valueDensity >= ECONOMICS.PRUNE_THRESHOLD);
  const pruned = scored.length - alive.length;

  // If still over budget, remove lowest value-density facts until under budget
  alive.sort((a, b) => b.valueDensity - a.valueDensity);
  let totalTokens = 0;
  const survivors = [];
  for (const entry of alive) {
    if (totalTokens + entry.tokenCost <= budget) {
      totalTokens += entry.tokenCost;
      survivors.push(entry.fact);
    }
    // else: this fact gets pruned due to budget pressure
  }

  const budgetPruned = alive.length - survivors.length;
  if (pruned > 0 || budgetPruned > 0) {
    console.log(`[learning] Apoptosis: ${pruned} decayed, ${budgetPruned} displaced by budget. ${survivors.length} survive (${totalTokens}/${budget} tokens).`);
  }

  return survivors;
}

// ============ Displacement ============
// When adding a new fact at capacity, displace the lowest value-density fact.
// Returns the displaced fact (or null if there's room).

function findDisplacementCandidate(facts, newFactCost, budget) {
  const currentOccupation = computeCKBOccupation(facts);
  if (currentOccupation + newFactCost <= budget) return null; // room available

  const now = Date.now();
  let lowestVD = Infinity;
  let lowestIdx = -1;

  for (let i = 0; i < facts.length; i++) {
    const vd = computeValueDensity(facts[i], now);
    if (vd < lowestVD) {
      lowestVD = vd;
      lowestIdx = i;
    }
  }

  return lowestIdx >= 0 ? lowestIdx : null;
}

// ============ Init ============

export async function initLearning() {
  await mkdir(USERS_DIR, { recursive: true });
  await mkdir(GROUPS_DIR, { recursive: true });

  // Load skills via StateStore (falls back to file)
  const store = getStateStore();
  skills = await store.get('skills') || await loadJson(SKILLS_FILE, []);

  // Verify skills integrity (HMAC check)
  if (isEncryptionEnabled()) {
    const { tampered } = verifySkills(skills);
    if (tampered.length > 0) {
      console.warn(`[learning] WARNING: ${tampered.length} skills failed integrity check: ${tampered.join(', ')}`);
    }
  }

  // Backcompat: add economic fields to existing skills
  for (const skill of skills) {
    if (!skill.tokenCost) skill.tokenCost = estimateTokenCost(skill);
    if (!skill.accessCount) skill.accessCount = 0;
    if (!skill.lastAccessed) skill.lastAccessed = skill.lastConfirmed || skill.created;
  }

  const totalSkillTokens = computeCKBOccupation(skills);
  console.log(`[learning] Loaded ${skills.length} skills (${totalSkillTokens}/${ECONOMICS.SKILL_BUDGET} tokens)`);
}

async function loadJson(path, fallback) {
  try {
    const data = await readFile(path, 'utf-8');
    return JSON.parse(data);
  } catch {
    return fallback;
  }
}

// ============ Per-User CKB ============

async function loadUserCKB(userId) {
  const id = String(userId);
  if (userKnowledge.has(id)) return userKnowledge.get(id);

  // Try StateStore first, fall back to direct file read
  const store = getStateStore();
  let data = await store.get(`user:${id}`);
  if (!data) {
    // Fallback for backward compat (first load before StateStore existed)
    data = await loadJson(join(USERS_DIR, `${id}.json`), null);
  }
  if (!data) {
    data = {
      userId: Number(id),
      username: null,
      facts: [],
      preferences: {},
      corrections: [],
      knowledgeClass: KNOWLEDGE_CLASSES.SHARED,
      interactionCount: 0,
      tokenBudget: ECONOMICS.USER_CKB_BUDGET,
      lastPruned: null,
      lastUpdated: null,
    };
  }

  // Decrypt sensitive fields (compute-to-data: plaintext exists only in memory)
  if (isEncryptionEnabled()) {
    decryptUserCKB(data, id);
  }

  // Backcompat: add economic fields to existing facts + CKB
  if (!data.tokenBudget) data.tokenBudget = ECONOMICS.USER_CKB_BUDGET;
  if (!data.knowledgeClass) data.knowledgeClass = KNOWLEDGE_CLASSES.SHARED;
  if (!data.interactionCount) data.interactionCount = 0;
  for (const fact of data.facts) {
    if (!fact.tokenCost) fact.tokenCost = estimateTokenCost(fact);
    if (!fact.accessCount) fact.accessCount = 0;
    if (!fact.lastAccessed) fact.lastAccessed = fact.lastConfirmed || fact.created;
    if (!fact.knowledgeClass) fact.knowledgeClass = KNOWLEDGE_CLASSES.SHARED;
  }

  userKnowledge.set(id, data);
  return data;
}

async function saveUserCKB(userId) {
  const id = String(userId);
  const data = userKnowledge.get(id);
  if (!data) return;
  data.lastUpdated = new Date().toISOString();

  // Encrypt sensitive fields before writing to disk (RSP: no plaintext at rest)
  const toSave = isEncryptionEnabled() ? encryptUserCKB(data, id) : data;

  // Write via StateStore (abstracts file vs redis vs future backends)
  const store = getStateStore();
  await store.set(`user:${id}`, toSave);
}

// ============ Per-Group CKB ============

async function loadGroupCKB(groupId) {
  const id = String(groupId);
  if (groupKnowledge.has(id)) return groupKnowledge.get(id);

  // Try StateStore first, fall back to direct file read
  const store = getStateStore();
  let data = await store.get(`group:${id}`);
  if (!data) {
    data = await loadJson(join(GROUPS_DIR, `${id}.json`), null);
  }
  if (!data) {
    data = {
      groupId: Number(id),
      groupName: null,
      facts: [],
      norms: [],
      topicsDiscussed: [],
      tokenBudget: ECONOMICS.GROUP_CKB_BUDGET,
      lastPruned: null,
      lastUpdated: null,
    };
  }

  // Decrypt sensitive fields
  if (isEncryptionEnabled()) {
    decryptGroupCKB(data, id);
  }

  // Backcompat
  if (!data.tokenBudget) data.tokenBudget = ECONOMICS.GROUP_CKB_BUDGET;
  for (const fact of data.facts) {
    if (!fact.tokenCost) fact.tokenCost = estimateTokenCost(fact);
    if (!fact.accessCount) fact.accessCount = 0;
    if (!fact.lastAccessed) fact.lastAccessed = fact.lastConfirmed || fact.created;
    if (!fact.knowledgeClass) fact.knowledgeClass = KNOWLEDGE_CLASSES.SHARED;
  }

  groupKnowledge.set(id, data);
  return data;
}

async function saveGroupCKB(groupId) {
  const id = String(groupId);
  const data = groupKnowledge.get(id);
  if (!data) return;
  data.lastUpdated = new Date().toISOString();

  // Encrypt before writing via StateStore
  const toSave = isEncryptionEnabled() ? encryptGroupCKB(data, id) : data;
  const store = getStateStore();
  await store.set(`group:${id}`, toSave);
}

// ============ Correction Detection ============

export async function detectCorrection(userMessage, previousJarvisResponse, userName) {
  if (!previousJarvisResponse || userMessage.length < 10) return null;

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system: `You detect when a user is correcting an AI assistant. Analyze whether the user's message corrects something the assistant said previously.

Return EXACTLY one JSON object:
{
  "is_correction": true/false,
  "confidence": 0.0-1.0,
  "what_was_wrong": "what the AI said that was incorrect or inappropriate" (null if not a correction),
  "what_is_right": "what the correct information/behavior is" (null if not a correction),
  "category": "factual" | "behavioral" | "tonal" | "preference" | "technical" | null,
  "generalizable": true/false (can this lesson apply beyond this specific conversation?)
}

Categories:
- factual: AI stated something objectively wrong
- behavioral: AI did something the user doesn't want (too verbose, too formal, etc.)
- tonal: AI's tone was wrong for the context
- preference: user has a specific preference AI should remember
- technical: AI made a technical/coding error

Important: Disagreement is NOT a correction. The user must be saying the AI is WRONG, not just having a different opinion.`,
      messages: [{
        role: 'user',
        content: `ASSISTANT's previous response:\n"${previousJarvisResponse.slice(0, 500)}"\n\nUSER (${userName}) replied:\n"${userMessage}"`
      }],
    });

    const raw = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const result = JSON.parse(jsonMatch[0]);
    if (!result.is_correction || result.confidence < 0.6) return null;

    return result;
  } catch (err) {
    console.error('[learning] Correction detection failed:', err.message);
    return null;
  }
}

// ============ Lesson Extraction ============

async function extractLesson(correction, userMessage, context) {
  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: `Extract a concise, actionable lesson from a correction. The lesson should be written as an instruction that a future AI can follow.

IMPORTANT: Be as CONCISE as possible. Every character costs tokens. Compress the lesson into the shortest useful form.

Return JSON:
{
  "lesson": "Clear, imperative instruction — max 50 words",
  "scope": "universal" | "user_specific" | "group_specific",
  "tags": ["topic1", "topic2"]
}`,
      messages: [{
        role: 'user',
        content: `Correction: ${JSON.stringify(correction)}\nUser said: "${userMessage}"\nContext: ${context || 'none'}`
      }],
    });

    const raw = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
}

// ============ Process Correction ============

export async function processCorrection(userMessage, previousJarvisResponse, userId, userName, chatId, chatType) {
  const correction = await detectCorrection(userMessage, previousJarvisResponse, userName);
  if (!correction) return null;

  const lesson = await extractLesson(correction, userMessage);
  const timestamp = new Date().toISOString();
  const correctionId = `corr-${Date.now()}`;

  const entry = {
    id: correctionId,
    timestamp,
    userId,
    userName,
    chatId,
    chatType,
    ...correction,
    lesson: lesson?.lesson || null,
    scope: lesson?.scope || 'universal',
    tags: lesson?.tags || [],
  };

  // Sign correction entry for integrity verification
  if (isEncryptionEnabled()) {
    signCorrection(entry);
  }

  // 1. Append to corrections log (raw, never deleted — this is the blockchain)
  try {
    await appendFile(CORRECTIONS_FILE, JSON.stringify(entry) + '\n');
  } catch { /* first write */ }

  // 2. Update per-user CKB with economic accounting
  const userCKB = await loadUserCKB(userId);
  userCKB.username = userName;
  userCKB.interactionCount++;

  // Elevate CKB relationship class
  if (userCKB.interactionCount >= 20 && userCKB.corrections.length >= 3) {
    userCKB.knowledgeClass = KNOWLEDGE_CLASSES.COMMON;
  } else if (userCKB.interactionCount >= 5) {
    userCKB.knowledgeClass = KNOWLEDGE_CLASSES.MUTUAL;
  }

  userCKB.corrections.push({
    id: correctionId,
    what_was_wrong: correction.what_was_wrong,
    what_is_right: correction.what_is_right,
    category: correction.category,
    timestamp,
  });

  // Add as a fact with economic accounting
  if (correction.category === 'preference' || lesson?.scope === 'user_specific' || correction.generalizable) {
    const factContent = lesson?.lesson || correction.what_is_right;
    addFactWithEconomics(userCKB, {
      content: factContent,
      source: 'correction',
      category: correction.category,
      confidence: correction.confidence,
      tags: lesson?.tags || [],
    });
  }

  // Trim corrections log (corrections are cheap — they're the audit trail)
  if (userCKB.corrections.length > 50) {
    userCKB.corrections = userCKB.corrections.slice(-50);
  }
  await saveUserCKB(userId);

  // 3. Group CKB
  if (chatType !== 'private' && (correction.generalizable || lesson?.scope === 'group_specific')) {
    const groupCKB = await loadGroupCKB(chatId);
    addFactWithEconomics(groupCKB, {
      content: lesson?.lesson || correction.what_is_right,
      source: 'correction',
      sourceUser: userName,
      category: correction.category,
      confidence: correction.confidence,
      tags: lesson?.tags || [],
    });
    await saveGroupCKB(chatId);
  }

  // 4. Skill promotion
  if (correction.generalizable && lesson?.scope === 'universal') {
    await maybePromoteToSkill(entry, lesson);
  }

  // Log economic event
  await logEconomicEvent('correction_stored', {
    correctionId,
    userId,
    category: correction.category,
    tokenCost: estimateTokenCost({ content: lesson?.lesson || correction.what_is_right }),
    userOccupation: computeCKBOccupation(userCKB.facts),
    userBudget: userCKB.tokenBudget,
  });

  console.log(`[learning] Correction processed: ${correction.category} — "${correction.what_is_right?.slice(0, 60)}"`);
  dirty = true;

  return {
    correctionId,
    category: correction.category,
    lesson: lesson?.lesson,
  };
}

// ============ Add Fact With Economics ============
// The core economic function: add a fact, respecting budget constraints.
// If at capacity, displace the lowest value-density fact.

function addFactWithEconomics(ckb, factData) {
  const timestamp = new Date().toISOString();
  const content = factData.content;
  if (!content) return null;

  // Check for duplicate
  const existing = ckb.facts.find(f => f.content === content);
  if (existing) {
    existing.confirmed++;
    existing.lastConfirmed = timestamp;
    existing.lastAccessed = timestamp;
    // Elevate knowledge class on confirmation
    if (existing.confirmed >= 3) {
      existing.knowledgeClass = KNOWLEDGE_CLASSES.COMMON;
    } else if (existing.confirmed >= 2) {
      existing.knowledgeClass = KNOWLEDGE_CLASSES.MUTUAL;
    }
    return existing;
  }

  const newFact = {
    id: `fact-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    content,
    source: factData.source || 'conversation',
    sourceUser: factData.sourceUser || null,
    category: factData.category || 'general',
    knowledgeClass: KNOWLEDGE_CLASSES.SHARED,
    confidence: factData.confidence || 0.8,
    confirmed: 1,
    created: timestamp,
    lastConfirmed: timestamp,
    lastAccessed: timestamp,
    accessCount: 0,
    tokenCost: 0,
    tags: factData.tags || [],
  };
  newFact.tokenCost = estimateTokenCost(newFact);

  const budget = ckb.tokenBudget || ECONOMICS.USER_CKB_BUDGET;
  const maxFacts = budget === ECONOMICS.GROUP_CKB_BUDGET
    ? ECONOMICS.MAX_FACTS_PER_GROUP
    : ECONOMICS.MAX_FACTS_PER_USER;

  // Hard count cap
  if (ckb.facts.length >= maxFacts) {
    const idx = findDisplacementCandidate(ckb.facts, newFact.tokenCost, budget);
    if (idx !== null) {
      const displaced = ckb.facts[idx];
      console.log(`[learning] Displacement: "${displaced.content.slice(0, 40)}..." (vd=${computeValueDensity(displaced, Date.now()).toFixed(3)}) → "${content.slice(0, 40)}..."`);
      ckb.facts.splice(idx, 1);
    }
  }

  // Token budget enforcement via displacement
  const displacementIdx = findDisplacementCandidate(ckb.facts, newFact.tokenCost, budget);
  if (displacementIdx !== null) {
    const displaced = ckb.facts[displacementIdx];
    console.log(`[learning] Budget displacement: "${displaced.content.slice(0, 40)}..." freed ${displaced.tokenCost} tokens`);
    ckb.facts.splice(displacementIdx, 1);
  }

  ckb.facts.push(newFact);
  return newFact;
}

// ============ Skill Promotion ============

async function maybePromoteToSkill(correction, lesson) {
  if (!lesson?.lesson) return;

  const existing = skills.find(s =>
    s.tags.some(t => lesson.tags.includes(t)) &&
    s.lesson.toLowerCase().includes(correction.what_is_right?.toLowerCase().slice(0, 30) || '')
  );

  if (existing) {
    existing.confirmations++;
    existing.lastConfirmed = new Date().toISOString();
    existing.sourceCorrections.push(correction.id);
    await saveSkills();
    return;
  }

  const newSkill = {
    id: `SOCIAL-${String(skills.length + 1).padStart(3, '0')}`,
    title: lesson.lesson.slice(0, 80),
    lesson: lesson.lesson,
    content: lesson.lesson, // for tokenCost estimation
    category: correction.category,
    tags: lesson.tags,
    sourceCorrections: [correction.id],
    confirmations: 1,
    confidence: correction.confidence,
    knowledgeClass: KNOWLEDGE_CLASSES.NETWORK,
    created: new Date().toISOString(),
    lastConfirmed: new Date().toISOString(),
    lastAccessed: new Date().toISOString(),
    accessCount: 0,
    tokenCost: 0,
    appliesTo: 'all',
  };
  newSkill.tokenCost = estimateTokenCost(newSkill);

  // Multi-shard: propose via BFT consensus (skill changes global behavior)
  if (isMultiShard()) {
    console.log(`[learning] Proposing skill via BFT consensus: "${lesson.lesson.slice(0, 60)}..."`);
    const result = await propose(PROPOSAL_TYPES.SKILL_PROMOTION, { skill: newSkill });
    if (!result.committed) {
      console.warn(`[learning] Skill proposal rejected/timed out: ${newSkill.id}`);
      return;
    }
    // Committed via consensus — skill will be applied by the onCommit handler
    return;
  }

  // Single-shard: apply directly
  applySkillPromotion(newSkill);
}

// Apply a skill promotion (called directly in single-shard, or via consensus commit handler)
function applySkillPromotion(newSkill) {
  // Budget check for skills
  const currentSkillTokens = computeCKBOccupation(skills);
  if (currentSkillTokens + newSkill.tokenCost > ECONOMICS.SKILL_BUDGET) {
    // Displace lowest value-density skill
    const now = Date.now();
    let lowestVD = Infinity;
    let lowestIdx = -1;
    for (let i = 0; i < skills.length; i++) {
      const vd = computeValueDensity(skills[i], now);
      if (vd < lowestVD) {
        lowestVD = vd;
        lowestIdx = i;
      }
    }
    if (lowestIdx >= 0) {
      console.log(`[learning] Skill displacement: ${skills[lowestIdx].id} (vd=${lowestVD.toFixed(3)})`);
      skills.splice(lowestIdx, 1);
    }
  }

  skills.push(newSkill);
  saveSkills();
  console.log(`[learning] New skill: ${newSkill.id} — "${newSkill.lesson.slice(0, 60)}" (${newSkill.tokenCost} tokens)`);
}

// ============ Coordinated Skill Apoptosis ============
// Network-tier skills: propose pruning via BFT, only apply if committed.
// User/group CKBs remain local — no consensus needed.

async function runSkillApoptosis() {
  const now = Date.now();
  const scored = skills.map((s, idx) => ({
    idx,
    skill: s,
    valueDensity: computeValueDensity(s, now),
  }));

  // Identify skills below prune threshold
  const toPrune = scored.filter(s => s.valueDensity < ECONOMICS.PRUNE_THRESHOLD);
  if (toPrune.length === 0) return;

  const pruneIds = toPrune.map(s => s.skill.id);

  if (isMultiShard()) {
    // Propose pruning via BFT — non-upgraded shards ignore unknown type (safe)
    console.log(`[learning] Proposing skill apoptosis via BFT: ${pruneIds.length} skills`);
    const result = await propose(PROPOSAL_TYPES.APOPTOSIS_BATCH, { skillIds: pruneIds });
    if (!result.committed) {
      console.warn(`[learning] Apoptosis proposal rejected/timed out — keeping all skills`);
      return;
    }
    // Committed — applySkillApoptosis will be called by the onCommit handler
  } else {
    // Single-shard: apply directly
    applySkillApoptosis(pruneIds);
  }
}

function applySkillApoptosis(skillIds) {
  const before = skills.length;
  skills = skills.filter(s => !skillIds.includes(s.id));
  const pruned = before - skills.length;
  if (pruned > 0) {
    console.log(`[learning] Apoptosis: pruned ${pruned} low-density skills (${skills.length} remain)`);
    saveSkills();
  }
}

// Register consensus commit handler for skill promotions + apoptosis
export function registerConsensusHandlers() {
  onCommit(async (type, data) => {
    if (type === PROPOSAL_TYPES.SKILL_PROMOTION && data.skill) {
      applySkillPromotion(data.skill);
    }
    if (type === PROPOSAL_TYPES.APOPTOSIS_BATCH && data.skillIds) {
      applySkillApoptosis(data.skillIds);
    }
  });
}

async function saveSkills() {
  // HMAC integrity for Network knowledge
  const toSave = isEncryptionEnabled() ? encryptSkills(skills) : skills;
  const store = getStateStore();
  await store.set('skills', toSave);
}

// ============ Learn Fact (Tool-Invoked) ============

export async function learnFact(userId, userName, chatId, chatType, fact, category, tags) {
  const userCKB = await loadUserCKB(userId);
  userCKB.username = userName;
  userCKB.interactionCount++;

  // Elevate user CKB class
  if (userCKB.interactionCount >= 20) {
    userCKB.knowledgeClass = KNOWLEDGE_CLASSES.COMMON;
  } else if (userCKB.interactionCount >= 5) {
    userCKB.knowledgeClass = KNOWLEDGE_CLASSES.MUTUAL;
  }

  // Add with economic accounting
  const newFact = addFactWithEconomics(userCKB, {
    content: fact,
    category: category || 'general',
    tags: tags || [],
  });

  await saveUserCKB(userId);

  // Group knowledge
  if (chatType !== 'private') {
    const groupCKB = await loadGroupCKB(chatId);
    addFactWithEconomics(groupCKB, {
      content: fact,
      sourceUser: userName,
      category: category || 'general',
      tags: tags || [],
    });
    await saveGroupCKB(chatId);
  }

  dirty = true;

  const occupation = computeCKBOccupation(userCKB.facts);
  const classLabel = newFact?.knowledgeClass || KNOWLEDGE_CLASSES.SHARED;
  console.log(`[learning] Fact learned: "${fact.slice(0, 50)}" [${classLabel}] (${occupation}/${userCKB.tokenBudget} tokens)`);

  return true;
}

// ============ Forget Fact ============

export async function forgetFact(userId, factId) {
  const userCKB = await loadUserCKB(userId);
  const before = userCKB.facts.length;
  const removed = userCKB.facts.find(f => f.id === factId);
  userCKB.facts = userCKB.facts.filter(f => f.id !== factId);
  if (userCKB.facts.length < before) {
    await saveUserCKB(userId);
    if (removed) {
      console.log(`[learning] Fact forgotten: "${removed.content.slice(0, 40)}..." freed ${removed.tokenCost} tokens`);
    }
    return true;
  }
  return false;
}

// ============ Knowledge Context Builder ============
// Builds a string to inject into the system prompt.
// Marks facts as "accessed" (increases their utility, resets decay timer).
// This is the "state rent payment" — being useful keeps you alive.

export async function buildKnowledgeContext(userId, chatId, chatType) {
  const parts = [];
  const now = Date.now();

  // ---- Per-user CKB (dyadic) ----
  const userCKB = await loadUserCKB(userId);
  if (userCKB.facts.length > 0) {
    // Run apoptosis before building context
    userCKB.facts = apoptosis(userCKB.facts, userCKB.tokenBudget);

    const ckbLabel = userCKB.username
      ? `Jarvisx${userCKB.username}`
      : `JarvisxUser${userId}`;
    const occupation = computeCKBOccupation(userCKB.facts);

    parts.push(`--- CKB: ${ckbLabel} [${userCKB.knowledgeClass}] (${occupation}/${userCKB.tokenBudget} tokens, ${userCKB.facts.length} facts) ---`);

    // Sort by value density (highest first) — best knowledge surfaces first
    const scored = userCKB.facts.map(f => ({
      fact: f,
      valueDensity: computeValueDensity(f, now),
    }));
    scored.sort((a, b) => b.valueDensity - a.valueDensity);

    // Build context string within budget
    let tokensUsed = 0;
    for (const { fact, valueDensity } of scored) {
      const cost = estimateTokenCost(fact);
      if (tokensUsed + cost > userCKB.tokenBudget) break;

      const classTag = fact.knowledgeClass === KNOWLEDGE_CLASSES.COMMON ? 'C'
        : fact.knowledgeClass === KNOWLEDGE_CLASSES.MUTUAL ? 'M' : 'S';
      const conf = fact.confirmed > 1 ? ` x${fact.confirmed}` : '';
      parts.push(`- [${classTag}|${fact.category}] ${fact.content}${conf}`);

      // Mark accessed — this is the utility signal (state rent payment)
      fact.lastAccessed = new Date().toISOString();
      fact.accessCount = (fact.accessCount || 0) + 1;

      tokensUsed += cost;
    }
    parts.push('');
    dirty = true;
  }

  // ---- Per-group CKB ----
  if (chatType !== 'private') {
    const groupCKB = await loadGroupCKB(chatId);
    if (groupCKB.facts.length > 0) {
      groupCKB.facts = apoptosis(groupCKB.facts, groupCKB.tokenBudget);

      const groupLabel = groupCKB.groupName || `Group${chatId}`;
      const occupation = computeCKBOccupation(groupCKB.facts);

      parts.push(`--- GROUP CKB: ${groupLabel} (${occupation}/${groupCKB.tokenBudget} tokens) ---`);

      const scored = groupCKB.facts.map(f => ({
        fact: f,
        valueDensity: computeValueDensity(f, now),
      }));
      scored.sort((a, b) => b.valueDensity - a.valueDensity);

      let tokensUsed = 0;
      for (const { fact } of scored) {
        const cost = estimateTokenCost(fact);
        if (tokensUsed + cost > groupCKB.tokenBudget) break;

        parts.push(`- [${fact.category}] ${fact.content}`);
        fact.lastAccessed = new Date().toISOString();
        fact.accessCount = (fact.accessCount || 0) + 1;
        tokensUsed += cost;
      }

      if (groupCKB.norms.length > 0) {
        parts.push('');
        parts.push('Group norms:');
        for (const norm of groupCKB.norms.slice(0, 10)) {
          parts.push(`- ${norm}`);
        }
      }
      parts.push('');
      dirty = true;
    }
  }

  // ---- Inner Dialogue (Self-Reflection) ----
  const innerContext = buildInnerDialogueContext();
  if (innerContext) {
    parts.push(innerContext);
  }

  // ---- Network Knowledge: Skills ----
  if (skills.length > 0) {
    // Coordinated apoptosis: multi-shard proposes pruning via BFT,
    // single-shard applies directly. User/group CKBs are local-only (no change).
    await runSkillApoptosis();

    const skillTokens = computeCKBOccupation(skills);
    parts.push(`--- NETWORK KNOWLEDGE: Skills (${skillTokens}/${ECONOMICS.SKILL_BUDGET} tokens) ---`);

    const scored = skills.map(s => ({
      skill: s,
      valueDensity: computeValueDensity(s, now),
    }));
    scored.sort((a, b) => b.valueDensity - a.valueDensity);

    let tokensUsed = 0;
    for (const { skill } of scored) {
      const cost = estimateTokenCost(skill);
      if (tokensUsed + cost > ECONOMICS.SKILL_BUDGET) break;

      const conf = skill.confirmations > 1 ? ` (x${skill.confirmations})` : '';
      parts.push(`- [${skill.id}] ${skill.lesson || skill.content}${conf}`);
      skill.lastAccessed = new Date().toISOString();
      skill.accessCount = (skill.accessCount || 0) + 1;
      tokensUsed += cost;
    }
    parts.push('');
    dirty = true;
  }

  return parts.join('\n');
}

// ============ Economic Logging ============

async function logEconomicEvent(event, data) {
  const entry = {
    event,
    timestamp: new Date().toISOString(),
    ...data,
  };
  try {
    await appendFile(ECONOMICS_LOG, JSON.stringify(entry) + '\n');
  } catch { /* ignore */ }
}

// ============ Stats & Queries ============

export async function getLearningStats(userId, chatId) {
  const userCKB = await loadUserCKB(userId);
  const groupCKB = chatId ? await loadGroupCKB(chatId) : null;

  const userOccupation = computeCKBOccupation(userCKB.facts);
  const groupOccupation = groupCKB ? computeCKBOccupation(groupCKB.facts) : 0;
  const skillOccupation = computeCKBOccupation(skills);

  return {
    // Counts
    userFacts: userCKB.facts.length,
    userCorrections: userCKB.corrections.length,
    groupFacts: groupCKB?.facts.length || 0,
    groupNorms: groupCKB?.norms.length || 0,
    globalSkills: skills.length,
    confirmedSkills: skills.filter(s => s.confirmations >= 2).length,
    // Economics
    userTokens: userOccupation,
    userBudget: userCKB.tokenBudget,
    userUtilization: `${Math.round(userOccupation / userCKB.tokenBudget * 100)}%`,
    groupTokens: groupOccupation,
    groupBudget: groupCKB?.tokenBudget || ECONOMICS.GROUP_CKB_BUDGET,
    skillTokens: skillOccupation,
    skillBudget: ECONOMICS.SKILL_BUDGET,
    // Relationship
    knowledgeClass: userCKB.knowledgeClass,
    interactionCount: userCKB.interactionCount,
  };
}

export async function getUserKnowledgeSummary(userId) {
  const userCKB = await loadUserCKB(userId);
  if (userCKB.facts.length === 0 && userCKB.corrections.length === 0) return null;

  const now = Date.now();
  const factsWithVD = userCKB.facts.map(f => ({
    ...f,
    valueDensity: computeValueDensity(f, now).toFixed(3),
    decayPercent: Math.round(
      (1 - Math.pow(0.5, (now - new Date(f.lastAccessed || f.created).getTime()) / ECONOMICS.DECAY_HALF_LIFE_MS)) * 100
    ),
  }));

  return {
    facts: factsWithVD.sort((a, b) => b.valueDensity - a.valueDensity).slice(0, 20),
    corrections: userCKB.corrections.slice(-10),
    preferences: userCKB.preferences,
    occupation: computeCKBOccupation(userCKB.facts),
    budget: userCKB.tokenBudget,
  };
}

export async function getGroupKnowledgeSummary(chatId) {
  const groupCKB = await loadGroupCKB(chatId);
  if (groupCKB.facts.length === 0) return null;
  return {
    facts: groupCKB.facts.slice(-20),
    norms: groupCKB.norms,
    occupation: computeCKBOccupation(groupCKB.facts),
    budget: groupCKB.tokenBudget,
  };
}

export function getSkills() {
  return [...skills];
}

// ============ Set Group Norms / Name ============

export async function addGroupNorm(chatId, norm) {
  const groupCKB = await loadGroupCKB(chatId);
  if (!groupCKB.norms.includes(norm)) {
    groupCKB.norms.push(norm);
    await saveGroupCKB(chatId);
  }
}

export async function setGroupName(chatId, name) {
  const groupCKB = await loadGroupCKB(chatId);
  groupCKB.groupName = name;
  await saveGroupCKB(chatId);
}

// ============ Flush ============

export async function flushLearning() {
  if (!dirty) return;
  for (const [id] of userKnowledge) {
    await saveUserCKB(id);
  }
  for (const [id] of groupKnowledge) {
    await saveGroupCKB(id);
  }
  await saveSkills();
  dirty = false;
}
