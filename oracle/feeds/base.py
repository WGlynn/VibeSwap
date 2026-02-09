"""
Base classes for data feeds.

All data feeds inherit from DataFeed and implement async fetch methods.
Includes rate limiting, error handling, and caching.
"""

import asyncio
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Dict, Optional, TypeVar, Generic
from collections import deque
import logging

logger = logging.getLogger(__name__)

T = TypeVar('T')


class FeedError(Exception):
    """Base exception for feed errors"""
    pass


class RateLimitError(FeedError):
    """Raised when rate limit is exceeded"""
    pass


class ConnectionError(FeedError):
    """Raised when connection fails"""
    pass


@dataclass
class RateLimiter:
    """
    Token bucket rate limiter for API calls.

    Args:
        requests_per_second: Maximum requests per second
        burst_size: Maximum burst size (bucket capacity)
    """
    requests_per_second: float
    burst_size: int = 10

    _tokens: float = field(default=0, init=False)
    _last_update: float = field(default=0, init=False)
    _lock: asyncio.Lock = field(default_factory=asyncio.Lock, init=False)

    def __post_init__(self):
        self._tokens = float(self.burst_size)
        self._last_update = time.monotonic()

    async def acquire(self):
        """Acquire a token, waiting if necessary."""
        async with self._lock:
            now = time.monotonic()
            elapsed = now - self._last_update
            self._last_update = now

            # Add tokens based on elapsed time
            self._tokens = min(
                self.burst_size,
                self._tokens + elapsed * self.requests_per_second
            )

            if self._tokens < 1:
                # Need to wait
                wait_time = (1 - self._tokens) / self.requests_per_second
                await asyncio.sleep(wait_time)
                self._tokens = 0
            else:
                self._tokens -= 1


@dataclass
class CacheEntry(Generic[T]):
    """Cached data entry with TTL"""
    data: T
    timestamp: float
    ttl: float

    @property
    def is_expired(self) -> bool:
        return time.time() - self.timestamp > self.ttl


class DataFeed(ABC):
    """
    Abstract base class for all data feeds.

    Provides:
    - Async fetch with rate limiting
    - Caching with TTL
    - Error handling and retries
    - Health monitoring
    """

    def __init__(
        self,
        name: str,
        rate_limit: float = 10.0,  # requests per second
        cache_ttl: float = 1.0,    # seconds
        max_retries: int = 3,
        retry_delay: float = 1.0,
    ):
        self.name = name
        self.rate_limiter = RateLimiter(rate_limit)
        self.cache_ttl = cache_ttl
        self.max_retries = max_retries
        self.retry_delay = retry_delay

        self._cache: Dict[str, CacheEntry] = {}
        self._error_count = 0
        self._last_success: Optional[float] = None
        self._request_times: deque = deque(maxlen=100)

    @property
    def is_healthy(self) -> bool:
        """Check if feed is healthy (recent successful request)"""
        if self._last_success is None:
            return False
        return time.time() - self._last_success < 60  # 1 minute threshold

    @property
    def avg_latency_ms(self) -> float:
        """Average request latency in milliseconds"""
        if not self._request_times:
            return 0
        return sum(self._request_times) / len(self._request_times) * 1000

    def _cache_key(self, *args, **kwargs) -> str:
        """Generate cache key from arguments"""
        return f"{self.name}:{args}:{sorted(kwargs.items())}"

    def _get_cached(self, key: str) -> Optional[Any]:
        """Get cached value if not expired"""
        entry = self._cache.get(key)
        if entry and not entry.is_expired:
            return entry.data
        return None

    def _set_cached(self, key: str, data: Any):
        """Set cached value"""
        self._cache[key] = CacheEntry(
            data=data,
            timestamp=time.time(),
            ttl=self.cache_ttl
        )

    async def fetch_with_retry(self, *args, **kwargs) -> Any:
        """
        Fetch data with rate limiting, caching, and retries.
        """
        cache_key = self._cache_key(*args, **kwargs)

        # Check cache first
        cached = self._get_cached(cache_key)
        if cached is not None:
            return cached

        # Rate limit
        await self.rate_limiter.acquire()

        # Fetch with retries
        last_error = None
        for attempt in range(self.max_retries):
            try:
                start = time.monotonic()
                result = await self._fetch(*args, **kwargs)
                elapsed = time.monotonic() - start

                # Record success
                self._request_times.append(elapsed)
                self._last_success = time.time()
                self._error_count = 0

                # Cache result
                self._set_cached(cache_key, result)

                return result

            except Exception as e:
                last_error = e
                self._error_count += 1
                logger.warning(
                    f"{self.name}: Attempt {attempt + 1}/{self.max_retries} failed: {e}"
                )

                if attempt < self.max_retries - 1:
                    await asyncio.sleep(self.retry_delay * (attempt + 1))

        raise FeedError(f"{self.name}: All retries failed: {last_error}")

    @abstractmethod
    async def _fetch(self, *args, **kwargs) -> Any:
        """
        Implement actual data fetching logic.

        Subclasses must implement this method.
        """
        pass

    def get_status(self) -> Dict[str, Any]:
        """Get feed status for monitoring"""
        return {
            "name": self.name,
            "healthy": self.is_healthy,
            "error_count": self._error_count,
            "avg_latency_ms": self.avg_latency_ms,
            "last_success": self._last_success,
            "cache_size": len(self._cache),
        }
