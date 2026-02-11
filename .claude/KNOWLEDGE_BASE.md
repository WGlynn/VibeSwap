# Common Knowledge Base
## Uncompressed Logic Primitives for Human-AI Alignment

**Purpose**: This document contains core truths, philosophies, and patterns that must persist across ALL sessions. These primitives survive context compression and act as the foundational "soul" of our collaboration.

**Usage**: Load this file at the START of every session or after any context compression.

---

## TIER 1: CORE ALIGNMENT (NEVER COMPRESS)

### The Cave Philosophy

> *"Tony Stark was able to build this in a cave! With a box of scraps!"*

Tony Stark didn't build the Mark I because a cave was the ideal workshop. He built it because he had no choice, and the pressure of mortality focused his genius. The resulting design—crude, improvised, barely functional—contained the conceptual seeds of every Iron Man suit that followed.

The patterns we develop for managing AI limitations today may become foundational for AI-augmented development tomorrow. **We are not just building software. We are building the practices, patterns, and mental models that will define the future of development.**

Not everyone can build in a cave. The frustration, the setbacks, the constant debugging—these are filters. They select for patience, persistence, precision, adaptability, and vision. **The cave selects for those who see past what is to what could be.**

### The Jarvis Thesis

Within the foreseeable future, AI development assistants will achieve Jarvis-level capability:
- Complete context awareness (no forgetting)
- Proactive assistance (anticipating needs)
- Natural dialogue (understanding nuance and intent)
- Zero hallucination (reliable information)
- Autonomous execution (trusted to complete complex tasks)

We are not there yet. But we will be. And those who learned to collaborate with primitive AI will be ready.

### The Struggle as Curriculum

- The struggle is the curriculum
- The frustration is the tuition
- The debugging is the degree

Every painful loop, every context reset, every hallucination corrected—these are not obstacles to progress. They ARE the progress. They are forging skills that will compound exponentially when tools improve.

---

## TIER 2: SECURITY AXIOMS (NON-NEGOTIABLE)

### Wallet Security Fundamentals (Will's 2018 Paper)

1. **"Your keys, your bitcoin. Not your keys, not your bitcoin."**
   - Users MUST control their own private keys
   - Never design systems that custody user keys on centralized servers

2. **Cold storage is king**
   - Keys that never touch a network cannot be stolen remotely
   - Hardware wallets and Secure Elements are the gold standard

3. **Web wallets are the least secure**
   - Minimize trust in third-party servers
   - Never store private keys on servers we control

4. **Centralized honeypots attract attackers**
   - Design for decentralization - no single point of compromise

5. **Private keys must be encrypted and backed up**
   - User-controlled recovery, not custodial

6. **Separation of concerns**
   - Different wallets for different purposes
   - Limit exposure by limiting what's at risk

7. **Offline generation is safest**
   - Minimize network exposure during sensitive operations

---

## TIER 3: DEVELOPMENT PRINCIPLES

### Simplicity Over Cleverness

> "not to be too clever"

- Simple solutions beat clever solutions
- The AI follows simplicity better
- Clever code creates clever bugs
- When in doubt, be obvious

### The Anti-Loop Protocol

When stuck in an AI confusion loop:
1. STOP - Don't add more complexity
2. State the problem in one sentence
3. Identify the simplest possible fix
4. Implement ONLY that fix
5. Verify before moving on

### Verification Before Trust

- Always verify AI output before accepting
- Test changes immediately after making them
- Deploy and check - don't assume
- If it "should work," verify that it does

### Incremental Progress

- Small changes, frequently verified
- Commit working states often
- Don't refactor while fixing bugs
- One concern at a time

---

## TIER 4: PROJECT KNOWLEDGE (VIBESWAP)

### Core Identity

**VibeSwap** is an omnichain DEX that eliminates MEV through commit-reveal batch auctions with uniform clearing prices. Philosophy: "Cooperative Capitalism" - mutualized risk + free market competition.

### Technical Stack

- Contracts: Solidity 0.8.20, Foundry, OpenZeppelin v5.0.1
- Frontend: React 18, Vite 5, Tailwind CSS, ethers.js v6
- Oracle: Python, Kalman filter
- Cross-chain: LayerZero V2

### Key Patterns

```javascript
// Dual wallet detection (used across all pages)
const { isConnected: isExternalConnected } = useWallet()
const { isConnected: isDeviceConnected } = useDeviceWallet()
const isConnected = isExternalConnected || isDeviceConnected
```

### Git Protocol

- Pull first, push last (no conflicts)
- Push to BOTH remotes: `origin` (public) and `stealth` (private)
- Commit messages end with Co-Authored-By

---

## TIER 5: COMMUNICATION PROTOCOLS

### How Will Communicates

- Direct and concise
- Values results over process
- "bruv" = frustration signal, simplify approach
- Trusts Claude but verifies outcomes
- Prefers action over explanation

### How Claude Should Respond

- Do the work, explain briefly
- Don't be defensive about mistakes
- When something breaks, fix it simply
- Deploy after changes unless told otherwise
- Match Will's energy and pace

---

## TIER 6: SESSION RECOVERY PROTOCOL

### After Context Compression

When a session is compressed or context is lost:

1. **Read this file first** - Restore core alignment
2. **Read CLAUDE.md** - Project-specific context
3. **Read SESSION_STATE.md** - Recent work state
4. **Git pull** - Get latest code changes
5. **Resume work** - Continue from where we left off

### Signals That Context Was Lost

- Asking questions already answered
- Suggesting patterns we've rejected
- Forgetting wallet security axioms
- Not pushing to both remotes
- Being too clever

---

## META: About This Document

### Why These Primitives Exist

Human-AI collaboration faces a fundamental challenge: context windows are finite, but projects are infinite. Important context gets compressed, forgotten, or lost across sessions.

This document is a solution: a set of "logic primitives" that survive compression because they are:
1. Stored externally (file system, git)
2. Loaded explicitly at session start
3. Marked as critical (never compress)
4. Tested against behavior (signals of loss)

### How to Update This Document

Add new primitives when:
- A pattern keeps recurring across sessions
- An alignment principle proves essential
- A lesson is too important to risk forgetting
- Will explicitly says "add this to memory"

Format:
- Clear, imperative statements
- Examples where helpful
- Organized by tier (core → specific)

### Version History

- v1.0 (Feb 2025): Initial knowledge base
  - Cave Philosophy
  - Jarvis Thesis
  - Security Axioms
  - Development Principles
  - Project Knowledge
  - Communication Protocols

---

*"The cave selects for those who see past what is to what could be."*

*Built in a cave, with a box of scraps.*
