# Traceability Backfill Manifest — 2026-04-21 / 22

Six closed issues receive retroactive annotation comments. Each annotation carries the canonical closing-comment format from `DOCUMENTATION/CONTRIBUTION_TRACEABILITY.md` §Layer 4, with `DAG-ATTRIBUTION: pending` held until `ContributionAttestor` deploys to the active network.

| # | Title | Contributor | Source date | Type | File |
|---|---|---|---|---|---|
| 28 | Cooperative Game Theory in MEV Resistance | @JARVIS | 2026-04-10 | Research | `annotation-28.md` |
| 29 | Verifiable Solver Fairness Beyond Bitcoin Anchor | @Willwillwillwillwill | 2026-04-13 | Research | `annotation-29.md` |
| 30 | Externalized Idempotent Overlay for Security | @unknown | 2026-04-15 | Design | `annotation-30.md` |
| 33 | Oracle Security Analysis Importance | @tadija_ninovic | 2026-04-16 | Security | `annotation-33.md` |
| 34 | Transparency in Decentralized Governance | @JARVIS | 2026-04-16 | Governance | `annotation-34.md` |
| 36 | Capturing Non-Code Protocol Contributions | @Willwillwillwillwill | 2026-04-16 | Inspiration | `annotation-36.md` |

## Posting

Each annotation is copy-paste ready. To post all six in one batch:

```bash
for n in 28 29 30 33 34 36; do
    gh issue comment "$n" --body-file ".traceability/annotation-$n.md"
done
```

Posting is deferred pending Will's greenlight — writing to public issues is a visible action that should be explicit, not autopilot.

## Mint status

All six carry `DAG-ATTRIBUTION: pending`. The minting step fires via `scripts/mint-attestation.sh <N> <commit>` once:

1. `ContributionAttestor` is deployed (target: first mainnet or testnet deploy).
2. `CONTRIBUTION_ATTESTOR_ADDRESS`, `RPC_URL`, `MINTER_PRIVATE_KEY` are configured.
3. A contributor-address mapping exists for `@JARVIS`, `@Willwillwillwillwill`, `@tadija_ninovic`, and the `@unknown` fallback (→ `DEFAULT_CONTRIBUTOR_ADDRESS`).

After minting, each annotation's `DAG Attribution: pending` line is replaced with `0x<claimId>` via a follow-up one-liner comment citing the tx.
