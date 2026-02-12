# The Provenance Thesis

**On the Public Contribution Graph as the Successor to Intellectual Property and Copyright in the Post-Transparency Era**

*Will Glynn, February 2025*

*Sequel to: The Transparency Theorem (Glynn, 2025)*

---

## Abstract

The Transparency Theorem (Glynn, 2025) demonstrated that sufficiently advanced human-AI collaboration will render all client-facing code reconstructable from observable behavior, collapsing the information asymmetry that underpins intellectual property (IP) and copyright in software. This paper addresses the question that collapse leaves behind: *If code cannot be owned, how do creators get credited and compensated?*

We propose that a **public contribution graph** — a temporally immutable, cryptographically verifiable record of who contributed what idea, when, and in what context — provides a strictly superior replacement for IP and copyright. We prove that contribution provenance is the one artifact that cannot be reconstructed by AI observation, making it the natural atomic unit of value in the post-transparency economy. We present the VibeSwap messaging board and Shapley distribution system as a working implementation of this model.

---

## 1. The Void

### 1.1 What IP and Copyright Protected

Intellectual property law in software served three functions:

1. **Attribution** — Establishing who created what
2. **Exclusion** — Preventing others from using the creation without permission
3. **Compensation** — Enabling creators to extract economic rent from their creations

Copyright protected the *expression* (the specific code). Patents protected the *invention* (the algorithm or method). Trade secrets protected the *information asymmetry* (knowing something others don't).

### 1.2 What the Transparency Theorem Breaks

The Transparency Theorem proves that for client-facing software, the expression, the method, and the information asymmetry are all recoverable from observable behavior. Specifically:

| IP Mechanism | What It Protects | Transparency Impact |
|-------------|-----------------|-------------------|
| Copyright | Specific expression of code | Moot — equivalent code can be independently generated from UI observation |
| Patent | Algorithm or method | Weakened — methods are inferable from input/output behavior |
| Trade secret | Non-public information | Collapsed — the "secret" is visible in every user interaction |

**The result**: A void. Creators can still produce, but they cannot *own* in the traditional sense. The three functions of IP — attribution, exclusion, compensation — all require something that the Transparency Theorem eliminates: the assumption that code, once written, is scarce.

### 1.3 The Question

If code is abundant (reconstructable by anyone with an AI), what is scarce?

**Answer**: *The temporal record of who thought of it first.*

---

## 2. The Non-Reconstructability of Provenance

### 2.1 The Provenance Axiom

**Axiom 2.1.** *Contribution provenance — the record of who contributed what idea, when, and in response to what context — cannot be reconstructed from the observable behavior of the resulting software.*

**Justification.** Consider two scenarios:

- **Scenario A**: Alice posts "What if we used commit-reveal to prevent MEV?" on February 1. Bob reads it, builds the implementation on February 5.
- **Scenario B**: Bob independently invents commit-reveal for MEV prevention on February 5, having never seen Alice's post.

The resulting software is identical. *OBS(S_A) = OBS(S_B)*. No amount of AI analysis of the deployed software can determine whether Alice's idea preceded Bob's implementation or whether Bob arrived there independently.

The Transparency Theorem can reconstruct *what was built*. It cannot reconstruct *the causal chain of ideas that led to it being built*. Provenance is orthogonal to behavior.

### 2.2 The Temporal Irreversibility Lemma

**Lemma 2.2.1.** *Temporal ordering of contributions is a one-way function: easy to record at the time of creation, impossible to reconstruct after the fact.*

This is analogous to cryptographic hashing. The act of recording "Alice said X at time T" is trivial when it happens. Proving, after the fact and without the record, that Alice said X before Bob built Y is impossible.

**Consequence**: Any system that records contribution provenance at the moment of creation possesses information that is permanently unavailable to any system that does not. This information asymmetry is *not* breakable by the Transparency Theorem, because provenance is not an observable behavior of the software — it is a property of the *process* that created the software.

### 2.3 The Scarcity Transfer

The Transparency Theorem makes *code* abundant.
The Provenance Axiom makes *contribution history* scarce.

In economics, value accrues to scarcity. If code is no longer scarce but contribution provenance is, then:

**Value migrates from the artifact (code) to the record (contribution graph).**

This is not a choice. It is a consequence of the mathematics.

---

## 3. The Public Contribution Graph

### 3.1 Definition

**Definition 3.1 (Public Contribution Graph).** A directed acyclic graph *G = (V, E)* where:
- Each vertex *v ∈ V* represents a contribution (message, idea, code commit, review, vote, or feedback)
- Each edge *e = (v_i, v_j)* represents a causal relationship ("v_j was made in response to v_i")
- Each vertex carries: author identity, timestamp, content hash, and context metadata
- The graph is append-only (no deletions, no history rewrites)
- The graph is publicly readable (transparency by design, not by accident)

### 3.2 Properties

**Property 1: Temporal Immutability.** Once recorded, a contribution's timestamp and content cannot be altered. This can be enforced by:
- Blockchain anchoring (hash commitment to an immutable ledger)
- Merkle tree chaining (each contribution references the hash of the previous state)
- Multi-party attestation (multiple independent observers confirm the timestamp)

**Property 2: Causal Traceability.** The edge structure of the graph records not just *that* someone contributed, but *what prompted it*. Alice's message is linked to Bob's reply, which is linked to Carol's implementation, which is linked to Dave's bug report that improved it.

**Property 3: Universal Inclusion.** Unlike IP law, which only protects "original works of authorship" (code, writing, art), the contribution graph records *all forms of value creation*:
- An idea posted in a chat message
- A question that reframed the problem
- A bug report that prevented a security vulnerability
- A vote that surfaced the right priority
- A review that improved code quality
- An objection that prevented a bad design decision

In the IP model, only the person who *writes the code* has legal claim. In the contribution graph model, everyone in the causal chain receives proportional credit.

**Property 4: Granular and Continuous.** IP is binary — you either have the patent or you don't. Copyright either belongs to you or it doesn't. The contribution graph supports *continuous attribution*: Alice contributed 12% of the idea, Bob contributed 34% of the implementation, Carol contributed 8% through a critical question that changed the architecture.

---

## 4. Superiority of Contribution Graphs over IP

### 4.1 The Comparison

| Dimension | Intellectual Property | Public Contribution Graph |
|-----------|---------------------|--------------------------|
| **Attribution** | Binary (creator/not) | Continuous (% contribution) |
| **Scope** | Code, writing, inventions only | All forms of value (ideas, questions, reviews, votes) |
| **Enforcement** | Legal system (expensive, slow, jurisdictional) | Cryptographic (cheap, instant, global) |
| **Dispute resolution** | Courts (years, millions in legal fees) | On-chain record (the timestamp is the proof) |
| **Fairness** | Winner-take-all (first to file) | Proportional (Shapley values) |
| **Non-coder inclusion** | Excluded (can't copyright an idea) | Included (ideas are first-class contributions) |
| **Cross-border** | Different laws per country | One graph, globally consistent |
| **Speed** | 3-7 years for patent approval | Instant upon contribution |
| **Cost** | $10,000+ per patent filing | Zero (posting a message is free) |
| **Transparency** | Secret until granted | Public from inception |
| **Derivative credit** | None (original author only) | Full chain (idea → implementation → improvement) |

### 4.2 Proof of Strict Superiority

**Theorem 4.2.1.** *The public contribution graph provides strictly more information, at strictly lower cost, with strictly broader coverage, than any IP/copyright regime.*

**Proof.**

1. **More information**: IP records *who filed* and *what was filed*. The contribution graph records *who contributed*, *what they contributed*, *when*, *in response to what*, and *with what causal impact*. The graph is a strict superset of IP information.

2. **Lower cost**: Patent filing costs $10,000+ and takes years. A contribution graph entry costs nothing and is instant. The ratio approaches infinity as graph size grows.

3. **Broader coverage**: IP excludes ideas, questions, feedback, votes, bug reports, and design critiques. The contribution graph includes all of them. The set of recognized contributions is a strict superset. QED.

---

## 5. The Economic Model

### 5.1 From Rent Extraction to Value Attribution

The IP economic model is **rent extraction**: Own the code → prevent others from using it → charge for access.

The contribution graph economic model is **value attribution**: Record who contributed what → compute fair distribution → compensate proportionally.

### 5.2 Shapley Values as the Distribution Mechanism

**Definition 5.2.1 (Shapley Value).** For a cooperative game with *n* players and a value function *v(S)* for each coalition *S*, the Shapley value for player *i* is:

```
φ_i = Σ_{S ⊆ N\{i}} [|S|!(n-|S|-1)! / n!] × [v(S ∪ {i}) - v(S)]
```

In plain terms: the Shapley value measures each participant's marginal contribution averaged over all possible orderings. It is the *unique* distribution that satisfies:

1. **Efficiency** — The total is fully distributed
2. **Symmetry** — Equal contributors receive equal shares
3. **Null player** — Non-contributors receive nothing
4. **Additivity** — Values compose across independent projects

**Application to the contribution graph**: Each vertex in the graph is a player. The value function *v(S)* measures the impact of a subset of contributions on the final product. The Shapley value for each contributor is their fair share of the total value created.

### 5.3 The Pipeline

```
[Human posts idea in messaging board]
        ↓
[Idea is timestamped and recorded in contribution graph]
        ↓
[Others build on the idea (replies, implementations, improvements)]
        ↓
[Causal edges link the chain: idea → discussion → implementation → deployment]
        ↓
[Value is generated (fees, adoption, market cap)]
        ↓
[Shapley distribution computes fair attribution across the causal chain]
        ↓
[Contributors are compensated proportionally]
```

This pipeline replaces the entire IP/copyright/licensing stack with a single mechanism: *record everything, attribute fairly, distribute proportionally*.

---

## 6. The Messaging Board as Layer Zero

### 6.1 Why Raw Messaging is the Foundation

The VibeSwap messaging board (Layer Zero) is not a social feature. It is the **intake layer for the contribution graph**.

Every message posted is a potential contribution. Every reply establishes a causal link. Every vote signals value. The raw gossip of human conversation is the ore from which the contribution graph extracts provenance.

This is why the messaging board must be:
- **Public** — Provenance only has value if it's verifiable by anyone
- **Append-only** — Temporal integrity requires no deletions or edits to history
- **Low-friction** — The easier it is to post, the more contributions are captured
- **Universal** — Not just for developers. Anyone with an idea, a question, or an opinion is a potential contributor

### 6.2 The Telegram Design Decision

The redesign of the messaging board from a reddit-style forum to a Telegram-style chat interface was a deliberate architectural choice motivated by the Provenance Thesis:

- **Reddit-style**: Optimized for *curation* (voting surfaces the best content). Curation implies some contributions are discarded — fatal for provenance.
- **Telegram-style**: Optimized for *flow* (every message is visible in sequence). Flow preserves the full temporal record — essential for provenance.

In a provenance system, a "bad" message still has value: it establishes that the author was present, thinking about the problem, at a specific time. Even wrong ideas contribute to the causal chain by prompting corrections. Nothing should be hidden. Everything is part of the record.

### 6.3 The Architecture Stack

```
Layer 0: Messaging Board (raw messages, timestamps, causal links)
    ↓
Layer 1: Contribution Graph (structured attribution, Shapley computation)
    ↓
Layer 2: Governance (voting weighted by contribution, not just token holdings)
    ↓
Layer 3: Compensation (token distribution proportional to Shapley values)
    ↓
Layer 4: Reputation (cumulative contribution history = portable identity)
```

Each layer builds on the one below. Remove Layer 0 (messaging), and the entire stack collapses — there's no raw data to attribute. This is why the messaging board is not a feature. It is the *foundation*.

---

## 7. Addressing Objections

### 7.1 "People will game the contribution graph"

Yes, and people game IP law (patent trolls, copyright bots, submarine patents). The question is not whether gaming occurs, but which system is more resistant to it.

The contribution graph is more resistant because:
- **Sybil detection** identifies fake accounts (VibeSwap implements this at `/admin/sybil`)
- **Causal chain analysis** detects contributions with no downstream impact (Shapley value = 0 for null players)
- **Community voting** surfaces genuine contributions and buries spam
- **Skin-in-the-game requirements** (staking, identity verification) raise the cost of gaming

IP law has patent trolls. The contribution graph has sybil detection. The latter is faster, cheaper, and automatable.

### 7.2 "Ideas are worthless, only execution matters"

This is the mantra of the IP era, where execution (code) was the scarce resource. In the post-transparency era, execution is abundant (AI generates code from descriptions). What becomes scarce is *having the right idea at the right time*.

The contribution graph doesn't claim ideas are worth the same as execution. Shapley values compute the *marginal contribution* — if 50 people had the same idea but only one person built it, the builder's Shapley value is higher. But the ideator's value is *non-zero*, which is more than IP law gives them.

### 7.3 "This only works for open-source projects"

The Transparency Theorem proves that *all* client-facing software is effectively open-source whether the developers intend it or not. The distinction between open and closed source is dissolving. Therefore, a model that "only works for open source" is a model that works for *everything*.

### 7.4 "What about proprietary algorithms and trade secrets?"

Section 5 of the Transparency Theorem addresses this: server-side algorithms and data remain partially private. For these, traditional protection mechanisms still apply — but they protect an ever-shrinking fraction of total software value. The contribution graph handles the growing majority.

### 7.5 "How do you compensate contributors fairly when value is hard to measure?"

This is genuinely hard, but it's hard under IP law too (what is a patent worth? Whatever a jury says). The contribution graph at least makes the attribution *transparent and auditable*. Bad valuations can be corrected. Under IP law, bad valuations are locked in by legal precedent.

---

## 8. Historical Precedent

### 8.1 The Scientific Citation Graph

Academic science has operated on a contribution graph model for centuries:

- Publish a paper (contribute to the graph)
- Cite prior work (establish causal edges)
- Your reputation = your citation count (cumulative contribution)
- No one "owns" the science (no copyright on natural laws)
- Attribution is everything (plagiarism is the cardinal sin)

Science does not use IP to protect discoveries. It uses *publication priority* and *citation graphs*. The result: the most productive collaborative knowledge system in human history.

The public contribution graph is the citation graph generalized to all forms of contribution, not just academic papers.

### 8.2 Git Blame

Every git repository already contains a primitive contribution graph. `git blame` shows who wrote each line. `git log` shows the temporal sequence. The contribution graph formalizes what software development has already been doing informally.

### 8.3 Blockchain Timestamps

Bitcoin solved the double-spend problem by creating an immutable temporal record. The contribution graph solves the double-claim problem (two people claiming the same idea) by creating an immutable temporal record of *ideas*, not just transactions.

---

## 9. The New Social Contract

### 9.1 The Old Contract

*"I will keep my code secret. In exchange, the law gives me exclusive rights to profit from it. If you copy my code, I will sue you."*

This contract breaks when code secrecy becomes impossible.

### 9.2 The New Contract

*"I will publish my contributions openly. In exchange, the contribution graph records my provenance immutably. If my ideas create value, I am compensated proportionally through Shapley distribution. If someone reconstructs my code, the graph still proves I thought of it first."*

This contract holds *because* code secrecy is impossible. It doesn't fight the Transparency Theorem — it *leverages* it.

### 9.3 The Transition

We are not proposing the abolition of IP law. We are observing that the conditions which made IP law necessary are dissolving, and proposing the system that naturally fills the void. The transition will happen whether we prepare for it or not. Those who build contribution graphs now will be positioned for the post-IP economy. Those who cling to code secrecy will find themselves protecting a vault whose walls are made of glass.

---

## 10. Formal Summary

**Theorem (The Provenance Thesis).** In a post-transparency economy where client-facing code is freely reconstructable:

1. Code is no longer scarce → code ownership has no economic value
2. Contribution provenance is permanently scarce → provenance has economic value
3. A public contribution graph captures provenance with temporal immutability
4. Shapley distribution computes fair compensation from the graph
5. This system provides strictly superior attribution, at lower cost, with broader coverage, than IP/copyright

**Therefore**: The public contribution graph is the natural and sufficient successor to intellectual property and copyright for software.

**Design implication**: Every system that wishes to attribute and compensate creators in the post-transparency era must implement, at minimum:

1. A low-friction public messaging layer (to capture raw contributions)
2. A temporally immutable contribution graph (to preserve provenance)
3. A mathematically fair distribution mechanism (to compute compensation)
4. A reputation system built on cumulative contribution (to replace credentials)

VibeSwap implements all four.

---

*"In a world where anyone can build what you built, the only thing that's yours is the proof that you thought of it first."*

---

### Citation

```
Glynn, W. (2025). "The Provenance Thesis: On the Public Contribution
Graph as the Successor to Intellectual Property and Copyright in the
Post-Transparency Era." VibeSwap Protocol Documentation. February 2025.

Depends on:
  Glynn, W. (2025). "The Transparency Theorem." VibeSwap Protocol Docs.
```

---

### Appendix A: The VibeSwap Implementation Map

| Thesis Component | VibeSwap Implementation | Location |
|-----------------|------------------------|----------|
| Low-friction messaging layer | Telegram-style MessageBoard | `frontend/src/components/MessageBoard.jsx` |
| Message persistence | MessagingContext with storage adapter | `frontend/src/contexts/MessagingContext.jsx` |
| Contribution graph | ContributionsContext + ForumPage | `frontend/src/contexts/ContributionsContext.jsx` |
| Causal link tracking | parentId threading + board structure | `MessagingContext.jsx` (postMessage with parentId) |
| Shapley distribution | ShapleyDistributor contract | `contracts/incentives/ShapleyDistributor.sol` |
| Sybil resistance | AdminSybilDetection + sybilDetection utility | `frontend/src/components/AdminSybilDetection.jsx` |
| Temporal immutability | Dual timestamps (createdAt, never mutable) | All message and contribution objects |
| Reputation system | Identity with XP, levels, contribution history | `frontend/src/hooks/useIdentity.js` |
| Vote-weighted governance | Contribution-weighted voting | `frontend/src/utils/governance.js` |
| Activity visualization | ContributionGraph (GitHub-style calendar) | `frontend/src/components/ContributionGraph.jsx` |
