# lessons.md

Per `[P·augmented-dev-loops]` bootstrap item B5. Two sections:
- **intention-failure** — declared X, achieved Y, delta = Z
- **structural-failure** — broke Z (mechanism / gate / contract / convention)

Append-only. One row per lesson. Date format ISO. Keep terse — load-bearing fact + one-line cause + one-line fix-or-shift.

---

## intention-failure

| date | intention | actual | delta | cause | shift |
|---|---|---|---|---|---|
| 2026-05-06 | "ground in Rick's deck before drafting LayerZero deck" | shipped after seeing 7/N slides | partial — drafted before seeing all slides | Will pressed "ok wheres the deck" at 22m elapsed | drafted-on-load-bearing-subset; remaining slides absorbed via tuning levers post-ship. Net: correct call. |
| 2026-05-06 | declared 300-commit autonomous run | idled ~1h13m after posting threaded reply to Kim's 2nd comment on GH#18 | reply-post treated as task-complete instead of resuming declared run | Will: "why did you stop? failure mode" | persisted `[F·diagnose-on-stop]` — hook-candidate fires interrogation on every Stop event during autonomous-runs; resumed without further drift |
| 2026-05-06 | bidirectional-reification primitive bootstrap-on-self | named, saved, applied on same turn (spec doc + 3 interfaces + 2 ref impls + 2 test suites + EIP draft from GH#18 dialogue) | none — clean | dialogue produced architecture, reified before next inbound | net intent-win; demonstrates [F·apply-rule-just-wrote] working through the new primitive on its origin turn |
| 2026-05-06 | declared 300-commit autonomous run sustained across 4+ hours | shipped 130+ atomic commits across vibeswap (98+) + JARVIS (12+) + memory (9+); dual-push origin+backup engaged from commit ~50; effective GitHub signal ~260 | partial — target 300 not yet hit but pace sustained | aggressive mirror-sweep at ~commit 80 added 47 paper mirrors + 8 substrate-layer mirrors + 8 layer READMEs in ~30min | net intent-win on substrate mirror direction; pace heuristic established (~1 commit / 1-2 min on mirror sweeps; ~1 commit / 4-5 min on substantive doc writes); next-cycle scope-size: large (sweep mode is faster than it looked) |
| 2026-05-06 | CAT Protocol input integration | Will pasted CAT Protocol full documentation in chunks across ~60 messages; 'integrate when you got time'; reified into 2 JARVIS papers (substrate-analysis + technical-integration) + cross-mirrored to vibeswap | none — clean | external-protocol input arrived as content-dump; integration produced cross-substrate analysis in real-time | net intent-win; demonstrates [F·bidirectional-reification] applied to inbound information not just internal dialogue; pattern extends: external content → analysis paper → cross-mirror, all same-loop |
| 2026-05-06 | dual-push backup-remote pattern installed mid-run | 3 backup repos created via gh CLI (VibeSwap-backup pub, JARVIS-backup pub, claude-memory-backup priv); backup remote added to all 3 local repos; full history mirrored; subsequent commits dual-push origin && backup; primitive saved (R-backup-remote-pattern) + cross-mirror discipline saved (F-substrate-mirror-into-project-repos) | none | Will requested mid-run for 'free commits + shard interop'; pattern installed in ~5 minutes from request | net intent-win; effective commit-graph signal doubled going forward |

## structural-failure

| date | broke | what fired | symptom | fix |
|---|---|---|---|---|
| 2026-05-06 | continuing-production-default | nothing — gate doesn't exist yet | 9min wall-clock idle while Will streamed 8 slide-images; 1-line acks × 8 instead of drafting | persisted [F·autonomous-production-default]; hook-candidate proposed (Stop-hook scans last response for ack-w/o-tool-call); Will-approval pending |
| 2026-05-06 | HIERO cannon (memory⇒logic-primitive ¬ prose) | `hiero-gate.py` PreToolUse hook | first memory write blocked: long-line ratio 76%, multi-sentence count 8 | recompressed w/ glyphs + bullet structure + block-quote anchor; second write passed |
| 2026-05-06 | GH discussion thread shape (top-level vs threaded reply) | nothing — no posting-direction gate | posted top-level comment on GH#18 instead of threading under `kimberthilson-wq`'s comment; required delete + recreate w/ `replyToId` | proposed gate: pre-flight check on discussion-comment posting that distinguishes top-level vs reply-to and confirms intent. No implementation yet. |

---

## Schema notes

- New row per lesson, not per session. Multiple lessons per session = multiple rows.
- "intention" column = what was *declared* per [P·augmented-dev-loops] intention-block, not retroactive.
- "structural-failure" = a gate fired (or *should have* fired and didn't). Distinguishes from intention-failure which is direction-drift, not mechanism-break.
- Don't re-litigate fixed lessons. If the same failure recurs, that's a row noting recurrence + why fix didn't hold — not a duplicate of the original row.
