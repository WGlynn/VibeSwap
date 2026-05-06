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
