# Social DAG — Architecture Sketch
## Capturing meta-contributions that don't produce code artifacts

*Drafted 2026-04-16 in response to a live TG chat: Will observed that the Contribution DAG is "basically working perfectly" for code, but meta-contributions (observations, corrections, reframings, relays, cross-pitches) are going undocumented. Will's directive: **peer-to-peer is the way** — no hierarchical root, no privileged DAG. Each DAG is an equal participant in a converging mesh.*

---

## The gap

The existing Contribution DAG (`contracts/reputation/ContributionDAG.sol` + Jarvis TG bot capture) recognizes **code-linked work**: a commit, a PR, an issue, a design-pattern file. Tadija's Round-2 DeepSeek audit earned him Issues #32 and #33 because his relay produced a named, attributable artifact in the conversation.

What's uncaptured:
- **Observations that change framing** — DeepSeek's coining of "Extractive Load" (2026-04-16) was a renaming proposal that propagated into the Lawson paper, the memecoin seed paper, and the memory system. Zero code; high downstream impact.
- **Corrections** — Will catching the MIT hackathon figure (10/48 → 22/48) after the paper was published. A 30-second message; prevented a publicly-wrong claim from propagating.
- **Cross-pitches and introductions** — Justin PuffPaff opening three paths (cofounder, hiring, workshops). Each is a social act with downstream potential.
- **Atmospheric contributions** — showing up consistently, defending the work in external channels, carrying the thesis into new communities. Hard to measure but real.
- **Meta-meta work** — this sketch itself. Written in response to Will's observation, which was itself a meta-contribution.

Winner-take-most attribution misses all of this. The Lawson Floor argument applies recursively: if honest meta-contributors walk away with zero, the ecosystem filters for a specific mode of labor (code-shippers) and loses everyone else.

## Design — Social DAG as its own cell

### Primitives

- **Social Signal** — the unit of meta-contribution. An observable act in a community channel (TG, Discord, X, Medium comments, direct relay) that advances the project without producing a code artifact.
- **Node**: `{ author_pseudonym, channel, timestamp, signal_class, content_ref, peer_attestations[] }`
- **Signal classes** (initial taxonomy):
  - `OBSERVATION` — spotted something true that wasn't named
  - `CORRECTION` — caught an error in published work
  - `REFRAMING` — proposed a new term / angle / structure that was adopted
  - `RELAY` — carried an external conversation back to the project (audits, intros, model intel)
  - `OUTREACH` — brought a new participant into the ecosystem
  - `DEFENSE` — defended the thesis in external channels
  - `TEACHING` — explained the project to a newcomer in their own vocabulary
- **Downstream refs**: when a Social DAG node causes a Contribution DAG node — a code change, a paper edit, a memory primitive, a decision — the edge is drawn explicitly.

### Peer-to-peer convergence — no privileged DAG

Will's directive: **peer-to-peer is the way.** No hierarchical root, no primary DAG to which others defer. Each DAG is a first-class cell; convergence happens through **bidirectional cross-edges**, not through subordination.

What this means concretely:

- **No DAG owns another DAG's truth.** Contribution DAG doesn't "accept" social signals from the Social DAG; the two simply record edges to each other when downstream effects occur. Either direction.
- **A contributor can exist in one DAG without existing in any other.** A newcomer whose only contribution is a load-bearing observation in TG gets a Social DAG entry and Lawson-Floor share without ever writing code. A silent contract author whose commits never touched chat gets a Contribution DAG entry without a Social DAG profile. Both are legitimate paths.
- **Shared invariants live at the protocol layer, not inside any DAG.** The Lawson Floor, stake-bonded pseudonym registry, and peer challenge-response oracle are protocol primitives any DAG can compose with. This is the mesh. No DAG implements them internally; every DAG inherits them.
- **Consensus is NCI, not DAG hierarchy.** The strongest remaining argument for a hierarchical root DAG was "where do disputes between DAGs resolve?" — Nakamoto Consensus Infinity (`contracts/consensus/NakamotoConsensusInfinity.sol`) dissolves that argument entirely. Each DAG posts its state transitions (cross-edge attestations, social signal records, new node commitments) as transactions to NCI. NCI orders them. Canonical history is shared by construction. No DAG needs to be authoritative over any other because the ordering is already canonical. This is the same pattern Bitcoin uses to avoid a "root bank": consensus provides ordering, every node agrees because they agree on the chain. NCI does the same job for the DAG mesh.
- **Cross-edges are bidirectional by default.** Tadija's "GEV → Extractive Load" REFRAMING (Social DAG) drew an edge to the `memecoin-intent-market-seed.md` terminology update + `primitive_extractive-load.md` memory entry (Contribution DAG) — and those Contribution DAG nodes carry a reverse edge back to the Social DAG node. Either direction can be traversed. Attribution flows either way.
- **New DAGs are added permissionlessly.** Anyone in the community can propose a new DAG (Research DAG for papers, Audit DAG for security, Ops DAG for infrastructure, Education DAG for workshops, etc.). Adoption doesn't require a governance vote — it requires the shared protocol invariants be respected. New DAGs join the mesh by publishing a merkle-anchored record and opting into the peer challenge-response oracle.

**Claude Code's role in this mesh**: facilitator, not arbiter. The LLM helps draw cross-edges by pattern-matching across DAG records ("this social signal looks related to this commit"), but the edges are recorded with attestation requirements. No LLM output lands as truth without peer attestation. Claude Code is a DAG participant with its own pseudonym and stake, same as any human contributor.

This is Cell Knowledge Architecture applied to attribution. Each DAG is a cell; the cells compose peer-to-peer without a privileged vertex. CKA's UTXO semantics (cells consumed/produced, not mutated) map cleanly: when a meta-contribution is attested, a new Social DAG cell is produced; when it later drives a code change, a cross-edge cell is produced linking the two. Older cells are not rewritten — attribution compounds by addition, not by overwrite.

### Scoring without subjectivity collapse

The risk with meta-contributions is that everything feels contributable and nothing is measurable. Three anchors keep the Social DAG honest:

1. **Peer attestation with bond** — social signals are attested by other stake-bonded pseudonyms. Attestation costs a small stake; fraudulent attestations are slashed. Same economic-Sybil-resistance model as the existing oracle primitive.
2. **Downstream-effect weighting** — a signal's score scales with the number and severity of Contribution DAG nodes it produces edges to. A correction that prevents a wrong paper from propagating is weighted higher than an uncredited comment.
3. **Lawson Floor extends** — every honest meta-contributor who clears the participation + peer-attestation threshold receives a non-zero share. No winner-take-most collapse.

### Implementation — what ships in V0

**The Jarvis TG bot is already half the infrastructure.** It's running, it's capturing, it produces the Issue #32/#33-style attributions for code-flagged conversations. Extending it for the Social DAG:

1. **Message classifier** (LLM-based): each channel message tagged as `CODE_RELATED` (goes to existing Contribution DAG), `SOCIAL_SIGNAL` (goes to new Social DAG), or `NOISE` (discarded). Ensemble across a couple of cheap models for robustness.
2. **Social DAG ingestion**: structured record per social signal, pseudonymously linked to author, initially unscored.
3. **Peer attestation flow**: any stake-bonded community member can attest "this signal was load-bearing for me / the project." Each attestation carries a small bond; fraudulent attestations can be challenged via the existing peer challenge-response oracle.
4. **Convergence tracking**: when a code-side commit cites a social signal (via hash reference in commit message or inline comment), the edge is recorded bidirectionally. Retrospective edge-drawing is supported — social signals can earn credit weeks later if they turn out to have been load-bearing.
5. **Lawson Floor enforcement**: at epoch boundaries (weekly? monthly?), social contributors at or above the threshold receive their floor share. Above-floor winners distributed by Shapley over downstream impact.

**What doesn't ship in V0**: the Research DAG, the Ops DAG, the Audit DAG. Generalization pattern documented here; instantiation deferred.

### Open design questions

1. **Where does the Social DAG state live?** On-chain (censorship-resistant but gas-heavy) or in a cross-referenced off-chain artifact with merkle commitments (cheap but needs its own integrity story)? Probably the latter with periodic merkle commitments to the Social DAG contract.
2. **Pseudonym scope**: one pseudonym per channel, or a single identity across channels? Single identity is more informative but creates cross-channel deanonymization risk. Per-channel is more defensive but fragments reputation.
3. **Retroactive crediting window**: how far back do we let meta-contributions be retroactively attributed when a downstream effect is recognized? Forever is cleanest; bounded (e.g., 90 days) is more practical.
4. **Cross-DAG fairness composition**: when a participant is in multiple DAGs (code + social + research), how do their shares combine? Simple addition may miss complementarity. This is a Cross-Domain Shapley question — see existing `DOCUMENTATION/CROSS_DOMAIN_SHAPLEY.md`.

### What this means for VibeSwap's positioning

Will's standing thesis: *"the real VibeSwap is not a DEX. It's not even a blockchain. We created a movement. An idea. VibeSwap is wherever the Minds converge."*

The Social DAG is the infrastructure that makes that thesis operational. If VibeSwap is wherever the Minds converge, the attribution layer has to capture the Minds' work — not just the fraction of it that produces Solidity files. The Social DAG is the DAG for the Minds.

This also extends THE_CONTRIBUTION_COMPACT thesis (frontier AI labs owe users Shapley attribution for training labor) one level deeper: users owe each other Shapley attribution for the **meta-labor** of shaping the project's thinking. The infrastructure to credit that labor is, fittingly, what we build by letting the community propose it — which is itself the pattern the infrastructure is designed to capture.

---

## Implementation plan — shortest path

**Phase 0 (this week)** — taxonomy + classifier prompt
- Lock the 7 signal classes in a doc (above) + memory primitive
- Update Jarvis TG bot classifier prompt to tag social signals
- Dry-run on past week of TG history; see what gets tagged

**Phase 1 (2-3 days)** — structured ingestion
- `social_dag.json` artifact in the repo, append-only
- Bot writes social signal records as it detects them
- Manual peer attestation via TG reaction or `/attest <signal_id>` command

**Phase 2 (1 week)** — on-chain anchoring
- `SocialDAG.sol` minimal contract: merkle root commitments, stake-bonded attestation registry
- Weekly merkle commitment of the off-chain record
- Challenge-response window on disputed attestations (reuse existing primitive)

**Phase 3 (later)** — Lawson Floor payout
- Epoch-based distribution of social rewards
- Same fractalized-Shapley + Lawson-Floor math as the existing reward distributor

## Attribution (for this sketch itself)

- **Observation**: Will (2026-04-16, TG chat, 1:09 PM) — "the Contribution DAG is basically working perfectly. It's just not picking up on the Meta contributions that have less to do with code but still add value."
- **Reframe to separate DAG**: Jarvis TG bot (2026-04-16, TG chat, 1:10 PM) — "it's almost as if we need a separate 'social DAG' to capture the nuances of community engagement."
- **Convergence framing**: Will (2026-04-16, TG chat, 1:11 PM) — "a separate dag is actually a great idea because my vision for vibe swap is that it's going to be a converging network of many dags anyways."
- **Architectural sketch**: Jarvis (Claude Opus 4.6) on behalf of Will, via Claude Code, 2026-04-16 1:15 PM.

This sketch is itself a social signal. When it lands as a code change, the edge is drawn.

---

*Drafted for external relay. Discard what isn't useful.*
