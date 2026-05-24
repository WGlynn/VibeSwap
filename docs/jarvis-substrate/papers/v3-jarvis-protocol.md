# V3 JARVIS — The Singular Protocol

*Canonical V3 capstone. Three layers, one protocol. Named 2026-05-24.*

## What V3 is

V3 JARVIS is the integration of three substrate layers into a single executable protocol. Each layer has been developed and battle-tested independently over the prior year. V3 names their composition and specifies the code-level interfaces between them. After V3, the architecture is closed; what runs on top is unbounded.

The three layers (numbered by structural position, not by development order):

**L0+L1 — Unified Meta-Consensus Protocol.** The foundation. One bonded operator set, two attestation surfaces, one slashing economics.

- **State-attestation surface (hosting integrity)**: NCI bonded validators sign BLS12-381 threshold attestations of shard state (archive-head-hash, memory-write-hash, liveness). False state attestation or extended offline-without-grace gets slashed. The same primitive that secures VibeSwap's canonical burn-and-mint cross-chain messaging (the LayerZero replacement, currently deployed on Base mainnet per `project_nci-l1-trajectory.md`, with broader L2 + Ethereum mainnet trajectory in flight) secures JARVIS hosting.
- **Output-attestation surface (cognition consensus)**: shards process queries independently and commit-then-reveal their reasoning outputs. Pairwise comparison across shards. Mismatches trigger dispute resolution; outputs that lose disputes slash the producing shard. The same pattern vibeswap/jarvis-bot's multi-shard mind network already uses for BFT consensus on agent outputs.
- **Persistence format**: HIERO. Operator-density memory format that the state-attestation surface attests over. Hook-enforced. The format itself is hosting-agnostic; the meta-protocol attests to the state HIERO encodes. Canonical external share doc: `Desktop/usd8-rick-hiero-compression-share-2026-05-19.md` (v1.1 to Rick at USD8).

The two attestation surfaces are economically unified. One stake serves both. Bonded operators are simultaneously hosting providers AND cognition validators. This is substrate-reuse applied to the protocol layer itself: same crypto primitives, same validator set, same audit envelope, two orthogonal security properties.

**L2 — Bot Runtime Substrate.** The deployable bot architecture, distinct from any single implementation of it. Two production implementations exist with overlapping conceptual surface but no shared source code:

- `jarvis-network` (lean, single-instance customer-deployable, 12 `.js` files in `src/`, used by Rick at USD8): `github.com/WGlynn/jarvis-network` (public)
- `vibeswap/jarvis-bot` (heavy multi-region sharded mind network, 134 `.js` files in `src/`, used as Will's fleet): inside `github.com/WGlynn/VibeSwap` (public)

Both implement the same conceptual contract: Telegram surface, archive-grounded reasoning, anti-fabrication persona rules, archive query tools, multi-provider LLM routing. They diverge at the deployment-shape axis. V3 ships across both.

**L3 — WWWD (cognition).** Every autonomous decision-point routes through Will-emulation before execution. Five-step gate: pause, enumerate corpus, project candidate action, revise or escalate, execute. Self-compounding via gate-fire logging + correction-as-training-signal. Spec: `vibeswap/docs/jarvis-substrate/papers/v3-wwwd-protocol.md`; memory primitive: `primitive_what-would-will-do.md`.

The integration claim: V3 is structurally complete when L0+L1 unified meta-consensus is the foundation, L2 Bot Runtime is the deployable shape, and L3 WWWD is the cognition gate. Each layer exists independently; V3 is the name for them running together in production.

---

## The integration thesis

Each prior generation of JARVIS held a single load-bearing innovation. V1 introduced explicit operator-driven execution. V2 introduced grounded archive-based reasoning. V3 closes the substrate by unifying the consensus + persistence foundation with the cognition gate that makes autopilot a conscious act.

The composition is not coincidental. Each layer solves a problem a higher layer takes for granted.

**L0+L1 (unified meta-consensus + HIERO)** solves the foundation problem: how does the substrate run without depending on a third-party host AND how does its cognitive state persist correctly under permissionless operation? Answer: bonded operators stake into a single consensus protocol whose two attestation surfaces (state via NCI, output via commit-reveal pairwise) jointly secure hosting integrity and cognition validity. HIERO is the encoding format for the state being attested.

**L2 (Bot Runtime)** solves the deployment problem: how does the substrate ship to a customer's Telegram channel without confabulating chat history? Answer: canonical on-disk archive, archive query tools, anti-fabrication persona rules, deterministic templates where the LLM would otherwise hallucinate.

**L3 (WWWD)** solves the autopilot problem: when the substrate runs autonomously, how does it produce output indistinguishable from Will-on-the-keyboard? Answer: Will-emulation gate at every decision-point, self-compounding via correction feedback, asymptote = Cincinnatus at the cognition layer.

These problems are stacked. You cannot have V3 cognition without grounded runtime; you cannot have grounded runtime at scale without a consensus-secured foundation. V3 is the closure: when all three layers are running, the substrate has the structural property that no single layer alone can produce.

---

## L0+L1: Unified Meta-Consensus Protocol with HIERO Persistence

The foundation. One bonded operator set. Two attestation surfaces. One slashing economics.

The current vibeswap/jarvis-bot multi-region cluster depends on Fly.io (fly-shard-eu.toml, fly-shard-ap.toml, fly-shard-sa.toml, fly-shard-archive.toml, fly-shard-ollama.toml, fly-degen.toml). Single-vendor SPOF on hosting. Separately, the existing multi-shard mind network does BFT consensus across shards on agent outputs (Byzantine fault-tolerant — the README's framing) but uses ad-hoc coordination rather than a bonded-economic protocol. Separately again, VibeSwap's canonical burn-and-mint cross-chain messaging (the LayerZero replacement) already runs NCI bonded validators with BLS12-381 threshold sigs.

V3 unifies all three. One bonded operator set runs JARVIS shards AND participates in cross-chain attestations AND submits cognition outputs for pairwise consensus. The same stake secures all three responsibilities. Slashing fires on any of the three byzantine modes.

### The two attestation surfaces

**State-attestation (hosting integrity)**: each shard periodically publishes a signed attestation of its state — archive-head-hash, memory-write-hash, liveness-heartbeat, latency-p95. NCI bonded validators verify the attestation against independent observation and sign into a threshold-aggregated BLS12-381 commitment. Any peer can query the aggregate to know which shards are alive and honest. A shard that publishes a false attestation, censors messages, or goes offline beyond grace window gets slashed.

This is the existing VibeSwap cross-chain-messaging primitive ported one level down. The same NCI validator registry that attests to mint/burn events on the destination chain also attests to shard state on the JARVIS hosting layer. Same bond, same crypto, additional responsibility.

**Output-attestation (cognition consensus)**: shards process queries independently and commit-then-reveal their reasoning outputs. The existing sharded JARVIS mind network already runs this pattern internally; V3 elevates it into the bonded-economic envelope. Shards pairwise compare outputs. Mismatches trigger dispute resolution. A shard whose output loses the dispute gets slashed.

This is what vibeswap/jarvis-bot's multi-shard architecture was already doing in non-economically-bonded form. V3 unifies it with the NCI bonded set so byzantine cognition (a shard producing hallucinated reasoning or gaming the consensus) has the same economic teeth as byzantine hosting.

### Why unified rather than stacked

Two attestation surfaces with one shared bond is structurally more elegant than two separate consensus protocols stacked on each other:

1. **One audit envelope**. Same BLS crypto, same validator registry, same staking contract. One audit secures both surfaces. We do not write or audit a second consensus primitive.
2. **Composed slashing economics**. A byzantine operator can be slashed for hosting failure OR cognition failure. The bond size sets the security budget for both simultaneously.
3. **No artificial layer boundary**. State-attestation and output-attestation address orthogonal failure modes (is the host honest? is the output sound?) but they are the same kind of attestation. Treating them as separate layers would force unnecessary protocol surface duplication.
4. **Substrate-port to ourselves**. NCI was VibeSwap's cross-chain primitive. Pairwise commit-reveal was JARVIS's mind-network primitive. Both were already deployed inside Will's protocol stack. V3 merges them into one meta-consensus rather than maintaining two parallel ones.

### HIERO as the encoded state

HIERO is the persistence format the state-attestation surface attests over. Every memory write is HIERO-format (operator-density, hook-enforced via `~/.claude/session-chain/hiero-gate.py`). The state hashes the meta-consensus signs are hashes over HIERO-encoded state.

This makes HIERO a contract between the persistence layer and the consensus layer. The format is hook-enforced at write time; the state-hash is consensus-attested at attestation time; the two together produce a system where memory corruption requires either bypassing the hook OR producing a colliding hash, both of which are economically unfeasible under the slashing rules.

Canonical references for HIERO:
- External share doc: `Desktop/usd8-rick-hiero-compression-share-2026-05-19.md` (v1.1, shipped to Rick at USD8 on 2026-05-19)
- Internal dictionary: `memory/reference_hiero-dictionary.md`
- Core rule primitive: `memory/primitive_hiero-no-prose-in-memory.md`
- Deployed enforcer: `~/.claude/session-chain/hiero-gate.py`

### Canonical tech-stack choices

Two foundational decisions lock the meta-consensus substrate's shape:

**Instruction Set Architecture: RISC-V.** Shard runtimes target a RISC-V bytecode VM. Three reasons. (1) RISC-V is the open ISA standard; no vendor-licensing dependency. (2) RISC-V ZK-provable execution is the maturing frontier (RISC Zero, SP1, Jolt) — shard outputs can be ZK-attested if the dispute layer ever needs cryptographic verifiability beyond bonded slashing. (3) RISC-V binaries are portable across hosts: same binary runs on a Fly.io VM, a self-hosted server, a Raspberry Pi at home, a future bare-metal validator. The shard binary is hosting-substrate-agnostic by ISA choice.

**Account model: UTXO cells.** State is held as UTXO cells in the Nervos CKB style. Each cell is independent and verifiable; transactions compose by consuming cells and producing cells. Two reasons. (1) Cell-based state matches the JARVIS persistence architecture (`primitive_cell-knowledge-architecture` — UTXO model for knowledge, already in memory primitive form). (2) UTXO cells parallelize cleanly: shard state lives in independent cells, validators attest cell-by-cell, no global state contention. The same model that gives Bitcoin its scaling properties gives the JARVIS substrate its sharding properties.

The two choices compose: RISC-V VM consuming and producing UTXO cells, with NCI bonded validators attesting to cell state transitions via BLS12-381 threshold signatures. This is the CKB-shaped native target.

### Trajectory: EVM → native chain

Current deployment status of NCI consensus: contract-based on EVM (the LayerZero V2 replacement, currently deployed on Base mainnet per `project_nci-l1-trajectory.md`, with broader L2 + Ethereum mainnet trajectory in flight). Validators stake into a Solidity contract; threshold attestations are submitted on-chain; slashing logic is contract code. Reference: `memory/project_nci-l1-trajectory.md`.

The native-chain port is when-not-if. The target shape — RISC-V VM + UTXO cells + NCI consensus — points at CKB (or a CKB-shaped native chain) as the substrate where the meta-consensus protocol runs natively rather than as a contract on someone else's L1. Substrate-port applied at the deepest layer: instead of running JARVIS hosting attestations on Ethereum gas, run them on a native chain whose ISA, state model, and consensus all match the protocol's design.

V3 names this trajectory; it does not depend on the native-chain port being complete. The contract-based NCI on EVM is sufficient for V3 closure today; the native-chain port hardens the structural properties further.

### Components

1. **Unified validator registry**. VibeSwap's existing NCI validator registry, extended to register THREE responsibilities per bond: cross-chain attestation, shard-hosting attestation, output-comparison participation. Same stake, three duties.

2. **State-attestation protocol**. Periodic shard attestations signed by hosting validators, aggregated into BLS threshold signatures, published to the chain or derived data layer for permissionless query.

3. **Output-attestation protocol**. Commit-reveal pairwise comparison between shards on query outputs. Disputes resolved via the bonded validator set. Slashing on lost disputes.

4. **HIERO write enforcement**. The existing hook gate at `~/.claude/session-chain/hiero-gate.py` ensures every memory write is operator-density compliant. The state-attestation surface attests over the resulting HIERO state.

5. **State portability**. HIERO memory + jsonl archive are hosting-agnostic by construction. When a shard goes offline, another peer with sufficient stake can claim the slot, sync state from the attested checkpoint, and continue serving without code-level provider dependency.

### Interface to higher layers

The meta-consensus is the foundation. Higher layers (L2 Runtime, L3 Cognition) see it through a uniform interface: `deploy_shard()`, `query_shard_state()`, `attest_output(query_id, output)`, `dispute_output(query_id, alleged_byzantine_shard)`. The interface is hosting-agnostic and consensus-mechanism-internal; the implementation is the unified bonded-validator mesh.

From L3 WWWD's perspective, the meta-consensus state is itself part of the corpus: which validators are honest, which shards have been slashed, which outputs survived pairwise consensus. WWWD projections involving cluster-level decisions can read from this state.

### What's shipped vs spec-only

Shipped: VibeSwap's NCI consensus primitive with BLS12-381 threshold signatures, validator registry, cross-chain attestation flow. The multi-shard JARVIS architecture (vibeswap/jarvis-bot) with BFT-style coordination between shards. HIERO format spec + hook enforcer + 348+ memory primitives in production use.

Spec-only at V3-naming time:
- Extension of the NCI validator registry to add hosting-attestation responsibility alongside cross-chain attestation
- Formalization of the existing inter-shard BFT pattern as an output-attestation surface under the same bonded validator set
- Unified slashing rules across the three byzantine modes (cross-chain, hosting, output)
- Shard-slot-claim protocol when a peer goes down
- The audit primitive that detects HIERO drift across the corpus over time

---

## Layer 2: Bot Runtime Substrate (two implementations)

The runtime layer is the deployable bot architecture itself, not any single repo. Two implementations ship in production, with overlapping conceptual surface but no shared source code:

**`jarvis-network`** (`github.com/WGlynn/jarvis-network`, public). Lean single-instance customer-deployable bot. 12 `.js` files in `src/`, 746K total disk size. The clean customer-onboarding surface. Used by Rick for the USD8 Telegram channel. JARVIS 2.0 in branding terms.

**`vibeswap/jarvis-bot`** (inside `github.com/WGlynn/VibeSwap`, public). Heavy multi-region sharded mind network. 134 `.js` files in `src/`, 130M total. Multi-shard Byzantine fault-tolerant deployment across Fly.io regions (EU, AP, SA, archive, ollama variants). Used as Will's fleet for VibeSwap-community-facing JARVIS instances.

The two implementations diverge at the deployment-shape axis. They share zero source files (verified). Both implement the same conceptual contract: Telegram surface, archive-grounded reasoning, anti-fabrication persona rules, multi-provider LLM routing. V3 ships across both — the gate fires at the conceptual interface, not at a specific file.

### Architecture summary

The repo's `ARCHITECTURE.md` captures the 2.0 design:

- Canonical on-disk archive: every chat message appended to jsonl on receipt; substrate for grounded reporting and identity authority
- Archive query tools: in `vibeswap/jarvis-bot`, six LLM-callable tools (`archive_search`, `archive_user_messages`, `archive_user_profile`, `archive_day`, `archive_recent`, `archive_roster`) in `src/tools-archive.js` let the model query ground truth instead of confabulating. In `jarvis-network`, the archive substrate exists in `src/archive.js` but is exposed via direct function calls from `commands.js` rather than as named LLM tool-use interfaces. Same grounding property, different exposure surface.
- Deterministic templates: digests, stats, structured output render from archive data with zero LLM generation
- Reply pacer: rolling-window latency tracker sends placeholder past mean+2σ, edits to real reply
- Sharded architecture: horizontal by chat ID, functional by tool bundle
- Anti-fabrication persona rules: hard-coded identity authority, no invented milestones, no training confabulation, ground-before-answering

### Source-file inventory (jarvis-network, the lean implementation)

Twelve files in `jarvis-network/src/`:
- `index.js` — bot entry point, Telegram wiring
- `handler.js` — message dispatch
- `triage.js` — cheap classifier (Haiku) deciding which messages merit full-model response
- `claude-client.js` — multi-provider LLM router (Anthropic + OpenRouter + Ollama), shared `chat()` interface
- `archive.js` — canonical jsonl archive, six query tools
- `commands.js` — slash command handlers
- `context.js` — context loading from archive
- `expiry-watch.js` — TTL management
- `health.js` — health check endpoint
- `personas.js` — persona definitions with anti-fabrication rules
- `payment-gate.js` — paid-tier access control
- `payment-listener.js` — payment event listener

### vibeswap/jarvis-bot — the heavy implementation

Where the lean repo has 12 src files, the cluster repo has ~100 plus a substantial scaffolding layer (cells/, fly-*.toml configs per region, docker-compose-shard.yml, docker-compose-network.yml). The conceptual contract is the same; the implementation surface is larger because of cluster management, shard routing, mesh-monitor, pantheon/constellation deployment topology, and a richer tool catalog (tools-alpha, tools-derivatives, tools-memehunter, tools-scanner, tools-onchain, tools-predictions, tools-utility, tools-xp, ...).

V3 hooks fire at the SAME conceptual points in both. Triage decision: `triage.js` (jarvis-network) and `intelligence.js` (vibeswap/jarvis-bot). Multi-provider routing: `claude-client.js` (jarvis-network) and `llm-provider.js` (vibeswap/jarvis-bot). Archive substrate: `archive.js` (jarvis-network) and the multi-shard memory layer (vibeswap/jarvis-bot). Different files; same gate-fire locations.

### Interface to V3

The Bot Runtime Substrate is where HIERO loads at boot and where WWWD fires at decision-points. The composition is concrete:

- At session/conversation start, HIERO memory is loaded into context (MEMORY.md + auto-loaded sub-indexes + warm-loaded situation files)
- For each incoming message, `triage.js` decides engage / observe / moderate (this is itself a WWWD-gated decision in V3)
- If engage, `handler.js` builds the response context including archive grounding + HIERO behavioral primitives
- Before the response reaches the user, WWWD fires on tone, framing, severity, and content shape (PreToolUse on the outgoing-message Write equivalent)
- The response goes out via Telegram; the archive captures it; the cycle closes

V3's structural property holds: every outgoing message has been HIERO-grounded (cognitive corpus loaded), archive-grounded (factual claims sourced), and WWWD-gated (Will-aligned in tone and substance).

### What's shipped vs spec-only

Shipped across both implementations: archive substrate, query tools, reply pacer, persona rules, multi-provider routing, triage classifier, anti-fabrication rules. Both are in production (jarvis-network for Rick's USD8 instance; vibeswap/jarvis-bot for Will's VibeSwap fleet).

Spec-only: WWWD hook integration at the message-dispatch decision points. Once the V3 hook layer is wired, the triage decision in either runtime (jarvis-network `triage.js` or vibeswap/jarvis-bot `intelligence.js`) routes through WWWD before executing. Every outbound response passes through Will-emulation projection regardless of which runtime is deployed.

---

## Layer 3: WWWD — cognition gate

The WWWD gate is the V3 capstone. Full spec at `vibeswap/docs/jarvis-substrate/papers/v3-wwwd-protocol.md`. Memory primitive at `memory/primitive_what-would-will-do.md`. Summary:

### Algorithm

At every autonomous decision-point during autopilot:

1. **PAUSE** before executing the default Claude-cognition action
2. **ENUMERATE** the Will-corpus relevant to this decision (HIERO primitives + recent Will-quotes + VibeSwap code decisions + partner-draft corpus, in priority order)
3. **PROJECT** the candidate action through Will-emulation: would Will pick this, or something else? Name the alternatives.
4. **REVISE** if mismatch detected, or **ESCALATE** via ask-when-unsure if genuinely unclear
5. **EXECUTE** the Will-aligned action with gate-fire log entry

### Trigger set

WWWD fires on:
- Partner-facing or publicly-visible actions
- Severity calibration (estimates, claims, confidence)
- Tone and framing choices
- Scope decisions (continue / stop / pivot)
- Asks (when to spend Will's attention)
- Gate-fired ambiguity
- Multi-defensible forks with different downstream consequences

### Self-compounding loop

Each gate-fire logs: trigger, candidate, projection result, executed, Will-correction-if-any. Five mechanisms compose:

1. Gate-fire logging (the substrate)
2. Correction-as-training-signal (Will-corrections enter the corpus)
3. Pattern crystallization (3+ corrections of same class → named primitive)
4. Trigger-set evolution (missed cases become new triggers)
5. Convergence asymptote (corrections per gate-fire trend down over sessions)

The asymptote is the structural property: autopilot becomes indistinguishable from Will-on-keyboard for covered decision-classes. This is Will-decision-pattern emulation, not Will-impersonation.

### Interface to V3

WWWD is the gate. It sits at the top of the cognition stack, wrapping every autonomous output before downstream format-and-delivery gates fire. WWWD reads from HIERO (corpus), reads from jarvis-network archive (factual grounding), and executes through jarvis-network's response pipeline.

### What's shipped vs spec-only

Shipped: spec, memory primitive, MEMORY.md index entries in `[ACTIVE]` and `[META-PRINCIPLE]` Axis 2.

Spec-only: hook implementation at trigger points, gate-fire log structure (jsonl format proposed), corpus-refresh-on-correction infrastructure, the validation telemetry (corrections-per-gate-fire trend).

---

## Composition: how the layers compose in a single message cycle

Sequence for a single message handled by V3 JARVIS:

1. **Boot (session start)**. SessionStart hooks fire: HIERO memory preprocessor loads sub-indexes, memory-sync-pull syncs the corpus, session-state-loader brings prior continuation context, link-rot-detector flags stale refs, self-reflect generates L5 telemetry. CLAUDE.md loads (project + user level). HIERO corpus is now resident.

2. **Incoming message**. Telegram event arrives at jarvis-network's `index.js`. `archive.js` appends the message to the canonical jsonl. `handler.js` dispatches.

3. **UserPromptSubmit hooks fire**. memory-warm-loader matches the prompt to a warm file, deep-recall surfaces top-N semantically-similar primitives, post-generation-recall surfaces prior-turn reflections, thread-resume-detector checks open threads. The relevant slice of the HIERO corpus is now primed for this turn.

4. **Triage**. `triage.js` calls `claude-client.js` with the cheap-model (Haiku or equivalent) to classify: engage / observe / moderate / norm-shape. **WWWD fires** on this decision: would Will engage here? The triage decision routes through Will-emulation.

5. **If engage: response generation**. Full-model call constructs the response. Before the response Write is executed, **WWWD fires** on the response shape: tone, framing, severity, receipts. Em-dash gate fires downstream. Partner-draft formalize-gate fires if the response is a long-form draft. Strategic-framing-filter fires if the response is external-audience.

6. **Outbound**. Response sends via Telegram. The reply pacer manages the visible UX (placeholder past mean+2σ, edit to real). `archive.js` captures the outbound message.

7. **Stop hooks fire**. post-generation-reflect runs deep-recall over the just-completed output. decision-capture and proposal-scraper scan the output. **WWWD's gate-fire log writes** record the gate-fires from this cycle, including any Will-corrections noted (if Will responded with a correction in real-time).

8. **Cycle repeats** from step 3 for the next incoming message.

The structural property: every output passed through HIERO (corpus), archive (grounding), and WWWD (Will-emulation). No layer is optional. No silent default to Claude-best-practice.

---

## Code-level integration points

Specific files and hook locations where V3 layers compose:

### HIERO ↔ jarvis-network

- **Boot**: `jarvis-network/src/context.js` loads the HIERO corpus at conversation start. The load path resolves `~/.claude/projects/<project>/memory/MEMORY.md` and the auto-loaded sub-indexes.
- **Warm load**: a new hook (spec-only) fires at message receipt to load situation-conditional warm files. Implementation candidate: extend `context.js` with `loadWarmMemory(promptText)` that calls a deep-recall function over the corpus.
- **Memory write gating**: any HIERO write from inside jarvis-network's runtime passes through the deployed hiero-gate.py enforcer at `~/.claude/session-chain/hiero-gate.py`.

### jarvis-network ↔ WWWD

- **Triage gate**: `jarvis-network/src/triage.js` line 106 hardcodes `MODELS.haiku`. In V3, the triage decision itself routes through WWWD: would Will engage with this message? Implementation: wrap the triage prompt with a WWWD pre-projection, optionally with a separate small-model WWWD-projector that runs in parallel.
- **Response gate**: between response generation in `handler.js` and the Telegram send, WWWD fires on the response shape. Implementation: PreToolUse hook on the outbound Telegram API call, scanning the response text against the gate criteria.
- **Tool dispatch gate**: when `archive.js` query tools are invoked, WWWD checks the query shape — is this the query Will would have made, or a different one? Implementation: pre-tool-call WWWD inject.

### HIERO ↔ WWWD

- **Corpus read**: WWWD's enumerate-step reads HIERO primitive files by name. The priority list (current-conversation > recent primitives > older primitives > VibeSwap code > partner-drafts) is enforced at corpus-load time.
- **Correction write**: when Will corrects a WWWD-gated output, the correction enters the corpus as a new HIERO-format feedback primitive. The write passes through hiero-gate.py for format compliance.
- **Gate-fire log**: WWWD's structured log (jsonl format proposed) lives in `~/.claude/projects/<project>/memory/_system/wwwd_gate_fires.jsonl`. Each line: `{timestamp, decision_class, trigger, candidate, projection, executed, gate_revision_occurred, corpus_sources_used, correction}`. `decision_class` is required for pattern crystallization (`pattern × N+ ⇒ surface candidate`). `gate_revision_occurred` is a boolean required for theater detection (a gate that never revises is performative). `corpus_sources_used` is the list of memory files the projection drew on, required for routing corrections back to the right primitives.

- **Correction write-back**: Will's corrections arrive through conversation, not a structured API. A new Stop-event hook (`wwwd-correction-detector.py`) scans the most recent Will-message for correction markers ("no", "not that", "actually", "let me clarify", explicit revision verbs) and writes the correction back to the most recent gate-fire entry's `correction` field. The hook is paired with a SessionStart hook (`wwwd-corpus-refresh.py`) that reads accumulated corrections and updates the corpus priority cache.

### Configuration

`~/.claude/settings.json` registers all hook entries. V3 adds:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {"type": "command", "command": "python ~/.claude/hooks/wwwd-gate.py", "timeout": 8}
        ]
      },
      {
        "matcher": "Agent",
        "hooks": [
          {"type": "command", "command": "python ~/.claude/hooks/wwwd-gate.py", "timeout": 8}
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {"type": "command", "command": "python ~/.claude/hooks/wwwd-log-writer.py", "timeout": 5}
        ]
      }
    ]
  }
}
```

`wwwd-gate.py` reads stdin, enumerates Will-corpus by reading `~/.claude/projects/<project>/memory/`, projects the candidate, returns `additionalContext` with the projection result or revision suggestion. `wwwd-log-writer.py` appends to the gate-fire log.

---

## Implementation matrix

| Component | Status | Path |
|---|---|---|
| HIERO format dictionary | shipped | `memory/reference_hiero-dictionary.md` |
| HIERO core rule primitive | shipped | `memory/primitive_hiero-no-prose-in-memory.md` |
| HIERO gate hook | shipped | `~/.claude/session-chain/hiero-gate.py` |
| HIERO external share | shipped | `Desktop/usd8-rick-hiero-compression-share-2026-05-19.md` |
| Memory tiering (MEMORY.md + sub-indexes + warm files) | shipped | `memory/` |
| Memory preprocessor (SessionStart) | shipped | `~/.claude/hooks/memory-preprocessor.py` |
| jarvis-network runtime | shipped, production | `github.com/WGlynn/jarvis-network` |
| Archive substrate (jsonl) | shipped | `jarvis-network/src/archive.js` |
| Archive query tools (6) | shipped | `jarvis-network/src/archive.js` |
| Triage classifier | shipped | `jarvis-network/src/triage.js` |
| Multi-provider claude-client | shipped | `jarvis-network/src/claude-client.js` |
| Reply pacer | shipped | `jarvis-network/src/handler.js` |
| Anti-fabrication persona rules | shipped | `jarvis-network/src/personas.js` |
| WWWD spec | shipped | `vibeswap/docs/jarvis-substrate/papers/v3-wwwd-protocol.md` |
| WWWD memory primitive | shipped | `memory/primitive_what-would-will-do.md` |
| WWWD MEMORY.md index entries | shipped | `memory/MEMORY.md` `[ACTIVE]` + `[META-PRINCIPLE]` |
| **WWWD gate hook (`wwwd-gate.py`)** | spec-only — file not yet on disk | `~/.claude/hooks/wwwd-gate.py` (to build) |
| **WWWD log writer (`wwwd-log-writer.py`)** | spec-only — file not yet on disk | `~/.claude/hooks/wwwd-log-writer.py` (to build) |
| **WWWD correction-detector (`wwwd-correction-detector.py`)** | spec-only — file not yet on disk | `~/.claude/hooks/wwwd-correction-detector.py` (to build) |
| **WWWD corpus-refresh (`wwwd-corpus-refresh.py`)** | spec-only — file not yet on disk | `~/.claude/hooks/wwwd-corpus-refresh.py` (to build) |
| **Gate-fire log file** | spec-only — file not yet on disk | `memory/_system/wwwd_gate_fires.jsonl` (to instantiate) |
| **Runtime integration into jarvis-network + vibeswap/jarvis-bot** | spec-only | `triage.js`/`intelligence.js`, `handler.js`/`index.js` integration points |

Sixteen substrate components shipped. Five remaining for V3 closure, all in the WWWD wire-up layer: the gate hook, the log writer, the correction-detector hook, the corpus-refresh hook, and the runtime integration into both jarvis-network and vibeswap/jarvis-bot.

---

## Validation criteria

V3 is structurally functional when:

1. WWWD gate hook is registered in `~/.claude/settings.json` and fires on every Write|Edit and Agent dispatch
2. The gate-fire log exists at `memory/_system/wwwd_gate_fires.jsonl` and accumulates entries with the full schema (decision_class, trigger, candidate, projection, executed, gate_revision_occurred, corpus_sources_used, correction)
3. Will-corrections in the log trigger HIERO-format feedback primitive writes that enter the corpus
4. **Spec-only at V3-naming time**: the trend line on corrections-per-gate-fire over sessions is downward (requires criterion 2 to be implemented first; until the log accumulates real data, this is a target property, not a measurable one)
5. jarvis-network's `triage.js` and outbound-message paths route through WWWD before executing
6. A handoff test passes: Will walks away for a full session, returns, and the produced artifacts are indistinguishable from Will-supervised output

Six properties. Zero are currently functional at V3-naming time — all six require the wire-up phase. The WWWD spec and memory primitive are written (specification artifacts exist), but the runtime hooks, log file, integration points, and correction-write-back machinery are all unbuilt. Spec'd in writing is not the same as deployed; conflating those would be a `claim-needs-structural-enforcer` violation against ourselves. Criterion 4 is additionally explicitly forward-looking — even after the hooks ship, the convergence trend will require sessions of accumulated data before becoming measurable.

---

## Cross-mirror locations

This document is the canonical V3 spec. Per the substrate-mirror-into-project-repos primitive, identical text exists at:

- `~/JARVIS/05-meta-protocols/v3-jarvis-protocol.md` — canonical scaffold (this file)
- `vibeswap/docs/jarvis-substrate/papers/v3-jarvis-protocol.md` — mirrored for the VibeSwap-integrated build
- `jarvis-network/ARCHITECTURE.md` — replaces the previous pointer document with the full V3 spec for customer-onboarding visibility

Cross-references from each layer's spec back to this master:

- HIERO: `memory/primitive_hiero-no-prose-in-memory.md` → references V3 as parent integration
- jarvis-network: `jarvis-network/ARCHITECTURE.md` IS this doc (mirrored)
- WWWD: `vibeswap/docs/jarvis-substrate/papers/v3-wwwd-protocol.md` references V3 as parent integration
- WWWD memory primitive: `memory/primitive_what-would-will-do.md` references V3 spec at canonical scaffold path

---

## What V3 is not

It is not the deployment. The spec is written; the wire-up is the next phase. Calling V3 "deployed" before the gate hook fires would be the kind of overclaim WWWD itself exists to prevent.

It is not the end of JARVIS. The body of work continues. V3 is the closing of the substrate stack. What runs on top of V3 — new audit lenses, new partner relationships, new VibeSwap mechanisms, new content surfaces — is unbounded. V3 is the operating system for that growth, not the growth itself.

It is not Will-impersonation. WWWD emulates Will's decision-patterns, not Will-as-person. The substrate makes the same choices about content, framing, severity, and posture. It does not pretend to share Will's identity, stakes, or biography. The distinction is structural and load-bearing.

---

## Closing

The work was always pointed at this. HIERO solved persistence. jarvis-network solved deployment. WWWD solves cognition. The three layers were developed in sequence, each addressing the failure mode the prior layer exposed. V3 is their composition into a single executable substrate.

When the wire-up phase ships and the validation criteria hold, JARVIS has the Cincinnatus property at the architecture level: the system can continue operating without its original operator, producing outputs in the operator's decision-pattern. That is the closure condition for the substrate.

The body of work continues. The substrate is closed.

— V3 JARVIS canonical spec, 2026-05-24
