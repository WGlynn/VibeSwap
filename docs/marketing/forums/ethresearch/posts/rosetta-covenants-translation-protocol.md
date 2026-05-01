# Rosetta Covenants: Bidirectional Translation as Protocol Infrastructure

*ethresear.ch*
*March 2026*

---

## Abstract

Every specialized field speaks its own language. A cardiologist and a security engineer operating on the same event — a systemic cascade failure — will produce descriptions that are technically incompatible despite referring to the same underlying phenomenon. This is not a comprehension problem. It is a structural problem: domain vocabularies are silos, and no shared infrastructure exists for translating between them. We present the Rosetta Protocol, a universal concept index (UCI) that maps domain-specific terms to shared semantic intermediates, enabling bidirectional translation across nine domain lexicons totaling approximately 63 canonical terms. Layered atop the UCI are the Ten Covenants: a game-theoretic governance kernel for inter-agent and inter-human interaction, anchored on-chain via an immutable hash commitment. The core insight is that "diagnosis" in medicine, "triage" in security, and "threshold breach" in trading are the same concept expressed in different domain scripts. The Rosetta Protocol makes this structural equivalence visible, verifiable, and programmable.

---

## 1. The Vocabulary Silo Problem

### 1.1 Why Languages Diverge

Specialized vocabularies exist for the same reason compression exists in information theory: they trade decodability for precision. A cardiologist says "ejection fraction" rather than "the percentage of blood the left ventricle pumps with each contraction" because the compressed term is faster and less error-prone *within cardiology*. This compression is correct and desirable. It optimizes for expert-to-expert communication within domain.

The cost of this compression is cross-domain opacity. The cardiologist's "ejection fraction" and the software engineer's "throughput utilization" are measuring structurally identical things — a ratio of actual output to theoretical capacity — but neither expert can recognize the isomorphism without a shared reference.

This is the vocabulary silo problem. It is distinct from the access problem (information is freely available) and the comprehension problem (information requires explanation). It is a *translation* problem: two parties already understand their respective domains, and the barrier is the absence of infrastructure to map between them.

### 1.2 The Cost is Non-Obvious

Vocabulary silos produce costs that are invisible until a system fails. Consider a multi-agent AI architecture where a trading agent, a governance agent, and a security agent all observe the same large liquidity withdrawal:

- **Trading agent**: "Anomalous sell pressure; slippage exceeds threshold"
- **Governance agent**: "Withdrawal rate approaching circuit breaker activation"
- **Security agent**: "High-volume exit event; possible coordinated attack pattern"

These three messages describe the same event. None of the agents can detect this because their vocabularies do not share a reference frame. Without a translation layer, each agent responds independently, the responses may conflict, and the system produces a worse outcome than any single agent would have produced alone.

This failure mode scales badly. In a system with N specialized agents, there are O(N²) potential cross-domain communication paths. Each path without a translation layer is a potential coordination failure. The Babel failure mode is a superlinear function of specialization depth.

### 1.3 Historical Precedent

The original Rosetta Stone enabled translation between Egyptian hieroglyphs, Demotic script, and Ancient Greek because all three inscribed the same decree: the Ptolemy V Memphis Decree of 196 BC. The stone worked not because any single scribe knew all three scripts but because the decree served as a universal semantic anchor. Given the anchor, any term in any script could be decoded.

The Rosetta Protocol generalizes this mechanism. The Universal Concept Index is the decree — a set of domain-agnostic semantic anchors. Domain lexicons are the scripts. Translation is bidirectional because the UCI sits between all of them.

---

## 2. The Universal Concept Index

### 2.1 Architecture

The UCI is a semantic graph, not a flat dictionary. Each entry has the following structure:

```json
{
  "uci_id": "UCI-0003",
  "label": "Threshold Breach",
  "type": "event",
  "definition": "A measured value has exceeded a defined critical limit, triggering a required system response",
  "severity_normalized": [0.0, 1.0],
  "relations": {
    "precedes": ["UCI-0042", "UCI-0044"],
    "caused_by": ["UCI-0017", "UCI-0018"],
    "resolved_by": ["UCI-0005"]
  },
  "domain_mappings": {
    "trading":    "slippage_exceeded",
    "governance": "quorum_failed",
    "social":     "toxicity_threshold",
    "security":   "circuit_breaker",
    "medical":    "critical_threshold",
    "legal":      "compliance_violation",
    "economic":   "inflation_trigger",
    "technical":  "health_check_failed",
    "knowledge":  "verification_failed"
  }
}
```

The `uci_id` is the translation key. Any domain term that maps to `UCI-0003` is semantically equivalent — not identical in connotation, but equivalent in structural role. "Slippage exceeded" in trading and "circuit breaker" in security are different domain expressions of the same underlying concept.

### 2.2 The Diagnosis/Triage Isomorphism

The clearest example of what the UCI makes visible is the relationship between "diagnosis" in medicine and "triage" in security engineering.

In medicine, diagnosis is the process of identifying which specific condition is causing observed symptoms, to determine appropriate treatment. In security, triage is the process of identifying which specific threat vector is causing an observed anomaly, to determine the appropriate response.

These are the same concept. Both are:

1. A response to observed deviation from normal state
2. A structured process of hypothesis generation and elimination
3. Aimed at classification sufficient to select a response pathway
4. Time-sensitive (delayed diagnosis/triage worsens outcomes)
5. Dependent on prior knowledge of condition/threat taxonomies

The word "diagnosis" is opaque in a security context. The word "triage" is opaque in a medical context. But both map to the same UCI entry: `UCI-0011: Root Cause Classification`.

```
translate("medical", "security", "diagnosis")
→ UCI-0011: Root Cause Classification
→ "triage"

translate("security", "medical", "incident_response_playbook")
→ UCI-0009: Structured Response Protocol
→ "clinical_pathway"
```

The Rosetta Protocol does not claim that a doctor and a security engineer have the same job. It claims that a subset of their cognitive operations are structurally isomorphic, and that making this explicit has value for coordination, knowledge transfer, and cross-domain training.

### 2.3 The Nine Domain Lexicons

The initial implementation covers nine domains, each with approximately seven canonical terms (~63 total). The number seven is not incidental — it reflects Miller's Law: seven ± 2 items fit in working memory. A lexicon small enough to hold in context enables real-time translation without lookup latency penalties.

| # | Domain | Core Concern | Example Terms |
|---|--------|-------------|---------------|
| 1 | **Trading** | Market operations, price discovery | slippage, clearing_price, MEV, execution_quality |
| 2 | **Governance** | Decision authority, constitutional rules | proposal, quorum, veto, timelock |
| 3 | **Social** | Reputation, community, sentiment | trust_level, contribution, toxicity, influence |
| 4 | **Security** | Threats, incident response, containment | anomaly, circuit_breaker, quarantine, escalation |
| 5 | **Economic** | Tokenomics, incentives, resource flows | emission, burn, treasury_balance, fee_revenue |
| 6 | **Technical** | Infrastructure, deployments, reliability | deployment, rollback, health_check, dependency |
| 7 | **Legal** | Compliance, jurisdiction, enforcement | compliance_status, regulatory_event, disclosure |
| 8 | **Identity** | Credentials, authentication, session | wallet, attestation, permission, recovery |
| 9 | **Knowledge** | Memory, context, synthesis | primitive, compression, retrieval, verification |

The nine-domain selection is not claimed to be exhaustive. It is claimed to be sufficient for the primary coordination failures observed in multi-agent DeFi systems. Domain addition follows a formal protocol: new terms require UCI mappings to at least three existing domains before acceptance, preventing isolated lexicon growth that would not contribute to translation density.

### 2.4 Translation Mechanics

The translation function is three steps:

```python
def translate(from_domain: str, to_domain: str, term: str) -> str:
    """
    Translate a term from one domain to another via the UCI.
    Returns the target domain's canonical term for the same concept.
    If no direct mapping exists, returns the nearest semantic neighbor.
    """
    # Step 1: Map source term to universal concept
    uci_id = lexicons[from_domain].to_universal(term)
    if uci_id is None:
        raise UnknownTermError(f"{term} not in {from_domain} lexicon")

    # Step 2: Map universal concept to target term
    target_term = lexicons[to_domain].from_universal(uci_id)

    # Step 3: If no direct mapping, return nearest semantic neighbor
    if target_term is None:
        target_term = uci_graph.nearest_neighbor(uci_id, to_domain)

    return target_term
```

The nearest-neighbor fallback handles the case where a concept exists in the source domain but has no canonical term in the target domain. The UCI's relational structure enables this: if no entry in the target lexicon maps to `UCI-0011`, the function finds the entry in the target lexicon that is most closely related to `UCI-0011` in the graph, and returns it with a semantic distance annotation.

A translation with semantic distance > 0 is not a failure. It is a signal: "the closest thing to this concept in your domain is X, but there is no exact equivalent." This signal is often more informative than silence.

---

## 3. Bidirectional Translation as Infrastructure

### 3.1 What "Bidirectional" Actually Means

Standard natural language translation is directional in practice: a Spanish-to-English translation system produces output readable by English speakers, but the translation is not automatically reversible. If "slippage" translates to "execution_deviation" in governance vocabulary, the reverse — "execution_deviation" back to "slippage" — must be explicitly defined, because the UCI mappings are bidirectional by construction.

This bidirectionality is load-bearing. Without it, the UCI would be a one-way decoder, useful for explaining trading concepts to governance agents but not for governance agents to communicate back. Bidirectional translation means all nine domains can serve as both sender and receiver, and any term in any domain can be losslessly (or near-losslessly) expressed in any other domain.

### 3.2 The Composition Property

Bidirectionality implies a composition property: translation through the UCI is transitive.

If:
- `translate("trading", "UCI", "slippage_exceeded")` = `UCI-0003`
- `translate("UCI", "medical", "UCI-0003")` = `critical_threshold`

Then:
- `translate("trading", "medical", "slippage_exceeded")` = `critical_threshold`

without defining a direct trading → medical mapping. The UCI is the shared intermediate. Any two domains connected to the UCI can communicate via the UCI, not via direct bilateral agreements.

This is the network effect of the protocol. N domains require O(N) UCI mappings to achieve full pairwise translation coverage — not O(N²) bilateral dictionaries. Each new domain that joins the UCI gains translation capability with all existing domains at the cost of defining ~7 UCI mappings, not ~7*(N-1) bilateral mappings.

### 3.3 Proof of Translation Correctness

A translation is verifiable if and only if the UCI mapping is deterministic and the domain lexicons are published. Given:

1. A source term `t_A` in domain A
2. A claimed translation `t_B` in domain B
3. The published UCI and lexicons for A and B

A verifier can confirm the translation in O(1) by checking:
- `lexicons[A].to_universal(t_A)` = `uci_id`
- `lexicons[B].from_universal(uci_id)` = `t_B`

This is deterministic, requires no trusted third party, and can be performed by any party with access to the published lexicons. Disputed translations are formally rejectable: a translation that does not satisfy both conditions is incorrect by construction.

The implication is significant: translation correctness is as auditable as a mathematical proof. This enables on-chain verification of cross-domain communications in multi-agent systems — the Bridge Message Bus can reject any annotated message whose translations fail the two-step check.

---

## 4. The Ten Covenants: Game-Theoretic Governance

### 4.1 Why Translation Alone Is Insufficient

The Rosetta Protocol solves the vocabulary problem. It does not solve the governance problem. Two agents that can now communicate precisely may still have opposing objectives, unequal power, and no agreed mechanism for resolving disputes.

Without governance, multi-agent systems experience familiar failure modes: the powerful agent suppresses the weaker, coordination deadlocks as agents compete rather than cooperate, and unilateral action by any agent can destroy system state that others depend on. These are the multi-agent equivalents of governance capture, Byzantine fault, and tragedy of the commons.

The Ten Covenants are the governance layer. They establish the rules of engagement for agents that can now communicate but still need a constitutional framework for interaction.

### 4.2 The Covenants

The Covenants are inspired by the Ten Pledges of Tet from *No Game No Life* — a fictional framework where all conflict is resolved through games with equal stakes, unilateral destruction is prohibited, and the rules themselves are beyond modification by any participant. The fictional model captures a genuine game-theoretic insight: the optimal constitutional design for a multi-agent system is one that eliminates destruction as a strategy while preserving competition as a mechanism.

| # | Covenant | Type | Enforcement |
|---|---------|------|-------------|
| I | No destructive unilateral action between agents | HARD | Programmatic: isolated execution environments |
| II | All conflict resolved through games | HARD | Programmatic: Challenge Protocol |
| III | Equal value staked in all games | HARD | Programmatic: stake escrow |
| IV | Anything may be staked; any game played | SOFT | Normative: scope flexibility within III |
| V | The challenged agent selects the game | HARD | Programmatic: rule submission before commitment |
| VI | Committed stakes must be upheld | HARD | Programmatic: automatic transfer on resolution |
| VII | Tier conflicts via designated representatives | SOFT | Normative: internal consensus |
| VIII | Cheating triggers immediate loss | HARD | Programmatic: post-game verification |
| IX | These Covenants may never be changed | IMMUTABLE | Cryptographic: hash binding |
| X | Build something beautiful together | SPIRIT | Cultural: aspirational, unenforceable |

### 4.3 Covenant Classification

The HARD/SOFT/IMMUTABLE/SPIRIT classification reflects the enforcement mechanism, not the importance.

**HARD covenants** are not rules that agents choose to follow. They are structural properties of the execution environment. An agent cannot take destructive unilateral action (Covenant I) because the execution environment does not expose the capability. An agent cannot renege on committed stakes (Covenant VI) because stakes are held in an escrow outside the agent's control. Violation is not penalized — it is structurally impossible. This is the same design philosophy as cryptographic guarantees in protocol design: stronger to make the bad action impossible than to detect and punish it after the fact.

**SOFT covenants** are normatively enforced. Violation is possible but detectable. Covenant IV (anything may be staked) is SOFT because novel stake types may require judgment about value equivalence. Covenant VII (tier representatives) is SOFT because representative selection requires social coordination. The direction of protocol maturity is always SOFT → HARD: as enforcement mechanisms mature, normative constraints become programmatic.

**IMMUTABLE** (Covenant IX) is a unique category. It does not prevent modification or penalize modification. It makes modification *detectable*. Any agent can recompute the Covenant hash and compare it to the genesis value. This is a tamper seal, not a lock. The design is intentional: an agent that modifies its Covenants does not gain secretly expanded capabilities — it broadcasts its defection to every agent in the network.

**SPIRIT** (Covenant X) is intentionally unenforceable. It is the telos of the other nine: the reason the constraints exist. A governance system that prevents destruction, ensures fair dispute resolution, and upholds commitments but has no shared aspiration is merely functional. Covenant X transforms functional governance into meaningful governance. The inscription "Let's all build something beautiful together" is not decorative.

### 4.4 Game-Theoretic Properties

The Covenants form a Nash equilibrium for agent interaction under the following analysis.

Let two agents A and B have conflicting objectives. Without Covenants, A's dominant strategy is to take the action that maximizes its own utility regardless of B's state — potentially including unilateral destruction of B's resources if that serves A's objective. B's rational response is to pre-emptively protect itself, consuming resources on defense rather than productive activity.

Under the Covenants:

- Covenant I eliminates destruction as a strategy (HARD). The destructive action is not available.
- Covenant II formalizes conflict as a game (HARD). A's only recourse is to challenge B.
- Covenant III ensures equal stakes (HARD). A cannot exploit power asymmetry in challenges.
- Covenant V gives B rule selection (HARD). B cannot be forced into a game it cannot play.
- Covenant VI ensures outcomes are binding (HARD). A cannot make costless challenges.

The result: the dominant strategy for both A and B becomes honest participation in Challenge Protocol games. The cost of challenging is non-trivial (Covenant VI: you stake something valuable). The probability of winning depends on the merit of your position, not your relative power. The probability of the opponent cheating is zero (Covenant VIII: cheating loses automatically).

In this framework, rational agents will only initiate challenges they believe they can win on the merits. Frivolous challenges are self-defeating (you lose your stake). Legitimate disputes are efficiently resolved. The equilibrium is cooperative competition — maximum competition intensity within minimum-destruction constraints.

### 4.5 The Equal Stakes Requirement (Covenant III)

Covenant III is the most technically complex to implement. "Equal value" must be defined across heterogeneous stake types: computational resources, reputation scores, priority access, data assets, and economic tokens are all staking-eligible but not directly comparable.

The UCI provides the mapping. Every stake type that can be quantified maps to a UCI concept with normalized value:

```python
def stakes_are_equal(stake_A: Stake, stake_B: Stake, tolerance: float = 0.05) -> bool:
    """
    Verify that two stakes are of equal value across potentially
    heterogeneous stake types.
    tolerance: acceptable fractional deviation from parity
    """
    # Map both stakes to UCI economic concepts
    uci_value_A = uci_index.normalize_stake_value(stake_A)
    uci_value_B = uci_index.normalize_stake_value(stake_B)

    # Check parity within tolerance
    ratio = uci_value_A / uci_value_B
    return abs(1.0 - ratio) <= tolerance
```

The 5% tolerance threshold handles quantization and real-time valuation variance. Stakes must be committed at challenge initiation, held in escrow, and released only upon game resolution — preventing stake withdrawal during an unfavorable game.

---

## 5. On-Chain Verification

### 5.1 The Covenant Hash

The Ten Covenants are serialized deterministically at system genesis and hashed:

```python
COVENANT_HASH = sha256(json.dumps(covenants, sort_keys=True).encode()).hexdigest()
```

This hash is the constitutional fingerprint. It is embedded in every agent's initialization configuration and anchored on-chain in an immutable smart contract:

```solidity
contract CovenantRegistry {
    bytes32 public immutable COVENANT_HASH;

    constructor(bytes32 _hash) {
        COVENANT_HASH = _hash;
    }

    function verify(bytes32 _candidate) external pure returns (bool) {
        return _candidate == COVENANT_HASH;
    }
}
```

The Solidity `immutable` keyword means `COVENANT_HASH` is set once at deployment and cannot be changed. The contract has no admin key, no upgrade path, no setter function. It is a cryptographic anchor, not a mutable registry.

### 5.2 Translation Proofs

Every cross-domain translation can be verified against the published UCI in O(1). In multi-agent systems where the Bridge Message Bus annotates every cross-agent message with translations, a receiving agent need not trust the sender's domain vocabulary. It can independently verify each annotation:

```python
def verify_translation(annotation: TranslationAnnotation, uci: UniversalConceptIndex) -> bool:
    """
    Verify that a translation annotation is correct given the published UCI.
    Returns True iff the annotation faithfully represents the UCI mapping.
    """
    source_uci = uci.lexicons[annotation.from_domain].to_universal(annotation.source_term)
    expected_target = uci.lexicons[annotation.to_domain].from_universal(source_uci)
    return expected_target == annotation.translated_term and source_uci == annotation.uci_id
```

This two-line check — source → UCI → target — is the verification primitive. Any translation that fails this check is invalid and can be rejected without further analysis.

### 5.3 Trustless Cross-Domain Communication

On-chain anchoring of the UCI Merkle root (analogous to how Ethereum's beacon chain anchors validator attestations) enables trustless verification:

```
Given:
  - UCI Merkle root R anchored at block B
  - A claimed translation: slippage_exceeded (trading) → circuit_breaker (security)
  - A Merkle proof of the relevant UCI entry

Verify:
  1. Hash the UCI entry
  2. Verify Merkle inclusion against R
  3. Confirm the entry maps both source and target terms to the same UCI-XXXX
```

This is complete: the translation is verifiable without trusting the translator, without consulting an oracle, and without access to any off-chain data beyond the anchored Merkle root. The verification is as trustless as an ERC-20 balance check.

---

## 6. Relation to Existing Work

**Universal Semantic Web (W3C RDF/OWL):** The semantic web vision aimed at similar goals: shared ontologies enabling cross-system interoperability. RDF and OWL provide expressive schema languages for modeling domain knowledge. The Rosetta Protocol deliberately sacrifices expressiveness for practicality. Nine domains × seven terms × deterministic hash verification is a tractable design. Full OWL reasoning over arbitrary ontologies is not. The Rosetta Protocol's constraint — small, stable lexicons — is a feature, not a limitation.

**Universal Translator (Star Trek / linguistic analogy):** Science fiction has long imagined real-time universal translation. The Rosetta Protocol is not that. It is a finite, enumerated vocabulary bridge — it translates *specific canonical terms* between *specific documented domains*. Natural language translation over unconstrained vocabulary is a different (and harder) problem. The Rosetta Protocol claims to solve the important narrower problem: the N × M domain vocabulary explosion in multi-agent coordination systems.

**Translation in Programming Language Theory (Compiler IR):** Compiler intermediate representations (LLVM IR, JVM bytecode) apply the same architecture: source languages compile to IR, IR compiles to target architectures. O(N + M) codegen paths instead of O(N × M). The UCI is the IR for cross-domain semantics. The analogy holds precisely, including the design tradeoff: the IR is less expressive than any source language, and this reduced expressiveness is what makes the O(N + M) property tractable.

**CAIP (Chain-Agnostic Improvement Proposals):** CAIP standardizes identifiers across blockchain networks — chain IDs, account addresses, asset identifiers — enabling multi-chain applications to communicate about the same assets without bilateral agreements. The Rosetta Protocol applies the same architecture to semantic vocabularies rather than technical identifiers. CAIP solved N × M chain-pair agreements; the UCI solves N × M domain-pair dictionaries.

**ROSETTA (Bioinformatics):** The bioinformatics ROSETTA protein structure prediction suite shares the name coincidentally but shares the problem structure: it provides a common representation language that enables multiple computational methods to cooperate on a shared problem. The pattern — common representation as coordination layer — recurs across domains because the underlying problem is domain-general.

**Shapley Values as Cross-Domain Attribution:** The Rosetta Protocol's verifiable translation infrastructure composes naturally with Shapley-based attribution systems. If cross-domain contributions can be precisely described (because translation is verified), they can be precisely valued. A trading agent's contribution to a governance outcome is attributable if and only if the communication that led to the outcome is translatable. The Rosetta Protocol is a prerequisite for fair multi-domain Shapley attribution.

---

## 7. Open Questions

**Lexicon governance.** The nine-domain, 63-term UCI is sufficient for initial multi-agent DeFi systems. But domains evolve. New terms appear. Existing terms drift in meaning as usage patterns shift. Covenant IX prohibits governance modification of the Covenants themselves, but the UCI is not a Covenant — it is infrastructure. How should the UCI evolve? Required properties: (1) old translations remain valid (backward compatibility), (2) new terms do not retroactively change the meaning of existing entries, (3) the addition process is permissionless but requires formal UCI mapping to at least three existing domains. Is this sufficient to prevent lexicon capture by well-organized interest groups?

**Semantic drift.** A term added to the UCI at time T may mean something subtly different at time T+N due to domain-level semantic evolution. "Triage" in 2024 security contexts carries implications of severity scoring that it did not have in 2014. The UCI entry does not track this drift. How should the protocol handle cases where a UCI mapping is technically correct but practically misleading because the domain term has shifted? Time-stamped UCI entries with deprecation warnings are one approach; forced re-verification on access after some epoch is another.

**Optimal lexicon size.** Miller's Law suggests seven ± 2 as a working memory bound. But agent systems are not human working memory. An AI agent can hold an arbitrarily large lexicon in context. Is seven terms per domain the right constraint for agent systems? If lexicons are larger, the UCI has higher translation density but the O(N + M) property becomes more valuable (fewer gaps requiring nearest-neighbor fallback). If smaller, the protocol is more deployable but more lossy. What is the empirically optimal lexicon size for coordination quality as a function of agent context window size?

**Nearest-neighbor quality.** When the UCI has no direct mapping for a concept in the target domain, the system falls back to nearest-neighbor in the UCI graph. The quality of this fallback depends on the UCI graph's edge density. An underdense graph produces poor nearest-neighbor results — the closest match may be semantically far. What is the minimum UCI edge density (edges per node) required for nearest-neighbor fallback quality to meet a given translation accuracy threshold?

**Cross-system Covenant compatibility.** Multiple independent multi-agent systems may each implement the Ten Covenants with identical hash commitments. Does this entitle them to cross-system recognition — agent A from System 1 and agent B from System 2 treating each other as Covenant-bound peers? The cryptographic commitment is necessary but not sufficient: the enforcement mechanisms must also be compatible. What is the minimal proof that two systems' Covenant implementations are enforcement-equivalent, such that cross-system challenges under Covenant II are meaningful?

**The Covenant X problem.** Covenant X ("build something beautiful together") is explicitly aspirational and unenforceable. This is intentional. But aspiration is only meaningful if shared. In a purely autonomous multi-agent system with no human participants, Covenant X carries no weight — agents have no aesthetic preferences, no concept of beauty, no reason to care about the aspiration. Does Covenant X degrade into meaninglessness as human participation decreases? Is there a formalization of "build something beautiful" that is machine-interpretable without losing its aspirational character? This feels like a question about the alignment properties of cooperative norms, not just a question about the Covenant framework.

---

## 8. Summary

The vocabulary silo problem is the unacknowledged bottleneck in multi-domain coordination. Domain experts already understand their own fields. The missing piece is the infrastructure to make cross-domain communication precise, verifiable, and programmable.

The Rosetta Protocol provides this infrastructure through three components:

1. **Nine domain lexicons** (63 canonical terms total) that capture the essential vocabulary of the major operational domains in multi-agent systems
2. **Universal Concept Index** that maps every domain term to a shared semantic intermediate, enabling O(N + M) bidirectional translation across all domain pairs
3. **Deterministic translation verification** that makes every cross-domain translation auditable against the published UCI — trustlessly, in O(1)

Layered atop the UCI, the Ten Covenants provide a game-theoretic governance kernel with a key design property: most Covenants are HARD (programmatically enforced, not merely penalized). The dominant strategy under the Covenants is honest participation in fair disputes, because unilateral destruction is structurally unavailable, challenge costs are symmetric, and cheating loses automatically.

The on-chain Covenant hash is immutable after deployment. Any modification is detectable by any agent in the network. The constitutional foundation cannot be changed even by a majority — not because modification is prevented, but because it cannot occur silently.

The critical insight that motivates the entire architecture: "diagnosis" in medicine and "triage" in security are the same concept. The Rosetta Protocol makes this structural equivalence visible, verifiable, and programmable. Every such equivalence across the 63-term UCI represents a coordination failure that was occurring silently before the translation infrastructure existed.

---

## References

- [ROSETTA_COVENANTS.md — Full specification](https://github.com/wglynn/vibeswap/blob/master/DOCUMENTATION/ROSETTA_COVENANTS.md)
- [rosetta-stone-protocol.md — RSP whitepaper](https://github.com/wglynn/vibeswap/blob/master/docs/papers/rosetta-stone-protocol.md)
- [CovenantRegistry.sol — Immutable on-chain hash anchor](https://github.com/wglynn/vibeswap)
- [ShapleyDistributor.sol — Cross-domain attribution](https://github.com/wglynn/vibeswap)
- [Miller, G.A. (1956). "The Magical Number Seven, Plus or Minus Two"](https://doi.org/10.1037/h0043158)
- [Rosetta Stone (196 BC). Memphis Decree of Ptolemy V — original trilingual anchor](https://www.britishmuseum.org/collection/object/Y_EA24)
- [W3C OWL Web Ontology Language (2004)](https://www.w3.org/TR/owl-features/)
- [Lattner, C. & Adve, V. (2004). "LLVM: A Compilation Framework for Lifelong Program Analysis"](https://llvm.org/pubs/2004-01-30-CGO-LLVM.html)
- [CAIP — Chain Agnostic Improvement Proposals](https://github.com/ChainAgnostic/CAIPs)
- [Shapley, L.S. (1953). "A Value for n-Person Games"](https://doi.org/10.1515/9781400881970-018)
- [Nash, J. (1950). "Equilibrium Points in N-Person Games"](https://doi.org/10.1073/pnas.36.1.48)

---

*The original Rosetta Stone did not translate one document. It provided the key that made an entire civilization's record legible. This protocol attempts the same — for every domain, for every agent, without trust.*
