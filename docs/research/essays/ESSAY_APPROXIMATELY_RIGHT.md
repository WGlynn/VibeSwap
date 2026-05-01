# It's Better to Be Approximately Right Than Precisely Wrong

Keynes said it about economic forecasting. I want to apply it to something that has been quietly broken since the first `git commit`: attribution.

---

**The Current System Is Precisely Wrong**

Git is a marvel of engineering. It tracks every character, every insertion, every deletion, with cryptographic precision. It can tell you exactly who typed line 47 of a file, at 2:47 AM, on a Tuesday in November. That is precise. It is also maximally wrong.

Alice and Bob are working on a distributed system. At lunch, Alice says something offhand — "what if you treated the failure modes as a probability distribution instead of a binary?" Bob nods, finishes his sandwich, and goes back to his desk. Three hours later he commits a new consensus algorithm. Git records: `Author: Bob`. Alice is invisible. She will be invisible forever unless Bob remembers to thank her in a comment, which he might, or a README, which he probably won't.

Now imagine Alice is a blog post Bob read six months ago. Or a StackOverflow answer. Or a conference talk he half-remembers. These are not edge cases. This is how software actually gets written. The ideas do not arrive fully formed from first principles. They arrive from a substrate of conversations, arguments, random observations, and borrowed frameworks, none of which appear in `git log`.

IP law is the same structure, worse. You own it or you don't. The binary is legally clean and philosophically catastrophic. The entire edifice of copyright assumes that creative work has a single origin point — an author — and everything flows from that. But the creative work we care most about, the work that moves civilization, is almost never the product of a single mind working in isolation. Newton said he stood on the shoulders of giants. What Newton's copyright filing said is a different matter.

Both systems are precise. Both are wrong. Not imprecisely wrong — precisely wrong, which is the worst kind, because it feels correct.

---

**Perfect Attribution Is Intractable**

The cooperative game theorist's answer to Alice's problem is the Shapley value: assign each contributor their marginal contribution, averaged over all possible orderings of the coalition. It is the unique solution satisfying efficiency, symmetry, null player, and additivity. It is mathematically beautiful. It is also, in any real collaborative context, unknowable.

To compute the true Shapley value of Alice's lunch comment, you need to know the counterfactual: would Bob have written that algorithm without it? This is private information inside Bob's head, and Bob himself may not know. Human cognition does not track its own provenance with any reliability. We confabulate. We forget. We genuinely cannot distinguish between ideas we originated and ideas we absorbed and reformulated. The psychological literature on cryptomnesia — unconsciously recalling someone else's idea as your own — is extensive and unsettling.

But the problem is deeper than psychology. It is philosophical. Causality in collaborative creation may be fundamentally undecidable. Alice's comment reached Bob through a chain of attention, memory, reformulation, and context that cannot be fully reconstructed. The counterfactual world where Alice didn't speak at lunch is not accessible. We cannot run the experiment. Shannon would say we have high uncertainty about the information-theoretic channel capacity between Alice's words and Bob's commit. Zadeh would say our membership in the coalition "contributors to this algorithm" is not crisp — it is fuzzy.

This is the trap that prevents people from improving the system. They see that perfect attribution is impossible, conclude that approximate attribution is meaningless, and decide that the current system — which gives 100% to Bob and 0% to Alice — is the best available option. This is the logic of someone who throws away a slightly inaccurate map because it isn't GPS and then gets completely lost.

---

**Fuzzy Cooperative Games Are the Middle Path**

Classical cooperative game theory assumes crisp coalitions. You are in or you are out. The characteristic function `v(S)` is defined over subsets — binary membership. This works when you are dividing profit among named partners in a closed room. It does not work when you are trying to model the actual diffusion of ideas through a technical community.

Fuzzy cooperative game theory, developed seriously since the 1970s, allows partial coalition membership. A player's membership in a coalition is a value in `[0,1]` rather than `{0,1}`. The generalized Shapley value over fuzzy coalitions still exists, still satisfies analogues of the classical axioms, and — crucially — handles exactly the kind of uncertain contribution we are talking about.

"I was somewhat inspired by Alice's comment" is not a soft claim to be discarded. It is literally a fuzzy coalition membership value. Bob is declaring that Alice has partial membership in the coalition that produced his algorithm. The value is uncertain, the declaration is imprecise, and that imprecision is information. It is more information than the current system captures, which is none.

You do not need to solve the hard philosophical problem of causal attribution to build a better system. You need a mechanism that is less wrong than the one you have. Any system that acknowledges Alice exists is strictly better than the current system, which asserts she does not.

---

**The Practical Implementation**

Here is what approximately right looks like in practice.

Bob declares inspiration: "This commit builds on a conversation with Alice (link/handle) and a blog post by Charlie (link)." This is self-reported. It is not verified. It is almost certainly incomplete. It is still infinitely more than zero.

Social attestation adds a second signal. Charlie, who was at that lunch, can independently attest: "Yes, Alice's framing contributed to Bob's approach." Attestation is cheap to give, costly to give falsely over time (reputation damage), and aggregates into a signal stronger than any individual declaration. This is how academic citation networks work, imperfectly, but well enough to have driven scientific progress for centuries.

Credit propagates backward with decay. If Bob credits Alice with 30% for that conversation, and Alice's thinking was itself shaped 40% by a paper by Dana, then Dana receives 30% x 40% x decay_factor of the original credit. Pick any decay factor between 0 and 1 — say 0.3 per hop. Is 0.3 right? Nobody knows. But the decay serves a real function: it prevents infinite retroactive attribution chains from diluting all credit into noise while still acknowledging that knowledge has history.

The decay parameter is configurable. Governance can tune it. Different communities might want different values. This is fine. The goal is not to compute the one true Shapley value — that is intractable, we established this. The goal is to make the distribution less wrong.

---

**Why This Matters**

Open-source is the backbone of the digital economy. The total market capitalization of companies whose core products run on open-source software is measured in tens of trillions of dollars. The developers who wrote that software were, in most cases, not compensated proportionally. This is widely acknowledged. The proposed solutions usually involve money — retroactive funding mechanisms, grants, donations.

Money is the right answer to the wrong question. The prior problem is that we cannot see the contributions at all. The attribution graph is nearly empty. We know some names in `git log` and some names on PyPI packages and not much else. The blog posts, the IRC conversations from 2003, the conference hallway tracks, the answered emails — invisible. We are building on invisible foundations and when we try to reward contributors we can only reward the visible ones, which means we are systematically undercompensating the diffuse, conversational, ambient contributions that actually shape the direction of technical work.

A fractal Shapley system does not solve the compensation problem directly. It creates the substrate for solving it. You cannot distribute value along attribution chains that do not exist in any record. Once you start recording approximate chains — even fuzzy, self-reported, decaying chains — the graph exists. You can reason about it. You can build payment rails on top of it. You can see the otherwise invisible.

---

**The Efficiency Axiom**

Cooperative game theory has an efficiency axiom: the total value generated by the grand coalition must be fully distributed among the players. Nothing is left on the table. This is both a normative claim (fairness requires it) and an analytical one (a mechanism that leaks value will be gamed until it stops leaking).

The current attribution system violates the efficiency axiom massively. It distributes authorship credit to the people whose names appear in commits and discards influence credit entirely. The influence credit is not zero — Alice's lunch comment had a real Shapley value. That value was generated. It was not distributed. It was annihilated.

We have built an economy on top of a commons that we have systematically failed to account for. Not maliciously — the tools were not there, the theory was not applied, the defaults calcified before anyone thought to question them. But the result is a colossal, ongoing violation of the efficiency axiom, dressed up in the language of precision.

The fix does not require solving the undecidable. It requires admitting that our current answer of zero is not a neutral default. Zero is a choice. It is a confident, precise, wrong choice.

Keynes was right. Be roughly right. The alternative is not no answer — the alternative is the answer we already have, which is exactly wrong, applied at scale, every day, to every commit, across the entire history of collaborative human knowledge production.

We can do better. The math exists. The only missing piece is the will to stop mistaking precision for accuracy.

---

*Will Glynn, 2026*
