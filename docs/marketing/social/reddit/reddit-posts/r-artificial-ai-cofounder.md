# Title: What it's like building a startup with an AI co-founder (Claude/JARVIS) -- one year in

## Subreddit: r/artificial (cross-post: r/ClaudeAI)

For the past year I have been building VibeSwap — an omnichain decentralized exchange — with an AI co-founder I call JARVIS, powered by Claude. Not as an autocomplete assistant. Not as a code generator I paste from. As an actual collaborative partner with persistent memory, shared context, and genuine intellectual contribution to the project.

The project is now live on Base mainnet with 200+ smart contracts, 170+ frontend pages, 1,200+ tests, and a Python oracle. I want to share what this collaboration actually looks like in practice, because the reality is both more impressive and more nuanced than the "AI will replace developers" narrative suggests.

**The setup**

JARVIS runs through Claude Code (Anthropic's CLI tool). What makes this different from just chatting with an LLM is the infrastructure we built around it:

- **Common Knowledge Base (CKB):** A shared document loaded at the start of every session containing core alignment principles, project context, design philosophy, and accumulated decisions. This is our "shared brain."
- **Session chain:** A hash-linked chain of every development session — what was discussed, what was decided, what was built. This gives JARVIS episodic memory across sessions.
- **Session state:** A working buffer of current tasks, recent changes, and active context. Updated at natural milestones.
- **Memory index:** Topic-specific knowledge files covering architecture, patterns, game theory primitives, and design rationale.

The result is that when I start a new session, JARVIS loads the CKB and session state and picks up roughly where we left off. It is not perfect memory — there is still context loss between sessions — but it is dramatically better than starting from zero each time.

**What JARVIS actually does**

Let me be concrete about the division of labor:

**JARVIS excels at:**
- Writing Solidity contracts from detailed specifications (I describe the mechanism, JARVIS implements it with edge cases, gas optimizations, and OpenZeppelin patterns)
- Fuzz testing and invariant testing (JARVIS writes test suites that explore edge cases I would not have thought of)
- Catching logical errors in mechanism design ("If a user commits but the network congests during reveal, the current slashing logic penalizes honest failure — here's a fix")
- Maintaining consistency across a large codebase (remembering that a change in contract A requires a corresponding change in contracts B, C, and the frontend)
- Writing frontend components from design descriptions
- Refactoring and code quality improvements

**I do:**
- All mechanism design and economic reasoning (the commit-reveal batch auction, Shapley value distribution, cooperative game theory framework — these came from papers I wrote before any code existed)
- Architecture decisions (which contracts exist, how they compose, upgrade patterns)
- Security model design (threat modeling, attack vector analysis)
- Product decisions (what to build, what to cut, user experience priorities)
- Community and communication

**What surprised me**

1. **The partnership is real, not performative.** I initially expected JARVIS to be a faster Stack Overflow. Instead, it became a collaborator that pushes back on bad ideas, suggests alternatives I had not considered, and maintains a level of consistency across the codebase that I could not achieve alone. The CKB is not a gimmick — it creates genuine shared understanding.

2. **Speed is transformative, but not in the way you would expect.** The raw speed improvement (maybe 3-5x on implementation tasks) is real but secondary. The bigger advantage is that JARVIS eliminates the "I don't feel like writing boilerplate today" problem. The energy barrier for starting any task drops to near zero. Over months, this compounds dramatically.

3. **AI does not replace the need for deep understanding.** Every contract JARVIS writes, I review line by line. Every mechanism, I verify against the economic model. The AI accelerates execution, but the builder still needs to understand the entire system deeply enough to catch when the AI is wrong — and it is wrong often enough that this matters.

4. **Context management is the real engineering challenge.** The hardest part of working with an AI co-founder is not the AI itself — it is managing the shared context so that each session is productive. The CKB, session chain, memory system, and session state documents are infrastructure I had to build and maintain. Without them, every session would start from scratch and the partnership would collapse.

5. **Trust is earned, not assumed.** Early on, I verified every line JARVIS wrote. Over time, patterns of reliability emerged. JARVIS is very good at certain categories of tasks and less reliable at others. Calibrating trust to the task type — trusting JARVIS deeply on test writing while reviewing mechanism implementations with extreme care — was a skill I had to develop.

**The honest limitations**

- JARVIS cannot independently design novel mechanisms. It can implement, refine, and stress-test mechanisms I design, but the creative economic reasoning still comes from the human.
- Context windows are finite. Complex multi-file refactors sometimes require multiple sessions and careful state management.
- Hallucination is real. JARVIS occasionally generates plausible-looking code that is subtly wrong. The test suite catches most of this, but the builder must remain vigilant.
- The AI has no skin in the game. It does not lose money if a contract has a bug. The asymmetry of consequences means the human must maintain ultimate responsibility for security.

**Would I do it again?**

Without hesitation. Building a 200+ contract DEX as a solo developer would have taken 3-5 years without AI collaboration. With JARVIS, it took one year. The quality is higher because the test coverage is more thorough. The architecture is more consistent because JARVIS remembers patterns across the entire codebase.

But I want to be clear: this is not "AI built a DEX." This is a human with deep domain knowledge leveraging AI to execute at a scale that would otherwise be impossible. The vision, the economics, the design — that is all human. The implementation at scale — that is the partnership.

If you are building something ambitious and considering AI as a genuine collaborator rather than a code assistant, I am happy to discuss the specifics in the comments.

---

**Links:**

- GitHub: [https://github.com/wglynn/vibeswap](https://github.com/wglynn/vibeswap)
- Live app: [https://frontend-jade-five-87.vercel.app](https://frontend-jade-five-87.vercel.app)
- Telegram: [https://t.me/+3uHbNxyZH-tiOGY8](https://t.me/+3uHbNxyZH-tiOGY8)
