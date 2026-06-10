# Frontend Recode Plan — terminal-console showcase pass (2026-06-10)

Directive: recode the presentation layer with the full skill arsenal (design-system
discipline + frontend-slides animation patterns + ui-agents techniques) and "more 3D
objects everywhere" — WITHOUT touching logic, hooks, routes, or the dual-wallet pattern.

## Locked constraints
- Aesthetic law: `vibeswap/CLAUDE.md` `<always_use_terminal_console_aesthetic>` block.
- Hero3D.jsx / Hero3DScene.jsx untouched (reuse their patterns).
- DO NOT touch/stage: index.html (dirty), NCIStoryPage.jsx (dirty),
  ClawbackCascadeStory.jsx, DisintermediationGradesStory.jsx, FairnessFixedPointStory.jsx (untracked).
- One Canvas per viewport max. Particle counts < 2k/scene, dpr cap 1.5.
- One page per commit; `npm run build` must pass after each.

## Baseline (pre-recode)
- entry `index-*.js` 675.61 kB · css 176.88 kB · vendor-three 842.10 kB (lazy)

## Route inventory (traffic-ordered targets)
| Route | Component | Plan |
|---|---|---|
| `/` | SwapCore | Full presentation recode: terminal hero (op-sig label, mono
trust badges), commit/reveal/settle cards as op-sig terminal panels, interaction
states + a11y (labels, focus-visible), copy fix (LayerZero → canonical messaging).
No new Canvas (Hero3D already owns the home viewport). |
| `/send` | BridgePage | Terminal recode: op-sig section headers, mono labels,
state-complete buttons, network-node Accent3D, canonical-messaging copy. |
| `/earn` | PoolPage | Terminal recode: kill off-palette green→emerald gradients,
op-sig table headers, focus states, torus Accent3D divider. |
| `/rosetta` | RosettaPage | CANONICAL reference (6777 lines) — surgical only:
hero Accent3D with visibility mounting; no aesthetic churn. |
| `/about` | AboutPage | Terminal recode + icosahedron Accent3D hero (if budget). |
| remaining ~160 routes | — | Inherit shared primitives; explicitly out of scope
this pass (depth over breadth, design-system ch.16). |

## Shared system (commit 1) — `src/components/ui/terminal/`
- `OpSig` — `<scope>.<op>(args) → <return>` section header + animated divider.
- `TerminalPanel` — locked panel (black-900/95→700/95 gradient, matrix-900/40
  border, inset glow, hover/focus states).
- `TerminalButton` — mono uppercase wide-tracking button, all 5 interaction states.
- `BreathingDot` — 2.4s breathing status dot (reduced-motion safe).
- `Accent3D` — lazy 3D accent family (shell stays dependency-free; scene chunk
  joins the vendor-three graph): variants `icosahedron | torus | network | points`.
  IntersectionObserver visibility mounting + module-level canvas gate so only ONE
  accent Canvas runs per viewport; reduced-motion + WebGL-fail → static SVG glyph.

## Dynamic Tailwind class audit (purged-in-prod risk)
Offenders: ContributionGraph, ForumPage, GameTheoryPage, NCIStoryPage (LOCKED — skip),
TokenomicsPage, VoiceChat, WhaleWatcherPage. Fix only those touched this pass;
log the rest as follow-up.

## Final phase — hostile self-QA
Palette violations in own diff · purged dynamic classes · route smoke ·
wallet-flow regression read-through · eager vendor-three leak check
(`dist` graph: entry must not import vendor-three) · MobileNav overlap ·
final build + bundle delta vs baseline.
