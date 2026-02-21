from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.exc import IntegrityError
from models import User, Match, Participant
from services.riot import riot_service
from riotskillissue import NotFoundError, RiotAPIError
import asyncio
import logging

logger = logging.getLogger(__name__)

class IngestionService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_or_update_user(self, region_routing: str, platform_region: str, game_name: str, tag_line: str):
        # Check DB
        result = await self.db.execute(select(User).where(User.game_name == game_name, User.tag_line == tag_line, User.region == platform_region))
        user = result.scalars().first()
        
        if user:
            # TODO: Check last_updated and refresh if stale
            return user
            
        # Fetch from Riot
        account = await riot_service.get_account_by_riot_id(region_routing, game_name, tag_line)
        if not account:
            return None

        # riotskillissue returns objects (DTOs), so use dot notation
        puuid = account.puuid
        
        # Mapping simple region to platform for summoner lookups (e.g. europe -> euw1)
        REGION_TO_PLATFORM = {
            "euw": "euw1",
            "eune": "eun1",
            "na": "na1",
            "br": "br1",
            "lan": "la1",
            "las": "la2",
            "kr": "kr",
            "jp": "jp1",
            "oce": "oc1",
            "tr": "tr1",
            "ru": "ru",
            "ph": "ph2",
            "sg": "sg2",
            "th": "th2",
            "tw": "tw2",
            "vn": "vn2",
        }
        
        # Default to passed value if not in map (assuming it might be already correct) or euw1
        platform = REGION_TO_PLATFORM.get(platform_region.lower(), platform_region if platform_region else "euw1")
        
        summoner = await riot_service.get_summoner_by_puuid(platform, puuid)
        
        user = User(
            puuid=puuid,
            game_name=account.gameName,
            tag_line=account.tagLine,
            region=platform_region,
            profile_icon_id=summoner.profileIconId,
            summoner_level=summoner.summonerLevel
        )
        try:
            self.db.add(user)
            await self.db.commit()
            await self.db.refresh(user)
        except IntegrityError:
            await self.db.rollback()
            # Race condition: User was created by another request in the meantime
            result = await self.db.execute(select(User).where(User.puuid == puuid))
            user = result.scalars().first()
            
        return user

    async def ingest_match_history(self, user: User, count: int = 20):
        # Determine routing
        routing = self._get_routing(user.region)
            
        match_ids = await riot_service.get_match_history(routing, user.puuid, count=count)
        
        new_matches = []
        for match_id in match_ids:
            # Check if exists
            result = await self.db.execute(select(Match).where(Match.match_id == match_id))
            if result.scalars().first():
                continue
                
            # Fetch details
            try:
                details = await riot_service.get_match_details(routing, match_id)
                await self.save_match(details)
                new_matches.append(match_id)
                # Delay between requests to avoid rate limiting
                await asyncio.sleep(1.2)
            except NotFoundError:
                logger.debug("Match %s not found, skipping", match_id)
            except RiotAPIError as e:
                logger.error("Riot API error ingesting match %s: %s", match_id, e)
            except Exception as e:
                import traceback
                traceback.print_exc()
                logger.error(f"Failed to ingest match {match_id}: {e}")
                
        return new_matches

    async def ingest_match_history_generator(self, user: User, count: int = 20):
        """
        Yields progress updates while ingesting match history.
        Uses parallel fetching for API calls with rate limiting for performance.
        DB saves are sequential to avoid session conflicts.
        """
        routing = self._get_routing(user.region)
        match_ids = await riot_service.get_match_history(routing, user.puuid, count=count)
        
        total = len(match_ids)
        if total == 0:
            yield {"current": 0, "total": 0, "status": "No matches found"}
            return

        yield {"current": 0, "total": total, "status": f"Found {total} matches, checking cache..."}
        
        # Batch check which matches already exist in DB
        result = await self.db.execute(
            select(Match.match_id).where(Match.match_id.in_(match_ids))
        )
        existing_ids = set(row[0] for row in result.fetchall())
        
        new_match_ids = [mid for mid in match_ids if mid not in existing_ids]
        cached_count = len(existing_ids)
        
        if cached_count > 0:
            yield {"current": cached_count, "total": total, "status": f"{cached_count} matches cached, fetching {len(new_match_ids)} new..."}
        
        if not new_match_ids:
            yield {"current": total, "total": total, "status": "All matches already cached"}
            return
        
        # Throttle concurrent API requests to avoid rate limiting.
        _API_SEMAPHORE = asyncio.Semaphore(3)   # max 3 concurrent requests
        _API_DELAY     = 1.2                     # seconds between requests

        async def fetch_match_data(match_id: str):
            """Fetch match details (API only, no DB), respecting rate limits."""
            async with _API_SEMAPHORE:
                try:
                    details = await riot_service.get_match_details(routing, match_id)
                    return (match_id, details, None)
                except NotFoundError:
                    logger.debug("Match %s not found", match_id)
                    return (match_id, None, "not found")
                except RiotAPIError as e:
                    logger.error("Riot API error fetching match %s: %s", match_id, e)
                    return (match_id, None, str(e))
                except Exception as e:
                    logger.error(f"Failed to fetch match {match_id}: {e}")
                    return (match_id, None, str(e))
                finally:
                    await asyncio.sleep(_API_DELAY)

        tasks = [asyncio.create_task(fetch_match_data(mid)) for mid in new_match_ids]

        yield {"current": cached_count, "total": total, "status": f"Fetching {len(new_match_ids)} matches from Riot API..."}

        completed = cached_count
        for task in asyncio.as_completed(tasks):
            match_id, details, error = await task
            completed += 1

            if details:
                try:
                    await self.save_match(details)
                    status = f"Saved match {completed}/{total}"
                except Exception as e:
                    logger.error(f"Failed to save match {match_id}: {e}")
                    status = f"Failed to save {match_id}"
            else:
                status = f"Failed to fetch {match_id}: {error}"

            yield {"current": completed, "total": total, "status": status}

    def _get_routing(self, region: str) -> str:
        if region.startswith("na") or region.startswith("la") or region.startswith("br"):
            return "americas"
        elif region.startswith("kr") or region.startswith("jp"):
            return "asia"
        return "europe"

    async def save_match(self, match_data):
        # match_data is a MatchDto object
        info = match_data.info
        metadata = match_data.metadata
        
        match = Match(
            match_id=metadata.matchId,
            platform_id=info.platformId,
            game_creation=info.gameCreation,
            game_duration=info.gameDuration,
            game_version=info.gameVersion,
            queue_id=info.queueId,
            data=match_data.model_dump() if hasattr(match_data, 'model_dump') else match_data.__dict__
        )
        
        self.db.add(match)
        
        # Parse participants
        for p in info.participants:
            # Stats handling - using getattr for safety or direct access
            gold = 0.0
            if hasattr(p, 'challenges') and p.challenges:
                 # Challenges might be an object too
                 gold = getattr(p.challenges, 'goldPerMinute', 0.0)
            
            part = Participant(
                match_id=match.match_id,
                puuid=p.puuid,
                champion_id=p.championId,
                team_id=p.teamId,
                win=p.win,
                kills=p.kills,
                deaths=p.deaths,
                assists=p.assists,
                gold_per_minute=gold,
                total_minions_killed=p.totalMinionsKilled,
                vision_score=p.visionScore,
                damage_dealt_to_champions=p.totalDamageDealtToChampions,
                stats_json=p.model_dump() if hasattr(p, 'model_dump') else p.__dict__
            )
            self.db.add(part)
            
        try:
            await self.db.commit()
        except IntegrityError:
            await self.db.rollback()
            logger.info(f"Match {match.match_id} already exists, skipping save.")
