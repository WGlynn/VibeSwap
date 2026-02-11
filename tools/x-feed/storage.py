"""
Storage layer for @godofprompt prompts.

Saves parsed prompts to .claude/x-feed/ as structured markdown
that Claude can read at session start.
"""

import json
import logging
from datetime import datetime, timezone
from pathlib import Path

from .config import PROMPTS_FILE, ARCHIVE_DIR, FEED_STORAGE_DIR

logger = logging.getLogger(__name__)


def _load_existing_ids() -> set[str]:
    """Load IDs of prompts already stored to avoid duplicates."""
    ids_file = FEED_STORAGE_DIR / "seen_ids.json"
    if ids_file.exists():
        with open(ids_file) as f:
            return set(json.load(f))
    return set()


def _save_seen_ids(ids: set[str]) -> None:
    """Persist the set of seen tweet IDs."""
    ids_file = FEED_STORAGE_DIR / "seen_ids.json"
    ids_file.parent.mkdir(parents=True, exist_ok=True)
    with open(ids_file, "w") as f:
        json.dump(sorted(ids), f, indent=2)


def save_prompts(prompts: list[dict]) -> int:
    """
    Save new prompts to the prompts.md file.

    Appends to the existing file. Deduplicates by tweet ID.
    Archives old prompts when the file gets too long.

    Returns the number of new prompts saved.
    """
    FEED_STORAGE_DIR.mkdir(parents=True, exist_ok=True)

    # Deduplicate
    seen_ids = _load_existing_ids()
    new_prompts = [p for p in prompts if p["id"] not in seen_ids]

    if not new_prompts:
        logger.info("No new prompts to save (all duplicates).")
        return 0

    # Read existing content
    existing_content = ""
    if PROMPTS_FILE.exists():
        existing_content = PROMPTS_FILE.read_text()

    # Check if we need to archive (file > 500 lines)
    if existing_content.count("\n") > 500:
        _archive_prompts(existing_content)
        existing_content = ""

    # Build new entries
    new_entries = []
    for p in new_prompts:
        cats = ", ".join(p["categories"])
        engagement = f" | engagement: {p['engagement_score']:.0f}" if p["engagement_score"] > 0 else ""
        entry = (
            f"### [{p['date']}] {cats}{engagement}\n"
            f"{p['content']}\n"
            f"*Source: [{p['url']}]({p['url']})*\n"
        )
        new_entries.append(entry)
        seen_ids.add(p["id"])

    # Write the file
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    if not existing_content:
        header = (
            "# @godofprompt Prompt Feed\n\n"
            "Prompts fetched from [@godofprompt](https://x.com/godofprompt) for Claude self-improvement.\n"
            "Sorted by engagement score (higher = more validated by community).\n\n"
            "---\n\n"
        )
    else:
        header = ""

    update_marker = f"## New Prompts (fetched {now})\n\n"
    new_content = update_marker + "\n".join(new_entries) + "\n---\n\n"

    if header:
        full_content = header + new_content
    else:
        # Prepend new prompts (newest at top)
        full_content = existing_content.split("---\n\n", 1)
        if len(full_content) == 2:
            full_content = full_content[0] + "---\n\n" + new_content + full_content[1]
        else:
            full_content = existing_content + "\n" + new_content

    PROMPTS_FILE.write_text(full_content)
    _save_seen_ids(seen_ids)

    logger.info(f"Saved {len(new_prompts)} new prompts to {PROMPTS_FILE}")
    return len(new_prompts)


def _archive_prompts(content: str) -> None:
    """Archive old prompts to a dated file."""
    ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
    date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    archive_file = ARCHIVE_DIR / f"prompts-{date_str}.md"
    archive_file.write_text(content)
    logger.info(f"Archived old prompts to {archive_file}")


def save_manual_prompt(text: str, source: str = "manual") -> None:
    """
    Save a manually entered prompt (for the fallback workflow).

    Args:
        text: The prompt text.
        source: Where it came from (e.g., "manual", "screenshot", "copy-paste").
    """
    FEED_STORAGE_DIR.mkdir(parents=True, exist_ok=True)

    now = datetime.now(timezone.utc)
    date_str = now.strftime("%Y-%m-%d")
    time_str = now.strftime("%Y-%m-%d %H:%M UTC")

    entry = (
        f"### [{date_str}] manual | source: {source}\n"
        f"{text}\n"
        f"*Added manually on {time_str}*\n\n"
    )

    if PROMPTS_FILE.exists():
        existing = PROMPTS_FILE.read_text()
        # Insert after the header
        parts = existing.split("---\n\n", 1)
        if len(parts) == 2:
            content = parts[0] + "---\n\n" + entry + parts[1]
        else:
            content = existing + "\n" + entry
    else:
        header = (
            "# @godofprompt Prompt Feed\n\n"
            "Prompts fetched from [@godofprompt](https://x.com/godofprompt) for Claude self-improvement.\n"
            "Sorted by engagement score (higher = more validated by community).\n\n"
            "---\n\n"
        )
        content = header + entry

    PROMPTS_FILE.write_text(content)
    logger.info(f"Saved manual prompt ({len(text)} chars)")


def get_unread_prompts(max_count: int = 10) -> str:
    """
    Get the most recent unread prompts as formatted text.
    For Claude to read at session start.
    """
    if not PROMPTS_FILE.exists():
        return "No prompts available yet. Run the fetcher or add prompts manually."

    content = PROMPTS_FILE.read_text()

    # Return first N sections (each prompt starts with ###)
    sections = content.split("### ")
    if len(sections) <= 1:
        return content

    # Take header + first max_count prompts
    result = sections[0]
    for section in sections[1 : max_count + 1]:
        result += "### " + section

    return result
