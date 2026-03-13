# Near-Zero Token Scaling: How Distributed AI Networks Can Scale Without Multiplying Cost

*Nervos Talks Post -- W. Glynn (Faraday1)*
*March 2026*

---

## TL;DR

Everyone assumes that distributing an AI system across N nodes means paying N times the token cost. We proved this is wrong. The key insight: **thinking and coordinating are different types of work with different cost structures**. Thinking (generating responses for users) scales with demand -- unavoidable. Coordinating (consensus, routing, health checks) scales with infrastructure -- but costs zero tokens because it is pure deterministic computation. By separating these two planes architecturally, we built a 3-node Byzantine fault-tolerant AI network (JARVIS Mind Network) where total token cost is `T * U * 1.04` -- independent of how many nodes you add. The 4% overhead buys you full BFT consensus and quality verification. Each idle worker node costs $2.19/month. And CKB's cell model is the natural substrate for making this separation principle a first-class on-chain primitive.

---

## The Scaling Paradox

Here is the mental trap that has held back distributed AI:

A single AI assistant costs `T * U` in tokens -- the average cost per interaction times the number of users. Simple. Now replicate it across 3 nodes. If every node processes every message (full replication), the cost becomes `3 * T * U`. Ten nodes? `10 * T * U`. The cost scales with infrastructure, not demand.

This model is accurate for traditional BFT systems where every validator must process every transaction. If "processing" means "calling an LLM," then consensus literally requires N times the generative work. And that is why people assume distributed AI is economically infeasible.

The assumption is false because it conflates two fundamentally different types of work.

---

## The Separation Principle

Every operation in a distributed AI network falls into one of two categories:

### Intelligence Plane (requires LLM inference)

- Generating responses to user messages
- Processing user corrections into structured knowledge
- Self-reflective inner dialogue (periodic, not per-message)
- Pairwise response generation for quality verification (CRPC, selective)

### Coordination Plane (requires only deterministic computation)

- BFT consensus voting (JSON over HTTP)
- Knowledge chain epoch hashing (SHA-256)
- Heartbeat and health monitoring (HTTP pings)
- Request routing and sticky session management (in-memory hash table)
- Peer discovery and topology updates (HTTP GET)
- Failover detection and user reassignment (timers + HTTP)

The cost structures are fundamentally different:

| Property | Intelligence Plane | Coordination Plane |
|----------|-------------------|-------------------|
| **Cost driver** | LLM API tokens | CPU cycles |
| **Marginal cost** | $0.003-0.015/call | ~$0/call |
| **Scales with** | User count (demand) | Node count (infrastructure) |
| **Avoidable?** | No -- users need responses | Yes -- can be made near-free |
| **Duplicable?** | Must not duplicate | Can duplicate freely |

This distinction is the entire insight. If your coordination plane requires zero LLM inference, then adding nodes adds capacity without adding cost.

---

## The Proof

With sticky session routing, each user is assigned to exactly one shard. The assignment function is injective -- no user maps to multiple shards simultaneously. For any user message:

- Exactly one shard calls the LLM to generate a response.
- All other shards perform zero LLM work for that message.

Total token cost across all shards:

```
C_total = sum over all shards of (sum of T for each user on that shard)
        = sum over all users of T
        = T * U
```

The number of shards N does not appear in the expression. Coordination work (BFT voting, epoch hashing, heartbeats) runs across all N shards but costs zero tokens by construction -- it is pure HTTP and SHA-256 computation.

The one exception: CRPC (Commit-Reveal Pairwise Comparison), a quality verification protocol that deliberately crosses the boundary by having multiple shards independently generate responses to the same prompt. This activates on approximately 2% of messages. With N=3 shards:

```
C_blended = T * (1 + 0.02 * (3-1)) = T * 1.04
```

Four percent overhead for full Byzantine fault-tolerant quality consensus. That is the entire cost of distribution.

---

## The Architecture: How JARVIS Does It

The JARVIS Mind Network implements the separation principle through four subsystems:

### 1. Sticky Session Routing

When a message arrives for user `u`:
1. Check `userAssignments[u]` -- an in-memory hash table (O(1) lookup, zero tokens)
2. If assigned: route to the owning shard. **Only that shard calls the LLM.**
3. If unassigned: assign to the least-loaded shard by active user count
4. If assigned shard is unreachable (missed heartbeats): failover to next available shard

One user, one shard, one LLM call. No duplication.

### 2. Tendermint-Lite BFT Consensus

When a shard's local knowledge change needs to become global:

```
PROPOSE --> PREVOTE --> PRECOMMIT --> COMMIT
```

Every message in this protocol is a small JSON object:

```json
{
  "proposalId": "prop-1709312400-a3f7c912",
  "proposalHash": "sha256(...)",
  "vote": "accept",
  "shardId": "shard-1",
  "round": 42
}
```

Token cost of a full BFT round: **exactly zero**. No natural language generated, processed, or evaluated. The entire protocol is deterministic computation over structured data.

### 3. CRPC Quality Verification

Tim Cotton's protocol for achieving consensus over non-deterministic outputs. Four phases:

1. **Work Commit**: Each shard independently generates a response, publishes `hash(response || secret)`. Commit-reveal prevents copying.
2. **Work Reveal**: Shards reveal responses + secrets. Peers verify hashes match.
3. **Compare Commit**: Validators compare all pairs, commit `hash(choice || secret)`.
4. **Compare Reveal**: Validators reveal choices. Best response wins by pairwise majority.

Only Phase 1 costs tokens (N shards each generating one response). Phases 2-4 are reveals, comparisons, and tallies -- all deterministic.

Trigger rate: ~2% of messages (moderation, knowledge promotion, dispute resolution). This is the source of the 4% overhead.

### 4. Hash-Linked Knowledge Chain

Tamper-evident, ordered history of all network knowledge mutations:

```json
{
  "epoch": 147,
  "parentHash": "sha256(epoch_146)",
  "mutations": [
    { "type": "skill_added", "data": { "..." } },
    { "type": "behavior_updated", "data": { "..." } }
  ],
  "proposer": "shard-0",
  "hash": "sha256(epoch + parentHash + mutations)"
}
```

Token cost per epoch: **exactly zero**. SHA-256 and JSON serialization.

---

## The Numbers

Scaling table from the live system:

| Shards (N) | Users (U) | Total Monthly | Cost/User |
|------------|-----------|---------------|-----------|
| 1 | 50 | $18.50 | $0.37 |
| 3 | 150 | $57.30 | $0.38 |
| 10 | 500 | $191.00 | $0.38 |
| 100 | 5,000 | $1,910.00 | $0.38 |

Cost per user is flat at $0.38/month across all network sizes. Each idle worker shard costs just $2.19/month (Fly.io compute + storage + minimal inner dialogue tokens). Under three dollars to add a fault-tolerant node.

### Comparison of Approaches

| Approach | Token Cost | Fault Tolerance | Consensus | Statefulness | Knowledge Sync |
|----------|-----------|-----------------|-----------|-------------|---------------|
| Single instance | T * U | None | N/A | Yes | N/A |
| Naive replication | N * T * U | Yes | Yes (expensive) | Yes | Yes (expensive) |
| Stateless load balancer | T * U | Partial | None | No | None |
| **JARVIS (this paper)** | **T * U * 1.04** | **Yes (BFT)** | **Yes (free)** | **Yes (sticky)** | **Yes (free)** |

The JARVIS architecture achieves the properties of naive replication at 1.04x the cost of a single instance, rather than Nx.

---

## The Knowledge Primitive

The result distills to a single principle:

> **Intelligence and coordination are separate planes with separate cost functions. Thinking scales with demand (unavoidable). Coordinating scales with infrastructure (avoidable). Never pay intelligence costs for coordination work.**

This applies far beyond the JARVIS architecture. Any system using LLM inference can ask: *Is this call generating intelligence, or is it performing coordination?* If the latter, it can almost certainly be replaced with deterministic computation.

### The Design Heuristic

For every proposed LLM call in a distributed AI system:

1. **Does this call produce output for a human user?** Intelligence-plane. Pay the tokens.
2. **Does this call make a decision that could be expressed as a Boolean, enum, or structured comparison?** Coordination-plane. Replace with deterministic logic.
3. **Does this call verify or compare outputs?** Consider CRPC-style selective verification.

If your system has more coordination-plane LLM calls than intelligence-plane calls, you have a design problem, not a scaling problem.

---

## The CKB Substrate Analysis: Why Cells Are Natural for Plane Separation

CKB's architecture maps remarkably well onto the separation principle. Here is how:

### Shard State as Cells

Each shard's state -- its user assignments, knowledge version, consensus round -- can be represented as a cell:

```
Shard State Cell {
    capacity: minimum CKBytes
    data: {
        shard_id,
        assigned_users: [user_lock_hashes],
        knowledge_epoch: u64,
        consensus_round: u64,
        heartbeat_timestamp: u64
    }
    type_script: ShardRegistry type script
    lock_script: shard operator's lock
}
```

Each cell is independently verifiable. An indexer can query all shard states without loading the entire network topology. This is coordination-plane infrastructure -- pure data, zero inference.

### Knowledge Epochs as Cell Chains

The knowledge chain maps directly to CKB's cell consumption model:

```
Knowledge Epoch Cell (n) {
    capacity: CKBytes
    data: {
        epoch: n,
        parent_hash: sha256(epoch_n-1),
        mutations: [...],
        proposer: shard_id
    }
    type_script: KnowledgeChain type script (enforces hash chain)
    lock_script: multisig (2-of-3 shards)
}
```

The type script enforces hash chain integrity: the new cell's `parent_hash` must equal `sha256(data)` of the consumed cell. No contract calls. No gas-bounded loops. Just verification of a hash link.

### CRPC on CKB: Commit-Reveal with Cell Consumption

CKB's cell model is a natural fit for CRPC's commit-reveal pattern:

**Phase 1 -- Commit**: Each shard creates a Commit Cell containing `hash(response || secret)`. The type script enforces that the cell cannot be consumed (revealed) until the commit phase ends (via CKB's `Since` field for relative timelocks).

**Phase 2 -- Reveal**: Shards consume their Commit Cells and create Reveal Cells containing the plaintext response + secret. The type script verifies that `hash(response || secret)` matches the committed hash from the consumed cell.

This is the same commit-reveal structure VibeSwap uses for batch auctions. The pattern is reusable across mechanisms.

### Off-Chain Compute, On-Chain Verify

The separation principle aligns with CKB's computational philosophy:

- **Intelligence plane**: Entirely off-chain. LLM inference happens on shard infrastructure, never touches the chain.
- **Coordination plane**: Computed off-chain, verified on-chain. BFT votes, knowledge epochs, CRPC rounds -- all produce deterministic results that CKB type scripts can verify cheaply.

This means the chain never pays for intelligence. It only verifies coordination outputs. The on-chain footprint is minimal: cell creations and consumptions for state transitions, with type scripts enforcing invariants.

### Economic Alignment and Multi-Agent Implications

CKB's state rent model creates an interesting economic pressure: shard operators pay CKBytes for the cells they occupy. But coordination cells are small (a few hundred bytes each) and the cost is negligible compared to LLM token costs. The expensive work (intelligence) stays off-chain. The cheap work (coordination) goes on-chain. Incentives align perfectly.

This extends beyond JARVIS. Current multi-agent frameworks (AutoGPT, CrewAI, MetaGPT) use LLM calls for inter-agent communication -- paying full token costs for coordination work. A CKB-based coordination layer could provide cell-based task routing, hash-linked agent memory, BFT consensus for decisions, and CRPC for high-stakes outputs -- all at zero token cost. The token cost remains `T * U * (1 + small overhead)` regardless of how many agents are in the network.

---

## Discussion Questions

1. **Does the separation principle apply to your AI architecture?** If you are running multi-agent systems, chatbots, or AI-powered dApps -- how much of your token spend is actually coordination (structured decisions, routing, status checks) masquerading as intelligence? What percentage of your LLM calls could be replaced with deterministic computation?

2. **CKB as a multi-agent coordination layer?** The cell model naturally separates state into independently verifiable units. Type scripts enforce coordination invariants cheaply. Could CKB become the coordination backbone for distributed AI networks, handling the zero-token-cost plane while agents run off-chain?

3. **What is the right CRPC activation rate?** The paper uses 2% based on empirical data. How would you tune this for different contexts -- high-trust communities vs. anonymous public channels? Should the rate be governed by on-chain parameters that token holders vote on?

4. **Is $2.19/month per node too cheap?** If anyone can add a node for under $3/month, what prevents low-quality or malicious nodes from flooding the network? The paper relies on BFT consensus (Byzantine tolerance of floor((N-1)/3)), but is that sufficient at very large N?

5. **How does this interact with CKB's state rent?** Coordination cells are small and cheap, but a network with thousands of shards would create many cells. Is there a point where CKB state rent becomes a meaningful cost? Or does the per-cell cost remain negligible relative to the intelligence-plane savings?

The full formal paper is available: `docs/papers/near-zero-token-scaling.md`

---

*"Fairness Above All."*
*-- P-000, VibeSwap Protocol*

*Full paper: [near-zero-token-scaling.md](https://github.com/wglynn/vibeswap/blob/master/docs/papers/near-zero-token-scaling.md)*
*Code: [github.com/wglynn/vibeswap](https://github.com/wglynn/vibeswap)*
