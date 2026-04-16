# Stake-Bonded Pseudonyms

**Status**: stub — full one-pager coming in V0.6.

## Teaser

Sybil resistance without KYC. Participants are anonymous addresses bonded with staked capital; reputation accrues to the pseudonym, not to a real-world identity. Sybil cost is **linear in bond size**, not in friction — N Sybil accounts means N bonds locked. Anonymity preserved at the address layer; the asymmetry the critique worries about ("click to participate") is satisfied because the bond is one-time, not per-action.

Naming note: avoid "Soulbound" — imports Worldcoin/biometric-KYC semantics that do not apply here. Use "stake-bonded pseudonym" (or "bonded pseudonym") as the preferred term.

**Where it lives**: design primitive used across `ShardOperatorRegistry` (`MIN_STAKE = 100e18` as the Sybil-deterrent bond), extended by the future C12 Issuer Reputation module for evidence-bundle signing. See `memory/primitive_gev-resistance.md` and the 2026-04-15 DeepSeek audit response for the design rationale.

**When to use**: any protocol that needs to cap Sybil participation without collecting identity. Particularly valuable in anon-culture environments (memecoin communities, anonymous governance, pseudonymous research) where KYC is a deal-breaker.
