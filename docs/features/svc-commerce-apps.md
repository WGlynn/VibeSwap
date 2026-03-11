# SVC Commerce Apps — Feature Spec

**Author**: Will + Jarvis | March 2026
**Status**: Concept → Coming Soon
**Principle**: Every transaction has Shapley-attributable value. No rent-seeking.

---

## 1. VibeJobs (`/jobs`) — SVC LinkedIn

**Problem**: LinkedIn extracts rent from both job seekers (Premium) and employers (Recruiter licenses). Skills are self-reported. Endorsements are meaningless.

**Solution**: Shapley-scored contribution portfolios replace resumes.

**How it works:**
- **Proof of Contribution > Proof of Credential**: Your ContributionDAG score IS your resume
- **Verifiable skills**: Smart contract deployments, GitHub commits, governance participation — all on-chain
- **Matching**: Employers post bounties with required skill NFTs (from VibeLearn)
- **Revenue**: Employers pay a flat listing fee → distributed via Shapley to successful referrers
- **Anti-spam**: Reputation-gated applications (min tier to apply)

**Smart contracts**: Uses existing ContributionDAG + ShapleyDistributor + ReputationOracle

---

## 2. VibeMarket (`/market`) — SVC Amazon

**Problem**: Amazon takes 15-45% commission. Reviews are gamed. Small sellers are suppressed by algorithm.

**Solution**: P2P marketplace with Shapley reviews and smart contract escrow.

**How it works:**
- **Escrow**: All transactions go through smart contract escrow (release on delivery confirmation)
- **Reviews**: Weighted by reviewer's reputation tier (Sybil-resistant via PoM)
- **Seller ratings**: Shapley-scored based on transaction history, dispute rate, review quality
- **Fees**: Protocol fee only (no platform commission). Fee goes to DAO treasury.
- **Discovery**: Conviction-weighted listings (community signals what's worth seeing)

---

## 3. VibeHousing (`/housing`) — SVC Zillow

**Problem**: Zillow and real estate platforms profit from information asymmetry. Hidden fees, inflated estimates, agent commissions.

**Solution**: Transparent listings with reputation-scored participants.

**How it works:**
- **Transparent pricing**: All fees, taxes, maintenance costs visible upfront
- **Reputation**: Landlords and tenants both have on-chain reputation (payment history, maintenance response times)
- **Smart leases**: Rent payment via streaming (VibeStream) — automatic, fractional, transparent
- **Dispute resolution**: Community arbitration with Shapley-weighted jury
- **Price oracle**: Community-sourced comparable prices (not Zillow's black-box Zestimate)

---

## 4. VibeGig (`/gig`) — SVC Fiverr/Upwork

**Problem**: Fiverr takes 20% from freelancers. Upwork takes 5-20%. Dispute resolution favors platform over participants.

**Solution**: Decentralized freelancing with fair pay proofs.

**How it works:**
- **Milestone escrow**: Funds locked per milestone, released on completion proof
- **Skill verification**: VibeLearn skill NFTs as verifiable credentials
- **Fair dispute**: Community arbitration, not platform diktat
- **Revenue**: Minimal protocol fee (1-2%), rest goes to freelancer
- **Reputation portable**: Your VibeGig reputation works across all VibeApps

---

## 5. VibeAuction (`/auction`) — SVC eBay

**Problem**: eBay's auction mechanism is vulnerable to sniping, shill bidding, and last-second manipulation.

**Solution**: Batch auctions (our core MEV-resistant mechanism!) for collectibles and goods.

**How it works:**
- **Commit-reveal bidding**: Same mechanism as VibeSwap's core — no sniping, no front-running
- **Uniform clearing price**: All winners pay the same fair price
- **NFT receipts**: Every purchase generates a verifiable proof-of-purchase NFT
- **Seller verification**: Reputation-gated listing (prevents scam accounts)
- **Cross-chain**: List on any chain, bid from any chain (LayerZero bridge)

---

## Unifying Architecture

All 5 commerce apps share:
- **ContributionDAG** for reputation
- **ShapleyDistributor** for value attribution
- **CommitRevealAuction** for fair price discovery (VibeAuction)
- **VibeStream** for continuous payments (VibeHousing)
- **ReputationOracle** for trust gating
- **Smart contract escrow** for trustless transactions

This is P-098 (As Above, So Below) — the same primitives that power DeFi power commerce.
