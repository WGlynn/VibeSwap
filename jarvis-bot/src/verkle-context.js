// ============ VERKLE CONTEXT TREE — Hierarchical Conversation Memory ============
//
// Inspired by Ethereum's Verkle trees (ethereum.org/roadmap/verkle-trees).
// Verkle trees replace Merkle Patricia tries with a flatter structure and
// polynomial commitments that give fixed-size witnesses regardless of tree depth.
//
// We adapt this for conversation context management:
//
//   Verkle Trees                    Verkle Context Tree
//   ----------------------------   ----------------------------
//   Leaves (state values)          Raw messages
//   Extension nodes (stems)        Epochs (~15 messages -> structured summary)
//   Inner nodes (256 children)     Eras (~5 epochs -> compressed summary)
//   Root                           Conversation identity (one paragraph)
//   Polynomial commitments         Hash-chained integrity + fixed token budgets
//   Witnesses (state proofs)       Context witnesses (injected into prompt)
//   Stateless verification         Shards use witnesses without full history
//
// The key insight: summaries are "lossy in the right way."
//
//   DECISIONS always survive    — they're the state reads, the point of the proof
//   RELATIONSHIPS survive       — the social graph is load-bearing
//   OPEN QUESTIONS get promoted — until resolved or stale
//   FACTS survive               — if referenced by decisions
//   FILLER is discarded         — at the first compression (epoch level)
//
// Token budgets are FIXED per level, regardless of conversation length:
//   Epoch:   ~200 tokens (15 messages compressed)
//   Era:     ~100 tokens (5 epochs compressed)
//   Root:    ~50 tokens  (all eras compressed)
//   Witness: root + active era + current epochs + live messages
//
// Cross-shard: exported witnesses are self-contained proofs of what happened
// in a conversation. A receiving shard can understand and act on another
// shard's context WITHOUT having the full transcript.
//
// "Like a Merkle tree of conversation, where each summary commits to the subtree."
// ============

import { createHash } from 'crypto';
import { llmChat } from './llm-provider.js';

// ============ Constants ============

export const EPOCH_SIZE = 15;           // Messages per epoch (matches SUMMARIZE_BATCH)
export const ERA_SIZE = 5;              // Epochs per era (75 messages)
const EPOCH_MAX_TOKENS = 200;           // ~800 chars
const ERA_MAX_TOKENS = 100;             // ~400 chars
const ROOT_MAX_TOKENS = 50;             // ~200 chars
const CHARS_PER_TOKEN = 4;              // Rough estimate for token counting

// ============ Summarization Prompts ============

// Tier-aware: the CKB's tier hierarchy maps to compression priority.
// Tier 0-1 (identity, alignment, trust) = ALWAYS preserve in DECISIONS/PEOPLE
// Tier 2-6 (architecture, security, project knowledge) = preserve in FACTS/DECISIONS
// Tier 7+ (operational, session-specific) = preserve only if load-bearing
// Filler (greetings, reactions, meta-discussion) = discard immediately
const EPOCH_SYSTEM = `You are a conversation memory engine. Compress these messages into EXACTLY this format:

DECISIONS:
- [each decision, agreement, or conclusion reached]

PEOPLE:
- [name]: [what they said, asked, decided, or contributed]

OPEN:
- [unresolved questions, pending tasks, or active threads]

FACTS:
- [specific names, numbers, dates, URLs, technical terms, file paths, error messages]

NARRATIVE:
[1-2 sentences: what happened in this chunk of conversation]

Compression priority (what survives, highest to lowest):
1. Identity & alignment statements (who we are, what we believe) — ALWAYS keep
2. Decisions & agreements — ALWAYS keep
3. Relationships & attributions (who said/did what) — ALWAYS keep
4. Technical specifics (names, numbers, addresses, paths) — keep if referenced by decisions
5. Open questions & unresolved threads — keep
6. Operational details — keep only if load-bearing
7. Greetings, filler, emoji reactions, small talk — DISCARD

Rules:
- If no items for a category, write "none"
- PRESERVE exact names, numbers, dates, code references, contract addresses — never paraphrase technical specifics
- Attribute statements to specific people (who said what matters)
- Keep total output under 200 words — be dense`;

// Era compression: knowledge promotion. Items that survived epoch-level
// compression now get tested for era-level survival. This is the
// Shared → Mutual → Common promotion from the CKB Knowledge Lifecycle.
// Only load-bearing information survives: decisions, key relationships,
// genuinely open questions, and facts that anchor decisions.
const ERA_SYSTEM = `You are a memory consolidation engine. Merge these epoch summaries into one compressed summary.

Consolidation rules (in priority order):
1. ALL decisions survive (merge duplicates, keep the most specific version)
2. Identity/alignment statements always survive (who we are, what we stand for)
3. PEOPLE entries survive if they made decisions or are referenced by open questions
4. OPEN questions: mark [RESOLVED] if answered in later epochs, keep only still-open ones
5. FACTS survive only if referenced by decisions or open questions
6. Everything else is discarded — if it's not load-bearing, it doesn't survive era compression

Output EXACTLY this format:

DECISIONS:
- [merged decisions]

PEOPLE:
- [key people only]

OPEN:
- [still-open questions only]

FACTS:
- [load-bearing facts only]

NARRATIVE:
[one sentence]

Keep total output under 100 words.`;

// Root = Common Knowledge. This is what survives everything.
// Maps to CKB Tier 0-1: identity, alignment, core truths.
// The root is the "commitment" to the entire conversation tree —
// like C(X) in epistemic logic: both know, both know that both know.
const ROOT_SYSTEM = `You are a conversation identity engine. Produce a single paragraph (under 50 words) answering:
- Who is in this conversation?
- What are they working on?
- What major decisions have been made?
- What is currently unresolved?

This is the permanent identity of the conversation — what would survive total context loss. Focus on WHO and WHAT WAS DECIDED, not operational details.

Output ONLY the paragraph. No headers, no formatting, no preamble.`;

// ============ Helpers ============

function nodeId(level) {
  return `${level}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function hashContent(content) {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

function estimateTokens(text) {
  return Math.ceil((text || '').length / CHARS_PER_TOKEN);
}

// ============ Structured Summary Parser ============

/**
 * Parse LLM output into structured categories.
 * Robust against formatting variations — looks for section headers
 * and bullet points, ignores everything else.
 */
export function parseStructuredSummary(text) {
  const sections = {
    decisions: [],
    people: [],
    open: [],
    facts: [],
    narrative: '',
  };

  if (!text) return sections;

  let currentSection = null;

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Detect section headers (case-insensitive, with or without colon)
    const upper = trimmed.toUpperCase();
    if (upper.startsWith('DECISION'))  { currentSection = 'decisions'; continue; }
    if (upper.startsWith('PEOPLE'))    { currentSection = 'people';    continue; }
    if (upper.startsWith('OPEN'))      { currentSection = 'open';      continue; }
    if (upper.startsWith('FACT'))      { currentSection = 'facts';     continue; }
    if (upper.startsWith('NARRATIVE')) { currentSection = 'narrative';  continue; }

    if (currentSection === 'narrative') {
      sections.narrative += (sections.narrative ? ' ' : '') + trimmed;
    } else if (currentSection) {
      // Accept "- item", "* item", "• item", or just plain text
      const item = trimmed.replace(/^[-*•]\s*/, '').trim();
      if (item && item.toLowerCase() !== 'none' && item !== '-') {
        sections[currentSection].push(item);
      }
    }
  }

  return sections;
}

/**
 * Format a structured summary back to text for further compression.
 */
export function formatStructuredSummary(summary) {
  const lines = [];
  if (summary.decisions?.length > 0) lines.push(`DECISIONS: ${summary.decisions.join('; ')}`);
  if (summary.people?.length > 0)    lines.push(`PEOPLE: ${summary.people.join('; ')}`);
  if (summary.open?.length > 0)      lines.push(`OPEN: ${summary.open.join('; ')}`);
  if (summary.facts?.length > 0)     lines.push(`FACTS: ${summary.facts.join('; ')}`);
  if (summary.narrative)             lines.push(summary.narrative);
  return lines.join('\n');
}

// ============ VerkleContextTree ============

export class VerkleContextTree {
  constructor(chatId) {
    this.chatId = chatId;
    this.root = null;           // { narrative, hash, eraCount, totalMessages, updated }
    this.eras = [];             // Array of era nodes
    this.epochs = [];           // Array of epoch nodes
    this.totalMessages = 0;
    this.version = 0;
    this.lastUpdated = Date.now();
  }

  // ============ Epoch Creation ============

  /**
   * Create an epoch from a batch of conversation messages.
   * This is the leaf-level compression: raw messages -> structured summary.
   *
   * @param {Array} messages - Array of {role, content} message objects
   * @returns {Object|null} The created epoch node, or null on failure
   */
  async createEpoch(messages) {
    // Extract text from messages (handle both string and structured content)
    const textLines = messages
      .filter(m => typeof m.content === 'string')
      .map(m => {
        const text = m.content.length > 300 ? m.content.slice(0, 300) + '...' : m.content;
        return `${m.role}: ${text}`;
      });

    // Also capture tool interactions (summarized)
    const toolLines = messages
      .filter(m => Array.isArray(m.content))
      .map(m => {
        if (m.role === 'assistant') {
          const tools = m.content.filter(b => b.type === 'tool_use').map(b => b.name);
          const text = m.content
            .filter(b => b.type === 'text')
            .map(b => (b.text || '').slice(0, 100))
            .join(' ');
          return tools.length > 0
            ? `assistant: [tools: ${tools.join(', ')}] ${text}`
            : text ? `assistant: ${text}` : null;
        }
        return null;
      })
      .filter(Boolean);

    const allLines = [...textLines, ...toolLines];
    if (allLines.length < 3) return null;

    // Hash the input for integrity commitment
    const inputHash = hashContent(allLines.join('\n'));

    try {
      const response = await llmChat({
        _background: true,
        max_tokens: 400,
        system: EPOCH_SYSTEM,
        messages: [{ role: 'user', content: allLines.join('\n') }],
      });

      const rawText = response.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('')
        .trim();

      if (!rawText || rawText.length < 20) {
        console.warn(`[verkle] Chat ${this.chatId}: epoch summarization returned empty result`);
        return null;
      }

      const summary = parseStructuredSummary(rawText);

      const epoch = {
        id: nodeId('epoch'),
        level: 'epoch',
        created: Date.now(),
        messageCount: messages.length,
        timeRange: {
          start: messages[0]?._timestamp || Date.now() - messages.length * 5000,
          end: messages[messages.length - 1]?._timestamp || Date.now(),
        },
        summary,
        hash: inputHash,
        eraId: null,         // Set when sealed into an era
        tokenCount: estimateTokens(rawText),
      };

      this.epochs.push(epoch);
      this.totalMessages += messages.length;
      this.version++;
      this.lastUpdated = Date.now();

      console.log(
        `[verkle] Chat ${this.chatId}: epoch sealed`
        + ` (${messages.length} msgs -> ${rawText.length} chars`
        + `, ${summary.decisions.length}D/${summary.people.length}P/${summary.open.length}O/${summary.facts.length}F`
        + `, hash:${inputHash.slice(0, 8)})`
      );

      // Check if we should seal an era
      const unsealed = this.epochs.filter(e => !e.eraId);
      if (unsealed.length >= ERA_SIZE) {
        await this.sealEra();
      }

      return epoch;
    } catch (err) {
      console.warn(`[verkle] Chat ${this.chatId}: epoch creation failed: ${err.message}`);
      return null;
    }
  }

  // ============ Era Creation ============

  /**
   * Seal unsealed epochs into an era.
   * This is the mid-level compression: epoch summaries -> consolidated summary.
   * Decisions always survive. Resolved questions are dropped. Filler is gone.
   */
  async sealEra() {
    const unsealed = this.epochs.filter(e => !e.eraId);
    if (unsealed.length < ERA_SIZE) return null;

    const epochBatch = unsealed.slice(0, ERA_SIZE);

    // Build input text from epoch summaries
    const epochTexts = epochBatch.map((e, i) => {
      return `EPOCH ${i + 1} (${e.messageCount} messages):\n${formatStructuredSummary(e.summary)}`;
    });

    // Commitment: hash of children hashes
    const inputHash = hashContent(epochBatch.map(e => e.hash).join(':'));

    try {
      const response = await llmChat({
        _background: true,
        max_tokens: 250,
        system: ERA_SYSTEM,
        messages: [{ role: 'user', content: epochTexts.join('\n\n') }],
      });

      const rawText = response.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('')
        .trim();

      if (!rawText || rawText.length < 20) {
        console.warn(`[verkle] Chat ${this.chatId}: era summarization returned empty result`);
        return null;
      }

      const summary = parseStructuredSummary(rawText);

      const era = {
        id: nodeId('era'),
        level: 'era',
        created: Date.now(),
        messageCount: epochBatch.reduce((sum, e) => sum + e.messageCount, 0),
        timeRange: {
          start: epochBatch[0].timeRange.start,
          end: epochBatch[epochBatch.length - 1].timeRange.end,
        },
        summary,
        hash: inputHash,
        children: epochBatch.map(e => e.id),
        tokenCount: estimateTokens(rawText),
      };

      // Mark epochs as belonging to this era
      for (const e of epochBatch) {
        e.eraId = era.id;
      }

      this.eras.push(era);
      this.version++;
      this.lastUpdated = Date.now();

      const totalEraMessages = era.messageCount;
      console.log(
        `[verkle] Chat ${this.chatId}: era sealed`
        + ` (${ERA_SIZE} epochs, ${totalEraMessages} msgs -> ${rawText.length} chars`
        + `, hash:${inputHash.slice(0, 8)})`
      );

      // Update root whenever an era is sealed
      await this.updateRoot();

      return era;
    } catch (err) {
      console.warn(`[verkle] Chat ${this.chatId}: era creation failed: ${err.message}`);
      return null;
    }
  }

  // ============ Root Update ============

  /**
   * Update the root — the conversation identity.
   * One paragraph that captures who, what, decisions, and open items.
   * This is the "commitment" to the entire tree.
   */
  async updateRoot() {
    if (this.eras.length === 0 && this.epochs.length === 0) return;

    const parts = [];

    // Include all eras
    for (let i = 0; i < this.eras.length; i++) {
      const era = this.eras[i];
      const s = era.summary;
      const text = [`ERA ${i + 1} (${era.messageCount} msgs):`];
      if (s.decisions.length > 0) text.push(`Decisions: ${s.decisions.join('; ')}`);
      if (s.open.length > 0) text.push(`Open: ${s.open.join('; ')}`);
      if (s.narrative) text.push(s.narrative);
      parts.push(text.join('\n'));
    }

    // Include unsealed epochs
    const unsealed = this.epochs.filter(e => !e.eraId);
    if (unsealed.length > 0) {
      const unsealedParts = unsealed.map(e => {
        const s = e.summary;
        const bits = [];
        if (s.decisions.length > 0) bits.push(`Decided: ${s.decisions.join('; ')}`);
        if (s.narrative) bits.push(s.narrative);
        return bits.join(' ');
      }).filter(Boolean);
      if (unsealedParts.length > 0) {
        parts.push(`RECENT (${unsealed.length} epochs, current):\n${unsealedParts.join(' ')}`);
      }
    }

    if (parts.length === 0) return;

    try {
      const response = await llmChat({
        _background: true,
        max_tokens: 100,
        system: ROOT_SYSTEM,
        messages: [{ role: 'user', content: parts.join('\n\n') }],
      });

      const narrative = response.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('')
        .trim();

      if (!narrative || narrative.length < 10) return;

      const rootHash = hashContent(
        [...this.eras.map(e => e.hash), ...unsealed.map(e => e.hash)].join(':')
      );

      this.root = {
        narrative,
        hash: rootHash,
        eraCount: this.eras.length,
        epochCount: this.epochs.length,
        totalMessages: this.totalMessages,
        updated: Date.now(),
      };

      this.version++;
      this.lastUpdated = Date.now();

      console.log(
        `[verkle] Chat ${this.chatId}: root updated`
        + ` (${this.eras.length} eras, ${this.epochs.length} epochs, ${this.totalMessages} total msgs)`
      );
    } catch (err) {
      console.warn(`[verkle] Chat ${this.chatId}: root update failed: ${err.message}`);
    }
  }

  // ============ Witness Builder ============

  /**
   * Build the witness — the compact proof of conversation context.
   *
   * Like a Verkle tree witness that proves state without the full trie,
   * this returns structured context that gives the LLM full understanding
   * of the conversation without needing the raw messages.
   *
   * Witness structure (within token budget):
   *   1. Root identity (always)
   *   2. Most recent era (always)
   *   3. Unsealed epochs (newest first, within budget)
   *   4. Previous era (if budget allows)
   *
   * @param {number} tokenBudget - Max tokens for the witness (default 600)
   * @returns {string} Formatted context string for prompt injection
   */
  buildWitness(tokenBudget = 600) {
    const parts = [];
    let tokens = 0;

    // 1. Root — always included (the commitment to the whole tree)
    if (this.root?.narrative) {
      parts.push(`IDENTITY: ${this.root.narrative}`);
      tokens += estimateTokens(this.root.narrative) + 5;
    }

    // 2. Most recent era — always included
    if (this.eras.length > 0) {
      const latest = this.eras[this.eras.length - 1];
      parts.push(this._formatNode(latest, 'RECENT ERA'));
      tokens += latest.tokenCount || ERA_MAX_TOKENS;
    }

    // 3. Unsealed epochs — newest first, within budget
    const unsealed = this.epochs.filter(e => !e.eraId);
    for (let i = unsealed.length - 1; i >= 0; i--) {
      const epoch = unsealed[i];
      const epochTokens = epoch.tokenCount || EPOCH_MAX_TOKENS;
      if (tokens + epochTokens > tokenBudget) break;
      const idx = this.epochs.indexOf(epoch) + 1;
      parts.push(this._formatNode(epoch, `EPOCH ${idx}`));
      tokens += epochTokens;
    }

    // 4. Previous era — if budget allows (for longer conversations)
    if (this.eras.length > 1 && tokens + ERA_MAX_TOKENS <= tokenBudget) {
      const prev = this.eras[this.eras.length - 2];
      parts.push(this._formatNode(prev, 'PRIOR ERA'));
      tokens += prev.tokenCount || ERA_MAX_TOKENS;
    }

    if (parts.length === 0) return '';

    const header = `// ============ VERKLE CONTEXT (${this.totalMessages} msgs, ${this.epochs.length} epochs, ${this.eras.length} eras, hash:${this.root?.hash?.slice(0, 8) || 'none'}) ============`;
    const footer = '// ============ END VERKLE CONTEXT ============';

    return `\n\n${header}\n${parts.join('\n\n')}\n${footer}`;
  }

  /**
   * Format a node (epoch or era) for witness inclusion.
   * Uses pipe-separated values for density — every character counts.
   */
  _formatNode(node, label) {
    const s = node.summary;
    const lines = [`[${label}] (${node.messageCount} msgs, hash:${node.hash?.slice(0, 8) || '?'})`];

    if (s.decisions?.length > 0) lines.push(`  DECIDED: ${s.decisions.join(' | ')}`);
    if (s.people?.length > 0)    lines.push(`  PEOPLE: ${s.people.join(' | ')}`);
    if (s.open?.length > 0)      lines.push(`  OPEN: ${s.open.join(' | ')}`);
    if (s.facts?.length > 0)     lines.push(`  FACTS: ${s.facts.join(' | ')}`);
    if (s.narrative)             lines.push(`  ${s.narrative}`);

    return lines.join('\n');
  }

  // ============ Cross-Shard Export/Import ============

  /**
   * Export a self-contained witness for cross-shard sharing.
   * Another shard can understand this conversation's context without
   * the full transcript — stateless verification for conversations.
   */
  exportWitness() {
    return {
      chatId: this.chatId,
      root: this.root,
      latestEra: this.eras.length > 0 ? this.eras[this.eras.length - 1] : null,
      recentEpochs: this.epochs.filter(e => !e.eraId).slice(-3),
      totalMessages: this.totalMessages,
      hash: this.root?.hash || 'empty',
      version: this.version,
      exported: Date.now(),
    };
  }

  /**
   * Import a witness from another shard.
   * Allows this shard to reference what happened elsewhere.
   */
  importWitness(witness) {
    if (!witness?.chatId || witness.chatId === this.chatId) return false;

    // Store as a "foreign era" — clearly marked as from another shard
    if (witness.root?.narrative) {
      const foreignEra = {
        id: nodeId('foreign-era'),
        level: 'era',
        created: Date.now(),
        messageCount: witness.totalMessages || 0,
        timeRange: { start: witness.exported - 86400000, end: witness.exported },
        summary: {
          decisions: [],
          people: [],
          open: [],
          facts: [],
          narrative: `[From chat ${witness.chatId}] ${witness.root.narrative}`,
        },
        hash: witness.hash,
        children: [],
        tokenCount: estimateTokens(witness.root.narrative) + 10,
        foreign: true,
        sourceChatId: witness.chatId,
      };

      this.eras.push(foreignEra);
      this.version++;
      return true;
    }
    return false;
  }

  // ============ Migration ============

  /**
   * Import a flat rolling summary from the old context-memory system.
   * Creates a synthetic era + root so no context is lost during transition.
   */
  importFlatSummary(flatSummary, messageCount) {
    if (!flatSummary || flatSummary.length < 20) return;

    const hash = hashContent(flatSummary);

    // Try to parse the flat summary for structure
    // Old summaries are prose, so we create a narrative-heavy structure
    const summary = {
      decisions: [],
      people: [],
      open: [],
      facts: [],
      narrative: flatSummary.length > 800 ? flatSummary.slice(0, 800) + '...' : flatSummary,
    };

    // Create synthetic era
    const era = {
      id: nodeId('migrated-era'),
      level: 'era',
      created: Date.now(),
      messageCount: messageCount || 0,
      timeRange: { start: Date.now() - 86400000, end: Date.now() },
      summary,
      hash,
      children: [],
      tokenCount: estimateTokens(flatSummary),
      migrated: true,
    };

    this.eras.push(era);
    this.totalMessages = messageCount || 0;

    // Create root from the flat summary
    this.root = {
      narrative: flatSummary.length > 200 ? flatSummary.slice(0, 200) + '...' : flatSummary,
      hash,
      eraCount: 1,
      epochCount: 0,
      totalMessages: this.totalMessages,
      updated: Date.now(),
    };

    this.version = 1;
    this.lastUpdated = Date.now();

    console.log(
      `[verkle] Chat ${this.chatId}: migrated flat summary as initial era`
      + ` (${messageCount || '?'} msgs, ${flatSummary.length} chars)`
    );
  }

  // ============ Stats ============

  getStats() {
    const unsealed = this.epochs.filter(e => !e.eraId).length;
    const totalDecisions = this.epochs.reduce((sum, e) => sum + (e.summary.decisions?.length || 0), 0);
    const totalOpen = this.epochs
      .filter(e => !e.eraId)
      .reduce((sum, e) => sum + (e.summary.open?.length || 0), 0);

    return {
      chatId: this.chatId,
      totalMessages: this.totalMessages,
      epochs: this.epochs.length,
      unsealedEpochs: unsealed,
      eras: this.eras.length,
      hasRoot: !!this.root,
      totalDecisions,
      openQuestions: totalOpen,
      version: this.version,
      lastUpdated: this.lastUpdated,
      witnessTokens: estimateTokens(this.buildWitness()),
    };
  }

  // ============ Serialization ============

  toJSON() {
    return {
      chatId: this.chatId,
      root: this.root,
      eras: this.eras,
      epochs: this.epochs,
      totalMessages: this.totalMessages,
      version: this.version,
      lastUpdated: this.lastUpdated,
    };
  }

  static fromJSON(data) {
    const tree = new VerkleContextTree(data.chatId);
    tree.root = data.root || null;
    tree.eras = data.eras || [];
    tree.epochs = data.epochs || [];
    tree.totalMessages = data.totalMessages || 0;
    tree.version = data.version || 0;
    tree.lastUpdated = data.lastUpdated || Date.now();
    return tree;
  }
}
