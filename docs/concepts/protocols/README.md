# Protocols

> Generic protocol specifications — SIE, Wardenclyffe, and Sybil-resistance.

## What lives here

Formal protocol specs that aren't tied to a single mechanism module. The Sovereign Intelligence Exchange (SIE-001) defines the wire format for sovereign-intelligence interaction. The Wardenclyffe protocol defines the broadcast / coordination pattern, and its Sybil-resistance variant addresses the attack surface that pattern opens up.

## Highlights

| Document | Covers |
|---|---|
| [SIE-001-PROTOCOL-SPEC.md](SIE-001-PROTOCOL-SPEC.md) | Sovereign Intelligence Exchange — protocol specification, message format, semantics |
| [wardenclyffe-protocol.md](wardenclyffe-protocol.md) | Wardenclyffe broadcast / coordination protocol |
| [wardenclyffe-sybil-resistance.md](wardenclyffe-sybil-resistance.md) | Sybil-resistance overlay for the Wardenclyffe protocol |

## Cross-references

- Up: [../README.md](../README.md) — concepts directory overview
- Architecture: [../../architecture/](../../architecture/) — where protocols slot into the stack
- Related concepts:
  - [../ai-native/](../ai-native/) — SIE serves the sovereign-intelligence layer
  - [../identity/](../identity/) — Sybil resistance leans on attestation primitives
  - [../commit-reveal/](../commit-reveal/) — commit-reveal protocol family
