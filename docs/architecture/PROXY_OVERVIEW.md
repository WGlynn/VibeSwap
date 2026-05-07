# Proxy Subsystem — Architecture Overview

**Status**: shipped
**Subsystem**: `contracts/proxy/`
**Companions**: [`DEPLOYMENT_TOPOLOGY.md`](./DEPLOYMENT_TOPOLOGY.md), [`AUGMENTED_GOVERNANCE.md`](./AUGMENTED_GOVERNANCE.md)

---

## What this subsystem does

A single contract: `VibeVersionRouter`. Routes calls to the appropriate version of an implementation based on caller-specified preferences or governance-set defaults. Bridges the "we want backward compatibility" property with the "we ship breaking changes" reality.

The thesis: protocol upgrades typically force everyone to migrate at once (a forced upgrade) or never (mandatory backward compatibility forever). Both are wrong. Better: deploy multiple versions, route per caller, deprecate gradually.

## File map

```
contracts/proxy/
└── VibeVersionRouter.sol
```

## How version routing works

```
caller.someOperation(args, version=null)
   │
   ▼
VibeVersionRouter:
   - if version specified: route to that version's implementation
   - if null: route to current default version (governance-set)
   - if version deprecated: revert with explicit error
   │
   ▼
implementation v_X.someOperation(args)
   │
   ▼
result returned to caller
```

The router maintains a registry of `(operation → version → implementation address)`. Upgrades add a new entry; deprecation flips a flag without removing the entry; full removal happens only after sufficient migration time.

## Why version routing, not pure UUPS

UUPS proxies upgrade in-place: the proxy's storage stays, the implementation behind it changes. This is correct for *forced* upgrades where the protocol doesn't want backward compatibility.

Some operations don't fit that model:
- **Public APIs** that integrators depend on. A breaking change without forward routing strands integrators.
- **Long-tail consumers** that haven't migrated. Forcing immediate migration breaks them.
- **Backward-compatibility windows** where the protocol promises N months of dual-support.

For these cases, version routing keeps multiple implementations live, lets callers pick (default = latest, override = specific version), and lets governance deprecate on a schedule rather than a single block.

## When to use vs UUPS

| Use UUPS proxy | Use version router |
|----------------|--------------------|
| Internal-only contracts | Public-API contracts |
| Forced security upgrades | Backward-compat windows |
| Single canonical version | Multiple coexisting versions |
| Tight migration control | Decentralized migration on integrator schedule |

VibeSwap uses both. Most contracts are UUPS (internal canonical). Public-API surfaces (e.g., AMM swap interface, intent router) sit behind `VibeVersionRouter` so integrators can opt into specific versions.

## Composition with broader stack

| Routed-through | Why |
|----------------|-----|
| `VibeAMM` | public swap API, integrators on long-tail versions |
| `VibeIntentRouter` | public routing API |
| `CrossChainRouter` | public cross-chain API |
| (future) other public-API contracts | as added |

Internal contracts (`ShapleyDistributor`, `ClawbackRegistry`, etc.) use UUPS directly — no version routing needed.

## Configurability

| Variable | Default | Notes |
|----------|---------|-------|
| Default version | latest stable | per-operation; set by governance |
| Deprecation schedule | per-version | how long after replacement before deprecation |
| Removal schedule | configurable | deprecated versions removable after grace period |

UUPS-upgradeable; admin controls registry; governance controls default versions.

## Migration discipline

The version router's value depends on disciplined use:

- **Don't proliferate versions**: every active version is an audit surface. Keep concurrent versions to ≤3 (current, prior, deprecated-but-live).
- **Mark deprecation early**: integrators need notice. Deprecation flag should fire on the new version's release, not at removal time.
- **Telemetry on usage**: governance should see which integrators still hit deprecated versions. Without telemetry, removal decisions are blind.

These are process disciplines, not contract-enforced. The router enables flexibility; the discipline enforces it.

## Related

- [`DEPLOYMENT_TOPOLOGY.md`](./DEPLOYMENT_TOPOLOGY.md) — deploy-order / wiring of proxies and routers.
- [`AUGMENTED_GOVERNANCE.md`](./AUGMENTED_GOVERNANCE.md) — governance controls default-version selection.
- UUPS proxy pattern (OpenZeppelin) — the standard for non-public-API upgrades.
