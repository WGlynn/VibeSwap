# Jarvis-Bot Voice Hardening

**Context**: On 2026-04-15 the TG bot responded to a Will-authored outbound draft (`@tadija_ninovic` tagged) as if it were inbound, then collapsed a multi-primitive answer to a single primitive while dismissing the audit it was supposed to defend against. Six failure classes:

1. Inbound/outbound confusion
2. Will-idiom misread ("run this through" = stress-test, not forward)
3. Triumphalist single-primitive collapse
4. Posture reversal (audit-useful → audit-unnecessary)
5. Voice drift (generic-LLM sycophancy)
6. Confidence inflation past source certainty

## Status

- ✅ **`src/persona.js`** — patched. Universal structural rules (1–5) spliced into all four personas; standard-only voice rules (6–7) on `standard`.
- ✅ **`src/voice-gate.js`** — live module. Six-rule post-draft regex filter, persona-aware.
- ✅ **`src/voice-gate.test.js`** — smoke tests. 10/10 passing. Run: `node src/voice-gate.test.js`.
- ⏳ **Call-site wiring** — NOT wired into the response pipeline yet. See below.

## Files in this directory (design record)

| File | Purpose |
|------|---------|
| `system-prompt-additions.md` | The exact prompt block spliced into `persona.js`. Keep as audit trail. |
| `test-cases.md` | Human-readable test case descriptions (richer than the smoke tests). |

## Wiring the gate into the response pipeline

The gate is importable but not yet called. You decide where to call it. Recommended:

### Option A — single chokepoint (preferred)

Find the last function that returns the final response text before `bot.sendMessage(...)` / `ctx.reply(...)`. Wrap it:

```js
import { voiceGate } from './voice-gate.js';
import { getActivePersona } from './persona.js';

async function finalizeResponse(userMsg, draft, sourceDoc = '') {
  const persona = getActivePersona()?.name?.toLowerCase().includes('degen') ? 'degen' : 'standard';
  const r = voiceGate({ userMsg, draft, sourceDoc, persona });

  // Hard-coded fallback for outbound-intercept
  const intercept = r.violations.find(v => v.code === 'OUTBOUND_RESPONSE_INTERCEPT');
  if (intercept) return intercept.fallback;

  // Other blocking violations: log and send cleaned draft with a warning suffix,
  // OR regenerate with violation context appended to system prompt.
  if (!r.ok) {
    console.warn('[voice-gate] violations:', r.violations);
    // For now, send cleaned draft anyway — gate is advisory at MVP.
    // Upgrade path: regenerate with violations injected into system prompt.
  }
  return r.cleaned;
}
```

Candidate chokepoints from `grep sendMessage`:
- `src/index.js`
- `src/broadcast.js`
- `src/chatterbox/index.js` (throttle bot — own pipeline, may not need gate)
- `src/workflow-router.js`
- `src/telegram-monitor.js`

`chatterbox/index.js` is a separate lightweight moderation bot; probably doesn't need the gate.
The other four are where Jarvis proper emits text. If there's a shared helper in `claude.js` (where `verificationGate` is already called at line 2285), that is the single best point.

### Option B — filter chain

Join the existing gate pattern `primitive-gate → verification-gate → voice-gate → send`. Voice-gate goes last because it's cheapest (pure regex, no LLM) and prior gates may mutate text.

### Option C — opt-in wrapper

Wrap outgoing messages only in channels where this matters (DMs with Will, public reply threads). Keeps blast radius small during rollout.

## Why this can't live in prompt alone

The bot runs free/weaker models. System-prompt compliance is unreliable at that tier. The voice-gate is a **post-draft regex filter** — deterministic, model-independent, testable. Prompt tells the model what to aim for; gate catches the misses.

This is the Propose→Persist pattern applied to voice: draft → filter → send. The filter is the source of truth, the draft is a view.

## Run the smoke tests

```bash
cd jarvis-bot
node src/voice-gate.test.js
```

Expected: `10 passed, 0 failed`.
