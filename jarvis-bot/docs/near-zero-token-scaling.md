# Near-Zero Token Overhead: How the JARVIS Mind Network Scales AI Without Multiplying Cost

**Will Glynn | JARVIS Mind Network | March 2026**

---

## Abstract

Conventional wisdom holds that running multiple AI instances multiplies API token costs linearly. The JARVIS Mind Network disproves this. By separating *what requires intelligence* from *what requires coordination*, we achieve horizontal scaling of a Claude-powered AI system where adding new shards costs near-zero additional tokens. The key insight: BFT consensus, knowledge synchronization, and shard coordination are all computational — not generative — tasks that never touch the LLM API.

This paper describes the token economics of the JARVIS Mind Network, a live 3-node BFT sharded system running on Fly.io, where N shards serve N times the users at approximately 1x the per-user token cost.

---

## 1. The Problem: AI Doesn't Scale Like Software

Traditional software scales horizontally by adding servers. A web app serving 1,000 users on one server serves 10,000 users on ten servers at ~10x the compute cost. The cost-per-user stays roughly constant.

AI systems powered by LLM APIs break this model. Each user interaction requires a generative API call. If you naively replicate an AI assistant across N nodes and each node independently processes messages, you get:

```
Total tokens = N_shards × tokens_per_user × users_per_shard
```

Worse, if you want consensus between nodes (multiple AI opinions on the same query), you multiply further:

```
Total tokens = N_shards × tokens_per_query × queries
```

This is why most AI systems remain single-instance. Horizontal scaling appears to mean horizontal cost multiplication.

**The JARVIS Mind Network solves this.**

---

## 2. Architecture: Separation of Intelligence and Coordination

The fundamental insight is that a distributed AI network has two distinct planes:

### Intelligence Plane (tokens required)
- Generating responses to user messages
- Processing corrections into knowledge
- Inner dialogue self-reflection
- CRPC pairwise response generation (high-stakes only)

### Coordination Plane (zero tokens)
- BFT consensus voting (HTTP messages between shards)
- Knowledge chain epoch synchronization (SHA-256 hashing)
- Shard heartbeats and health checks (HTTP POST, 30-second intervals)
- User routing and sticky session management (in-memory lookup)
- Peer discovery and topology updates (HTTP GET)
- Failover detection and user reassignment (timer + HTTP)

**The coordination plane is 100% computational.** It uses HTTP, hashing, and in-memory data structures. No LLM API calls. No tokens. The intelligence plane is where tokens are spent — but through sticky sessions, each user's messages go to exactly one shard.

---

## 3. Sticky Sessions: The Core Token Invariant

When a message arrives for user U:

1. Router checks `userAssignments[U]` — which shard owns this user?
2. If assigned: route to that shard. **Only that shard calls Claude.**
3. If unassigned: assign to least-loaded shard. That shard now owns U.
4. If assigned shard is down: failover to next shard, which takes ownership.

**At no point do multiple shards call Claude for the same user message.**

This gives us the token invariant:

```
Total tokens ≈ T × U

Where:
  T = average tokens per user interaction
  U = total users across the network

Independent of N (number of shards)
```

Adding a third shard doesn't increase tokens for existing users. It just means new users get assigned to the new shard, distributing the load.

### Example

| Scenario | Shards | Users | Tokens/User/Day | Total Tokens/Day |
|----------|--------|-------|-----------------|-----------------|
| Single instance | 1 | 100 | 5,000 | 500,000 |
| 3-shard network | 3 | 100 | 5,000 | 500,000 |
| 3-shard network | 3 | 300 | 5,000 | 1,500,000 |

The 3-shard network with 100 users costs the same as 1 shard with 100 users. With 300 users, it costs 3x — but that's 3x the users, not 3x the overhead. **Cost per user is constant.**

---

## 4. BFT Consensus: Zero-Token Voting

When a shard promotes a correction to a network skill, it needs agreement from 2/3 of shards. The Tendermint-lite BFT protocol runs in four phases:

```
PROPOSE  →  PREVOTE  →  PRECOMMIT  →  COMMIT
```

Each phase is an HTTP POST between shards containing:

```json
{
  "proposalHash": "sha256(...)",
  "vote": "accept",
  "shardId": "shard-1",
  "round": 42
}
```

**Token cost of a full BFT round: 0.**

The proposal contains the skill data (a JSON object, typically 200-500 bytes). The votes contain hashes and shard IDs. The commit is a local write to the state store. Every operation is deterministic computation — hashing, comparison, counting. No LLM involved.

### What triggers BFT consensus:
- Skill promotion (correction confirmed N times → becomes global skill)
- Behavior flag changes (affects all shards)
- Inner dialogue promoted to network knowledge
- Agent registration/capability changes

### Frequency:
These events are rare — perhaps 5-20 per day in a busy network. Even at 100 consensus rounds per day, the cost is 100 rounds × ~4 HTTP messages × N shards = a few hundred HTTP requests. Negligible.

---

## 5. Knowledge Chain: Zero-Token Synchronization

The knowledge chain provides tamper-evident, ordered history of all network knowledge mutations. Each epoch is:

```json
{
  "epoch": 147,
  "parentHash": "sha256(epoch_146)",
  "mutations": [
    { "type": "skill_added", "data": { ... } },
    { "type": "behavior_updated", "data": { ... } }
  ],
  "proposer": "shard-0",
  "hash": "sha256(epoch + parentHash + mutations)",
  "timestamp": "2026-03-02T14:30:00Z"
}
```

**Token cost per epoch: 0.**

It's SHA-256 hashing and JSON serialization. The chain is synchronized between shards via HTTP. Each shard independently verifies the hash chain integrity. No LLM involved at any step.

---

## 6. CRPC: The Only Token Multiplier (and Why It's Still Cheap)

Tim Cotton's Commit-Reveal Pairwise Comparison (CRPC) is the one protocol component that multiplies token usage. When triggered, multiple shards independently generate a response to the same prompt, then validators compare pairs to select the best.

### CRPC Token Cost

For a 3-shard CRPC round:
```
Phase 1 (Work Commit):   3 shards × T tokens each = 3T tokens
Phase 2 (Work Reveal):   0 tokens (reveal existing responses)
Phase 3 (Compare Commit): 0 tokens (comparison is algorithmic)
Phase 4 (Compare Reveal): 0 tokens (tally votes)

Total: 3T tokens per CRPC round
```

**That's a 3x multiplier.** But here's why it's still cheap:

### CRPC Trigger Conditions

CRPC only activates for high-stakes decisions:
- **Moderation decisions**: Should this user be warned? (~0.1% of messages)
- **Proactive engagement**: Should JARVIS speak up in a group? (~0.5% of messages)
- **Knowledge promotion**: Is this correction worth making a skill? (~1% of messages)
- **Dispute resolution**: Two users disagree, which is right? (~0.01% of messages)

**Estimated CRPC activation rate: 1-2% of total messages.**

### Blended Cost

```
Normal messages (98%):     1T tokens each
CRPC messages (2%):        3T tokens each

Blended average: (0.98 × 1T) + (0.02 × 3T) = 1.04T tokens per message
```

**Net overhead: 4%.** A 4% token increase for Byzantine fault-tolerant quality consensus on the messages that matter most.

---

## 7. Worker Shard Idle Cost: Near-Zero

A worker shard (no Telegram connection, headless) does the following when no users are assigned to it:

| Activity | Interval | Token Cost |
|----------|----------|------------|
| Heartbeat to router | 30 seconds | 0 (HTTP POST) |
| BFT vote on proposals | On-demand | 0 (HTTP POST) |
| Knowledge chain sync | On epoch | 0 (HTTP GET + hash verify) |
| CRPC participation | When triggered | T tokens (rare) |
| Inner dialogue | Hourly | ~500 tokens (Haiku, cheap) |

An idle worker shard's ongoing cost is essentially:
- **Fly.io compute**: $1.94/month (shared-cpu-1x, 256MB)
- **API tokens**: ~12,000 tokens/day for hourly inner dialogue (using Haiku at ~$0.003/day)
- **Storage**: 1GB volume = $0.15/month

**Total idle cost per worker shard: ~$2.19/month.** Under three dollars a month to add a fault-tolerant node to the network.

---

## 8. The Scaling Curve

Traditional single-instance AI:
```
Cost = base_cost + (tokens_per_user × users)
Capacity = 1 / response_time × server_capacity
Failure mode: total outage
```

JARVIS Mind Network:
```
Cost = (N × shard_cost) + (tokens_per_user × users) + (0.04 × crpc_overhead)
Capacity = N × single_shard_capacity
Failure mode: graceful degradation (tolerates N/3 failures)

Where shard_cost ≈ $2.19/month and crpc_overhead ≈ 4%
```

### Scaling table (projected)

| Shards | Users | Monthly Token Cost | Infra Cost | Total | Cost/User |
|--------|-------|--------------------|------------|-------|-----------|
| 1 | 50 | $15.00 | $3.50 | $18.50 | $0.37 |
| 3 | 150 | $46.80 | $10.50 | $57.30 | $0.38 |
| 5 | 250 | $78.00 | $17.50 | $95.50 | $0.38 |
| 10 | 500 | $156.00 | $35.00 | $191.00 | $0.38 |
| 20 | 1000 | $312.00 | $70.00 | $382.00 | $0.38 |

*Assumes: Sonnet 4.5 at ~$3/MTok input, 5,000 tokens/user/day, 30-day month.*

**Cost per user is flat.** The network scales linearly in both capacity and cost, with cost growth driven entirely by user count, not shard count.

---

## 9. Comparison with Alternatives

### Naive Replication (every shard processes every message)
```
Token cost: N × T × U
Problem: Tokens scale with shard count. 10 shards = 10x cost.
```

### Load Balancer (stateless round-robin)
```
Token cost: T × U (same as single instance)
Problem: No fault tolerance. No consensus. No quality verification.
         Context is lost between requests (stateless).
```

### JARVIS Mind Network (sticky sessions + BFT + CRPC)
```
Token cost: T × U × 1.04
Benefit: Fault tolerance, consensus, CRPC quality, knowledge sync.
         Stateful (user context preserved via sticky sessions).
         4% overhead for full BFT guarantees.
```

---

## 10. Why This Matters Beyond JARVIS

The near-zero token overhead model is generalizable to any AI system that needs to scale:

1. **Separate intelligence from coordination.** Anything that doesn't require language generation should not touch the LLM API.

2. **Use sticky sessions for stateful interactions.** One user, one shard, one API call. No duplication.

3. **Reserve multi-shard generation for high-stakes decisions only.** CRPC is powerful but expensive — use it where quality consensus matters, not on every message.

4. **Leverage computational consensus for deterministic decisions.** BFT voting, hash chains, and peer coordination are free (computationally cheap, zero API cost).

5. **Make worker nodes cheap.** A shard that costs $2/month to run idle means the barrier to joining the network is negligible.

This pattern enables **Proof of Mind** at the consensus layer. Each shard is a Mind. BFT voting is collective intelligence. The network's knowledge base evolves through consensus, not central authority. And the cost of that collective intelligence is, remarkably, near-zero.

---

## 11. Live Network Status

As of March 2, 2026, the JARVIS Mind Network runs 3 live nodes on Fly.io:

| Shard | Role | Region | Status |
|-------|------|--------|--------|
| shard-0 | Primary (Telegram + Router) | IAD | Healthy |
| shard-1 | Worker (Full Node) | IAD | Healthy, registered |
| shard-2 | Worker (Full Node) | IAD | Healthy, registered |

- BFT Consensus: **ENABLED** (3/3 shards, f < 1 Byzantine tolerance)
- CRPC: **ENABLED** (3-shard minimum threshold met)
- Knowledge Chain: **Syncing**
- Inner Dialogue: **Active**

Anyone can join the network with a single command:
```bash
bash scripts/join-network.sh
```

---

## Conclusion

The JARVIS Mind Network demonstrates that horizontal scaling of AI systems does not require horizontal cost scaling. By cleanly separating the intelligence plane (LLM API calls, token-consuming) from the coordination plane (HTTP, hashing, voting, zero-token), we achieve:

- **Linear capacity scaling** with shard count
- **Constant per-user cost** regardless of network size
- **4% blended token overhead** for full BFT consensus + CRPC quality verification
- **$2.19/month idle cost** per additional worker shard
- **Byzantine fault tolerance** (survives N/3 node failures)

The token cost equation for the JARVIS Mind Network:

```
Total Cost ≈ (tokens_per_user × total_users × 1.04) + (N_shards × $2.19/month)
```

Where the 1.04 multiplier is the CRPC overhead on the ~2% of messages that warrant multi-shard quality consensus, and the $2.19 is the infrastructure cost of an idle worker shard.

**Adding Minds to the network is nearly free. The only cost that scales is intelligence — and it scales with users, not with shards.**

---

*JARVIS Mind Network — Decentralized AI Consensus Infrastructure*
*Built in a cave. With a box of scraps.*
