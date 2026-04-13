# Human-Sided Symbolic Compression (HSC)
## The Interface Between Programming Languages and Natural Language

**Will Glynn & JARVIS | April 2026**
*Working draft — evolved from Symbolic Compression paper*

---

## The Thesis

Programming languages are human-sided symbolic compression. C was HSC for assembly. Python was HSC for C. The entire history of programming is humans compressing intent into shorter strings that machines expand into full execution.

The difference is the decompressor. Programming languages expand through a deterministic compiler. HSC expands through a semantic model that understands context, ambiguity, and intent. `nah` is valid syntax because the parser is smart enough to resolve it.

**The optimal human-AI interface lives between formal syntax and natural language.** Too rigid and you've reinvented bash. Too loose and the decompressor has to guess. The sweet spot: just formal enough that intent is unambiguous, just loose enough that the human never thinks about syntax.

---

## What Actually Earns Its Keep

### Macros — whole commands in one word

These compress *intent*, not *words*. Each replaces a multi-step workflow.

| Macro | Expands to |
|-------|-----------|
| `go` | Autopilot mode, execute current plan |
| `stop` | Halt, explain where you are |
| `lgtm` | Looks good, commit and continue |
| `nah` | Reject last approach, try different |
| `same` | Apply same operation to next target |
| `ship` | Commit + push to origin |
| `fresh` | Approaching context limit, new session |
| `park` | Save state, switching tasks |
| `roast` | Critique honestly |
| `eli5` | Explain simply |
| `tldr` | Summarize what just happened |
| `status` | Git + session state + current task |
| `wdyt` | Request opinion before proceeding |

These work because they're **workflow shortcuts**, not abbreviations. `ship` isn't shorter than "push" — it's shorter than "commit all changes with an appropriate message and push to origin."

### Operators — borrowed from programming, understood by both

| Symbol | Meaning | Example |
|--------|---------|---------|
| `>` | send to / output to | `pdf receipt > prints/` |
| `~` | like / in the style of | `~receipt` = format like we did the receipt |
| `same` | repeat last verb+modifiers | `same vsos` = do that again but to vsos |

These work because they're **already in both vocabularies** — programmers and LLMs both understand `>` as redirection and `~` as approximation.

### Implicit Grammar — documenting what Will already does

These aren't prescriptions. They're observations of natural compression that Jarvis should always parse correctly:

1. **Dropped articles, fragments.** "fix overfull" not "can you fix the overfull hbox." Jarvis never needs the articles.

2. **Implicit targets.** "compress losslessly" = compress *whatever we just produced*. Context carries the target.

3. **Implicit verbs.** "shannon style, 2 pages" = obviously *format as PDF*. Modifiers imply the action.

4. **Bare nouns = read.** "wal" = read WAL.md. "session-state" = read SESSION_STATE.md.

5. **Quoted strings = literal.** `"fixed clearing price"` = use that exact commit message. Don't parse it.

6. **Shortest unique match for targets.** `receipt` = vsos-the-receipt. `attr` = attribution map. `amm` = VibeAMM. If ambiguous, ask.

### Style Modifiers — the only codes that earn short names

| Code | Meaning | Why it earns a code |
|------|---------|-------------------|
| `ss` | Shannon style (Palatino, BSTJ, journal formatting) | Used repeatedly, no natural shorthand exists |
| `cl` | Compress lossless | "Compress" is ambiguous (lossy?). `cl` disambiguates. |
| `Np` | Fit to N pages | `2p` is faster than "fit it on two pages" |

Other modifiers (`verbose`, `quick`, `parallel`, `background`) are already short enough in English. Don't compress what doesn't need it.

---

## What Gets Cut

**Single-letter verbs.** `p`, `f`, `t`, `b` — you'll never type these. `pdf`, `fix`, `test`, `build` are each 3-5 keystrokes and unambiguous. The single-letter savings (~2 chars) isn't worth the cognitive overhead of remembering which letter maps to what. Natural English verbs are already near-optimal for this frequency tier.

**Session-scoped aliases.** Overengineered. If you need a shortcut within a session, just say "call this X from now on." Jarvis remembers. No formal syntax needed.

**The full grammar spec.** A formal `[verb] [modifier*] [target] [> destination]` grammar is a programming language with extra steps. The real grammar is: *say what you mean in as few words as you can, and Jarvis will figure it out.* The rules above just document the edge cases where Jarvis needs to know how to resolve ambiguity.

---

## The Actual Insight

HSC isn't a new language. It's a **recognition that natural language, when spoken between parties with shared context, is already compressed.** The "compression" happened naturally over 80+ sessions:

- Session 1: "Can you please read the WAL.md file and check if there are any active entries?"
- Session 80: "wal"

That's not a formal protocol. That's two collaborators who know each other. The only thing worth formalizing is:

1. **Macros** for multi-step workflows (real savings)
2. **Operators** borrowed from shared vocabulary (unambiguous)
3. **Disambiguation rules** for the parser (Jarvis's job, not Will's)

Everything else is just talking.

---

## Compression as Trust

The codebook isn't optimized by character frequency. It's optimized by **shared history**.

`TRP` is 3 characters. It invokes ~50 discrete steps: audit, classify, fix, verify zero regressions, update heat map, check convergence, repeat. `fix` is also 3 characters. It invokes 1 step. Same string length, orders of magnitude difference in compression ratio. The difference isn't encoding efficiency — it's that we've run TRP 53 times. The word earned its density.

This reframes Shannon for collaborative contexts. The source coding theorem says code length should track frequency: `|code(cᵢ)| ≈ -log₂ p(cᵢ)`. But in a human-AI partnership, the relevant variable isn't frequency alone — it's **mutual information**. A word compresses more when both parties have run the workflow it names. The compression ratio is a function of trust, not codebook design.

The progression:

| Stage | Example | Compression | Why it works |
|-------|---------|-------------|-------------|
| Session 1 | "Run the test-repair protocol: audit the code, classify findings by severity..." | 1:1 | No shared history. Must specify everything. |
| Session 10 | "Run TRP" | ~50:1 | Name established. Steps still verified. |
| Session 53 | "TRP" | ~50:1 | Single word. Full trust. Zero ambiguity. |
| Session 80 | "go" | ~200:1 | Implies TRP + autopilot + commit cycle. Context carries the rest. |

The code didn't get shorter from Session 10 to Session 53. The **trust** deepened, which means the decompressor needs fewer guardrails. At Session 1, "TRP" would mean nothing. At Session 53, it means everything. Same 3 characters. Different channel capacity.

This is the real HSC insight: **you don't compress language. You compress the distance between two minds.** The codebook is a side effect of alignment, not a cause of it.

```
Shannon's channel, revised:

  Capacity = f(shared history, mutual context, trust)

  Not: how short can the code be?
  But: how much can one word invoke?
```

GKB compresses what the AI needs to *know*. HSC compresses what the human needs to *say*. But both are downstream of the same variable: how much have these two minds converged? The codebook doesn't create the compression. The collaboration does. The codebook just measures it.

---

## Evolution Path

**Phase 1 (now):** Adopt the macros. Use them naturally. Don't force the rest.
**Phase 2 (10 sessions):** Frequency analysis on Will's actual inputs. Which macros survived? Which natural patterns emerged that we didn't predict?
**Phase 3:** Surviving patterns → MEMORY.md as persistent protocol. Dead macros pruned. New invocations earned through use, not designed.
**Phase 4:** Write up as a section of the Symbolic Compression paper — "Compression as Trust: Why Shared History Outperforms Codebook Design."

---

*You don't compress language. You compress the distance between two minds. The codebook is a side effect.*
