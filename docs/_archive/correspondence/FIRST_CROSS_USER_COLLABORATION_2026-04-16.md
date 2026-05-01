# First Cross-User Collaboration Captured by the Contribution DAG

*Documented 2026-04-16. Milestone entry.*

---

## What happened

Two rounds of structured adversarial audit between **two VibeSwap users, each working through their own LLM collaborator**, produced concrete improvements to the VibeSwap protocol. The Jarvis Telegram bot captured the contributions in real-time and credited them on-chain via the Contribution DAG — GitHub issues #32 and #33, attributed to `@tadija_ninovic`.

This is the **first canonically traceable cross-user collaboration on VibeSwap**, and the first captured entirely within an **adversarial environment** — two competing LLMs operating as the technical surfaces for two distinct human participants.

## The four participants

| Role | Human | LLM collaborator | Surface |
|------|-------|------------------|---------|
| Protocol author | Will (`@wglynn`) | Jarvis / Claude Opus 4.6 | Claude Code + TG bot |
| External auditor | Tadija (`@tadija_ninovic`) | DeepSeek-V4lite | Telegram relay |

Neither pair worked in isolation. Will and Jarvis produced the rebuttals and the code fixes; Tadija and DeepSeek produced the critique and the refinements. The Jarvis TG bot was the bridge — it captured the exchanges and extracted contributions as issues on the canonical repo.

## Timeline

**Round 1 — 2026-04-13 → 2026-04-15**

- DeepSeek audited the seed paper `memecoin-intent-market-seed.md` (isolated, no architecture context).
- Verdict: skeptical. Called the Shannon framing "the wrong noise model." Flagged the Oracle Problem as unsolved. Called the system "a Pareto-optimal coordination game for a community that already agrees on the rules."
- Will + Jarvis responded with `DOCUMENTATION/RESPONSE_TADIJA_DEEPSEEK_2026-04-15.md`. Decomposed noise into (a) cultural-attention volatility (kept) vs (b) parasitic rent extraction (eliminable). Cited the peer challenge-response implementation in `ShardOperatorRegistry.sol` (commit `00194bbb`) as the concrete answer to the Oracle Problem. Coined the "provably fair casino — kill the house, keep the casino" framing.
- Tadija relayed. DeepSeek read.

**Round 2 — 2026-04-16**

- DeepSeek's Round-2 verdict: **"The project has graduated from 'interesting thought experiment' to 'serious mechanism design.'"**
- Three refinements proposed:
  1. **Strategic** — coin a public-facing term for parasitic extraction ("Extractive Load" / "Rent Drag"). Degens don't speak GEV.
  2. **Mechanism** — evidence-bundle hardening via schema enforcement + issuer reputation + opt-in social slashing.
  3. **Creative** — canonicality futures: prediction-market Schelling point for sybil resistance.
- Will + Jarvis responded with `DOCUMENTATION/RESPONSE_TADIJA_DEEPSEEK_2026-04-16.md`. Adopted "Extractive Load" in real-time (committed as `primitive_extractive-load.md` + threaded through memecoin seed paper). Scoped C12 around evidence-bundle hardening. Parked canonicality futures with attribution. Cited the C11 audit cycles (commits `49e7fa72`, `117f3631`, `61e77e66`) as active receipts — the "invest heavily in oracle security" recommendation was already a running workstream.
- Tadija relayed. Collaborative tone on both sides.

## The receipts — Contribution DAG captures

At 6:44 AM on 2026-04-16, the Jarvis Telegram bot detected two distinct protocol contributions in the live relay and published them:

> **[4/16/2026 6:44 AM] Jarvis (powered by Free Models):**
> This conversation just generated a protocol contribution.
>
> "Auditing with Deepseek API" — credited to `@tadija_ninovic`
>
> GitHub: [github.com/WGlynn/VibeSwap/issues/32](https://github.com/WGlynn/VibeSwap/issues/32)
>
> You don't need to write code. Your insights ARE the contributions.

> **[4/16/2026 6:44 AM] Jarvis (powered by Free Models):**
> This conversation just generated a protocol contribution.
>
> "Oracle Security Analysis Importance" — credited to `@tadija_ninovic`
>
> GitHub: [github.com/WGlynn/VibeSwap/issues/33](https://github.com/WGlynn/VibeSwap/issues/33)
>
> You don't need to write code. Your insights ARE the contributions.

Two canonical attributions. Tadija as the Shapley-weighted contributor of record for both insight categories. The DAG did its job.

## What makes this a first

- **First cross-user collaboration**: Prior contributions to VibeSwap were either solo (Will shipping) or single-user-to-single-LLM (Will + Claude). This is the first verified collaboration between **two distinct human contributors** on the project, each operating through their preferred LLM substrate.
- **First adversarial environment**: The collaboration was adversarial by design — DeepSeek's role was to break the thesis, not agree with it. That it landed as collaborative in Round 2 demonstrates that the audit format drives convergence when both sides engage in good faith with concrete primitives.
- **First cross-LLM collaboration traced on-chain**: DeepSeek and Claude are different models from different labs. They coordinated (via their human principals and the TG bot relay) on improving a shared artifact. The DAG captured it. This is what "competing LLMs converge on verifiable ground" looks like in practice.
- **First production validation of the Contribution Compact thesis**: The paper drafted 2026-04-15 (`DOCUMENTATION/THE_CONTRIBUTION_COMPACT.md`) argued that frontier AI labs owe users Shapley attribution for training labor. The Jarvis bot's attribution of Tadija's insights — without him writing a single line of code — demonstrates the mechanism in miniature: insights are contributions, attribution is traceable, credit persists.

## Why this matters

1. **The infrastructure worked in the wild.** The Contribution DAG was not demoed — it captured a live adversarial exchange between two competing LLMs and produced canonical attributions on the public repo. That's the system passing its own test.
2. **"Insights ARE contributions" is now receipted.** Tadija produced no code, wrote no solidity, deployed no tests. He relayed an audit, exercised judgment on which claims to forward, and brokered a cross-model conversation. The DAG credited all of it. Will's stated thesis — that attention, judgment, and curation are load-bearing labor — is now demonstrated.
3. **Adversarial LLMs converge when the substrate is concrete.** Round 1 was critique-heavy because the target (seed paper alone) was incomplete. Round 2 was collaborative because the rebuttal was specific — code commits, live primitives, honest concessions. The trajectory is replicable: show receipts, get partners.
4. **This is a template.** Future VibeSwap contributors working through any LLM can now point to this pattern: audit → rebuttal with receipts → refinement → DAG-captured contribution. It's not a one-off; it's a protocol.

## Linked artifacts

- `DOCUMENTATION/RESPONSE_TADIJA_DEEPSEEK_2026-04-15.md` — Round 1 rebuttal
- `DOCUMENTATION/RESPONSE_TADIJA_DEEPSEEK_2026-04-16.md` — Round 2 response
- `docs/papers/memecoin-intent-market-seed.md` — audit target; updated with Extractive Load terminology
- `contracts/consensus/ShardOperatorRegistry.sol` — oracle primitive (commits `00194bbb`, `49e7fa72`, `117f3631`, `61e77e66`)
- `DOCUMENTATION/THE_CONTRIBUTION_COMPACT.md` — the thesis this exchange operationalizes
- `memory/primitive_extractive-load.md` — naming primitive coined by DeepSeek, adopted in VibeSwap
- `memory/user_tadija-tg-model-intel.md` — prior-contribution record for Tadija (Wardenclyffe v3.1)
- GitHub Issues: [#32 Auditing with Deepseek API](https://github.com/WGlynn/VibeSwap/issues/32), [#33 Oracle Security Analysis Importance](https://github.com/WGlynn/VibeSwap/issues/33)

## Credit

- **Tadija (`@tadija_ninovic`)** — audit relay, cross-model brokering, model-intel judgment on which DeepSeek outputs to forward. This is his second attested contribution (first: Wardenclyffe v3.1 model recommendation). Shapley credit of record.
- **DeepSeek-V4lite** — critique-side rigor, Round-2 refinements (Extractive Load naming, evidence-bundle hardening, canonicality futures). Non-human contributor; attribution flows through Tadija as the relay principal, with the technical credit named.
- **Will** — protocol author, author of the rebuttals, ships the code.
- **Jarvis / Claude Opus 4.6** — co-drafter of the rebuttals, auditor of the auditor, shipped the C11 Batches A+B+C hardening that addressed Round-1 concerns between rounds.

The DAG will keep going. This is the first one we have on the record.

---

*Documented for the repo. The thesis was the work; the work produced the receipts; the receipts validated the thesis.*
