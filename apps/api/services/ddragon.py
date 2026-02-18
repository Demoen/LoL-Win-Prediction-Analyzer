"""Data Dragon version helper.

Delegates to the library's built-in ``DataDragonClient`` (accessed via
``riot_service.client.static``) which already handles version caching,
LRU eviction, and HTTP error fallbacks.

A pinned ``DDRAGON_VERSION`` env-var still takes precedence for
reproducible deployments.
"""

import os
import logging

logger = logging.getLogger(__name__)

_DEFAULT_FALLBACK_VERSION = "14.24.1"


async def get_ddragon_version() -> str:
    """Return the Data Dragon patch version string.

    Behaviour:
    - If ``DDRAGON_VERSION`` is set (and not ``"latest"``), return it verbatim.
    - Otherwise delegate to the library's ``DataDragonClient`` which fetches,
      caches and returns the latest patch version automatically.
    - On failure, fall back to a safe default.
    """
    pinned = os.getenv("DDRAGON_VERSION")
    if pinned and pinned.strip().lower() != "latest":
        return pinned.strip()

    try:
        from services.riot import riot_service

        return await riot_service.get_ddragon_version()
    except Exception as e:
        logger.warning(
            "Failed to fetch DDragon version via library; using fallback=%s (%s)",
            _DEFAULT_FALLBACK_VERSION,
            e,
        )
        return _DEFAULT_FALLBACK_VERSION
