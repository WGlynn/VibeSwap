// ============ Learning Engine ============
// Implements the CKB epistemological framework from JarvisxWill_CKB.md:
//
// Knowledge Lifecycle: Private → Shared → Mutual → Common → Public/Network
//
// This module handles:
// - Shared Knowledge: Facts exchanged in current conversation
// - Mutual Knowledge: Acknowledged by both parties (corrections = mutual)
// - Common Knowledge: Promoted to persistent CKB (skills = common)
//
// Per-user CKBs (dyadic): JarvisxUser knowledge — unique per relationship
// Per-group CKBs: Shared group knowledge — norms, decisions, facts
// Skills: Network Knowledge — patterns that work for all users
//
// CKB Governance:
// - Promotion requires: explicit statement OR proven utility OR non-contradiction
// - Demotion: explicit deprecation OR superseded OR proven false
// ============

import Anthropic from '@anthropic-ai/sdk';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { config } from './config.js';

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

// ============ Paths ============

const KNOWLEDGE_DIR = join(config.dataDir, 'knowledge');
const USERS_DIR = join(KNOWLEDGE_DIR, 'users');
const GROUPS_DIR = join(KNOWLEDGE_DIR, 'groups');
const CORRECTIONS_FILE = join(KNOWLEDGE_DIR, 'corrections.jsonl');
const SKILLS_FILE = join(KNOWLEDGE_DIR, 'skills.json');

// CKB-aligned knowledge classes
const KNOWLEDGE_CLASSES = {
  SHARED: 'shared',       // Exchanged in session, not yet confirmed
  MUTUAL: 'mutual',       // Both parties know, acknowledged
  COMMON: 'common',       // Persisted, proven utility across sessions
  NETWORK: 'network',     // Applies to all users (promoted skills)
};

// ============ In-Memory State ============

const userKnowledge = new Map();   // userId -> { facts, preferences, corrections }
const groupKnowledge = new Map();  // groupId -> { facts, norms }
let skills = [];
let dirty = false;

// ============ Init ============

export async function initLearning() {
  await mkdir(USERS_DIR, { recursive: true });
  await mkdir(GROUPS_DIR, { recursive: true });

  // Load skills
  skills = await loadJson(SKILLS_FILE, []);
  console.log(`[learning] Loaded ${skills.length} learned skills`);
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

  const filePath = join(USERS_DIR, `${id}.json`);
  const data = await loadJson(filePath, {
    // CKB header — mirrors JarvisxWill_CKB.md dyadic structure
    userId: Number(id),
    username: null,
    // Knowledge stores
    facts: [],           // Persistent learned facts
    preferences: {},     // User-specific preferences
    corrections: [],     // Raw correction log
    // CKB metadata
    knowledgeClass: KNOWLEDGE_CLASSES.SHARED, // elevates as relationship deepens
    interactionCount: 0, // tracks depth of dyad
    lastUpdated: null,
  });
  // Backcompat: ensure new fields exist on old records
  if (!data.knowledgeClass) data.knowledgeClass = KNOWLEDGE_CLASSES.SHARED;
  if (!data.interactionCount) data.interactionCount = 0;
  userKnowledge.set(id, data);
  return data;
}

async function saveUserCKB(userId) {
  const id = String(userId);
  const data = userKnowledge.get(id);
  if (!data) return;
  data.lastUpdated = new Date().toISOString();
  const filePath = join(USERS_DIR, `${id}.json`);
  await writeFile(filePath, JSON.stringify(data, null, 2));
}

// ============ Per-Group CKB ============

async function loadGroupCKB(groupId) {
  const id = String(groupId);
  if (groupKnowledge.has(id)) return groupKnowledge.get(id);

  const filePath = join(GROUPS_DIR, `${id}.json`);
  const data = await loadJson(filePath, {
    groupId: Number(id),
    groupName: null,
    facts: [],
    norms: [],
    topicsDiscussed: [],
    lastUpdated: null,
  });
  groupKnowledge.set(id, data);
  return data;
}

async function saveGroupCKB(groupId) {
  const id = String(groupId);
  const data = groupKnowledge.get(id);
  if (!data) return;
  data.lastUpdated = new Date().toISOString();
  const filePath = join(GROUPS_DIR, `${id}.json`);
  await writeFile(filePath, JSON.stringify(data, null, 2));
}

// ============ Correction Detection ============
// Uses Haiku to cheaply detect if a user message is correcting JARVIS.
// Only runs when the message is a reply to JARVIS or directly addressed.

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
// When a correction is detected, extract a generalizable lesson.

async function extractLesson(correction, userMessage, context) {
  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: `Extract a concise, actionable lesson from a correction. The lesson should be written as an instruction that a future AI can follow.

Return JSON:
{
  "lesson": "Clear, imperative instruction (e.g., 'When discussing X, always Y instead of Z')",
  "scope": "universal" | "user_specific" | "group_specific",
  "tags": ["topic1", "topic2"]
}

Keep the lesson under 100 words. Make it specific enough to be useful, general enough to apply broadly.`,
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
// The main entry point: detect, extract, store, maybe promote.

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

  // 1. Append to corrections log (raw, never deleted)
  try {
    const { appendFile } = await import('fs/promises');
    await appendFile(CORRECTIONS_FILE, JSON.stringify(entry) + '\n');
  } catch { /* first write */ }

  // 2. Update per-user CKB
  const userCKB = await loadUserCKB(userId);
  userCKB.username = userName;
  userCKB.interactionCount++;

  // CKB Governance: elevate knowledge class based on interaction depth
  // Shared (new) → Mutual (5+ interactions) → Common (20+ interactions with corrections)
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

  // Add as a fact if it's a preference or generalizable
  if (correction.category === 'preference' || lesson?.scope === 'user_specific') {
    const existingFact = userCKB.facts.find(f =>
      f.content === correction.what_is_right && f.source === 'correction'
    );
    if (existingFact) {
      existingFact.confirmed++;
      existingFact.lastConfirmed = timestamp;
    } else {
      userCKB.facts.push({
        id: `fact-${Date.now()}`,
        content: lesson?.lesson || correction.what_is_right,
        source: 'correction',
        category: correction.category,
        confidence: correction.confidence,
        confirmed: 1,
        created: timestamp,
        lastConfirmed: timestamp,
        tags: lesson?.tags || [],
      });
    }
  }

  // Keep only last 50 corrections per user
  if (userCKB.corrections.length > 50) {
    userCKB.corrections = userCKB.corrections.slice(-50);
  }
  await saveUserCKB(userId);

  // 3. Update per-group CKB if in a group
  if (chatType !== 'private' && (correction.generalizable || lesson?.scope === 'group_specific')) {
    const groupCKB = await loadGroupCKB(chatId);
    const existingFact = groupCKB.facts.find(f =>
      f.content === correction.what_is_right
    );
    if (existingFact) {
      existingFact.confirmed++;
      existingFact.lastConfirmed = timestamp;
    } else {
      groupCKB.facts.push({
        id: `gfact-${Date.now()}`,
        content: lesson?.lesson || correction.what_is_right,
        source: 'correction',
        sourceUser: userName,
        category: correction.category,
        confidence: correction.confidence,
        confirmed: 1,
        created: timestamp,
        lastConfirmed: timestamp,
        tags: lesson?.tags || [],
      });
    }

    // Keep only last 100 group facts
    if (groupCKB.facts.length > 100) {
      groupCKB.facts = groupCKB.facts.slice(-100);
    }
    await saveGroupCKB(chatId);
  }

  // 4. Check if this lesson should be promoted to a skill
  if (correction.generalizable && lesson?.scope === 'universal') {
    await maybePromoteToSkill(entry, lesson);
  }

  console.log(`[learning] Correction processed: ${correction.category} — "${correction.what_is_right?.slice(0, 60)}"`);
  dirty = true;

  return {
    correctionId,
    category: correction.category,
    lesson: lesson?.lesson,
    promoted: false, // will be set by maybePromoteToSkill
  };
}

// ============ Skill Promotion ============
// When a universal lesson has been confirmed by multiple corrections,
// promote it to a reusable skill primitive.

async function maybePromoteToSkill(correction, lesson) {
  if (!lesson?.lesson) return;

  // Check if a similar skill already exists
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

  // Create new skill
  const skillId = `SOCIAL-${String(skills.length + 1).padStart(3, '0')}`;
  skills.push({
    id: skillId,
    title: lesson.lesson.slice(0, 80),
    lesson: lesson.lesson,
    category: correction.category,
    tags: lesson.tags,
    sourceCorrections: [correction.id],
    confirmations: 1,
    confidence: correction.confidence,
    created: new Date().toISOString(),
    lastConfirmed: new Date().toISOString(),
    appliesTo: 'all',
  });

  await saveSkills();
  console.log(`[learning] New skill promoted: ${skillId} — ${lesson.lesson.slice(0, 60)}`);
}

async function saveSkills() {
  await writeFile(SKILLS_FILE, JSON.stringify(skills, null, 2));
}

// ============ Learn Fact (Tool-Invoked) ============
// JARVIS can proactively learn facts during conversation via tool use.

export async function learnFact(userId, userName, chatId, chatType, fact, category, tags) {
  const timestamp = new Date().toISOString();

  // ============ Knowledge Lifecycle ============
  // New facts enter as SHARED (just exchanged in session).
  // When confirmed by the user (repeated or corrected), they become MUTUAL.
  // After 3+ confirmations, they become COMMON (persisted as reliable).
  // Skills promoted across users become NETWORK knowledge.

  const userCKB = await loadUserCKB(userId);
  userCKB.username = userName;
  userCKB.interactionCount++;

  // Deduplicate — if fact already exists, confirm it (elevates its class)
  const existing = userCKB.facts.find(f => f.content === fact);
  if (existing) {
    existing.confirmed++;
    existing.lastConfirmed = timestamp;
    // Knowledge class elevation
    if (existing.confirmed >= 3) {
      existing.knowledgeClass = KNOWLEDGE_CLASSES.COMMON;
    } else if (existing.confirmed >= 2) {
      existing.knowledgeClass = KNOWLEDGE_CLASSES.MUTUAL;
    }
  } else {
    userCKB.facts.push({
      id: `fact-${Date.now()}`,
      content: fact,
      source: 'conversation',
      category: category || 'general',
      knowledgeClass: KNOWLEDGE_CLASSES.SHARED, // starts as shared
      confidence: 0.8,
      confirmed: 1,
      created: timestamp,
      lastConfirmed: timestamp,
      tags: tags || [],
    });
  }

  // Elevate user CKB class based on depth
  if (userCKB.interactionCount >= 20) {
    userCKB.knowledgeClass = KNOWLEDGE_CLASSES.COMMON;
  } else if (userCKB.interactionCount >= 5) {
    userCKB.knowledgeClass = KNOWLEDGE_CLASSES.MUTUAL;
  }

  await saveUserCKB(userId);

  // Group knowledge — only add to group CKB if in a group chat
  if (chatType !== 'private') {
    const groupCKB = await loadGroupCKB(chatId);
    const existingGroup = groupCKB.facts.find(f => f.content === fact);
    if (existingGroup) {
      existingGroup.confirmed++;
      existingGroup.lastConfirmed = timestamp;
    } else {
      groupCKB.facts.push({
        id: `gfact-${Date.now()}`,
        content: fact,
        source: 'conversation',
        sourceUser: userName,
        category: category || 'general',
        knowledgeClass: KNOWLEDGE_CLASSES.SHARED,
        confidence: 0.8,
        confirmed: 1,
        created: timestamp,
        lastConfirmed: timestamp,
        tags: tags || [],
      });
    }
    await saveGroupCKB(chatId);
  }

  dirty = true;
  const classLabel = existing
    ? `elevated to ${existing.knowledgeClass}`
    : KNOWLEDGE_CLASSES.SHARED;
  console.log(`[learning] Fact learned: "${fact.slice(0, 60)}" [${classLabel}]`);
  return true;
}

// ============ Forget Fact ============

export async function forgetFact(userId, factId) {
  const userCKB = await loadUserCKB(userId);
  const before = userCKB.facts.length;
  userCKB.facts = userCKB.facts.filter(f => f.id !== factId);
  if (userCKB.facts.length < before) {
    await saveUserCKB(userId);
    return true;
  }
  return false;
}

// ============ Knowledge Context Builder ============
// Builds a string to inject into the system prompt with relevant learned knowledge.

export async function buildKnowledgeContext(userId, chatId, chatType) {
  const parts = [];

  // Per-user CKB (dyadic knowledge — JarvisxUser)
  const userCKB = await loadUserCKB(userId);
  if (userCKB.facts.length > 0) {
    const ckbLabel = userCKB.username
      ? `Jarvisx${userCKB.username}`
      : `JarvisxUser${userId}`;
    parts.push(`--- CKB: ${ckbLabel} [${userCKB.knowledgeClass}] ---`);
    // Sort by confidence * confirmations, take top 20
    const topFacts = [...userCKB.facts]
      .sort((a, b) => (b.confidence * b.confirmed) - (a.confidence * a.confirmed))
      .slice(0, 20);
    for (const fact of topFacts) {
      const conf = fact.confirmed > 1 ? ` (confirmed x${fact.confirmed})` : '';
      parts.push(`- [${fact.category}] ${fact.content}${conf}`);
    }
    parts.push('');
  }

  // Per-group CKB (shared group knowledge)
  if (chatType !== 'private') {
    const groupCKB = await loadGroupCKB(chatId);
    if (groupCKB.facts.length > 0) {
      const groupLabel = groupCKB.groupName || `Group${chatId}`;
      parts.push(`--- GROUP CKB: ${groupLabel} ---`);
      const topFacts = [...groupCKB.facts]
        .sort((a, b) => (b.confidence * b.confirmed) - (a.confidence * a.confirmed))
        .slice(0, 15);
      for (const fact of topFacts) {
        parts.push(`- [${fact.category}] ${fact.content}`);
      }

      if (groupCKB.norms.length > 0) {
        parts.push('');
        parts.push('Group norms:');
        for (const norm of groupCKB.norms.slice(0, 10)) {
          parts.push(`- ${norm}`);
        }
      }
      parts.push('');
    }
  }

  // Network Knowledge: Skills learned from corrections across all users
  // These are CKB Tier 8 equivalent — Mistake → Skill Protocol
  if (skills.length > 0) {
    parts.push('--- NETWORK KNOWLEDGE: Learned Skills ---');
    // Only include confirmed skills (2+ confirmations) or recent ones (< 7 days)
    const relevantSkills = skills.filter(s =>
      s.confirmations >= 2 || (Date.now() - new Date(s.created).getTime() < 7 * 24 * 60 * 60 * 1000)
    );
    for (const skill of relevantSkills.slice(0, 15)) {
      const conf = skill.confirmations > 1 ? ` (x${skill.confirmations})` : '';
      parts.push(`- [${skill.id}] ${skill.lesson}${conf}`);
    }
    parts.push('');
  }

  return parts.join('\n');
}

// ============ Stats & Queries ============

export async function getLearningStats(userId, chatId) {
  const userCKB = await loadUserCKB(userId);
  const groupCKB = chatId ? await loadGroupCKB(chatId) : null;

  return {
    userFacts: userCKB.facts.length,
    userCorrections: userCKB.corrections.length,
    groupFacts: groupCKB?.facts.length || 0,
    groupNorms: groupCKB?.norms.length || 0,
    globalSkills: skills.length,
    confirmedSkills: skills.filter(s => s.confirmations >= 2).length,
  };
}

export async function getUserKnowledgeSummary(userId) {
  const userCKB = await loadUserCKB(userId);
  if (userCKB.facts.length === 0 && userCKB.corrections.length === 0) {
    return null;
  }
  return {
    facts: userCKB.facts.slice(-20),
    corrections: userCKB.corrections.slice(-10),
    preferences: userCKB.preferences,
  };
}

export async function getGroupKnowledgeSummary(chatId) {
  const groupCKB = await loadGroupCKB(chatId);
  if (groupCKB.facts.length === 0) return null;
  return {
    facts: groupCKB.facts.slice(-20),
    norms: groupCKB.norms,
  };
}

export function getSkills() {
  return [...skills];
}

// ============ Set Group Norms ============

export async function addGroupNorm(chatId, norm) {
  const groupCKB = await loadGroupCKB(chatId);
  if (!groupCKB.norms.includes(norm)) {
    groupCKB.norms.push(norm);
    await saveGroupCKB(chatId);
  }
}

// ============ Set Group Name ============

export async function setGroupName(chatId, name) {
  const groupCKB = await loadGroupCKB(chatId);
  groupCKB.groupName = name;
  await saveGroupCKB(chatId);
}

// ============ Flush ============

export async function flushLearning() {
  if (!dirty) return;
  // Save any loaded user/group CKBs
  for (const [id] of userKnowledge) {
    await saveUserCKB(id);
  }
  for (const [id] of groupKnowledge) {
    await saveGroupCKB(id);
  }
  await saveSkills();
  dirty = false;
}
