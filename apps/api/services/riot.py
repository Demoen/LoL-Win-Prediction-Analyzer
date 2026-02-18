import os
import logging
from typing import Dict, Any, Optional

import httpx

from riotskillissue import (
    RiotClient,
    RiotClientConfig,
    MemoryCache,
    NotFoundError,
    RateLimitError,
    RiotAPIError,
)

from pathlib import Path

logger = logging.getLogger(__name__)

# Try to load .env files for local development (optional)
try:
    from dotenv import load_dotenv

    current_dir = Path(__file__).resolve().parent
    load_dotenv(current_dir / ".env")
    load_dotenv(current_dir / "dev.env")

    # Try parent directories for monorepo structure
    for parent in current_dir.parents:
        env_file = parent / "dev.env"
        if env_file.exists():
            load_dotenv(env_file)
            break
except ImportError:
    pass  # python-dotenv not installed, rely on system env vars


def _build_config() -> RiotClientConfig:
    """Build a ``RiotClientConfig`` from environment variables.

    Uses ``RiotClientConfig.from_env()`` which reads:
      RIOT_API_KEY, RIOT_CACHE_TTL, RIOT_PROXY, RIOT_BASE_URL,
      RIOT_LOG_LEVEL, RIOT_MAX_RETRIES, RIOT_REDIS_URL
    """
    return RiotClientConfig.from_env()


class RiotService:
    """Thin async wrapper around :class:`RiotClient`.

    The library itself now handles:
    - Rate limiting (acquires before every call)
    - Automatic 429 retry (sleeps for Retry-After, transparent)
    - 5xx retries with configurable ``max_retries``
    - Response caching (via ``MemoryCache``)
    """

    _instance: Optional["RiotService"] = None
    client: RiotClient

    def __new__(cls) -> "RiotService":
        if cls._instance is None:
            config = _build_config()
            masked = f"{config.api_key[:5]}...{config.api_key[-4:]}" if config.api_key else "None"
            logger.info("Initializing RiotService with API Key: %s", masked)

            inst = super().__new__(cls)
            inst.client = RiotClient(
                config=config,
                cache=MemoryCache(max_size=2048),
            )

            # Fix: Riot API sometimes returns responses whose Content-Encoding
            # header doesn't match the actual encoding (e.g. declares gzip but
            # sends raw/deflate), causing zlib "incorrect header check" errors
            # in httpx's automatic decompression.  Requesting "gzip, deflate"
            # only (dropping "br"/brotli which may not be installed) and adding
            # "identity" as a fallback avoids the issue.
            try:
                httpx_client = inst.client.http._client
                httpx_client.headers["accept-encoding"] = "gzip, deflate, identity"
            except Exception as exc:
                logger.debug("Could not override Accept-Encoding: %s", exc)

            cls._instance = inst
        return cls._instance

    # -- lifecycle -----------------------------------------------------------

    async def close(self) -> None:
        """Gracefully close the underlying HTTP client."""
        await self.client.close()

    # -- helpers -------------------------------------------------------------

    async def get_ddragon_version(self) -> str:
        """Return the latest Data Dragon patch version (cached by the library)."""
        return await self.client.static.get_latest_version()

    # -- Riot API wrappers ---------------------------------------------------

    async def get_account_by_riot_id(
        self, region_routing: str, game_name: str, tag_line: str
    ) -> Any:
        return await self.client.account.get_by_riot_id(
            region_routing, game_name, tag_line
        )

    async def get_summoner_by_puuid(
        self, platform_region: str, puuid: str
    ) -> Any:
        return await self.client.summoner.get_by_puuid(platform_region, puuid)

    async def get_match_history(
        self,
        regional_routing: str,
        puuid: str,
        count: int = 20,
        queue: int = 420,
    ) -> list:
        return await self.client.match.get_match_ids_by_puuid(
            regional_routing, puuid, queue=queue, count=count
        )

    async def get_match_details(
        self, regional_routing: str, match_id: str
    ) -> Any:
        return await self.client.match.get_match(regional_routing, match_id)

    async def get_match_timeline(
        self, regional_routing: str, match_id: str
    ) -> Optional[Any]:
        """Fetch match timeline; returns ``None`` on 404 or transient errors.

        If the normal library call fails with a decompression error (zlib
        "incorrect header check"), fall back to a direct httpx request with
        ``Accept-Encoding: identity`` to bypass server-side compression
        issues.
        """
        try:
            return await self.client.match.get_timeline(
                regional_routing, match_id
            )
        except NotFoundError:
            logger.debug("Timeline not found for %s", match_id)
            return None
        except RiotAPIError as e:
            logger.warning("Error fetching timeline for %s: %s", match_id, e)
            return None
        except Exception as e:
            err_msg = str(e).lower()
            # Detect zlib / brotli decompression failures and retry without
            # compression so the server sends a plain-text response.
            if "decompressing" in err_msg or "incorrect header check" in err_msg or "zlib" in err_msg:
                logger.warning(
                    "Decompression error for timeline %s – retrying without compression: %s",
                    match_id, e,
                )
                return await self._fetch_timeline_raw(regional_routing, match_id)
            logger.warning("Unexpected error fetching timeline for %s: %s", match_id, e)
            return None

    async def _fetch_timeline_raw(
        self, regional_routing: str, match_id: str
    ) -> Optional[Any]:
        """Direct httpx GET for timelines, bypassing automatic decompression."""
        try:
            api_key = self.client.http.config.api_key
            host = f"https://{regional_routing}.api.riotgames.com"
            url = f"{host}/lol/match/v5/matches/{match_id}/timeline"
            async with httpx.AsyncClient(
                headers={
                    "X-Riot-Token": api_key,
                    "Accept-Encoding": "identity",
                },
                timeout=httpx.Timeout(30.0, connect=10.0),
            ) as raw_client:
                resp = await raw_client.get(url)
            if resp.status_code == 404:
                return None
            resp.raise_for_status()
            data = resp.json()
            # Return the raw dict — downstream code already handles both
            # Pydantic models and plain dicts via _get_attr_or_key().
            return data
        except Exception as exc:
            logger.warning("Raw timeline fallback also failed for %s: %s", match_id, exc)
            return None

    async def get_league_entries(
        self, platform_region: str, puuid: str
    ) -> list:
        """Return ranked league entries as dicts.  Empty list on error."""
        try:
            logger.info(
                "Fetching league entries for PUUID %s… on region %s",
                puuid[:8],
                platform_region,
            )
            entries = await self.client.league.get_league_entries_by_puuid(
                platform_region, puuid
            )
            # Convert Pydantic DTOs to plain dicts for downstream consumers
            if entries and hasattr(entries[0], "model_dump"):
                return [entry.model_dump() for entry in entries]
            return entries
        except NotFoundError:
            logger.debug("No league entries found for %s", puuid[:8])
            return []
        except RiotAPIError as e:
            logger.warning("Error fetching league entries: %s", e)
            return []
        except Exception as e:
            logger.warning("Unexpected error fetching league entries: %s", e)
            return []


riot_service = RiotService()


