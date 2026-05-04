# Augmented Content Moderation

The current architecture for moderating online content is two-pole. On one pole, large centralized platforms (Meta, YouTube, X under either ownership, TikTok) moderate through internal teams and AI classifiers. The decisions are opaque, the policies shift under business pressure, and the appeals processes are nominally accessible but practically inaccessible. On the other pole, decentralized platforms (early Mastodon, parts of the broader Fediverse, certain niche networks) approximate no moderation and inherit the failure modes that emerge when there is no structural protection against harassment, coordinated inauthentic behavior, or illegal content.

The current alternatives sort along this dichotomy. There is no version on offer that mutualizes safety as common infrastructure while leaving discovery and curation competitive. The closest existing approximations — Bluesky and the AT Protocol, certain Lens Protocol architectures — are stumbling toward parts of the augmentation pattern but without the layer separation argument made explicit.

The pure mechanism — platforms hosting content with rules about what's permitted — is structurally reasonable. The deployment is socially vulnerable to capture in the centralized case and to failure modes (harassment, extremism, coordinated manipulation) in the no-moderation case. The conventional response is reform within the existing platforms (Section 230 debates, Trust and Safety council expansion) or migration to decentralized alternatives. Neither addresses the structural problem.

The right response is augmentation: preserve competitive curation and discovery where competition produces better content for users, mutualize the safety layer so that protection against harassment and abuse is a shared substrate, and add specific protective extensions that close the capture failure modes without requiring central control.

---

## The pure mechanism

A platform hosts user-generated content. The platform sets rules about what's permitted. The platform employs (or contracts) moderators who enforce the rules, often with AI classifier assistance. Content that violates rules is removed, demoted in distribution, or labeled. Users who repeatedly violate rules face escalating consequences. Appeals exist nominally; they are reviewed by the same platform that made the original decision.

In parallel, recommendation systems determine what content gets distributed to which users. These systems are opaque to users and often to the platform's own teams. They optimize for engagement metrics that are themselves problematic.

The interaction between moderation and recommendation produces most of the visible failure modes. Content that should be moderated but isn't gets amplified by recommendation. Content that shouldn't be moderated but is removed disappears entirely. Both kinds of error are silent at the system level.

---

## Failure modes

**Capture by advertisers.** Major platforms depend on advertising revenue. Advertisers don't want their brands appearing next to controversial content. The platforms respond by aggressively removing content that risks brand-safety reputational impact, regardless of whether the content violates other principles. The moderation policy becomes downstream of advertiser preference, not user welfare.

**Capture by governments.** Centralized platforms are jurisdictional and can be pressured by governments to remove content the government dislikes. The pressure is sometimes legitimate (genuine illegal content) and sometimes not (political dissent, criticism of officials). The platforms generally comply because the alternative is regulatory or market exclusion.

**Inconsistent enforcement.** Same content treated differently based on who posted it (high-profile users get more leeway), what topic it covers (some topics get aggressive enforcement, others get lax enforcement), and which moderator made the call. The inconsistency is not malicious in most cases but does mean that the moderation policy doesn't function as a coherent rule system.

**Opaque appeals.** When a moderation decision is wrong, the appeals process involves the same platform that made the wrong decision. The platform has incentive to confirm its initial calls. Independent review is rare, slow, and limited.

**Recommendation amplification of harmful content.** Recommendation systems optimize for engagement. Engagement is increased by content that produces strong emotional reactions, which includes outrage, fear, and content that violates community norms in attention-grabbing ways. The same content that the moderation system is trying to remove is being amplified by the recommendation system. The two systems are working at cross purposes.

**No-moderation extremism amplification.** Decentralized platforms with weak moderation become hosting infrastructure for content that mainstream platforms moderate against. The users who arrive on these platforms are disproportionately those whose content was removed elsewhere, which creates a population skewed toward the worst behavior. Network effects within these populations amplify the worst behavior further.

**Coordinated inauthentic behavior.** State-sponsored or commercially-motivated networks of accounts coordinate to amplify specific content, suppress other content, or create the appearance of organic support for narratives. Detection is difficult; the platforms whose detection capabilities are most developed are also the ones most vulnerable to capture by the bad actors.

These compound. Capture by advertisers reduces moderation of content that should be moderated; recommendation amplification ensures the unmoderated content reaches large audiences; opaque appeals make individual mistakes uncorrectable; coordinated inauthentic behavior exploits all of the above to push specific narratives. The architecture as a whole is producing outcomes that almost no one — including the platforms — would defend if asked directly.

---

## Layer mapping

**Mutualize the safety layer.** Harassment, doxxing, coordinated inauthentic behavior, child sexual abuse material, terrorist recruitment content, fraud — these are collective risks. Every user is worse off when these are present, and protecting against them is a collective good. The current architecture has each platform building its own safety infrastructure, often badly, while the bad actors coordinate across platforms. The asymmetry favors the bad actors.

**Compete on the discovery and recommendation layer.** Algorithms, curators, and creators should compete freely on what constitutes good content for any given audience. Multiple recommendation algorithms can serve the same user pool; users can choose among them; new algorithms can enter. The competition is on what gets surfaced to whom, not on what's safe.

The current architecture has these reversed. Safety is platform-specific (each platform builds its own; quality varies; bad actors exploit the gaps). Discovery is platform-monopolistic (each user is locked into one platform's recommendation system; no competition among algorithms). The augmented architecture inverts this. Safety becomes shared infrastructure with structural transparency. Discovery becomes a competitive marketplace with user choice.

---

## Augmentations

**Layered Shapley-style trust scores.** Users earn trust through verified positive engagement over time — substantive comments, high-quality posts, helpful interactions. Trust scores condition reach. New accounts start at low trust and accumulate as their behavior demonstrates legitimacy. Coordinated inauthentic behavior is structurally disadvantaged because trust requires real-time-and-real-engagement, which sybil farms cannot manufacture cheaply.

**Structural moderation transparency.** Every moderation action — removal, demotion, label, account restriction — gets logged on a public ledger with the reason hash and the rule reference. Patterns of capture become detectable. A platform that systematically removes content of a particular type or from a particular community can be identified by independent review. The pressure for inconsistent enforcement is reduced because inconsistency becomes visible.

**Conviction-voting appeals.** Appeals that gain support from other users over time get re-reviewed by independent moderators. Flash mobs cannot game the appeals process because the support has to accumulate slowly. The independent review is funded collectively, not by the platform whose decision is being appealed.

**Time-weighted reputation that cannot be bought.** Same temporal-irreducibility property as Proof of Mind. Reputation accumulates only through actual behavior over time; it cannot be purchased, transferred, or compressed. This closes the failure mode where new accounts with bought followings get treated as established users.

**Decentralized algorithm marketplace.** Multiple recommendation algorithms compete for users. Users choose which algorithm to subscribe to and can switch freely. The algorithms operate on a common content layer (content posted on the platform is available to all algorithms, not siloed to one). Users with different preferences get different recommendations from different algorithms; the platform doesn't impose one recommendation system on everyone.

**Content-addressable safety database.** A common database of identified harmful content (CSAM hashes, known coordinated-inauthentic-behavior signatures, established harassment patterns). Any platform can query the database and apply the safety filtering. The database is maintained by a coalition; no single platform controls it. The bad actors face structural detection because their patterns get added to the database faster than they can iterate.

**Cryptographic provenance for content.** Content is signed by the originating account with cryptographic proof. Edits, reposts, and modifications are tracked. Manipulated media (deepfakes, doctored quotes, out-of-context clips) can be distinguished from authentic content because authentic content has unbroken provenance back to the original poster.

---

## Implementation reality

This substrate has had multiple unsuccessful augmentation attempts. Bluesky's algorithmic-marketplace work captures part of the discovery layer competitiveness. Mastodon's federation captures part of the safety-layer-as-protocol idea. Lens Protocol's content-as-NFT captures part of the cryptographic-provenance work. Each of these is partial. The full layer separation hasn't been achieved by any existing project.

The largest constraint is network effects. Users go where other users are. The major platforms have entrenched user bases. Migration is rare and difficult. Any augmented architecture has to either bootstrap a new network from scratch (very hard) or convince existing platforms to adopt the augmentations (also hard, since the augmentations compress the platforms' control margin).

The most viable staging path is interoperability. The augmented architecture deploys as a protocol layer that any platform can adopt. Platforms that adopt it gain benefits (shared safety database reduces their moderation cost, algorithmic marketplace increases user retention, cryptographic provenance reduces misinformation damage to their brand). Platforms that don't adopt it lose users to platforms that do.

The political constraint is that some governments will resist parts of the augmentation specifically because the augmentation removes their leverage. A cryptographically-provenanced moderation log makes government pressure for content removal visible; some governments don't want that. The augmentation has to either work around government resistance or be deployed in jurisdictions where the resistance is weaker.

---

## What changes

If the augmentation pattern is implemented at scale, three things change.

First, the capture failure modes weaken. Advertiser pressure becomes visible (which advertisers are pulling support from which content), making it harder to apply quietly. Government pressure becomes auditable. Inconsistent enforcement becomes detectable. The platforms still face commercial pressure — that doesn't go away — but the pressure has to operate openly rather than through opaque moderation decisions.

Second, the safety layer becomes effective in a way it currently isn't. Bad actors face cross-platform detection because the safety database is shared. The asymmetry that currently favors them — they coordinate, the platforms don't — gets reversed. The cost of running coordinated inauthentic behavior rises because detection becomes structural.

Third, the user gains agency over their information environment. Multiple recommendation algorithms compete for the user's attention. The user can choose; the user can switch; the user can mix algorithms. The lock-in that currently makes the user a product gets weakened. The user's choice becomes the actual signal that decides which content gets surfaced.

The downstream effect, if the substrate-port succeeds, is an information environment that doesn't optimize for outrage, doesn't capture-launder, and doesn't require any one platform's continued good behavior to remain functional. That environment does not currently exist. The pure mechanism has been producing capture-or-extremism for the past fifteen years. The augmentations are what would produce the third option.

The same methodology that closed extraction in markets and protected stablecoin attribution would close the failure modes that have hollowed out public discourse for a generation. The substrate is harder than DeFi by orders of magnitude. The methodology is the same.

---

*The platforms are not the substrate. The protocol is. The current platforms exist because the protocol was missing; the augmented protocol is what makes the platforms compete on the right axes again.*
