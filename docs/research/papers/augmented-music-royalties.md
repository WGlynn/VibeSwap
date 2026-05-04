# Augmented Music and Creator Royalties

The economic model for music distribution has been broken in different ways for at least three decades. The pre-streaming era extracted from artists through record labels that controlled distribution and recouped advances aggressively. The streaming era extracts through aggregator platforms (Spotify, Apple Music, YouTube) whose per-stream royalty rates produce subsistence-level income for all but the top fraction of a percent of artists. The pattern repeats across creator categories — visual artists on Instagram, writers on Medium, video creators on YouTube. The aggregators capture most of the revenue; the creators capture the residual.

The current alternatives are creator-economy direct platforms (Patreon, OnlyFans, Substack) that work for established creators with existing audiences, mainstream label-and-publisher arrangements (still extractive but with marketing infrastructure), and DIY independent paths (no infrastructure, low ceiling). Each has visible failure modes. Direct platforms favor existing fame. Labels extract substantially. DIY scales poorly.

The pure mechanism — creators produce work, distributors aggregate, audiences pay through some combination of direct payment, ad-supported access, or subscription — was structurally reasonable when distribution required physical infrastructure (record stores, theatrical releases, publishing houses). Now that distribution is essentially free, the rent that aggregators capture isn't earned by physical-infrastructure provision; it's earned by algorithmic recommendation positions and network effects.

The right response is augmentation: preserve competitive creator markets and competitive recommendation algorithms, mutualize the audience-discovery and verification infrastructure where shared substrate serves all creators, and add specific protective extensions that route revenue to actual creators rather than to aggregator intermediaries.

---

## The pure mechanism

Music: artists record songs. Songs go through publishers (for songwriting royalties) and labels (for master recordings). Streaming platforms license catalogs from labels and publishers and stream songs to listeners. Listeners pay subscription fees (for premium tiers) or generate ad revenue (for free tiers). Revenue flows from platforms to labels and publishers, then to artists, then to songwriters.

The royalty calculation is complex. Per-stream rates depend on the listener's tier (premium pays more than free), the country of the listener (developed market pays more than emerging market), the type of stream (active listening pays more than radio-style background), and the negotiated rate the platform agreed with the label. Most artists see a fraction of a cent per stream after labels and publishers take their cuts.

Other creator categories follow analogous patterns. YouTube creators receive a share of ad revenue based on watch time and CPM. Visual artists on Instagram monetize indirectly (through brand deals, prints, commissions) because the platform doesn't share ad revenue. Writers on aggregator platforms receive subscription splits or per-pageview rates that vary widely.

---

## Failure modes

**Per-stream economics for music.** Spotify's blended per-stream rate is approximately $0.003 to $0.005. An artist needs roughly 250,000 monthly streams to make $1,000 monthly income from streaming. The vast majority of catalog artists receive less than 10,000 monthly streams. The mathematical floor under streaming income is well below subsistence for almost all working musicians.

**Label and publisher capture.** Even when streaming revenue per song is meaningful, the artist's share is typically 12-25% of the streaming royalty after label and publisher cuts. Pre-streaming-era recoupment structures (artists must "pay back" their advance from royalties before receiving any payment) extend the extraction further. Many catalog artists never receive royalties on streams of their own songs because they remain in unrecoupment.

**Aggregator algorithmic gating.** Streaming platforms' recommendation algorithms determine which songs get heard. Algorithmic placement on platform-curated playlists can produce orders-of-magnitude differences in stream counts. The placement decisions are opaque, are influenced by label promotional payments (the digital equivalent of payola), and effectively replace the open-discovery promise of streaming with curated gatekeeping.

**Cross-platform fragmentation for creators.** A creator with a music release also wants visibility on Instagram, TikTok, YouTube, and Twitter. Each platform has its own recommendation system, its own monetization model, and its own audience-relationship structure. Creators spend enormous time managing the cross-platform presence; the aggregators capture the ad revenue from the audience the creator brought.

**Mercenary fan dynamics.** Creator-economy direct platforms (Patreon-style) reward whatever maximizes audience size and engagement. Creators feel pressure to produce constantly, to engage with the most-engaged subset of fans regardless of how much value those fans actually want, and to chase trends that produce subscriptions. The work suffers; the relationship with audience becomes transactional in ways that the original creator-fan relationship usually wasn't.

**Sample and remix attribution failures.** When a song samples or remixes prior work, the attribution and royalty distribution to the sampled work are negotiated case-by-case (or unauthorized, leading to lawsuits). The attribution layer is heavily lawyer-mediated; smaller creators can't afford the negotiation; the result is either restrictive sampling cultures or unauthorized use that produces litigation rather than royalties.

**Deepfake and AI-generation displacement.** AI-generated music and voice cloning create attribution problems the existing system can't handle. A "song that sounds like Drake" generated by AI without Drake's involvement raises questions about whether Drake should receive any compensation. The existing royalty system has no infrastructure for distinguishing authentic from generated content or for distributing royalties when the line is fuzzy.

These compound. Per-stream economics force creators to prioritize streaming volume over artistic depth; volume requires algorithmic placement; placement requires either label support (which extracts) or platform gaming (which is unsustainable). Creator-economy direct platforms appear as alternatives but favor already-established creators. The dynamic across the substrate is concentration of value at the top of the distribution and subsistence-or-worse for everyone else.

---

## Layer mapping

**Mutualize the audience-discovery and verification infrastructure.** Discovery — letting audiences find creators they'd love but haven't heard of — is a collective good. The current architecture has each platform building proprietary discovery algorithms; the algorithms are tuned for platform engagement, not for creator-audience matching; the result is concentration on already-known creators. Verification (authenticating that work is by the claimed creator, that samples are licensed, that AI-generated content is labeled) is also collective infrastructure.

**Compete on creator quality and audience-relationship building.** Creators should fight freely on what they make, how they connect with audiences, and what they offer. Multiple recommendation algorithms can compete on producing good creator-audience matches; multiple monetization structures can serve creators with different needs (direct support, streaming, subscription, merchandise, live).

The current architecture has these reversed. Discovery is platform-monopolistic (each platform's algorithm gates discovery on that platform). Creator competition is partial (within-platform competition exists but creators can't easily be portable across platforms). The augmented architecture inverts this. Discovery becomes shared substrate with multiple competing algorithms. Creators become portable across the substrate.

---

## Augmentations

**Cryptographic provenance for all creative work.** Every release — song, video, image, written piece — gets cryptographically signed by the creator at publication. Provenance flows through any republication, sample, or remix. AI-generated work is structurally distinguishable from human-created work because the provenance chain is different. The substrate gains verifiable creator attribution at the file level.

**Shapley distribution among creators, samples, and contributors.** When a song that samples three prior works generates revenue, the revenue flows to the original artist, the three sample sources, the producer, and the songwriters in proportion to their measured contribution. The split is calculated by formula, not negotiated case-by-case. Sample-clearance friction collapses because attribution becomes structural.

**Direct creator-audience monetization with platform-neutral identity.** A creator's audience relationship gets stored in their cryptographic identity, not in any one platform. Audiences who "follow" a creator on Spotify also follow them on YouTube, Instagram, and direct-publishing platforms. Monetization (direct support, premium content access, live event tickets) flows directly between creator and audience without platform intermediation.

**Anti-extraction caps on aggregator margin.** Platforms that aggregate creator content face structural caps on what fraction of revenue they can retain. The cap is set by protocol; deviations require explicit creator opt-in (with the higher revenue extraction visible to the creator). The current 70%+ revenue capture by some aggregators becomes structurally impossible without explicit creator consent for each transaction.

**Multiple competing recommendation algorithms.** Creators publish to a common content layer; multiple recommendation algorithms compete on producing good creator-audience matches. Audiences choose which algorithm(s) to subscribe to. The platform-monopolistic discovery gating gets replaced by an open algorithm marketplace.

**Conviction-weighted audience reputation.** Audiences who consistently support specific creators over time gain reputation that matters in secondary mechanisms (early access to releases, voting power in creator-direct decisions, structural incentives that the creator can offer to loyal supporters). Mercenary fan dynamics get partially offset because long-term audience commitment becomes structurally rewarded.

**AI-generation labeling with structural enforcement.** AI-generated music, voice clones, and other AI creative work gets cryptographically labeled at generation time. Distribution requires the labeling. Mislabeling triggers structural penalties. Audiences and royalty distribution can distinguish authentic from generated content. Existing creators whose work or voice is used as training data can claim structural compensation when generated work derives from their input.

---

## Implementation reality

This substrate has had partial-augmentation attempts. Audius is a music-streaming platform built on blockchain that addresses some failure modes (creator ownership, transparent royalty distribution) but hasn't achieved scale. Various NFT-based music projects (Royal, Sound, Catalog) have demonstrated direct creator-fan economics for early adopters. None has yet broken through to mainstream scale.

The largest constraint is incumbent network effects. Spotify has half a billion users; YouTube has more. Creators go where audiences are. The augmented architecture has to either bootstrap a new network from scratch (very hard) or convince incumbents to adopt the augmentations (also hard, since the augmentations compress incumbent margins).

The most viable staging path is hybrid. The cryptographic-provenance and shared-discovery layers can be deployed as protocol infrastructure that any platform can use. Creators benefit by gaining cross-platform identity portability and verified attribution. Platforms benefit by reducing fraud and AI-generation problems they're already facing. Once the protocol layer reaches threshold adoption, the per-platform extraction caps become enforceable through audience migration toward platforms that respect them.

The political constraint is the major labels. Three labels (UMG, Sony, Warner) control most of the recorded-music catalog and have substantial influence over streaming-platform negotiations. Any augmentation that compresses label margin will be opposed. The substrate-port has to either work around the major labels (deploy first for independent creators) or convince labels that the augmented system grows the overall pie enough to compensate for compressed extraction rate.

---

## What changes

If the augmentation pattern is implemented at scale, three things change.

First, mid-tier creators become economically viable. The current streaming economics support roughly the top 1% of catalog at meaningful income levels and produce subsistence-or-worse for almost everyone else. The augmented economics — with extraction caps, direct fan support, and Shapley sample distribution — extend viability to the top 10-20% of catalog at meaningful levels and produce real income for working creators below that.

Second, AI-generated content disruption gets handled structurally. The current system has no answer for AI-generated music; the augmented system has cryptographic labeling and structured derivative-work compensation. Existing creators whose work feeds AI training get compensated when the AI generates derivative work; AI-generated content is distinguishable for audiences who care about authenticity; the displacement gets managed rather than just absorbed.

Third, creator-audience relationships become portable and direct. The platform lock-in that currently shapes creator dependency gets weakened. Creators with audience can move; audiences who care about specific creators can follow them. The bargaining position between creators and platforms shifts toward creators because creators no longer depend on any single platform for audience access.

The downstream effect, if the substrate-port succeeds, is a creative economy that supports a much larger working class of creators, that handles AI disruption with structural attribution, and that doesn't require accepting either platform extraction or DIY isolation as the only options. That economy partially exists in early-stage form (parts of the crypto-creator ecosystem); the augmentations are what would generalize it.

The same methodology that protected attribution in DeFi reward distribution would protect attribution in creator royalties. The substrate is institutionally complex. The methodology is the same.

---

*The work is what should pay. The current system pays the platforms. The augmented system routes payment to the work, and lets the platforms compete on actually serving creators rather than on capturing them.*
