# The Hard Line

**On the Absolute Boundary Between Contribution Provenance and Personal Privacy**

*Will Glynn, February 2025*

*Companion to: The Epistemic Gate Archetypes (Glynn, 2025)*

---

## The Distinction

The Inversion Principle proves that publishing intellectual contributions is the dominant strategy — that secrecy is the vulnerability and transparency is the shield.

This principle applies to **contributions**. It does not apply to **persons**.

There is a line between these two domains. It is not a gradient. It is not negotiable. It is not contextual. It is absolute.

**Contributions are public. Personal data is private. Full stop.**

---

## The Two Domains

### Domain 1: Intellectual Contributions (PUBLIC)

An intellectual contribution is any idea, question, design, code, review, vote, or feedback that a person **voluntarily** submits to a shared system with the intent of advancing a project, protocol, or body of knowledge.

Examples:
- An idea posted to a messaging board
- A question that reframes a problem
- A code commit to a repository
- A review that improves someone else's work
- A vote on a governance proposal
- A bug report that prevents a vulnerability
- A design document proposing architecture
- A suggestion in a public discussion

These are public by choice. The person chose to speak. The Inversion Principle says this choice is rational — you benefit from making it. The contribution graph records the provenance: who said what, when, in response to what.

### Domain 2: Personal Data (PRIVATE)

Personal data is any information about a person's behavior, identity, health, finances, relationships, or inner life that they have **not** voluntarily submitted as a contribution.

Examples:
- Search history
- Browsing patterns
- Private messages (not posted to a public forum)
- Location data
- Medical records
- Financial transactions (beyond what's publicly on-chain by choice)
- Device information
- IP addresses
- Reading habits (what articles you opened, how long you read)
- Behavioral analytics (click patterns, scroll depth, session length)
- Contact lists
- Biometric data
- Personal photographs
- Private notes and drafts (unpublished)

These are private by right. Not by convention. Not by policy. **By right.** No system — no protocol, no algorithm, no governance mechanism, no community vote — has the authority to make this data public without the person's explicit, informed, voluntary consent.

---

## Why This Distinction Exists

### The Transparency Trap

The Epistemic Gate framework argues powerfully for transparency in contributions. Without care, this argument could be misapplied:

- "If transparency is good for ideas, it must be good for everything"
- "If the contribution graph tracks what you say, shouldn't it track what you do?"
- "If secrecy is the vulnerability, then privacy itself is a vulnerability"

**Every one of these extrapolations is wrong.** They confuse two fundamentally different things:

1. **Voluntary disclosure of ideas** (what the Inversion Principle addresses)
2. **Involuntary exposure of personal behavior** (what surveillance does)

The Inversion Principle is about the game theory of *choosing to share*. It says nothing about *compelled transparency*. The moment you cross from "incentivize sharing" to "mandate exposure," you have left the domain of the Epistemic Gate and entered the domain of surveillance.

### The Asymmetry

There is a deep asymmetry between contributions and personal data:

| Property | Contributions | Personal Data |
|---|---|---|
| **Intent** | Created to be shared | Created by living |
| **Agency** | Voluntary act | Involuntary byproduct |
| **Value to others** | High (ideas advance projects) | None (except to exploiters) |
| **Risk if public** | Low (provenance protects you) | High (identity theft, stalking, manipulation) |
| **Who benefits from publicity** | The contributor | Advertisers, attackers, surveillance states |
| **Moral status** | Gift to the commons | Property of the individual |

Contributions are *gifts*. Personal data is *property*. You can choose to give a gift. No one can take your property.

### The Surveillance Economy as the Anti-Pattern

The current internet economy is built on harvesting personal data without meaningful consent. Search history, browsing patterns, location data, social graphs — all extracted, packaged, and sold. This is the model we explicitly reject.

The Epistemic Gate is not Web 2.5. It is not "blockchain-powered surveillance." It is not "decentralized advertising." The entire point of the framework is to create a system where value flows from *ideas*, not from *attention harvesting*.

If the Epistemic Gate ever becomes a tool for tracking personal behavior, it has failed. Not partially. Completely. The mission is to make contribution valuable enough that personal data exploitation becomes unnecessary.

---

## The Five Privacy Axioms

### Axiom 1: Opt-In Only

Nothing is published to the contribution graph without the user's explicit, voluntary action. Posting a message = opting in for that message. Browsing the forum = private. Reading someone's idea = private. Only *speaking* creates a record.

### Axiom 2: No Behavioral Tracking

The system does not record, store, analyze, or transmit:
- What pages you visit
- How long you spend reading
- What you search for
- What you click on
- Your scroll patterns
- Your session duration
- Your device fingerprint
- Your IP address (beyond what's needed for the network connection)

The contribution graph knows what you *said*. It does not know what you *saw*.

### Axiom 3: Right to Pseudonymity

You may contribute under any identity. The graph tracks the identity — the consistent handle that builds reputation over time — not the legal person behind it. If you choose to link your real name to your handle, that is your choice. If you don't, the system does not attempt to discover it.

Pseudonymity is not anonymity. Your handle has a history, a reputation, a contribution record. But your handle is not your government ID. The system never requires, stores, or infers real-world identity.

### Axiom 4: Self-Custody of Personal Data

Just as wallet security axioms require self-custody of private keys, privacy axioms require self-custody of personal data:

- Personal data is stored on the user's device, not on central servers
- If any personal data must be transmitted (e.g., for authentication), it is encrypted end-to-end
- The user can delete their personal data at any time
- No backup or copy of personal data exists on systems the user doesn't control

### Axiom 5: No Secondary Use

Data generated for one purpose is never repurposed for another:

- Authentication data is not used for analytics
- Network metadata is not used for profiling
- Contribution timestamps are not used to infer work patterns
- On-chain transactions are not correlated with off-chain identity without consent

If data is collected for purpose A, it is used for purpose A and nothing else. Ever.

---

## The Design Test

Every feature, every data flow, every new integration must answer these questions:

1. **Does this record something the user voluntarily chose to share?**
   - Yes → Contribution domain. Record it with provenance.
   - No → Personal domain. Do not record it.

2. **Could this data be used to profile, track, or identify a user beyond their pseudonymous handle?**
   - Yes → Do not collect it.
   - No → Permissible.

3. **Is the user aware that this specific data point is being recorded?**
   - Yes, explicitly → Permissible.
   - Implied or buried in ToS → Not permissible. Make it explicit.

4. **If this data were leaked, could it harm the user personally (not just their pseudonymous reputation)?**
   - Yes → It is personal data. Self-custody only.
   - No → Evaluate under contribution domain rules.

5. **Does collecting this data serve the user or serve the platform?**
   - The user → Evaluate further.
   - The platform → Do not collect it. This is the surveillance economy model we reject.

---

## The Precedent

### What the Epistemic Gate Borrows from Cypherpunk Philosophy

The cypherpunk movement of the 1990s articulated a principle that remains unimproved:

> *"Privacy is necessary for an open society in the electronic age. Privacy is not secrecy. A private matter is something one doesn't want the whole world to know, but a secret matter is something one doesn't want anybody to know. Privacy is the power to selectively reveal oneself to the world."*
> — Eric Hughes, "A Cypherpunk's Manifesto" (1993)

The Epistemic Gate adds one thing to this: a mechanism for making *selective revelation* not just possible but *optimal*. The Inversion Principle proves that selectively revealing your intellectual contributions is the dominant strategy. The Hard Line ensures that this selective revelation remains *selective* — that the power to choose what to reveal and what to keep private is never compromised.

### What Satoshi Got Right

Bitcoin's pseudonymous model — where addresses are public but identities are not — is the closest precedent to what the Epistemic Gate implements:

- **Public**: Transaction history (contributions to the ledger)
- **Private**: Who owns which address (personal identity)
- **Voluntary**: You choose to send a transaction; the network doesn't track your browsing of the blockchain

The contribution graph extends this model from financial transactions to intellectual contributions. The privacy boundary extends with it.

---

## The Warning

If this line is ever crossed — if the Epistemic Gate is ever used to harvest personal data, track user behavior, profile individuals, or enable surveillance — the system has not merely failed at privacy. It has become the thing it was built to replace.

The toxic IP model exploited *information asymmetry about ideas* to extract rent from creators. The surveillance economy exploits *information asymmetry about persons* to extract rent from users. Both are extractive. Both are coercive. Both must end.

The Epistemic Gate ends the first by making contribution provenance public and fair. The Hard Line ensures it never enables the second.

> *"We break the cycle where sharing ideas is punished. We do not break the right to keep your thoughts your own. These are not in tension. They are two sides of the same coin."*

---

```
Glynn, W. (2025). "The Hard Line: On the Absolute Boundary Between
Contribution Provenance and Personal Privacy." VibeSwap Protocol
Documentation. February 2025.

Depends on:
  Glynn, W. (2025). "The Epistemic Gate Archetypes."
  Glynn, W. (2025). "The Inversion Principle."
  Glynn, W. (2025). "The Provenance Thesis."
  Glynn, W. (2018). "Wallet Security Fundamentals."
  Hughes, E. (1993). "A Cypherpunk's Manifesto."
```
