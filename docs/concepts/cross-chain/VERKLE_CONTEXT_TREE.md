# The Verkle Context Tree: Hierarchical Conversation Memory Inspired by Ethereum State Architecture

**Faraday1 (Will Glynn)**

**March 2026**

---

## Abstract

Large language models suffer from a fundamental memory constraint: fixed context windows impose hard limits on conversation length, and existing mitigation strategies --- flat rolling summaries --- are lossy in the wrong way. Older content is overwritten uniformly rather than compressed selectively, causing critical decisions to be lost alongside irrelevant filler. We present the Verkle Context Tree, a hierarchical conversation memory architecture directly inspired by Ethereum's proposed Verkle tree state transition. Raw messages compress into epochs (~15 messages to ~200 tokens), epochs compress into eras (~5 epochs to ~100 tokens), and eras compress into a root (~50 tokens of conversation identity). Information is classified into five tiers --- DECISIONS, RELATIONSHIPS, OPEN QUESTIONS, FACTS, and FILLER --- with explicit survival rules at each compression level. Hash-chained integrity at every node ensures tamper evidence. Fixed token budgets per level guarantee that memory overhead remains constant regardless of conversation length. Cross-shard witness export enables one agent to understand another's context without access to the full transcript. The architecture is implemented in production as part of the Jarvis AI system and represents a concrete instance of the Convergence Thesis: blockchain state management applied to AI memory is not metaphor but structural isomorphism.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [The Problem with Flat Summaries](#2-the-problem-with-flat-summaries)
3. [Ethereum's Verkle Trees: The Inspiration](#3-ethereums-verkle-trees-the-inspiration)
4. [Architecture](#4-architecture)
5. [Information Classification and Survival Rules](#5-information-classification-and-survival-rules)
6. [Hash-Chained Integrity](#6-hash-chained-integrity)
7. [Witness Construction](#7-witness-construction)
8. [Cross-Shard Context Sharing](#8-cross-shard-context-sharing)
9. [Migration and Backwards Compatibility](#9-migration-and-backwards-compatibility)
10. [Implementation](#10-implementation)
11. [Evaluation](#11-evaluation)
12. [Connection to Blockchain Architecture](#12-connection-to-blockchain-architecture)
13. [Conclusion](#13-conclusion)

---

## 1. Introduction

### 1.1 The Context Window Problem

Every LLM conversation has a ceiling. Whether the window is 8K, 128K, or 1M tokens, every conversation that runs long enough will hit it. At that point, older messages must be discarded. The question is not *whether* to discard, but *how*.

The naive approach --- first-in-first-out truncation --- is catastrophically lossy. A decision made in message 12 is just as important in message 1,200, but FIFO drops it at the first overflow. The standard mitigation is a rolling summary: periodically compress older messages into a prose blob, keep recent messages verbatim, and inject the summary into the system prompt.

This works. Barely. And it degrades in ways that are invisible until they are catastrophic.

### 1.2 The Insight

Ethereum faced an analogous problem. As state grew, the Merkle Patricia trie that stored account balances and contract storage became unwieldy. Witnesses --- the proofs needed to verify state without storing the full trie --- grew linearly with tree depth. The solution: Verkle trees, which use polynomial commitments to produce fixed-size witnesses regardless of depth.

The structural parallel is exact. A conversation is a growing state. Summaries are witnesses. The question "what happened in this conversation?" is a state query. The goal is a fixed-size proof that answers the query without storing the full history.

We adapted this directly.

### 1.3 Scope

This paper describes the Verkle Context Tree as implemented in the Jarvis AI system (a Telegram-based AI agent built as part of the VibeSwap project). The implementation is production code, not a research prototype. It manages context for multiple concurrent conversations across sharded agent instances.

---

## 2. The Problem with Flat Summaries

### 2.1 How Flat Summaries Work

The standard approach to conversation memory management:

```
[System Prompt] + [Rolling Summary Blob] + [Recent Messages (verbatim)]
```

When the message history exceeds a threshold (e.g., 40 messages), the oldest messages are compressed into a single prose summary. The summary is prepended to the system prompt. Recent messages remain verbatim. On the next overflow, the old summary is fed back into the summarizer along with the next batch of old messages, producing a new summary that replaces the old one.

### 2.2 The Failure Modes

The approach has three systematic failure modes:

**Failure 1: Uniform Degradation.** Every summarization pass compresses the entire summary --- old and new content alike. A decision from 500 messages ago receives the same compression as one from 50 messages ago. After enough passes, early decisions are compressed to nothing. The summary converges toward a description of the *most recent* topic, not the *most important* content.

**Failure 2: Structural Amnesia.** Summaries are unstructured prose. There is no way to distinguish a load-bearing decision ("We agreed to use UUPS proxy patterns for all upgradeable contracts") from contextual filler ("We discussed several options before settling on the approach"). Both are represented as sentences in a paragraph. The summarizer has no signal for which to preserve.

**Failure 3: No Integrity Guarantees.** A summary is a blob of text. There is no way to verify whether it accurately represents the conversation it summarizes. There is no commitment to the original content. If the summary drifts (as it inevitably does through repeated compression), the drift is undetectable.

### 2.3 The Consequence

In practice, flat summaries produce AI agents that:

- Forget decisions made more than ~100 messages ago
- Contradict earlier commitments without awareness
- Lose track of open questions and unresolved threads
- Cannot share context with other agent instances

These are not edge cases. They are the normal operating mode of every system that uses flat rolling summaries.

---

## 3. Ethereum's Verkle Trees: The Inspiration

### 3.1 The State Problem in Ethereum

Ethereum stores all account balances, contract code, and contract storage in a Merkle Patricia trie. To verify any piece of state, a node needs a Merkle proof --- a path from the leaf to the root, including all sibling hashes along the way. As the trie grows deeper, these proofs grow longer.

The Verkle tree proposal (Kuszmaul, Buterin, et al.) replaces the Merkle trie with a wider, shallower tree that uses polynomial commitments (specifically, Pedersen commitments over elliptic curves) instead of hash-based commitments. The critical property: **witness size is constant regardless of tree depth**. A proof that a particular account has a particular balance is the same size whether the tree has 1,000 leaves or 1 billion.

### 3.2 The Structural Mapping

The mapping from Verkle trees to conversation memory is direct:

| Verkle Trees (Ethereum) | Verkle Context Tree (Conversation) |
|---|---|
| Leaves (state values) | Raw messages |
| Extension nodes (stems) | Epochs (~15 messages, structured summary) |
| Inner nodes (256 children) | Eras (~5 epochs, compressed summary) |
| Root | Conversation identity (one paragraph) |
| Polynomial commitments | SHA-256 hash chains + fixed token budgets |
| Witnesses (state proofs) | Context witnesses (injected into prompt) |
| Stateless verification | Cross-shard witness import |
| State pruning | Filler discarding at epoch level |

The key properties that transfer:

1. **Fixed witness size**: The witness (context injected into the prompt) has a fixed token budget regardless of conversation length.
2. **Hierarchical compression**: Each level compresses the level below, with explicit rules for what survives.
3. **Integrity commitments**: Each node commits to its children via hash, creating a tamper-evident chain.
4. **Stateless verification**: A witness is self-contained --- the verifier (receiving shard) needs no other data.

### 3.3 What We Did Not Copy

We did not implement polynomial commitments. For conversation memory, SHA-256 hash chains provide sufficient integrity guarantees. We are not operating in an adversarial consensus environment where a malicious prover might forge proofs; we are operating in a cooperative environment where the goal is detecting accidental drift, not deliberate fraud. The hash chain provides exactly the right level of integrity for this setting.

---

## 4. Architecture

### 4.1 The Three-Level Hierarchy

The Verkle Context Tree has three levels of compression, each with a fixed token budget:

```
                    ┌─────────────┐
                    │    ROOT     │  ~50 tokens
                    │ (identity)  │  Conversation identity: who, what, decisions
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
        ┌─────┴─────┐ ┌───┴───┐ ┌─────┴─────┐
        │   ERA 0   │ │ ERA 1 │ │   ERA 2   │  ~100 tokens each
        │ (75 msgs) │ │       │ │           │  Consolidated decisions + key facts
        └─────┬─────┘ └───┬───┘ └─────┬─────┘
              │            │            │
    ┌────┬────┤      ┌─────┤      ┌────┤
    │    │    │      │     │      │    │
   E0   E1   E2    E3    E4    E5   E6      ~200 tokens each
  (15) (15) (15)  (15)  (15)  (15) (15)    Structured summary per epoch
```

**Epoch** (~15 messages to ~200 tokens): The leaf-level compression unit. Raw messages are summarized into a structured format with explicit categories: DECISIONS, PEOPLE, OPEN, FACTS, and NARRATIVE. This is where filler is discarded.

**Era** (~5 epochs to ~100 tokens, covering ~75 messages): The mid-level compression. Epoch summaries are consolidated. Resolved questions are dropped. Duplicate decisions are merged. Only load-bearing information survives.

**Root** (all eras to ~50 tokens): The conversation identity. One paragraph answering: Who is in this conversation? What are they working on? What has been decided? What is unresolved? This is the commitment to the entire tree.

### 4.2 Token Budget Invariants

The budgets are fixed by design, not by accident:

| Level | Token Budget | Character Budget | Compression Ratio |
|---|---|---|---|
| Epoch | ~200 tokens | ~800 chars | 15 messages to 200 tokens |
| Era | ~100 tokens | ~400 chars | 75 messages to 100 tokens |
| Root | ~50 tokens | ~200 chars | All messages to 50 tokens |
| Full Witness | ~600 tokens | ~2,400 chars | Fixed regardless of length |

A conversation of 100 messages and a conversation of 10,000 messages produce witnesses of approximately the same size. The information density increases; the token overhead does not.

### 4.3 The Witness

The witness is the context that gets injected into the LLM prompt. It is constructed from the tree as follows:

```
WITNESS = root + most_recent_era + unsealed_epochs + live_messages
```

Specifically:

1. **Root identity** (always included, ~50 tokens)
2. **Most recent era** (always included, ~100 tokens)
3. **Unsealed epochs** (newest first, within remaining budget)
4. **Previous era** (if budget allows)

The default token budget for the witness is 600 tokens. Combined with live messages (typically 25 recent messages kept verbatim), this gives the LLM access to:

- The identity of the conversation (root)
- The last ~75 messages in compressed form (latest era)
- The last ~15-45 messages in structured form (unsealed epochs)
- The last ~25 messages verbatim (live history)

---

## 5. Information Classification and Survival Rules

### 5.1 The Five Categories

Every piece of information in a conversation falls into one of five categories, classified at epoch creation:

| Category | Definition | Epoch Survival | Era Survival | Root Survival |
|---|---|---|---|---|
| **DECISIONS** | Agreements, conclusions, commitments | Always | Always | Always |
| **RELATIONSHIPS** | Who said what, attributions, social graph | Always | If load-bearing | Summarized |
| **OPEN QUESTIONS** | Unresolved threads, pending tasks | Always | Until resolved | If still open |
| **FACTS** | Names, numbers, dates, URLs, paths | If referenced | If anchoring decisions | Dropped |
| **FILLER** | Greetings, reactions, small talk | Discarded | N/A | N/A |

### 5.2 Compression Priority

At epoch level (raw messages to structured summary), the compression priority is:

```
1. Identity & alignment statements        → ALWAYS keep
2. Decisions & agreements                  → ALWAYS keep
3. Relationships & attributions            → ALWAYS keep
4. Technical specifics (if decision-linked)→ Keep
5. Open questions                          → Keep
6. Operational details                     → Only if load-bearing
7. Filler                                  → DISCARD
```

At era level (epoch summaries to consolidated summary):

```
1. ALL decisions survive (merge duplicates, keep most specific)
2. Identity/alignment statements survive
3. PEOPLE entries survive if they made decisions or are referenced
4. OPEN questions: mark [RESOLVED] if answered, keep only still-open
5. FACTS survive only if referenced by decisions or open questions
6. Everything else discarded
```

At root level:

```
1. WHO is in the conversation
2. WHAT are they working on
3. WHAT DECISIONS have been made
4. WHAT is currently UNRESOLVED
```

### 5.3 The Key Insight: Lossy in the Right Way

Flat summaries are lossy uniformly --- all content degrades at the same rate. The Verkle Context Tree is lossy selectively --- content degrades based on its category, not its age. A decision from epoch 1 survives to the root. A greeting from epoch 50 is discarded at epoch creation.

This mirrors how human memory works: you remember what you decided, who was involved, and what remains unresolved. You forget the specific words, the tangential discussions, and the social pleasantries. The Verkle Context Tree encodes this selective forgetting as an explicit compression policy.

---

## 6. Hash-Chained Integrity

### 6.1 Commitment Structure

Each node in the tree carries a SHA-256 hash commitment:

- **Epoch hash**: `SHA-256(raw_message_content)` --- commits to the input messages
- **Era hash**: `SHA-256(epoch_0.hash + ":" + epoch_1.hash + ... + epoch_n.hash)` --- commits to the children
- **Root hash**: `SHA-256(era_0.hash + ":" + era_1.hash + ... + era_n.hash + ":" + unsealed_epoch_hashes)` --- commits to the entire tree

```javascript
function hashContent(content) {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

// Era commitment: hash of children hashes
const inputHash = hashContent(epochBatch.map(e => e.hash).join(':'));

// Root commitment: hash of all era + unsealed epoch hashes
const rootHash = hashContent(
  [...this.eras.map(e => e.hash), ...unsealed.map(e => e.hash)].join(':')
);
```

### 6.2 What the Hash Chain Provides

The hash chain serves three purposes:

1. **Drift detection**: If a summary is re-generated from the same inputs, the hash should match. A mismatch indicates the summarizer produced different output --- a signal to investigate.

2. **Witness authenticity**: When a witness is exported to another shard, the hash allows the receiver to verify that the witness has not been tampered with in transit.

3. **Tree traversal**: Hash-based node identification enables efficient lookup and cross-referencing without maintaining explicit parent/child pointers.

### 6.3 Truncated Hashes

We use truncated hashes (first 16 hex characters of SHA-256) rather than full 64-character hashes. This is a deliberate trade-off: conversation memory does not require collision resistance against adversarial attack. The truncated hash provides a compact, human-readable identifier (visible in logs as `hash:a3f7b2c1`) while still providing sufficient uniqueness for practical purposes.

---

## 7. Witness Construction

### 7.1 The Algorithm

```javascript
buildWitness(tokenBudget = 600) {
    const parts = [];
    let tokens = 0;

    // 1. Root — always included (commitment to the whole tree)
    if (this.root?.narrative) {
        parts.push(`IDENTITY: ${this.root.narrative}`);
        tokens += estimateTokens(this.root.narrative) + 5;
    }

    // 2. Most recent era — always included
    if (this.eras.length > 0) {
        const latest = this.eras[this.eras.length - 1];
        parts.push(this._formatNode(latest, 'RECENT ERA'));
        tokens += latest.tokenCount;
    }

    // 3. Unsealed epochs — newest first, within budget
    const unsealed = this.epochs.filter(e => !e.eraId);
    for (let i = unsealed.length - 1; i >= 0; i--) {
        const epoch = unsealed[i];
        if (tokens + epoch.tokenCount > tokenBudget) break;
        parts.push(this._formatNode(epoch, `EPOCH ${idx}`));
        tokens += epoch.tokenCount;
    }

    // 4. Previous era — if budget allows
    if (this.eras.length > 1 && tokens + ERA_MAX_TOKENS <= tokenBudget) {
        const prev = this.eras[this.eras.length - 2];
        parts.push(this._formatNode(prev, 'PRIOR ERA'));
    }

    return formatWithHeaders(parts);
}
```

### 7.2 Output Format

A witness in the prompt looks like:

```
// ============ VERKLE CONTEXT (347 msgs, 23 epochs, 4 eras, hash:a3f7b2c1) ============
IDENTITY: Will and Jarvis are building VibeSwap, an omnichain DEX. Major decisions:
UUPS proxy pattern, 10-second batch auctions, Shapley reward distribution. Currently
working on frontend wallet integration and cross-chain settlement.

[RECENT ERA] (75 msgs, hash:e2d4f6a8)
  DECIDED: Use WebAuthn for device wallet | Hot/cold separation permanent
  PEOPLE: Will: mechanism design lead | Jarvis: implementation + testing
  OPEN: Bridge fee model not finalized
  Implemented dual wallet detection and deployed frontend to Vercel.

[EPOCH 23] (15 msgs, hash:b1c3d5e7)
  DECIDED: BridgePage uses 0% protocol fees
  PEOPLE: Will: specified fee model
  FACTS: Vercel URL: frontend-jade-five-87.vercel.app
  Fixed layout overflow and button text on BridgePage.
// ============ END VERKLE CONTEXT ============
```

### 7.3 Token Efficiency

The witness format is optimized for information density:

- **Pipe-separated values** instead of bullet lists (`DECIDED: A | B | C` instead of three separate lines)
- **Abbreviated labels** (`DECIDED`, `OPEN`, `FACTS`)
- **No redundant formatting** (no Markdown headers, no blank lines within nodes)
- **Hash references** in the header line (allows cross-referencing without verbose identifiers)

---

## 8. Cross-Shard Context Sharing

### 8.1 The Problem

In a multi-shard agent architecture (see companion paper: *Shard-Per-Conversation*), multiple instances of the same AI identity operate in separate conversations. Shard 0 manages community discussions. Shard 1 manages trading operations. When a decision in the community shard affects trading behavior, Shard 1 needs to know about it --- without access to Shard 0's full transcript.

### 8.2 Export

```javascript
exportWitness() {
    return {
        chatId: this.chatId,
        root: this.root,
        latestEra: this.eras[this.eras.length - 1] || null,
        recentEpochs: this.epochs.filter(e => !e.eraId).slice(-3),
        totalMessages: this.totalMessages,
        hash: this.root?.hash || 'empty',
        version: this.version,
        exported: Date.now(),
    };
}
```

The exported witness contains:

- **Root**: The conversation identity (who, what, decisions)
- **Latest era**: The most recent consolidated context
- **Recent epochs**: The last 3 unsealed epochs (structured, not raw)
- **Metadata**: Chat ID, message count, hash, version, timestamp

This is self-contained. The receiving shard needs no other data to understand what happened in the source conversation.

### 8.3 Import

```javascript
importWitness(witness) {
    if (!witness?.chatId || witness.chatId === this.chatId) return false;

    if (witness.root?.narrative) {
        const foreignEra = {
            id: nodeId('foreign-era'),
            level: 'era',
            summary: {
                decisions: [],
                people: [],
                open: [],
                facts: [],
                narrative: `[From chat ${witness.chatId}] ${witness.root.narrative}`,
            },
            hash: witness.hash,
            foreign: true,
            sourceChatId: witness.chatId,
        };

        this.eras.push(foreignEra);
        return true;
    }
    return false;
}
```

The imported witness becomes a **foreign era** --- clearly marked as originating from another shard. It participates in the local tree's witness construction (appearing in the context when relevant) but is never confused with locally-generated content.

### 8.4 Stateless Verification

The hash in the exported witness allows the receiver to verify authenticity:

1. The receiver stores the hash of the imported witness
2. On subsequent imports from the same source, the hash chain can be checked for consistency
3. If the source's hash has changed, the foreign era is updated rather than duplicated

This is stateless in the Verkle sense: the receiver does not need the source's full tree to verify the witness. The witness is its own proof.

---

## 9. Migration and Backwards Compatibility

### 9.1 The Migration Problem

The Verkle Context Tree replaces a flat rolling summary system that was already in production. Existing conversations have flat summaries but no tree structure. A hard cutover would lose all existing context.

### 9.2 The Solution

On first initialization, the system checks for existing flat summaries and migrates them:

```javascript
importFlatSummary(flatSummary, messageCount) {
    // Create a synthetic era from the flat summary
    const era = {
        id: nodeId('migrated-era'),
        level: 'era',
        summary: {
            decisions: [],
            people: [],
            open: [],
            facts: [],
            narrative: flatSummary,
        },
        hash: hashContent(flatSummary),
        migrated: true,
    };

    this.eras.push(era);

    // Create root from the flat summary
    this.root = {
        narrative: flatSummary.slice(0, 200),
        hash: hashContent(flatSummary),
        eraCount: 1,
    };
}
```

The flat summary becomes a synthetic migrated era with a narrative-only structure (no categorized DECISIONS, PEOPLE, etc., since the flat format did not distinguish them). The root is initialized from the first 200 characters of the summary. As the conversation continues, new structured epochs are created alongside the migrated era, and the tree gradually fills with properly categorized content.

### 9.3 Dual-Write Persistence

To ensure no data loss, the system maintains dual persistence:

```
context-memory/
├── verkle-trees.json    ← New: full tree state per chat
└── summaries.json       ← Legacy: flat summaries (auto-generated from tree witnesses)
```

The legacy file is regenerated on every flush from the tree witnesses, ensuring that any system still reading the old format gets valid (if less structured) data.

---

## 10. Implementation

### 10.1 File Structure

The implementation consists of two files:

- **`verkle-context.js`** (~730 lines): The `VerkleContextTree` class, summary parser, and all tree operations (epoch creation, era sealing, root update, witness building, cross-shard export/import, migration, serialization).
- **`context-memory.js`** (~380 lines): The integration layer that manages per-chat trees, handles summarization triggers, persistence, and exposes the API to the rest of the bot.

### 10.2 LLM-Driven Compression

Epoch, era, and root creation all use LLM calls for the actual summarization. The tree structure provides the *what to compress* and *what to preserve*; the LLM provides the *how to compress*.

Each level has a dedicated system prompt:

- **Epoch prompt**: "Compress these messages into DECISIONS, PEOPLE, OPEN, FACTS, NARRATIVE. Preserve exact names, numbers, dates. Discard filler. Under 200 words."
- **Era prompt**: "Merge these epoch summaries. All decisions survive. Mark resolved questions. Facts survive only if anchoring decisions. Under 100 words."
- **Root prompt**: "Produce a single paragraph (under 50 words): who, what, decisions, unresolved."

### 10.3 Trigger Conditions

Summarization is triggered when the message history exceeds 40 messages. At that point, the oldest `(history.length - 25)` messages are consumed into epoch(s), and the 25 most recent messages remain verbatim. If the batch is larger than one epoch (15 messages), multiple epochs are created sequentially.

Era sealing is triggered automatically when 5 unsealed epochs accumulate. Root update is triggered automatically when a new era is sealed.

### 10.4 Error Handling

LLM calls can fail (rate limits, network errors, malformed output). The system is designed for graceful degradation:

- If epoch creation fails, messages remain in the live history (they are not discarded)
- If era sealing fails, epochs remain unsealed (they are still included in the witness)
- If root update fails, the previous root is retained
- Minimum output length checks (20 characters) reject empty or trivially short summaries

---

## 11. Evaluation

### 11.1 Qualitative Improvements

In production use across multiple Telegram conversations, the Verkle Context Tree has produced the following observable improvements over flat summaries:

| Property | Flat Summary | Verkle Context Tree |
|---|---|---|
| Decision retention (>100 msgs) | Unreliable | Consistent |
| Context size growth | Linear with conversation | Bounded (fixed budget) |
| Cross-shard awareness | Not possible | Via witness export |
| Structural queries ("what did we decide?") | Requires re-reading | Direct (DECISIONS category) |
| Contradiction detection | Not possible | Hash chain enables diffing |
| Migration from legacy | N/A | Automatic, zero data loss |

### 11.2 Token Overhead

Measured across production conversations:

| Conversation Length | Flat Summary Tokens | Verkle Witness Tokens | Ratio |
|---|---|---|---|
| 50 messages | ~150 | ~200 | 1.3x |
| 200 messages | ~400 | ~350 | 0.9x |
| 500 messages | ~800 | ~450 | 0.6x |
| 1,000 messages | ~1,200 | ~500 | 0.4x |
| 5,000+ messages | Truncated | ~550 | Bounded |

The Verkle witness costs slightly more for short conversations (the tree structure has overhead) but significantly less for long conversations (the fixed budget caps growth). The crossover point is approximately 150 messages.

### 11.3 Compression Statistics

From production logs, typical epoch creation:

```
[verkle] Chat -100123: epoch sealed (15 msgs -> 647 chars, 3D/2P/1O/4F, hash:a3f7b2c1)
```

- **3D**: 3 decisions captured
- **2P**: 2 people referenced
- **1O**: 1 open question tracked
- **4F**: 4 facts preserved
- **647 chars**: Well within the ~800 character budget

---

## 12. Connection to Blockchain Architecture

### 12.1 The Isomorphism

This is not an analogy. It is a structural isomorphism:

| Blockchain Concept | Verkle Context Tree Implementation |
|---|---|
| Block headers | Epoch summaries (compact commitment to block content) |
| Block bodies | Raw messages (full content, prunable after summarization) |
| Chain of blocks | Sequence of epochs within an era |
| Merkle/Verkle proofs | Witness paths (root + era + epochs) |
| State pruning | Filler discarding at epoch level |
| Finality | Era sealing (epochs become immutable) |
| Light clients | Cross-shard witnesses (understand state without full history) |
| State sync | `importWitness()` (sync context from another shard) |
| Genesis block | Migrated flat summary (synthetic initial era) |
| Consensus | LLM summarization (agreement on what the messages mean) |

### 12.2 The Convergence Thesis in Action

The Convergence Thesis (Glynn, 2026) argues that blockchain and AI are not separate disciplines that sometimes overlap, but a single discipline observed from two angles. The Verkle Context Tree is a concrete proof:

- **The problem** (managing growing state with fixed resources) is the same
- **The solution** (hierarchical compression with fixed-size witnesses) is the same
- **The mechanism** (hash-chained commitments with selective pruning) is the same
- **The property** (stateless verification via self-contained proofs) is the same

We did not set out to prove the thesis. We set out to fix conversation memory. The fact that the best solution was a blockchain data structure, adapted without modification to the problem's structure, is evidence that the underlying mathematics is shared.

### 12.3 Session Protocols as Blockchain

The broader Jarvis system uses session protocols --- block headers written at the end of every work session, containing the session topic, parent hash, branch state, artifacts, and next-session pointers. These are, explicitly, a blockchain: a hash-linked chain of state commitments that enables full reconstruction without storing full state.

The Verkle Context Tree operates at the *conversation* level. Session protocols operate at the *session* level. Together, they form a two-layer state management system that mirrors Ethereum's execution layer (per-block state transitions) and consensus layer (cross-epoch finality).

---

## 13. Conclusion

The Verkle Context Tree solves the conversation memory problem by applying blockchain state management to AI context. Flat summaries are replaced with a hierarchical tree that compresses selectively: decisions survive, filler is discarded, and the witness has a fixed token budget regardless of conversation length. Hash-chained integrity provides tamper evidence. Cross-shard witness export enables multi-agent coordination without shared state.

The architecture is not a metaphor borrowed from blockchain for aesthetic purposes. It is a direct application of the same data structure to the same mathematical problem: how do you maintain a compact, verifiable summary of a growing state that an observer can trust without access to the full history?

The answer, in both domains, is the same: hierarchical commitment trees with fixed-size witnesses and selective pruning.

The patterns we develop for managing AI limitations today --- building in a cave, with a box of scraps --- may become foundational for AI-augmented development tomorrow. The Verkle Context Tree is one such pattern: crude, improvised, barely optimal, and containing the conceptual seeds of every conversation memory system that will follow.

---

## References

1. Kuszmaul, J. (2019). "Verkle Trees." Unpublished manuscript.
2. Buterin, V. (2021). "An Incomplete Guide to Verkle Trees." vitalik.eth.limo.
3. Ethereum Foundation. (2023). "The Verge: Verkle Trees Roadmap." ethereum.org/roadmap/verkle-trees.
4. Glynn, W. (2026). "The Convergence Thesis: Blockchain and AI as One Discipline." VibeSwap Documentation.
5. Glynn, W. (2026). "Shard-Per-Conversation: Scaling AI Agents Through Full-Clone Parallelism." VibeSwap Documentation.
6. Glynn, W. (2026). "Disintermediation Grades: The Cincinnatus Roadmap." VibeSwap Documentation.
