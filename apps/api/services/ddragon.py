import asyncio
import logging
import os
import time
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

_DEFAULT_FALLBACK_VERSION = "14.24.1"
_VERSIONS_URL = "https://ddragon.leagueoflegends.com/api/versions.json"

_cache_version: Optional[str] = None
_cache_fetched_at: float = 0.0
_cache_lock = asyncio.Lock()


def _ttl_seconds() -> int:
    raw = os.getenv("DDRAGON_VERSION_TTL_SECONDS", "43200")  # 12h
    try:
        ttl = int(raw)
        return max(60, ttl)
    except Exception:
        return 43200


async def get_ddragon_version() -> str:
    """Return Data Dragon patch version.

    Behavior:
    - If `DDRAGON_VERSION` is set and not "latest", use it (pin).
    - Otherwise fetch the latest version from DDragon (cached).
    - On failure, fall back to pinned value (if set), cached value (if present), or a safe default.
    """

    pinned = os.getenv("DDRAGON_VERSION")
    if pinned and pinned.strip() and pinned.strip().lower() != "latest":
        return pinned.strip()

    ttl = _ttl_seconds()
    now = time.time()

    global _cache_version, _cache_fetched_at

    if _cache_version and (now - _cache_fetched_at) < ttl:
        return _cache_version

    async with _cache_lock:
        now = time.time()
        if _cache_version and (now - _cache_fetched_at) < ttl:
            return _cache_version

        try:
            async with httpx.AsyncClient(timeout=5.0, follow_redirects=True) as client:
                resp = await client.get(_VERSIONS_URL)
                resp.raise_for_status()
                versions = resp.json()

            if isinstance(versions, list) and versions and isinstance(versions[0], str):
                _cache_version = versions[0]
                _cache_fetched_at = now
                return _cache_version

            raise ValueError("Unexpected versions.json format")

        except Exception as e:
            # Prefer pinned even if it was "latest" (user intention), else cached, else fallback
            if _cache_version:
                logger.warning("Failed to fetch latest DDragon version; using cached=%s (%s)", _cache_version, e)
                return _cache_version

            fallback = pinned.strip() if pinned and pinned.strip() else _DEFAULT_FALLBACK_VERSION
            logger.warning("Failed to fetch latest DDragon version; using fallback=%s (%s)", fallback, e)
            return fallback
