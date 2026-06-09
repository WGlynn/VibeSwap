# vibeswap-ckb chain-spec

This directory holds the chain-spec TOML files for the VibeSwap-CKB sovereign chain. A chain-spec defines the genesis block and the consensus parameters that every node must agree on. It is the file you point `ckb run --chain` at when you want to participate in *our* chain rather than upstream Nervos's.

**Honest scope (read this first).** The TOML in this directory is **Will-runnable IF VS Build Tools (MSVC C++ workload) is installed**. The chain-spec itself is in canonical form (post-2026-06-08 design resolutions); the gate is the local build environment, not the spec.

- The `ckb-fork/` sibling repository (per `FORK_PLAN.md` Section 7 steps 1–4) is being cloned and branched 2026-06-08; the build step (Section 7 step 5) is blocked on VS Build Tools install.
- Once the C linker is available, `cargo build --release` produces the `ckb` binary; this TOML is then importable via `ckb init --import-spec`. `OPERATIONS.md` §10 enumerates the Day 1 → Day 7 sequence for standing the chain up.
- Validity claims below ("valid TOML", "parses against v0.206.0 schema") still concern TOML grammar; the observed genesis hash will be recorded here after the first successful boot.

When the first devnet smoke test runs against this file, this README should be updated to record the observed genesis hash and tighten the scope note above.

---

## Files

| File | Purpose | Status |
|---|---|---|
| `vibeswap-ckb-dev.toml` | Dev-chain (single-node, Dummy PoW) chain-spec | Canonical. 4 `TODO Will-decide:` markers remain (lock-args pending key generation at deploy time). Not yet booted; gated on VS Build Tools install. |
| `vibeswap-ckb-testnet.toml` | Public testnet (Eaglesong PoW) chain-spec | Not written yet. Sequenced after dev-chain first boot. |
| `vibeswap-ckb-mainnet.toml` | Sovereign mainnet chain-spec | Not written yet. Requires Will-go decision per `FORK_PLAN.md`. |

---

## Design philosophy

**Minimal augmentation.** This chain-spec is a forked-and-augmented descendant of `nervosnetwork/ckb` `v0.206.0` `resource/specs/dev.toml`. The augmentation discipline (`AUGMENTATION_SURFACE.md` rule 1: "Nothing on this surface unless required") applies here: every line that differs from upstream is justified inline with a `# VS-AUG:` comment.

**Tier 1 (config-only), not Tier 2 (substrate-code).** The augmentations in this file are all configuration changes that the existing upstream Rust code accepts without modification. We have explicitly NOT introduced any new TOML keys that would require corresponding `spec/src/` changes in the fork. This keeps `AUGMENTATION_SURFACE.md` at "configuration-only fork" — the most credible version of "Nervos CKB augmented to meet VibeSwap specifications."

**Preserve Nervos invariants.** NC-Max consensus parameters are inherited verbatim, including `epoch_duration_target`, `max_block_cycles`, the reward schedule, and the hardfork activation table. The augmentation surface document gives us the option to touch any of these later, but doing so without first measuring what user-space NCI actually needs would be premature. So: upstream values stand for the first boot, and only get tuned after we have data.

**Three-token model: genesis-reserve, deploy-later.** Per `[F·jul-is-primary-liquidity]`, JUL and VIBE are reserved capacity at genesis, not minted tokens at genesis. The deployment of the sUDT issuer cells happens in post-genesis transactions that consume the reserved capacity. CKB-native remains the state-rent asset and inherits the upstream reward distribution unchanged. This is the user-space path for the "three-token model" entry in `AUGMENTATION_SURFACE.md`, deferred from substrate-augmentation.

---

## Per-section walkthrough

The TOML file is heavily inline-commented. This section provides higher-level context that doesn't fit in inline comments.

### `name = "vibeswap_ckb_dev"`
The chain name is the substrate-level identity. It appears in peer handshakes and in `ckb-cli` output. Changing it from upstream's `"ckb_dev"` is the single most important augmentation, because it prevents accidental peer-mixing between an upstream dev node and ours running on the same machine.

### `[genesis]` and `[genesis.genesis_cell]`
Genesis block header parameters are upstream-faithful with two exceptions: `[genesis.genesis_cell.message]` is rebranded to embed the VibeSwap constitutional preamble ("A coordination primitive, not a casino. | Lawson floor inviolate.") and `timestamp` carries a `TODO Will-decide` for setting the canonical VibeSwap genesis moment before any second peer joins. Until that decision, `timestamp = 0` is deterministic and safe.

### `[[genesis.system_cells]]`
Four bundled scripts: `secp256k1_blake160_sighash_all`, `dao`, `secp256k1_data`, `secp256k1_blake160_multisig_all`. All upstream-verbatim. We do not add VibeSwap-specific scripts to this bundle. Our scripts (proof-of-mind-lock-script, primitive-cell-type-script, etc.) deploy as user code-cells via post-genesis transactions. This matches `AUGMENTATION_SURFACE.md` section 3.4 ("Default to user-deployable. Surface stays clean.").

### `[[genesis.dep_groups]]`
Upstream-verbatim. VibeSwap-specific dep-groups (e.g., a CommitRevealAuction code+parameter bundle) get added by post-genesis transactions, not here.

### `[[genesis.issued_cells]]`
This is where the most visible VibeSwap restructuring lives. Upstream issues three cells. We issue four, with each cell tagged by purpose:

1. **Deployer faucet** (8.4B CKB) — capacity used by the post-genesis scripts-deployment transactions.
2. **JUL deployment reservation** (20B CKB) — capacity earmarked for the sUDT issuer deployment for the JUL money-layer token.
3. **VIBE deployment reservation** (5.198B CKB) — capacity earmarked for the sUDT issuer deployment for the VIBE governance token.
4. **Lawson-constants deployment reservation** (1B CKB) — capacity for `ConstitutionalBoundsCell` + initial `ConstantsRegistryCell` per `specs/lawson-constants.md`.

The CKB amounts for cells 1-3 mirror upstream proportions so the dev money supply is approximately preserved (~33.6B + 1B ≈ 34.6B CKB on dev). Cell 4 is sized with extreme headroom; a sizing pass against `specs/lawson-constants.md` can reduce it.

All four cells currently carry placeholder lock args (the upstream dev fixture values for cells 1-3; all-zeros for cell 4). Replacing these with real blake160 hashes of the genesis-deployer pubkeys is `TODO Will-decide`.

### `[params]`
Consensus parameters inherited verbatim. Resolved 2026-06-08:

- `max_block_cycles` — held at upstream 10B; Agent 9's BLS12-381 cycle-budget spike confirmed Path 1+3 user-space BLS fits within budget at the targeted MessagingHub attestation batch sizes.
- `epoch_duration_target` — held at upstream 80; path (a) chosen (app-layer absorbs NC-Max variance). Re-open only if first end-to-end smoke test shows variance breaks the 10s batch cadence.

Both decisions remain config-only; neither escalates to Tier 2.

### `[pow]`
`Dummy` for dev (matches upstream). Mainnet switches to `Eaglesong` matching NC-Max. The NCI 10% PoW pillar (per `specs/nci-consensus.md`) consumes whatever PoW the substrate produces — Dummy hashes on dev, Eaglesong hashes on mainnet — without requiring any change to NCI's user-space cells.

---

## How to use this file

### Prerequisites

Per `FORK_PLAN.md` Section 7 and `OPERATIONS.md` §10:

1. Clone `nervosnetwork/ckb` at tag `v0.206.0` to `C:/Users/Will/vibeswap/ckb-fork/` (Steps 1–4 in flight 2026-06-08).
2. **Install VS Build Tools (MSVC C++ workload)** — the Day-0 Will-action blocker. Without it, `cargo build --release` for `ckb` itself fails. This applies to building the node binary, not just the VibeSwap scripts.
3. Build `ckb` from source (`cargo build --release`).
4. Once the node binary exists, follow `OPERATIONS.md` §10 Day 1 instructions to import this chain-spec and produce the first block.

### Standing up the dev chain (once prerequisites are met)

```bash
# 1. Initialize a node directory using this chain-spec
cd C:/Users/Will/vibeswap/ckb-fork
./target/release/ckb init \
  --chain dev \
  --import-spec ../contracts-ckb/chain-spec/vibeswap-ckb-dev.toml

# 2. Start the node
./target/release/ckb run

# 3. In a separate terminal, start a single-threaded miner
./target/release/ckb miner --threads 1

# 4. Verify tip is increasing
ckb-cli rpc get_tip_block_number
```

If step 4 returns increasing numbers, the chain is alive against this spec.

### Genesis-hash recording

After the first successful boot, record the observed genesis-block hash in this README under a new section titled "Observed genesis hashes," with the date and the commit of `vibeswap-ckb-dev.toml` it was computed from. Any subsequent change to this TOML invalidates the recorded hash and requires re-recording on next boot.

---

## Genesis cell instantiation procedure

The cells reserved in `[[genesis.issued_cells]]` are raw-capacity cells under their respective deployer locks. They hold no protocol semantics by themselves. The post-genesis instantiation procedure follows:

1. **Build the VibeSwap scripts as RISC-V binaries.** Run `capsule build --release` for each crate in `contracts-ckb/` (proof-of-mind-lock-script, primitive-cell-type-script, datatoken-cell-type-script, etc.). Outputs land in `contracts-ckb/build/release/`.

2. **Deploy each script as a user code-cell.** Construct deployment transactions that consume capacity from the Deployer Faucet cell (issued-cell #1). Each script becomes a code-cell at a deterministic OutPoint, referenced thereafter via `type_id` for upgradability or via `data_hash` for immutability.

3. **Deploy the JUL sUDT issuer.** Consume the JUL Deployment Reservation cell (#2). Output cells: the JUL sUDT code-cell (if not already shared with VIBE) and the JUL issuer cell (lock = JUL issuance multisig). No JUL is minted in this transaction; minting follows the JUL issuance schedule which is itself a Will-decide item (separate from this chain-spec).

4. **Deploy the VIBE sUDT issuer.** Same procedure as JUL, consuming the VIBE Deployment Reservation cell (#3).

5. **Deploy the Lawson constants.** Consume the Lawson Deployment Reservation cell (#4). Outputs: `ConstitutionalBoundsCell` (immutable, contains the bounds for every Lawson constant), the initial `ConstantsRegistryCell` (with default values within bounds), and an empty `ConstantsHistoryCell`. Per `specs/lawson-constants.md`, the bounds set here cannot be modified post-genesis without a hardfork — this is the highest-stakes deployment step.

6. **Verify deployment.** Use `ckb-cli` to inspect each deployed cell and confirm OutPoints, capacities, and lock-script hashes match expectations.

The order matters: scripts must be deployed before any cell that references them via `cell_deps` can be constructed. The Lawson constants step (5) is sequenced last among the protocol bootstraps because every other VibeSwap mechanism (NCI, CommitRevealAuction, VibeAMM, ShapleyDistributor) reads constants from the `ConstantsRegistryCell`, but the registry itself does not depend on those mechanisms.

This sequence is the operational meaning of `FORK_PLAN.md` Milestones 2-4.

---

## Open questions for Will

The four key-args questions below need actual key generation at deploy time and are the only TOML-level Will-decides remaining. The 2026-06-08 design resolutions closed everything else.

1. **Deployer faucet lock-args.** What blake160 hash holds the genesis deployer pubkey for the post-genesis script-deployment transactions? Likely a hot key on dev; should be a multisig on testnet/mainnet.

2. **JUL deployment multisig.** Signers and threshold for the JUL issuer multisig. Treasury-relevant; affects JUL minting gating for the chain lifetime.

3. **VIBE deployment multisig.** Same question as JUL. The two multisigs can be different (different signer sets, different thresholds) or share signers; both choices have trade-offs.

4. **Lawson deployer key.** Who deploys the `ConstitutionalBoundsCell`? Bounds set at deployment cannot be changed without a hardfork (per `specs/lawson-constants.md` Open Questions #3). The deployer's only act is to create the immutable bounds cell; the key is then retired (`OPERATIONS.md` §10 Day 2).

Non-blocking efficiency items:

- **Allocation sizing for the Lawson reservation.** 1B CKB is comfortable upper bound; sizing pass against `specs/lawson-constants.md` can likely reduce to under 100M CKB.
- **Testnet promotion criteria.** Default proposal: dev-chain boots cleanly, Milestone-4 PoM-lock-script integration passes, and at least one NCI-authorized boundary transaction executes end-to-end on dev (`OPERATIONS.md` §3 end-of-Phase-1 gate).

---

## Cross-references

- `../FORK_PLAN.md` — operational plan for creating the sovereign fork.
- `../AUGMENTATION_SURFACE.md` — authoritative list of allowed deviations from upstream.
- `../UPSTREAM.md` — catalog of upstream artifacts we depend on.
- `../specs/lawson-constants.md` — `ConstitutionalBoundsCell` + `ConstantsRegistryCell` spec.
- `../specs/nci-consensus.md` — explains why this chain-spec doesn't touch NC-Max.
- `../specs/INDEX.md` — full catalog of cell specs (for context on what gets deployed post-genesis).
- Upstream reference: `https://github.com/nervosnetwork/ckb/blob/v0.206.0/resource/specs/dev.toml`
- Memory primitive: `[J·vibeswap-ckb-sovereign-pivot]`, `[F·blockchain-not-contracts]`, `[F·jul-is-primary-liquidity]`
