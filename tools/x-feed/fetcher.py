"""
X (Twitter) API v2 client for fetching @godofprompt tweets.

Uses tweepy for X API v2 access. Requires a bearer token from
the X Developer Portal (https://developer.twitter.com).

Free tier supports reading tweets. That's all we need.
"""

import json
import logging
from datetime import datetime, timezone
from pathlib import Path

import tweepy

from .config import (
    X_BEARER_TOKEN,
    TARGET_USERNAME,
    MAX_TWEETS_PER_FETCH,
    INCLUDE_REPLIES,
    INCLUDE_RETWEETS,
    FEED_STATE_FILE,
)

logger = logging.getLogger(__name__)


def get_client() -> tweepy.Client:
    """Create an authenticated X API v2 client."""
    if not X_BEARER_TOKEN:
        raise ValueError(
            "X_BEARER_TOKEN not set. Get one from https://developer.twitter.com\n"
            "Then set it in .env or as an environment variable."
        )
    return tweepy.Client(bearer_token=X_BEARER_TOKEN, wait_on_rate_limit=True)


def load_state() -> dict:
    """Load the feed state (last fetch timestamp, last tweet ID)."""
    if FEED_STATE_FILE.exists():
        with open(FEED_STATE_FILE) as f:
            return json.load(f)
    return {"last_fetch": None, "last_tweet_id": None, "total_fetched": 0}


def save_state(state: dict) -> None:
    """Persist feed state to disk."""
    FEED_STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(FEED_STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)


def fetch_tweets(since_id: str | None = None) -> list[dict]:
    """
    Fetch recent tweets from @godofprompt.

    Args:
        since_id: Only fetch tweets newer than this ID (for incremental fetches).

    Returns:
        List of tweet dicts with keys: id, text, created_at, url, metrics.
    """
    client = get_client()

    # First, get the user ID for @godofprompt
    user = client.get_user(username=TARGET_USERNAME)
    if not user.data:
        raise ValueError(f"User @{TARGET_USERNAME} not found")

    user_id = user.data.id
    logger.info(f"Fetching tweets for @{TARGET_USERNAME} (ID: {user_id})")

    # Build query parameters
    kwargs = {
        "id": user_id,
        "max_results": min(MAX_TWEETS_PER_FETCH, 100),
        "tweet_fields": ["created_at", "public_metrics", "referenced_tweets"],
        "exclude": [],
    }

    if not INCLUDE_REPLIES:
        kwargs["exclude"].append("replies")
    if not INCLUDE_RETWEETS:
        kwargs["exclude"].append("retweets")
    if since_id:
        kwargs["since_id"] = since_id

    # Fetch
    response = client.get_users_tweets(**kwargs)

    if not response.data:
        logger.info("No new tweets found.")
        return []

    tweets = []
    for tweet in response.data:
        tweet_data = {
            "id": str(tweet.id),
            "text": tweet.text,
            "created_at": tweet.created_at.isoformat() if tweet.created_at else None,
            "url": f"https://x.com/{TARGET_USERNAME}/status/{tweet.id}",
            "metrics": {},
        }
        if tweet.public_metrics:
            tweet_data["metrics"] = {
                "likes": tweet.public_metrics.get("like_count", 0),
                "retweets": tweet.public_metrics.get("retweet_count", 0),
                "replies": tweet.public_metrics.get("reply_count", 0),
                "impressions": tweet.public_metrics.get("impression_count", 0),
            }
        tweets.append(tweet_data)

    logger.info(f"Fetched {len(tweets)} tweets from @{TARGET_USERNAME}")
    return tweets


def fetch_new_tweets() -> list[dict]:
    """
    Fetch only tweets newer than the last fetch.
    Updates the feed state after fetching.
    """
    state = load_state()
    tweets = fetch_tweets(since_id=state.get("last_tweet_id"))

    if tweets:
        # Update state with newest tweet ID
        newest_id = max(tweets, key=lambda t: int(t["id"]))["id"]
        state["last_tweet_id"] = newest_id
        state["last_fetch"] = datetime.now(timezone.utc).isoformat()
        state["total_fetched"] = state.get("total_fetched", 0) + len(tweets)
        save_state(state)

    return tweets
