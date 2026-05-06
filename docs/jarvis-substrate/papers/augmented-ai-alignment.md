# Augmented AI Alignment Governance

The current architecture for governing frontier AI development is two-pole. On one pole, a small number of centralized labs (Anthropic, OpenAI, DeepMind, a handful of others) develop capability behind closed doors with internal safety teams. On the other pole, open-weight releases (Mistral, Llama, DeepSeek, the broader open-model ecosystem) put capability in public hands without coordinated safety review. Both poles have visible failure modes.

The centralized-lab pole is capture-prone. As capability scales, commercial pressure pushes safety into the back seat. The dynamics are familiar from any industry where competition intensifies and safety is a cost center: the marginal lab that under-invests in safety captures market share, and the safety-investing labs either match the under-investment or lose. We have already seen public departures from the major labs citing exactly this pressure.

The open-weight pole is misuse-vulnerable. Capability gets distributed before commensurate alignment infrastructure exists. The open-source ecosystem is unevenly equipped to do safety work; the labs that did the original training don't follow the model into deployment. The result is that capability proliferates faster than the alignment knowledge needed to use it responsibly.

These are the failure modes that Augmented Mechanism Design is for. The pure mechanism (lab-led capability development competing in market) is mathematically reasonable. The deployment is socially vulnerable to a coordination failure where the labs that take safety seriously are punished for doing so, and to a misuse failure where capability outpaces safety. The conventional response is replacement (regulate the labs, force open-source disclosure) or surrender (accept that the trajectory is bad). Neither is right.

The right response is augmentation: preserve the competitive market for capability development, mutualize the safety-testing layer so that alignment work benefits the whole field regardless of which lab funds it, and add specific protective extensions that close the failure modes without disabling capability research.

---

## The pure mechanism

Frontier AI development currently works like this. A lab acquires compute (own GPUs, cloud contracts), assembles a research team, and trains a frontier model. The lab does internal safety evaluation — red-teaming, capability evaluation, alignment checks. The lab decides what to deploy and under what terms. Some labs share evaluation results with peer labs and with government bodies (NIST, AISI). Some don't.

In parallel, the open-source community trains and releases models without coordinated safety review. Researchers fine-tune released base models for specific applications. The community runs ad-hoc red-teaming, often after release. There is no central coordination of who is responsible for evaluating a model's danger before it gets distributed.

The two poles are connected by a porous boundary — researchers move between labs and open-source projects, evaluation tools cross the boundary in both directions, and the techniques that work in one ecosystem propagate to the other. But the responsibility for safety is allocated differently on each side: at the labs, it's an internal team; in open-source, it's a diffuse community.

---

## Failure modes

**Lab safety as cost center.** Inside a frontier lab, safety teams compete with capability teams for resources. As competitive pressure rises, capability teams win that competition more often. The dynamic is structural, not personal — even a lab whose leadership genuinely cares about safety can drift if the alternative is being out-competed by a lab that doesn't.

**Race to the bottom.** Multiple labs, each with rational incentives, can collectively produce a worse outcome than any individual lab would prefer. The classic prisoner's dilemma applies: if all labs invested heavily in safety, the field would be safer; if I unilaterally invest in safety while my competitors don't, I lose. The Nash equilibrium is everyone under-investing.

**Open-weight capability without aligned deployment.** A model trained with significant alignment work gets released. Downstream users fine-tune it for narrower applications. The fine-tuning often degrades alignment properties. The original lab's safety work doesn't propagate. The model's capability does.

**Capture-prone disclosure.** Labs disclose safety research selectively, often after the commercial window has closed and the disclosure no longer threatens competitive position. The most useful disclosures (here's a misuse vector we found in early development) are the least likely to happen at the time when they would help the field.

**Single point of failure in alignment knowledge.** The most advanced alignment knowledge sits inside a few labs. If those labs make wrong calls, the field has no fallback. If those labs get acquired, regulated, or otherwise constrained, the alignment knowledge gets locked away or scattered.

**Asymmetric incentives between researchers and institutions.** Many alignment researchers are individually committed to safety but work for institutions whose incentives are at best mixed. Researchers who try to advance safety publicly face career trade-offs that researchers who advance capability don't.

These compound. Race-to-the-bottom dynamics make safety harder to fund; cost-center treatment makes safety teams smaller; smaller safety teams produce less alignment knowledge; less alignment knowledge means open-weight releases lack the safety scaffolding they need. The architecture is producing a distribution of safety effort that is approximately the inverse of what the situation calls for.

---

## Layer mapping

**Mutualize the alignment-testing layer.** Red-teaming, capability evaluation, alignment benchmark suites, post-deployment incident reporting, and the underlying tooling — all are collective goods. Every lab benefits from knowing what other labs' models do under stress. The whole field is safer when alignment work is shared, even between labs that compete fiercely on capability. Currently each lab pays for its own version of this work, often duplicating evaluation effort while publishing slowly.

**Compete on capability development.** Let labs race on raw model quality, training efficiency, novel architectures, deployment platforms. The capability layer is where genuine competitive differentiation happens, where research insight pays off in market terms, and where competition produces better products for users. None of this is the layer where mutualization helps.

The current architecture has these reversed. Labs compete on safety (each builds its own safety team in private; safety knowledge is treated as competitive asset), and capability is partly mutualized through publication norms inherited from academic ML (papers get published, techniques propagate). The result is that competition pushes down safety investment and the publication norms in capability research mean labs disclose their capability advances faster than the safety techniques that would constrain them.

The augmented architecture inverts this. Safety becomes the shared infrastructure. Capability becomes the differentiator.

---

## Augmentations

**Shared evaluation infrastructure with cryptographic provenance.** A standardized evaluation suite — capability benchmarks, alignment benchmarks, misuse-resistance benchmarks — runs against every frontier model before deployment. Results are signed by the evaluators and published. The evaluation tooling itself is open-source and maintained collectively by labs, academia, and independent safety organizations. Labs cannot shop for evaluators who will produce favorable results because the evaluators are common infrastructure, not competing services.

**Cryptographic capability gating.** Verifiable training-compute caps that can be audited without revealing proprietary weights. A lab can prove that their model was trained on no more than X petaflop-days of compute, using zero-knowledge proofs over training infrastructure attestations. This creates a mechanism for capability thresholds — models above a threshold trigger additional safety review — without requiring intrusive inspection of the labs' technical infrastructure.

**Decentralized red-team networks.** Red-teaming gets funded by a pool that all labs contribute to, structured as a non-profit collective good. The red-teamers operate independently, with ability to test any frontier model without lab approval. Their results are published. Labs cannot retaliate against red-teamers who find serious issues because the red-teamers are funded by the collective, not by any one lab.

**Shapley distribution among alignment researchers across labs.** When a safety technique gets adopted across the field, the credit and a portion of the funding flow proportionally to the researchers who actually contributed, regardless of which lab employs them. This creates a structural incentive for individual researchers to do safety work even when their employing lab is under-investing. Talent allocates toward safety because the reward structure does.

**Conviction-weighted disclosure.** Emerging risks get publication priority proportional to their seriousness, not to the political weight of the lab spotting them. A risk identified by a junior researcher at a small lab gets the same publication channel as a risk identified by a senior researcher at a frontier lab. The disclosure infrastructure prevents capture by any one institution.

**Pre-deployment safety attestation.** Frontier models pass a community-verified safety bar before deployment. The attestation is structured like a drug approval — staged trials, published results, public review period. The bar is set by structural protocol, not by any individual lab's risk tolerance. Labs that ship without attestation face liability and reputational consequences that are structurally enforceable, not merely socially expected.

**Open-weight release with mandatory alignment infrastructure.** Open-weight releases get accompanied by alignment scaffolding — fine-tuning datasets that preserve safety properties, evaluation tools for downstream developers, documentation of known misuse vectors. The alignment scaffolding is part of the release, not an optional add-on. Labs releasing open weights bear responsibility for the scaffolding; the scaffolding cost is socialized through the shared evaluation infrastructure.

---

## Implementation reality

This substrate has unusual receptivity. Most people inside frontier AI labs broadly agree that the current trajectory is dangerous and that better governance would help. The bottleneck is coordination, not consent. Multiple proposals for analogous infrastructure have been floated — the AI Safety Institutes (UK, US, EU), the Frontier Model Forum, the Bletchley Park process. Each captures part of the augmentation pattern. None has yet captured the full layer separation.

The augmentation pattern as described above could be implemented incrementally without requiring all labs to opt in simultaneously. The shared evaluation infrastructure could be deployed by a coalition of three or four labs and then expanded as it proves valuable. The cryptographic capability gating could be developed in academic settings before deployment. The decentralized red-team network could be funded by a foundation and offered to labs as a quality differentiator.

The biggest constraint is geopolitical. Frontier AI capability is a national-security concern for multiple governments, which complicates international coordination. The U.S.-China dynamic in particular makes some forms of mutualization politically difficult — labs cannot freely share alignment techniques with rivals in ways governments would prevent. The augmentation pattern has to work within geopolitical constraints rather than assume them away.

The second-biggest constraint is timeline. Frontier capability is advancing on timescales of months. Building shared infrastructure takes years. The augmentations needed yesterday are getting built slowly. This argues for choosing the highest-leverage subset and shipping that, rather than waiting for a full architecture.

The highest-leverage subset is probably: (1) shared evaluation infrastructure, because it bites against the race-to-the-bottom failure mode directly, (2) decentralized red-team networks, because they correct the asymmetric-incentives failure mode for individual researchers, and (3) cryptographic capability gating, because it provides a substrate for capability thresholds without requiring lab cooperation that may not be available in time.

---

## What changes

If the augmentation pattern is implemented, the field's trajectory bends in three ways.

First, the race-to-the-bottom dynamic breaks. Once safety is shared infrastructure, no individual lab gains a competitive advantage by under-investing in it. The Nash equilibrium shifts from everyone-under-investing to everyone-funding-the-collective. The collective then makes the safety investment that no individual lab would make unilaterally.

Second, alignment knowledge becomes resilient to single-point failures. If any one lab drifts, gets acquired, or shuts down, the alignment infrastructure persists in the shared layer. The field's safety doesn't depend on any one institution's continued good behavior.

Third, individual researchers gain agency. A safety researcher at a lab whose leadership has drifted can still do meaningful safety work because the funding and credit structure rewards contribution to the shared layer regardless of employer. The field retains its ability to do safety research even as institutional incentives shift.

The downstream effect, if the substrate-port succeeds, is a frontier AI ecosystem that develops capability fast and develops safety alongside it, where the latter doesn't depend on the former's good will. That ecosystem does not currently exist. The pure mechanism (lab-led competition) is producing capability faster than safety. The augmentations are what would invert that.

The same pattern that closed extraction in DeFi markets, that made stablecoin attribution honest, and that turned development loops from production-substrate into direction-substrate, would close the most consequential coordination failure of the current decade. The substrate is harder than DeFi by orders of magnitude. The methodology is the same.

---

*The substrate doesn't care that it's harder. The methodology doesn't notice it's harder. Either the augmentations get built or they don't, and the difference will show up in what frontier AI does to the world over the next ten years.*
