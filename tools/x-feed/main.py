#!/usr/bin/env python3
"""
@godofprompt X Feed Fetcher

Fetches prompts from @godofprompt's X feed and stores them
for Claude to read at session start.

Usage:
    # Fetch new tweets (requires X_BEARER_TOKEN)
    python -m tools.x-feed.main fetch

    # Add a prompt manually (no API needed)
    python -m tools.x-feed.main add "Your prompt text here"

    # Show recent prompts
    python -m tools.x-feed.main show

    # Show feed status
    python -m tools.x-feed.main status
"""

import sys
import json
import logging
from datetime import datetime, timezone

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)


def cmd_fetch():
    """Fetch new tweets from @godofprompt."""
    from .fetcher import fetch_new_tweets
    from .parser import parse_tweets
    from .storage import save_prompts

    print("Fetching tweets from @godofprompt...")
    try:
        tweets = fetch_new_tweets()
        if not tweets:
            print("No new tweets found.")
            return

        prompts = parse_tweets(tweets)
        if not prompts:
            print("Tweets found but no actionable prompts extracted.")
            return

        count = save_prompts(prompts)
        print(f"Saved {count} new prompts to .claude/x-feed/prompts.md")

    except ValueError as e:
        print(f"Configuration error: {e}")
        print("\nTo set up X API access:")
        print("  1. Go to https://developer.twitter.com")
        print("  2. Create a project and get a Bearer Token")
        print("  3. Set X_BEARER_TOKEN in your .env file")
        print("\nOr use manual mode: python -m tools.x-feed.main add 'prompt text'")
        sys.exit(1)

    except Exception as e:
        logger.error(f"Fetch failed: {e}")
        print(f"\nFetch failed: {e}")
        print("Try manual mode: python -m tools.x-feed.main add 'prompt text'")
        sys.exit(1)


def cmd_add(text: str, source: str = "manual"):
    """Manually add a prompt."""
    from .storage import save_manual_prompt

    save_manual_prompt(text, source=source)
    print(f"Saved prompt ({len(text)} chars) to .claude/x-feed/prompts.md")


def cmd_show(count: int = 10):
    """Show recent prompts."""
    from .storage import get_unread_prompts

    print(get_unread_prompts(max_count=count))


def cmd_status():
    """Show feed status."""
    from .config import FEED_STATE_FILE, PROMPTS_FILE

    print("=== @godofprompt Feed Status ===\n")

    if FEED_STATE_FILE.exists():
        with open(FEED_STATE_FILE) as f:
            state = json.load(f)
        last_fetch = state.get("last_fetch", "never")
        total = state.get("total_fetched", 0)
        last_id = state.get("last_tweet_id", "none")
        print(f"Last fetch:     {last_fetch}")
        print(f"Total fetched:  {total}")
        print(f"Last tweet ID:  {last_id}")
    else:
        print("No fetch history found.")

    if PROMPTS_FILE.exists():
        content = PROMPTS_FILE.read_text()
        prompt_count = content.count("### [")
        print(f"Stored prompts: {prompt_count}")
        print(f"File size:      {len(content)} bytes")
    else:
        print("No prompts stored yet.")

    # Check API config
    from .config import X_BEARER_TOKEN
    if X_BEARER_TOKEN:
        print(f"\nAPI status:     Configured (token: ...{X_BEARER_TOKEN[-8:]})")
    else:
        print("\nAPI status:     NOT CONFIGURED")
        print("  Set X_BEARER_TOKEN in .env to enable automatic fetching.")


def cmd_batch_add():
    """Interactive mode: paste multiple tweets, one per line, end with empty line."""
    from .storage import save_manual_prompt

    print("Paste tweets from @godofprompt (one per line, empty line to finish):")
    print("---")
    count = 0
    while True:
        try:
            line = input()
        except EOFError:
            break
        if not line.strip():
            break
        save_manual_prompt(line.strip(), source="batch-paste")
        count += 1

    print(f"---\nSaved {count} prompts to .claude/x-feed/prompts.md")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(0)

    command = sys.argv[1]

    if command == "fetch":
        cmd_fetch()
    elif command == "add":
        if len(sys.argv) < 3:
            print("Usage: python -m tools.x-feed.main add 'prompt text'")
            sys.exit(1)
        text = " ".join(sys.argv[2:])
        cmd_add(text)
    elif command == "show":
        count = int(sys.argv[2]) if len(sys.argv) > 2 else 10
        cmd_show(count)
    elif command == "status":
        cmd_status()
    elif command == "batch":
        cmd_batch_add()
    else:
        print(f"Unknown command: {command}")
        print("Commands: fetch, add, show, status, batch")
        sys.exit(1)


if __name__ == "__main__":
    main()
