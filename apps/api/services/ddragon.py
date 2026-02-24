"""Data Dragon version helper.

Delegates to the library's built-in ``DataDragonClient`` (accessed via
``riot_service.client.static``) which already handles version caching,
LRU eviction, and HTTP error fallbacks.

A pinned ``DDRAGON_VERSION`` env-var still takes precedence for
reproducible deployments.
"""

import os
import time
import logging

logger = logging.getLogger(__name__)

_DEFAULT_FALLBACK_VERSION = "14.24.1"

# In-process cache so every /champion list call doesn't incur a network round-trip.
# DDragon versions only change on patch day (~2 weeks); 6-hour TTL is plenty.
_version_cache: str | None = None
_version_cache_ts: float = 0.0
_VERSION_TTL_SECONDS = 6 * 3600  # 6 hours


async def get_ddragon_version() -> str:
    """Return the Data Dragon patch version string.

    Behaviour:
    - If ``DDRAGON_VERSION`` is set (and not ``"latest"``), return it verbatim.
    - Otherwise delegate to the library's ``DataDragonClient`` which fetches,
      caches and returns the latest patch version automatically.
    - Result is cached in-process for 6 hours to avoid a network call on every request.
    - On failure, fall back to a safe default.
    """
    global _version_cache, _version_cache_ts

    pinned = os.getenv("DDRAGON_VERSION")
    if pinned and pinned.strip().lower() != "latest":
        return pinned.strip()

    now = time.monotonic()
    if _version_cache is not None and (now - _version_cache_ts) < _VERSION_TTL_SECONDS:
        return _version_cache

    try:
        from services.riot import riot_service

        version = await riot_service.get_ddragon_version()
        _version_cache = version
        _version_cache_ts = now
        return version
    except Exception as e:
        logger.warning(
            "Failed to fetch DDragon version via library; using fallback=%s (%s)",
            _DEFAULT_FALLBACK_VERSION,
            e,
        )
        # Cache the fallback too so we don't hammer the network on every request
        # when it's unavailable.
        _version_cache = _DEFAULT_FALLBACK_VERSION
        _version_cache_ts = now
        return _DEFAULT_FALLBACK_VERSION
