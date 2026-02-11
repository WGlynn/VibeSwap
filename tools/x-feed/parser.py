"""
Parse @godofprompt tweets into structured prompts.

Filters out noise, extracts actionable prompt content,
and categorizes by topic.
"""

import re
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

# Categories we care about for self-improvement
CATEGORIES = {
    "prompting": ["prompt", "prompting", "instruction", "system prompt", "chain of thought"],
    "reasoning": ["reason", "think", "logic", "step by step", "breakdown"],
    "coding": ["code", "coding", "program", "developer", "engineer", "debug", "refactor"],
    "ai_tools": ["claude", "gpt", "llm", "ai", "chatgpt", "copilot", "cursor", "agent"],
    "productivity": ["workflow", "productivity", "automate", "efficiency", "hack"],
    "meta": ["meta", "improve", "learn", "better", "upgrade", "level up"],
}

# Noise patterns to filter out
NOISE_PATTERNS = [
    r"^RT @",                    # Retweets that slipped through
    r"^@\w+\s",                  # Direct replies
    r"giveaway|airdrop|free\s",  # Spam
    r"follow.*retweet",          # Engagement bait
    r"DM me for",                # Spam
]


def is_noise(text: str) -> bool:
    """Check if a tweet is noise (not a useful prompt)."""
    text_lower = text.lower()
    for pattern in NOISE_PATTERNS:
        if re.search(pattern, text_lower):
            return True
    return False


def categorize(text: str) -> list[str]:
    """Categorize a tweet by matching keywords."""
    text_lower = text.lower()
    matched = []
    for category, keywords in CATEGORIES.items():
        for keyword in keywords:
            if keyword in text_lower:
                matched.append(category)
                break
    return matched if matched else ["general"]


def extract_prompt_content(text: str) -> str:
    """
    Clean up tweet text to extract the core prompt/insight.
    Removes URLs, excessive hashtags, and thread numbering.
    """
    # Remove URLs
    text = re.sub(r"https?://\S+", "", text)
    # Remove hashtag symbols but keep the word
    text = re.sub(r"#(\w+)", r"\1", text)
    # Remove thread numbering like "1/" or "1/10"
    text = re.sub(r"^\d+/\d*\s*", "", text)
    # Clean up extra whitespace
    text = re.sub(r"\s+", " ", text).strip()
    return text


def parse_tweets(tweets: list[dict]) -> list[dict]:
    """
    Parse raw tweets into structured prompt entries.

    Args:
        tweets: List of tweet dicts from fetcher.

    Returns:
        List of parsed prompt dicts with keys:
            id, date, categories, content, url, engagement_score
    """
    prompts = []

    for tweet in tweets:
        text = tweet["text"]

        # Skip noise
        if is_noise(text):
            logger.debug(f"Filtered noise: {text[:50]}...")
            continue

        # Extract and categorize
        content = extract_prompt_content(text)
        if len(content) < 20:
            # Too short to be useful
            continue

        categories = categorize(text)

        # Calculate engagement score (rough signal of quality)
        metrics = tweet.get("metrics", {})
        engagement = (
            metrics.get("likes", 0) * 1
            + metrics.get("retweets", 0) * 2
            + metrics.get("replies", 0) * 0.5
        )

        created = tweet.get("created_at", "")
        if created:
            try:
                date = datetime.fromisoformat(created).strftime("%Y-%m-%d")
            except (ValueError, TypeError):
                date = "unknown"
        else:
            date = "unknown"

        prompts.append({
            "id": tweet["id"],
            "date": date,
            "categories": categories,
            "content": content,
            "url": tweet.get("url", ""),
            "engagement_score": engagement,
        })

    # Sort by engagement (highest first)
    prompts.sort(key=lambda p: p["engagement_score"], reverse=True)

    logger.info(f"Parsed {len(prompts)} prompts from {len(tweets)} tweets")
    return prompts
