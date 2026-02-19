# Deployment & Infrastructure Patterns

> Codified from real debugging sessions. Every entry is a mistake that burned time and must never be repeated.

---

## The Connectivity Verification Primitive (MANDATORY)

**Anti-pattern observed (Session 31 — Google Meet transcript pipeline):**

```
Symptom:  Apps Script can't reach Fly.io webhook
Attempt 1: Blame DNS → allocate shared IP             (WRONG — didn't verify root cause)
Attempt 2: Try raw IP with HTTP port 8080              (WRONG — Fly shared IPs need hostname routing)
Attempt 3: Rewrite to use Telegram Bot API directly     (WRONG — bot can't receive its own messages)
Attempt 4: Deploy Vercel proxy to forward to Fly        (WRONG — Fly still unreachable from anywhere)
Attempt 5: curl external URL → exit code 35 (TLS fail) (DIAGNOSTIC — should have been step 1)
Attempt 6: Check fly.toml → missing [http_service]      (ROOT CAUSE)
```

**6 failed attempts. The fix was 4 lines of config. 45+ minutes wasted.**

### The Primitive: Test External Reachability FIRST

Before debugging WHY a service can't reach another service, verify the target is reachable AT ALL:

```bash
# STEP 1 (ALWAYS): Can YOU reach the target from your own machine?
curl -s -o /dev/null -w "%{http_code}" https://your-service.fly.dev/health

# If this fails → the problem is the TARGET, not the caller
# If this succeeds → the problem is the caller's DNS/network/auth
```

**This single curl saves every downstream debugging attempt.** If the target isn't externally reachable, no amount of DNS fixes, proxy layers, or alternative routing will help.

### Generalizable Principle

**"Verify the destination exists before debugging the route."**

When Service A can't reach Service B:
1. **Test B independently first** (curl from your machine, browser, any third party)
2. If B is unreachable → fix B's exposure/networking config
3. If B is reachable → then investigate A's DNS/firewall/network
4. Never build workarounds (proxies, alternative protocols) until you've confirmed B is actually listening

---

## Fly.io Deployment Checklist (MANDATORY)

Every Fly.io app that needs to receive external HTTP traffic MUST have:

```toml
[http_service]
  internal_port = 8080        # Must match your app's listening port
  force_https = true
  auto_stop_machines = 'off'  # Keep running for webhooks
  auto_start_machines = true
```

**Without `[http_service]`, Fly does NOT route external traffic to your app.** The health check can pass (it uses internal networking) while the app is completely invisible to the outside world.

### Symptoms of missing `[http_service]`:
- Internal health checks pass ✓
- `flyctl ssh console` + `wget localhost:8080` works ✓
- External `curl https://app.fly.dev/` fails with TLS error (exit 35) ✗
- External services get DNS errors or connection refused ✗
- Proxy services get "fetch failed" ✗

### Verification after deploy:
```bash
# ALWAYS run this after any Fly deployment:
curl -s -w "\nHTTP: %{http_code}" https://YOUR-APP.fly.dev/health
# Must return HTTP 200. If not, check [http_service] in fly.toml.
```

---

## Google Apps Script DNS Limitations

Google Apps Script's `UrlFetchApp` **cannot resolve `fly.dev` domains** (confirmed Feb 2026). This is a Google infrastructure limitation, not a DNS propagation issue.

**Workaround**: Use a proxy on a domain Google CAN resolve:
- `vercel.app` ✓ (confirmed working)
- `api.telegram.org` ✓ (confirmed working)
- `railway.app` ✓ (likely works)
- `fly.dev` ✗ (permanent failure from Google servers)

**Current architecture**:
```
Apps Script → vercel.app/api/transcript → fly.dev/transcript → Claude → TTS → Telegram
```

The Vercel serverless function is a 15-line dumb proxy that forwards POST bodies. No env vars needed on Vercel for this — all secrets stay on Fly.

---

## The Proxy Trap Anti-Pattern

**Anti-pattern**: When A can't reach B, immediately building a proxy C between them.

**Why it fails**: If B isn't externally reachable, A→C→B fails just as hard as A→B. You've added complexity without fixing the root cause.

**Rule**: Only build a proxy AFTER confirming:
1. B is externally reachable (curl from your machine returns 200)
2. A specifically cannot reach B (A's DNS/network blocks B's domain)
3. A CAN reach C (verified, not assumed)
4. C CAN reach B (verified, not assumed)

If any of these are unverified, you're stacking assumptions.

---

## The Bot Self-Message Trap

Telegram bots **do not receive their own outgoing messages** as updates. If Service A sends a message via Bot API `sendMessage`, the bot's `on('text')` handler will NOT fire for that message.

**Implication**: You cannot use "send message to chat → bot picks it up" as an inter-service communication pattern. Use webhooks or direct API calls instead.

---

## Diagnostic Order of Operations (MANDATORY)

When Service A reports it can't reach Service B:

```
1. curl B from your machine              → Is B alive and externally reachable?
2. Check B's platform config             → Is traffic routing configured?
3. Check B's logs for incoming requests   → Is anything arriving at all?
4. Test from A's platform specifically    → Is it an A-side restriction?
5. Only THEN build workarounds            → Proxies, alternative routes, etc.
```

**Never skip to step 5.** Steps 1-4 take 2 minutes total and identify the root cause 90% of the time.

---

## Fly.io Environment Variable Override Trap (Session 32)

**Anti-pattern**: Setting an env var in `fly.toml` `[env]` section, then expecting the entrypoint script's `${VAR:-default}` to override it.

```
Root cause: fly.toml [env] sets MEMORY_DIR=/repo/.claude/projects/C--Users-Will/memory
Entrypoint: MEMORY_DIR="${MEMORY_DIR:-/app/memory}"
Result:     MEMORY_DIR is already set → default never activates → files MISSING
```

**3 deploys to diagnose. The fix was changing 1 line in fly.toml.**

### Rule: fly.toml [env] takes ABSOLUTE precedence over entrypoint defaults

`${VAR:-default}` only fires when VAR is **unset**. An env var set to ANY value (even wrong) prevents the default. If you're changing where files live, update the `[env]` section in fly.toml, not the entrypoint script.

### Diagnostic: Always check fly.toml [env] FIRST

```bash
# When a Fly app can't find files it should have:
grep -A20 '\[env\]' fly.toml   # ← Check this FIRST
fly logs --no-tail | grep -i "dir\|path\|missing"  # ← Confirm what path it's using
```

---

## Jarvis Behavioral Hallucination Pattern (Session 32)

**Anti-pattern**: LLM claims to have "updated its mandate" but no actual side effect occurs.

```
User: "Stop welcoming new members"
Jarvis: "I've updated my mandate to not welcome new members."
Reality: Welcome handler is hardcoded in index.js. Nothing changed.
```

**Root cause**: LLM generates text about taking action but has no tools to actually take action. The welcome handler runs unconditionally regardless of conversation context.

### Fix Architecture: Give the LLM tools with real side effects

1. **Configurable behavior file** (`data/behavior.json`) — runtime flags the event handlers actually read
2. **Claude API tools** (`set_behavior`, `get_behavior`) — LLM can call these to modify the config file
3. **System prompt instruction**: "ALWAYS use the tool. Never just claim you updated something."
4. **Event handlers gate on flags**: `if (!getFlag('welcomeNewMembers')) return;`

### Generalizable Principle

**"An LLM saying it did something is not the same as doing it."**

When building LLM-powered systems, every behavioral change the LLM claims to make must go through a verifiable side effect (file write, API call, database update). Text generation is not action. If the LLM can't call a tool to make the change, the change didn't happen.

---

## Fly.io Deployment Quick Reference

```bash
# Binary location on Will's machine:
/c/Users/Will/.fly/bin/fly.exe

# Common commands:
fly status                    # App state + machine health
fly logs --no-tail            # Recent logs (non-streaming)
fly deploy                    # Build + push + rolling update
fly secrets list              # Check env vars (encrypted)
fly secrets set KEY=VALUE     # Set encrypted env var
fly ssh console               # SSH into running machine

# After EVERY deploy, verify:
fly logs --no-tail | tail -20  # Check startup succeeded
curl -s https://APP.fly.dev/health  # Verify external reachability
```
