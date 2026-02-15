import os
import asyncio
from contextlib import asynccontextmanager
from typing import Dict, Any, Optional
from riotskillissue import RiotClient

from pathlib import Path

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

API_KEY = os.getenv("RIOT_API_KEY")

class RiotService:
    _instance = None
    client: RiotClient
    
    def __new__(cls):
        if cls._instance is None:
            masked_key = f"{API_KEY[:5]}...{API_KEY[-4:]}" if API_KEY else "None"
            print(f"Initializing RiotService with API Key: {masked_key}")
            cls._instance = super(RiotService, cls).__new__(cls)
            cls._instance.client = RiotClient(api_key=API_KEY)

            raw_max = os.getenv("RIOT_API_MAX_CONCURRENT", "5")
            try:
                max_concurrent = max(1, int(raw_max))
            except Exception:
                max_concurrent = 5

            cls._instance._max_concurrent = max_concurrent
            cls._instance._semaphore = asyncio.Semaphore(max_concurrent)
            cls._instance._limits_lock = asyncio.Lock()
            cls._instance._in_flight = 0
            cls._instance._queued = 0
        return cls._instance

    @asynccontextmanager
    async def _rate_limit_slot(self):
        async with self._limits_lock:
            self._queued += 1

        await self._semaphore.acquire()

        async with self._limits_lock:
            self._queued -= 1
            self._in_flight += 1

        try:
            yield
        finally:
            async with self._limits_lock:
                self._in_flight = max(0, self._in_flight - 1)
            self._semaphore.release()

    async def get_limits(self) -> Dict[str, int]:
        async with self._limits_lock:
            return {
                "maxConcurrent": int(self._max_concurrent),
                "inFlight": int(self._in_flight),
                "queued": int(self._queued),
            }

    async def get_account_by_riot_id(self, region_routing: str, game_name: str, tag_line: str) -> Dict[str, Any]:
        async with self._rate_limit_slot():
            return await self.client.account.get_by_riot_id(region_routing, game_name, tag_line)

    async def get_summoner_by_puuid(self, platform_region: str, puuid: str) -> Dict[str, Any]:
        async with self._rate_limit_slot():
            return await self.client.summoner.get_by_puuid(platform_region, puuid)

    async def get_match_history(self, regional_routing: str, puuid: str, count: int = 20, queue: int = 420) -> list:
        async with self._rate_limit_slot():
            return await self.client.match.get_match_ids_by_puuid(
                regional_routing,
                puuid,
                queue=queue,
                count=count,
            )

    async def get_match_details(self, regional_routing: str, match_id: str) -> Dict[str, Any]:
        async with self._rate_limit_slot():
            return await self.client.match.get_match(regional_routing, match_id)

    async def get_match_timeline(self, regional_routing: str, match_id: str) -> Optional[Dict[str, Any]]:
        """
        Get match timeline data for territorial/positional analysis.
        Returns minute-by-minute position data for all participants.
        """
        try:
            async with self._rate_limit_slot():
                return await self.client.match.get_timeline(regional_routing, match_id)
        except Exception as e:
            print(f"Error fetching timeline for {match_id}: {e}")
            return None

    async def get_league_entries(self, platform_region: str, puuid: str) -> list:
        """
        Get ranked league entries (tier, division, LP) for a summoner by PUUID.
        Returns list of queue entries (RANKED_SOLO_5x5, RANKED_FLEX_SR, etc.)
        """
        try:
            print(f"Fetching league entries for PUUID {puuid[:8]}... on region {platform_region}")
            async with self._rate_limit_slot():
                entries = await self.client.league.get_league_entries_by_puuid(platform_region, puuid)
            print(f"Raw league entries response: {entries}")
            # Convert Pydantic models to dicts if needed
            if entries and hasattr(entries[0], 'model_dump'):
                return [entry.model_dump() for entry in entries]
            return entries
        except Exception as e:
            print(f"Error fetching league entries: {e}")
            import traceback
            traceback.print_exc()
            return []

riot_service = RiotService()


