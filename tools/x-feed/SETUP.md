# @godofprompt X Feed Integration - Setup Guide

## Overview

This tool fetches prompts from [@godofprompt](https://x.com/godofprompt) on X (Twitter)
and stores them in `.claude/x-feed/prompts.md` for Claude to read at session start.

Three modes of operation:
1. **Automated** - GitHub Action fetches daily (requires X API token)
2. **Manual CLI** - Run the fetcher locally
3. **Copy-paste** - Add prompts manually (no API needed)

---

## Option A: Automated Daily Fetch (Recommended)

### 1. Get an X API Bearer Token

1. Go to [developer.twitter.com](https://developer.twitter.com)
2. Sign up for a developer account (Free tier works)
3. Create a Project and App
4. Generate a **Bearer Token** (read-only access is sufficient)

### 2. Add Token to GitHub Secrets

1. Go to your repo Settings > Secrets and variables > Actions
2. Click "New repository secret"
3. Name: `X_BEARER_TOKEN`
4. Value: Your bearer token

### 3. Enable the GitHub Action

The workflow at `.github/workflows/x-feed-daily.yml` runs automatically at 8:00 AM UTC daily.
You can also trigger it manually from the Actions tab.

That's it. New prompts will be committed to `.claude/x-feed/prompts.md` automatically.

---

## Option B: Manual CLI Fetch

### 1. Install dependencies

```bash
pip install -r tools/x-feed/requirements.txt
```

### 2. Set your token

```bash
# In .env at project root:
X_BEARER_TOKEN=your-token-here

# Or as environment variable:
export X_BEARER_TOKEN="your-token-here"
```

### 3. Run the fetcher

```bash
# Fetch new tweets
python -m tools.x-feed.main fetch

# Check status
python -m tools.x-feed.main status

# View stored prompts
python -m tools.x-feed.main show
```

---

## Option C: Copy-Paste Mode (No API Needed)

No X API access? Just paste the prompts directly:

```bash
# Add a single prompt
python -m tools.x-feed.main add "Use chain-of-thought prompting to break complex tasks into steps"

# Add multiple prompts interactively
python -m tools.x-feed.main batch
# (paste one tweet per line, empty line to finish)
```

Or tell Claude directly in a session:
> "Add this @godofprompt prompt to the feed: [paste tweet text]"

---

## How Claude Uses the Prompts

The session start protocol (in `JarvisxWill_CKB.md`) now includes:

```
6. Read {project}/.claude/x-feed/prompts.md → @godofprompt self-improvement prompts
```

Claude reads this file at every FRESH_START and RECOVERY, gaining exposure to
prompt engineering techniques that can improve its own performance.

---

## File Structure

```
.claude/x-feed/
├── prompts.md       # Main prompt file (Claude reads this)
├── feed_state.json  # Last fetch timestamp and tweet ID
├── seen_ids.json    # Deduplication tracking
└── archive/         # Old prompts (auto-archived when file gets long)

tools/x-feed/
├── __init__.py      # Package init
├── __main__.py      # Module entry point
├── main.py          # CLI interface
├── fetcher.py       # X API v2 client (tweepy)
├── parser.py        # Tweet → structured prompt conversion
├── storage.py       # File storage and deduplication
├── config.py        # Configuration
├── requirements.txt # Python dependencies
└── SETUP.md         # This file
```
