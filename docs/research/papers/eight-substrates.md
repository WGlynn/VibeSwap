# Eight Substrates

The methodology I work in is called Augmented Mechanism Design. The argument is short. Pure economic mechanisms are mathematically elegant but socially vulnerable. The right response to that vulnerability is augmentation, not replacement — preserve the competitive core, add orthogonal protective extensions that close the failure modes without disabling what already works. The philosophy underneath, Cooperative Capitalism, says: mutualize the risk layer, compete on the value layer. Layer separation enforces structural honesty.

Four substrates have already been worked through under this methodology. VibeSwap applies it at the EVM substrate, eliminating MEV through commit-reveal batch auctions while preserving market price discovery. USD8 applies it at the stablecoin substrate, layering insurance and order-enforcement on top of dollar peg without recreating central authority. JARVIS applies it at the AI substrate, augmenting Claude's cognition with hooks, persistence, and discipline gates without replacing the underlying model. Augmented dev loops apply it to the development process itself, conditioning parallel-agent loops on explicit intention plus mutualized protective gates.

The substrate changes each time. The methodology doesn't. That recursion — the same pattern producing useful systems across substrates that don't share much else — is the strongest argument that the methodology is real, not DeFi-specific.

This paper extends the demonstration to eight more substrates, all outside DeFi. The point is not detailed implementation. The point is to show what AMD looks like when applied at scale across the failure modes that matter most. Each substrate gets the same treatment: identify the pure mechanism, name the failure modes, map the cooperative and competitive layers, sketch the augmentations.

If the methodology generalizes, the universality is structural — and what looks like a DeFi pattern is actually a design pattern that DeFi happened to demonstrate first.

---

## 1. Scientific research funding

**The pure mechanism**. Peer review allocates grants and decides what gets published. Citation counts retroactively validate impact. Funding committees and editorial boards are the gating layer.

**Failure modes**. Reviewer cliques gate-keep their fields, citing each other and rejecting threats to their position. Novelty bias over replication — novel claims get funded; replications get rejected as "not significant enough" even though replication is what validates science. Slow allocation cycles in fast-moving fields. The replication crisis itself: psychology, biomedicine, and cancer research have all documented that more than half of published "significant" findings fail to replicate. The current alternatives are gatekept (NIH, NSF, Wellcome) or attention-driven (preprint servers, social-media-as-publication). Both have failure modes. Neither does the work the institutional system is supposed to do.

**Layer mapping**. Mutualize the replication and validation layer. Failed replications are collective protection — when a finding doesn't replicate, every researcher in the field benefits from knowing. Replication should be funded as collective infrastructure, not as a one-off researcher's volunteered second-class work. Compete on the novel claim layer. Researchers should fight freely for novel discoveries, with low barriers to publishing initial findings.

**Augmentations**. Shapley distribution among original authors, replicators, and validators — if a finding gets cited a thousand times, the citation reward flows proportionally to the people who actually validated it, which is often the replicators, not the original authors. Prediction-market validation of claims before funding — aggregate experts' beliefs about whether a claim will replicate, fund the claims with the highest validated-belief × novelty product. Retroactive impact funding for research that turned out to matter, paying upstream contributors years after the fact when impact becomes measurable. Time-weighted reviewer reputation — reviewers whose recommended papers replicate gain reputation; reviewers whose picks don't, lose it.

**Distinctive**. The failure mode is most visible in fields where stakes are highest. Patient capital and scientific capital have different time horizons, and the current funding system optimizes for the wrong one. AMD applied here would invert the incentive — fund the work that produced lasting truth, not the work that produced novel-sounding initial claims.

---

## 2. Healthcare allocation

**The pure mechanism**. Insurance markets price risk, providers compete on care delivery, and outcomes are nominally measured by patient health. The U.S. variant is heavily insurance-mediated. Single-payer variants are state-allocated.

**Failure modes**. The U.S. system optimizes for billing extraction — defensive medicine, surprise billing, coding upcharges, and a whole layer of intermediaries who skim without delivering care. Single-payer systems gatekeep through queues, treatment denials, and slow approval cycles. Both fail in the false-dichotomy way: extraction or exclusion. Patients get the worst of both worlds in mixed systems where insurers and providers negotiate around them while the patient pays the residual.

**Layer mapping**. Mutualize the catastrophic-care risk layer. This is partially done already — that is what insurance is supposed to be — but the mutualization is incomplete because adverse selection, moral hazard, and information asymmetry let insurers cherry-pick risks while shifting losses to the public. Compete on the care-quality value layer. Hospitals and providers should differentiate on measurable patient outcomes, not on billing-pathway optimization.

**Augmentations**. Parametric outcome-based payments — providers paid for measurable patient outcomes (recovery rates, quality-adjusted life years gained, complication-free discharges) rather than procedure counts. Shapley distribution between primary-care physicians, specialists, insurers, and patients for any given case, so the credit and the cost both flow proportionally to actual contribution. Anti-extraction gates on billing pathways — surprise billing, bundled-charge gaming, and similar extraction patterns made structurally unprofitable through automated detection and refund. Public-good catastrophic mutualization with private competition on quality of care.

**Distinctive**. This is a direct port of USD8's parametric-insurance design at a much larger substrate. The same Shapley-axiom protection that makes the cover pool honest at the DeFi scale would make claims processing honest at the healthcare scale. The substrate is harder — physical care delivery has dimensions that DeFi doesn't — but the math of fair mutualization is identical.

---

## 3. Carbon markets

**The pure mechanism**. Cap-and-trade systems set emissions limits and let polluters trade allowances. Voluntary carbon credit markets let companies offset emissions by buying credits from emission-reduction projects.

**Failure modes**. Additionality fraud — credits sold for emissions reductions that would have happened anyway. Double-counting — same credit sold to multiple buyers. Gaming offset projects — protected forests that would not have been logged anyway, or projects that count avoided emissions from baselines that were artificially inflated. Intermediary extraction — registries and certifiers taking thirty percent or more of the credit price. Investigative journalism over the past five years has converged on roughly one verdict: most voluntary carbon markets are theater.

**Layer mapping**. Mutualize the verification layer. Offset validity is a collective good — if one bad credit gets sold, every honest credit is worth less. Verification needs to be honest or the whole market dies. Compete on the offset-project layer. Once verification is structurally honest, project developers should compete freely on cost-per-ton-reduced.

**Augmentations**. Cryptographic verification of offsets — satellite imagery, IoT sensor data, and ground-truth measurements anchored on-chain with the data sources cryptographically attested. Shapley distribution of climate finance to actual emission reducers, not intermediaries — credit revenue flows proportionally to the parties whose actions actually produced the reduction. Anti-extraction gates against registry capture — registry fees capped structurally rather than competed away by network effects. Retroactive verification — credits valued not at issuance but after measured emissions data is available, so projects that sold credits for reductions that didn't materialize get clawed back.

**Distinctive**. This substrate is desperately underserved by structural-honesty thinking, and the stakes are catastrophic. The current carbon market is the closest thing we have to a real-world stress test of "what happens when extractive markets are allowed to govern outcomes that depend on actual physical truth." The answer has been: nothing good. AMD applied here would not be theoretical refinement — it would be the difference between offsets that work and offsets that don't.

---

## 4. Content moderation

**The pure mechanism**. Centralized platforms (large social networks) moderate through internal teams and AI classifiers. Decentralized platforms (early Mastodon, 4chan) approximate no moderation.

**Failure modes**. Centralized moderation is capture-prone (advertiser pressure, government pressure, internal politics), opaque (decisions are made without explanation), and inconsistent (similar content treated differently based on who posted it). No-moderation environments amplify extremism, harassment, and coordinated inauthentic behavior — the failure mode is on the user-safety side rather than the censorship side, but it is just as bad.

**Layer mapping**. Mutualize the safety layer. Harassment, doxxing, illegal content, and coordinated inauthentic behavior are collective risks — every user is worse off when these are present, and protecting against them is a collective good. Compete on the discovery and recommendation layer. Algorithms, curators, and creators should compete freely on what constitutes good content for any given audience.

**Augmentations**. Layered Shapley-style trust scores — users earn trust through verified positive engagement over time; trust scores condition reach. Structural transparency — every moderation action logged with reason hash on a public ledger, so patterns of capture become detectable. Conviction-voting appeals — appeals that gain support over time get re-reviewed; flash mobs cannot game the appeals process. Time-weighted reputation that cannot be bought — same temporal-irreducibility property as Proof of Mind. Decentralized algorithm marketplace — let multiple recommendation algorithms compete, with users choosing which to subscribe to, while the safety layer remains common.

**Distinctive**. Bluesky and the AT Protocol are stumbling toward parts of this — the algorithmic-marketplace piece especially. The structural argument they're missing is the layer separation. Right now they're trying to do everything decentralized, which under-protects the safety layer. AMD applied here would say: protocol-level safety mutualization, application-level discovery competition.

---

## 5. AI alignment governance

**The pure mechanism**. Centralized AI labs (Anthropic, OpenAI, DeepMind) develop frontier models with internal safety teams. Open-weights releases (Mistral, Llama) put capability in public hands without coordinated safety review.

**Failure modes**. Centralized lab governance is capture-prone — economic pressure pushes safety into the back seat as competition intensifies. Open-weights releases are misuse-vulnerable — bad actors get capability without commensurate safety infrastructure. The current dichotomy is "trust one lab" versus "trust nobody" and both are visibly insufficient as model capabilities scale.

**Layer mapping**. Mutualize the alignment-testing layer. Red-teaming, evaluation suites, capability benchmarks, and safety audits are collective goods — every lab benefits from knowing what other labs' models do under stress, even if one lab pays for the research. The whole field is safer when alignment work is shared, even between competitors. Compete on raw capability development. Let labs race on model quality, training efficiency, novel architectures.

**Augmentations**. Cryptographic capability gating — verifiable training-compute caps that can be audited without revealing proprietary weights. Shapley distribution among alignment researchers across labs — credit and funding flow to whoever actually contributes to safety, regardless of which lab employs them. Decentralized red-team networks paid by the community of labs, with results shared openly. Conviction-weighted disclosure — emerging risks get attention proportional to their seriousness, not proportional to which lab spotted them. Pre-deployment safety attestation — frontier models pass a community-verified safety bar before deployment, similar to drug approval but with cryptographic proof of testing.

**Distinctive**. The current trajectory is one or two labs holding most of the frontier capability and most of the alignment knowledge. This concentrates risk catastrophically — if either the labs make a mistake or someone outside the labs catches up without alignment work, the outcomes are bad. AMD applied here would distribute the alignment work without giving up the labs' ability to compete on capability. This substrate also has the rare property that the people building the substrate (researchers) generally agree it needs structural improvement, which makes mechanism-design proposals easier to land than in markets where incumbents resist change.

---

## 6. Patent and IP

**The pure mechanism**. Twenty-year defensive monopoly on inventions, with licensing markets for commercialization. The thesis is that monopoly profits incentivize R&D investment.

**Failure modes**. Patent trolls — entities that buy patents specifically to extract licensing fees from operating companies, contributing nothing to the underlying innovation. Defensive hoarding — large companies accumulate patent portfolios specifically to deter competitors, not to commercialize. Knowledge silos — patented techniques can't be openly built on for two decades, slowing whole industries. Software patents in particular are widely understood as broken. The current alternatives are jurisdictional fragmentation (which patents apply where) and increasingly elaborate defensive arrangements (patent pools, defensive publications, OIN).

**Layer mapping**. Mutualize the upstream-knowledge layer. Basic research, foundational techniques, and reference implementations are collective goods — locking them up for twenty years slows everyone. Compete on commercial application. Downstream products fight freely in market for users.

**Augmentations**. Structural Shapley distribution of innovation credit — when a downstream product commercializes successfully, a portion of revenue flows automatically to upstream contributors, without licensing negotiation. Retroactive funding for foundational work — once a foundation paper or tool turns out to have enabled a major commercial success, the upstream gets paid. Anti-troll gates that require genuine product use within a defined window — patents that aren't being commercialized within (say) five years revert to a commons. Open commons for foundational knowledge with revenue-sharing on derivative commercial work.

**Distinctive**. Patent law is jurisdictional, which makes substrate-level changes hard. The substrate-port argument here works as a "what would IP look like if designed honestly today" thought experiment — and as a working alternative for industries (open-source software, biotech research consortia) that have already opted out of the patent system. The augmentation pattern doesn't need to replace patent law; it needs to demonstrate a parallel system that works better, and let the better system win on substrate-port grounds.

---

## 7. Journalism

**The pure mechanism**. Paywalled outlets sell subscriptions or institutional access. Ad-driven outlets sell attention. Aggregators rebroadcast both.

**Failure modes**. Paywalls exclude the readership that needs reporting most. Ad-driven outlets optimize for engagement, which produces clickbait, outrage cycles, and dark patterns. Aggregators capture revenue without funding original reporting, hollowing out the source layer. The replication of bad incentives across the industry has produced the broadly-acknowledged decline of local journalism, the rise of misinformation as a profitable category, and the inability of even well-funded outlets to consistently fund expensive original reporting.

**Layer mapping**. Mutualize the verification layer. Fact-checking, source verification, and primary-source archival are collective goods — everyone in the information ecosystem is better off when bad information is reliably caught. Compete on the reporting layer. Journalists should fight freely for original stories, distinct angles, and quality writing.

**Augmentations**. Shapley revenue distribution to original-source contributors versus aggregators — when a story goes viral after being picked up by aggregators, the primary reporter gets paid proportionally to their actual contribution, not to who has the larger distribution. Reputation-weighted byline credibility — journalists' track records on accuracy, retractions, and source verification become portable across outlets. Structural fact-check incentives — fact-checking as a paid public-infrastructure layer, not as one outlet's volunteered overhead. Anti-extraction gates against ad-network capture — content recommendation tied to reporting-quality metrics, not engagement-per-click.

**Distinctive**. Substack and other creator-economy platforms have addressed parts of this — bypassing the ad-driven middle to let writers monetize direct readership. The structural argument they're missing is the verification layer. Substack writers can be brilliant or wrong; readers have no structural protection against the wrong ones building large followings. AMD applied to journalism would build the verification layer as common infrastructure under the creator-economy substrate.

---

## 8. Validator networks

**The pure mechanism**. Proof-of-stake consensus systems where validators stake tokens to participate in block production. Delegators delegate stake to validators in exchange for a yield share.

**Failure modes**. Stake centralization — by 2025, three of the largest staking entities (Lido, Coinbase, Binance) collectively held a majority share of staked Ethereum. Validator-side MEV extraction — validators capture significant value from transaction ordering that delegators don't see. Slashing-risk distribution — when a validator gets slashed, delegators eat the loss disproportionately to the value they captured during the validator's good behavior. Restaking primitives like EigenLayer compound these risks without addressing them structurally.

**Layer mapping**. Mutualize the slashing-risk layer. Delegators across all validators should pool slashing risk in a collective insurance layer — same mechanism as the cover pool in USD8, applied to validator failures. Compete on validator performance. Validators should differentiate on uptime, MEV-rebate generosity, geographic distribution, and reliability.

**Augmentations**. Shapley fair distribution among delegators in a validator pool — delegators who stayed during a hard fork or contentious upgrade should earn a higher share of subsequent rewards than delegators who arrived after the dust settled. Structural anti-extraction against validator-side MEV — validators that retain MEV beyond a published threshold are slashed automatically, with the slashed amount returned to delegators. Conviction-weighted re-delegation — delegators who frequently chase short-term yield get smaller share than delegators who commit long-term, even at the same stake size. Cryptographic proof of validator behavior — validators publish verifiable reports of MEV captured and rebated, so delegators can verify what they're getting.

**Distinctive**. This substrate is closest to the original DeFi work, which means the substrate-port argument is shorter — most of the primitives already exist in VibeSwap and adjacent projects. The novelty is applying them to consensus-layer staking rather than to application-layer trading. The largest staking pools currently dominate by network effect, but a structurally honest competitor with the augmentation pattern fully implemented would be a genuine threat to that dominance, not just a smaller alternative.

---

## What the eight substrates have in common

Three families:

**Information substrates** — scientific research funding, AI alignment governance, journalism. The core problem is that the mechanisms producing collective knowledge are gameable, and the augmentation pattern adds verification mutualization beneath competitive content production.

**Risk substrates** — healthcare, carbon markets, validator networks. The core problem is that pure markets fail to mutualize risks that should be collective, and pure central allocation fails to leverage the information that competition aggregates. The augmentation pattern separates the layers cleanly.

**Coordination substrates** — content moderation, patent and IP. The core problem is that pure decentralization under-protects safety and pure centralization captures discretion. The augmentation pattern provides safety as common infrastructure under competitive application layers.

The same methodology applies to all three families. That is what universality means in this context — a methodology produces useful systems across substrates that share neither participants nor stakes nor failure modes nor implementation languages. If the methodology survives this many substrate-ports, the methodology is doing the work, not the substrates.

This is also the answer to a fair question about Augmented Mechanism Design: is this just one designer's collection of clever DeFi tricks, or is it a real design pattern? The eight substrates above are evidence for the second answer. None of them is DeFi. None of them is even crypto, except for the validator network case. The pattern still applies. The same layer separation, the same protective extension classes, the same competitive-versus-cooperative split.

The substrate changes. The methodology doesn't.

---

## What is not done here

These are sketches, not implementations. Each substrate would require a year of focused work to actually augment — talking to the people inside the substrate, mapping the local political and incentive constraints, figuring out which augmentations work with the substrate's existing institutional structure and which require parallel-system construction.

The point of this paper is not to claim that AMD has solved any of these substrates. The point is to demonstrate that the methodology generalizes, and to provide eight concrete worked starting points for anyone who wants to take any one of them seriously.

The ones that interest me most personally are the carbon markets case, where the existing market is broken in ways that respond well to cryptographic verification and Shapley credit allocation, and the AI alignment governance case, where the substrate is unusually receptive to mechanism-design proposals because the people inside it broadly agree the current trajectory is dangerous.

The others are open invitations. If you work in one of these substrates and the augmentation pattern resonates with what you've been trying to do, the methodology is portable, the math is open, and the worked examples in DeFi are public.

---

*Same methodology. Eight substrates. The methodology doesn't notice the substrate change because the methodology was never about the substrate.*
