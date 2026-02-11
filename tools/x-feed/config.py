"""Configuration for X feed fetcher."""

import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

# X API v2 credentials
X_BEARER_TOKEN = os.getenv("X_BEARER_TOKEN", "")
X_API_KEY = os.getenv("X_API_KEY", "")
X_API_SECRET = os.getenv("X_API_SECRET", "")

# Target account
TARGET_USERNAME = "godofprompt"

# Paths
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
FEED_STORAGE_DIR = PROJECT_ROOT / ".claude" / "x-feed"
PROMPTS_FILE = FEED_STORAGE_DIR / "prompts.md"
FEED_STATE_FILE = FEED_STORAGE_DIR / "feed_state.json"
ARCHIVE_DIR = FEED_STORAGE_DIR / "archive"

# Fetch settings
MAX_TWEETS_PER_FETCH = 50
INCLUDE_REPLIES = False
INCLUDE_RETWEETS = False
