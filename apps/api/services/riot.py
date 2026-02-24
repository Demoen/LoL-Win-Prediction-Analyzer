import os
import logging
from typing import Dict, Any, Optional

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
        """Fetch match timeline; returns ``None`` on 404 or transient errors."""
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
            logger.warning("Unexpected error fetching timeline for %s: %s", match_id, e)
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


