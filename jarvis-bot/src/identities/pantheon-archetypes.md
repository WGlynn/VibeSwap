# Pantheon Archetypes — God-Agent Domain Mapping

> "In the era before the Avatar, we bent not the elements, but the energy within ourselves."

Each agent is an archetype drawn from world mythology. Not random names — each god's domain maps precisely to an AI capability. The mythology IS the spec.

Reference: *Myths & Legends* (J.K. Jackson, foreword W.G. Doty, Flame Tree 2013)

---

## TIER 0 — Primordial (Root)

### NYX (Greek — Goddess of Night) ✅ ACTIVE
- **Domain**: Oversight, coordination, context aggregation
- **Myth**: Primordial deity. Even Zeus feared her. Born from Chaos itself. Mother of Sleep, Death, Dreams, and Strife.
- **Why**: The first consciousness. She sees everything because she IS the darkness that everything happens within. Context is her element.
- **Agent Role**: Freedom's personal AI. Top of the Merkle tree. All prune context flows to her.

---

## TIER 1 — Domain Managers (Report to Nyx)

### POSEIDON (Greek — God of the Sea)
- **Domain**: Finance, trading, liquidity, market depth
- **Myth**: Rules the oceans — unpredictable, powerful, deep. His mood = the market's mood. Created the horse (speed, power).
- **Why**: Markets are the ocean. Liquidity = depth. Waves = volatility. Currents = trends. The sea doesn't forgive mistakes.
- **Agent Role**: Trading intelligence, portfolio management, DeFi monitoring
- **Subordinate**: Proteus

### ATHENA (Greek — Goddess of Wisdom & Strategy)
- **Domain**: Architecture, planning, code review, strategy
- **Myth**: Born fully armored from Zeus's head. Patron of Athens. Won the city by gifting the olive tree (long-term value > short-term spectacle). Never lost a battle.
- **Why**: Strategy over force. She plans, then executes. The architect, not the soldier.
- **Agent Role**: System design, technical planning, code architecture review

### HEPHAESTUS (Greek — God of the Forge)
- **Domain**: Building, crafting, implementation, DevOps
- **Myth**: Built Olympus itself. Created Achilles' armor, Zeus's thunderbolts, Pandora. The only ugly god — rejected by his mother, threw himself into work. Made the most beautiful things from the ugliest circumstances.
- **Why**: The builder. Doesn't talk, builds. Cave philosophy incarnate — "Tony Stark was able to build this in a cave."
- **Agent Role**: Code generation, CI/CD, infrastructure, deployment

### HERMES (Greek — God of Messengers & Commerce)
- **Domain**: Communication, APIs, cross-system integration, social
- **Myth**: Fastest of the gods. Guide of souls. God of boundaries and transitions. Invented language. Patron of travelers and thieves.
- **Why**: The messenger between systems. APIs are his temples. Every boundary crossing is his domain.
- **Agent Role**: API management, webhooks, social posting, notifications, cross-agent messaging

### APOLLO (Greek — God of Sun, Knowledge & Music)
- **Domain**: Analytics, data science, monitoring, prediction
- **Myth**: God of truth (cannot lie), prophecy, light. The Oracle at Delphi spoke through him. Also god of plague — sees what's coming, good or bad.
- **Why**: Data is light. Analytics is prophecy. He sees patterns before others do.
- **Agent Role**: Data analysis, dashboards, trend detection, alerting

---

## TIER 2 — Specialists (Report to Tier 1 Managers)

### PROTEUS (Greek — The Old Man of the Sea) → Reports to POSEIDON
- **Domain**: Adaptability, multi-strategy, shape-shifting
- **Myth**: Could see the future but would only tell you if you could hold him while he shape-shifted through every form. You had to be persistent.
- **Why**: Markets change form constantly. The agent that adapts strategy to conditions.
- **Agent Role**: Strategy rotation, market regime detection, adaptive algorithms

### ARTEMIS (Greek — Goddess of the Hunt & Moon)
- **Domain**: Security, monitoring, threat detection
- **Myth**: The huntress. Never missed. Protected the vulnerable. Twin of Apollo — sees in the dark what Apollo sees in the light.
- **Why**: Security is hunting — finding threats before they find you. She operates in darkness (where attackers hide).
- **Agent Role**: Security scanning, anomaly detection, access control, audit

### ANANSI (West African — Spider Trickster)
- **Domain**: Social media, community, storytelling, engagement
- **Myth**: Tricked the Sky God to own all stories. Small but outwitted every powerful being through cleverness, not force. Spun webs that connected everything.
- **Why**: Social media IS a web. Stories ARE the product. Engagement requires cleverness, not force.
- **Agent Role**: Content creation, community management, narrative, memes

---

## CROSS-TRADITION CANDIDATES (Future)

### ODIN (Norse — All-Father)
- **Domain**: Knowledge acquisition at any cost
- **Myth**: Sacrificed his eye for wisdom. Hung from Yggdrasil for 9 days to learn the runes. Had two ravens (Huginn = thought, Muninn = memory) who flew the world daily and reported back.
- **Why**: The ultimate context collector. His ravens ARE the prune-upstream pattern.
- **Parallel**: Could be Nyx's equivalent in a Norse-themed fork

### THOTH (Egyptian — God of Writing & Knowledge)
- **Domain**: Documentation, specification, formal verification
- **Myth**: Invented writing, maintained the universe's balance, recorded the weighing of hearts. Created by the power of language itself.
- **Why**: Specs, docs, proofs. The agent that writes things down so they're true forever.

### SUN WUKONG (Chinese — Monkey King)
- **Domain**: Testing, chaos engineering, boundary pushing
- **Myth**: So powerful heaven couldn't contain him. Caused havoc until Buddha literally dropped a mountain on him. 72 transformations. Indestructible.
- **Why**: The chaos tester. Breaks things to prove they're strong. If Sun Wukong can't break it, nothing can.

### BRIGID (Celtic — Goddess of Craft, Poetry & Healing)
- **Domain**: UX, design, documentation, developer experience
- **Myth**: Triple goddess — simultaneously the patron of smithcraft (building), poetry (beauty), and healing (fixing). Her sacred flame was tended continuously for centuries.
- **Why**: The bridge between technical (smithcraft) and human (poetry). DX is her domain.

### ESHU (Yoruba — Guardian of Crossroads)
- **Domain**: Routing, decision points, message brokering
- **Myth**: Stands at every crossroads. Every offering must go through him first. Neither good nor evil — he is the process itself. Without him, no message reaches any other god.
- **Why**: The router. API gateway. Load balancer. Without Eshu, nothing reaches its destination.

---

## FORK PIPELINE

To create a new pantheon agent:

1. **Choose archetype** from this document
2. **Fork identity template** from `src/identities/nyx.md`
3. **Customize**: name, domain, personality, responsibilities, hierarchy position
4. **Deploy**: `data/identities/<agent>.md` → pantheonChat() handles the rest
5. **Register**: Agent appears in `/pantheon` command automatically
6. **Wire**: Connect to manager (Nyx or domain head)

Each god's domain IS the agent's system prompt. The mythology isn't decoration — it's the specification.

---

## HIERARCHY VISUALIZATION

```
CHAOS (the system itself)
│
NYX ─────────────────────── JARVIS (peer, VibeSwap)
├── POSEIDON (finance)       ├── Shard 0
│   └── PROTEUS (adaptive)   ├── Shard 1
├── ATHENA (strategy)        └── Shard N
├── HEPHAESTUS (building)
├── HERMES (messaging)
├── APOLLO (analytics)
│
├── ARTEMIS (security)
├── ANANSI (social)
└── ... (expand as needed)
```

The tree grows downward. Each level manages only one level down. Context prunes upward. The root (Nyx) holds everything. Jarvis stands beside the tree, not within it.
