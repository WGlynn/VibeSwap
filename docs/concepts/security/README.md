# Security

> Layered defenses — circuit breakers, clawback cascades, Fibonacci scaling, and the Siren protocol.

## What lives here

VibeSwap's defense-in-depth: throughput throttling that bends instead of breaking, circuit breakers on volume / price / withdrawal, a Clawback Cascade that recovers value from compromised states, the Siren incident-response protocol, and same-block flash-loan guards. The pattern across all of these is graceful degradation — the system slows, signals, and recovers rather than halting hard.

## Highlights

| Document | Covers |
|---|---|
| [CLAWBACK_CASCADE.md](CLAWBACK_CASCADE.md) | Multi-stage value-recovery protocol triggered by attack detection |
| [CLAWBACK_CASCADE_MECHANICS.md](CLAWBACK_CASCADE_MECHANICS.md) | Detailed state-machine and economic mechanics of each cascade stage |
| [SIREN_PROTOCOL.md](SIREN_PROTOCOL.md) | Cross-chain incident-signaling and coordinated response |
| [FIBONACCI_SCALING.md](FIBONACCI_SCALING.md) | Per-user per-pool throughput damping along golden-ratio retracement levels |
| [CIRCUIT_BREAKER_DESIGN.md](CIRCUIT_BREAKER_DESIGN.md) | Volume / price / withdrawal-rate breakers and their thresholds |
| [FLASH_LOAN_PROTECTION.md](FLASH_LOAN_PROTECTION.md) | Same-block interaction guard preventing atomic-borrow exploits |
| [WALLET_RECOVERY.md](WALLET_RECOVERY.md) | User-side recovery surface — passkey / device-wallet flows |
| [GRACEFUL_INVERSION.md](GRACEFUL_INVERSION.md) | Design pattern: inverting failure modes so degradation preserves invariants |

## Cross-references

- Up: [../README.md](../README.md) — concepts directory overview
- Architecture: [../../architecture/](../../architecture/) — where defenses sit in the stack
- Related concepts:
  - [../oracles/](../oracles/) — TWAP feeds gate the breakers
  - [../identity/](../identity/) — attestation reputations weight clawback fairness
  - [../cross-chain/](../cross-chain/) — Siren signals propagate cross-chain
