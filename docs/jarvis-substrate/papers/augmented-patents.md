# Augmented Patent and IP Systems

The patent system was designed in an era when invention was scarce, capital was patient, and twenty-year monopoly grants were a reasonable trade for the disclosure of how an invention worked. None of those conditions hold the way they did in 1790, or even 1970. The system has continued operating under its original design while the substrate around it has changed. The visible failure modes — patent trolls, defensive hoarding, knowledge silos, software-patent absurdity — are consequences of running an obsolete pure mechanism in a substrate it wasn't designed for.

The current alternatives are jurisdictional patches (varying patent law across countries), defensive arrangements (patent pools, defensive publications, the Open Invention Network for Linux), and outright exit (open-source software, biotech research consortia that share data, the academic publishing system's cultural commitment to openness). Each addresses parts of the failure mode and creates new ones. None addresses the underlying structural problem.

The pure mechanism — temporary monopoly grant in exchange for disclosure — was structurally reasonable when patent grants required substantial novelty, when twenty years was short relative to the development cycle of inventions, and when the costs of enforcement fell on parties with genuine commercial interest in the invention. None of those conditions hold for most modern patent activity.

The right response is augmentation: preserve the competitive market for genuine commercialization, mutualize the upstream-knowledge layer where collective commons would serve everyone better than monopoly, and add specific protective extensions that close the troll-and-hoard failure modes without disabling legitimate IP protection.

---

## The pure mechanism

A patent grants the holder exclusive right to exclude others from making, using, or selling the patented invention for twenty years from filing. In exchange, the holder must disclose how the invention works in sufficient detail that someone skilled in the relevant art could reproduce it. The disclosure becomes part of the public record once the patent expires; in the interim, the monopoly is the holder's incentive to invest in the invention.

Trademark, copyright, and trade-secret regimes operate under different specifics but share the underlying logic of granting exclusive rights as commercial incentive. This paper focuses on patents because the failure modes there are the most visible, but the augmentation pattern generalizes.

The system is administered by national patent offices (USPTO, EPO, JPO, CNIPA) that examine applications and grant or reject patents. Litigation enforces patents through court systems that vary by jurisdiction. Licensing markets allow patent holders to monetize without commercializing themselves.

---

## Failure modes

**Patent trolls.** Non-practicing entities buy patents — often broad or vaguely-worded ones — specifically to extract licensing fees from operating companies. The trolls produce nothing; they extract from companies that produce. The economic activity is purely transferential, and the cost of defending against troll suits is high enough that companies often settle even when they would win on merits. Estimates of patent troll cost to the U.S. economy run into tens of billions of dollars annually.

**Defensive hoarding.** Large companies accumulate patent portfolios specifically to deter competitors and to provide bargaining chips in cross-licensing negotiations. Most of the patents in these portfolios will never be commercialized. They exist as defensive infrastructure. The economic activity that produced them — patent attorney work, application drafting, examination — is largely deadweight from the perspective of inventing useful things.

**Knowledge silos slowing whole industries.** When foundational techniques are patented, downstream researchers and practitioners can't openly build on them for two decades. In fast-moving fields (machine learning, biotechnology, semiconductors), this slows the entire field's progress. The patent-disclosure-after-twenty-years exchange that made sense when industries moved on twenty-year cycles makes no sense when the relevant cycles are two years.

**Software patent absurdity.** Software patents grant monopolies on what are often obvious or trivial techniques — basic algorithms, common UI patterns, standard data structures applied to specific business contexts. The examination process is overwhelmed and approves patents that should not have been granted; the litigation system is slow and expensive enough that defending against assertion of bad patents costs more than settling. The result is a tax on software development that flows to patent attorneys and trolls rather than to inventors.

**Standard-essential patent capture.** When a technical standard requires the use of patented techniques (HEVC video, certain cellular protocols, USB-C charging negotiation), the patent holders gain leverage disproportionate to their contribution. License negotiations for standard-essential patents become political rent extraction. The standard-setting bodies have FRAND (fair, reasonable, and non-discriminatory) obligations that are routinely litigated rather than respected.

**Asymmetric litigation cost.** Patent litigation costs millions of dollars per case. This means that small inventors cannot enforce their patents against large infringers (who can outspend them in litigation), and large incumbents can extract settlements from small companies that cannot afford to defend. The cost asymmetry inverts the system's nominal purpose — protection for inventors becomes weapon for incumbents.

These failure modes compound. Software-patent absurdity feeds patent trolls (broad bad patents are easy to assert). Defensive hoarding rewards aggressive patenting. Standard-essential patent capture incentivizes maneuvering for inclusion in standards rather than for genuine technical merit. Knowledge silos slow innovation across the entire substrate. The system as a whole produces less invention, not more, than it would without the failure modes.

---

## Layer mapping

**Mutualize the upstream-knowledge layer.** Basic research, foundational techniques, and reference implementations are collective goods. Locking them up for twenty years slows everyone, including the patent holders themselves once they need to build on others' foundational work. The upstream layer is where commons works better than monopoly.

**Compete on commercial application.** Downstream products fight freely in market for users. Companies that take foundational techniques and build superior commercial products should be able to do so without needing to license each foundational technique individually. The market for commercial applications is where competition produces better products and where patent protection has the weakest theoretical justification.

The current architecture has these reversed. Foundational techniques get patented (locking the upstream); commercial applications face a tax of overlapping patent royalties rather than competitive market discipline (distorting the downstream). The augmented architecture inverts this. Foundational techniques become commons with structured retroactive credit for major contributors. Commercial applications compete freely with revenue-sharing back to upstream contributors automated rather than negotiated.

---

## Augmentations

**Structural Shapley distribution of innovation credit.** When a downstream product commercializes successfully, a portion of revenue flows automatically to upstream contributors, in proportion to their measured contribution. The current system requires explicit licensing negotiation and litigation to enforce; the augmented system makes credit attribution structural through an on-chain registry of contribution claims, with citations and code linkage that determine flow.

**Retroactive funding for foundational work.** Once a paper, technique, or tool turns out to have enabled a major commercial success, the upstream gets paid years after the fact. This addresses the problem that foundational work often pays poorly at the time but produces enormous downstream value; the augmentation captures that downstream value and routes it backward.

**Anti-troll gates requiring genuine product use.** Patents that aren't being commercialized within a defined window — say, five years from grant — revert to a commons or face dramatically reduced enforcement powers. The pure-extraction business model that defines patent trolls becomes structurally unprofitable. This doesn't eliminate licensing markets; it eliminates the version of licensing that exists only because the patent holder produces nothing.

**Open commons for foundational knowledge with downstream revenue-sharing.** A new tier of intellectual property: contributions explicitly made to the commons with an attached revenue-sharing entitlement. Researchers and inventors can choose to contribute work to the commons, knowing that if their contribution turns out to enable major commercial success they will receive structured proportional compensation. This is the "best of both" — open commons for the upstream layer, with the inventor still rewarded for genuinely valuable contribution.

**Cryptographic prior-art database.** A public database of prior art, cryptographically time-stamped and globally accessible. Patent applications get checked against the database structurally. Patents granted on inventions that were already prior art get rejected or invalidated automatically. This addresses the examination overload problem — the patent office can leverage a much larger prior-art base than its examiners can review individually.

**Standard-essential patent FRAND enforcement through structural rate caps.** When a patent becomes standard-essential, the licensing rate caps automatically at a structural FRAND maximum determined by formula (proportional to the patent's claimed contribution to the standard, with structural anti-extraction caps). Negotiation is replaced by formula. Holders of standard-essential patents still get paid; they just can't extract beyond what the structure permits.

**Litigation cost mutualization for small inventors.** A pool of funding, contributed to by major patent holders and the patent office, funds enforcement litigation for small inventors against large infringers. This addresses the cost asymmetry that currently makes patents weapons for incumbents rather than protection for inventors. The pool is structurally accessible — small inventors apply, demonstrate the patent's validity and the infringement, and receive litigation funding.

---

## Implementation reality

Patent law is jurisdictional. National patent systems have different rules, and international harmonization is slow. The augmentation pattern can't be deployed as a single global change; it has to deploy as either parallel infrastructure (commons-based alternatives that operate alongside the existing system) or as gradual reform within receptive jurisdictions.

Several pieces of the pattern have working precedents. The Open Invention Network's defensive patent pool for Linux demonstrates the commons approach for a specific technology area. Creative Commons demonstrates the structured-license-with-attribution model for copyrighted works. Various retroactive-public-goods funding models in crypto demonstrate the structured backward-revenue-flow concept. The augmentation pattern integrates these existing approaches into a coherent system.

The largest political constraint is the patent attorney profession and the existing patent administration apparatus. Both have economic interest in the existing system's complexity and friction. Reform that compresses their margin will be opposed. The substrate-port has to demonstrate that the augmented system produces better outcomes for inventors and for the broader economy, and let the demonstration force adoption.

The largest opportunity is open-source software, where the patent system has effectively been opted out of by social convention. The augmentation pattern can be deployed first in open-source as a structured alternative to ad-hoc defensive arrangements, and demonstrated to work before extension to other domains.

---

## What changes

If the augmentation pattern is implemented at scale, three things change.

First, patent troll activity collapses. The pure-extraction business model becomes structurally unprofitable. The litigation cost asymmetry that currently funds the trolls reverses. The companies that produce things stop paying tribute to entities that don't.

Second, the upstream knowledge commons accelerates innovation. Foundational techniques become available immediately rather than after twenty years of monopoly. The cumulative trajectory of fields where innovation depends on building on prior foundations (essentially all of them) speeds up. The slowdown that the patent system imposes on these fields gets removed.

Third, inventors who contribute genuinely valuable work get paid more, not less. The Shapley distribution and retroactive funding mechanisms route value to actual contributors rather than to entities skilled at acquiring and asserting patents. The system's nominal purpose — incentivizing useful invention — gets more closely matched by its actual outcomes.

The downstream effect, if the substrate-port succeeds, is an intellectual property system that protects genuine inventors, accelerates rather than slows foundational research, and resists the troll-and-hoard failure modes that have been a tax on innovation for decades. That system does not currently exist anywhere. The pure mechanism has been producing the failure modes since the substrate around it changed and was never updated.

The same methodology that closed extraction in markets and rewarded actual contribution in cooperative-game distribution would close the failure modes that have hollowed out the patent system. The substrate is jurisdictionally complex. The methodology is the same.

---

*Patents were supposed to incentivize invention. The current system incentivizes patent acquisition. The augmentation realigns the incentive with the original purpose, by making genuine invention pay better than aggressive paperwork.*
