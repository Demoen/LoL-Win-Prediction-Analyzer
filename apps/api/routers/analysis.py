from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from database import get_db
from services.ingestion import IngestionService
from services.riot import riot_service
from services.ddragon import get_ddragon_version
from ml.pipeline import load_player_data
from ml.training import model_instance
from ml.timeline_analysis import aggregate_territory_metrics, analyze_match_timeline_series, extract_heatmap_data, extract_lane_lead_at_minute, calculate_territory_metrics
from models import Match, Participant
from pydantic import BaseModel
from typing import Optional
import asyncio
import numpy as np
import math
import json
import os
import time
import logging

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Analysis Queue – limits how many analyses run concurrently and reports
# queue position to waiting clients.
# ---------------------------------------------------------------------------
class AnalysisQueue:
    """Process-wide concurrency gate for /analyze requests."""

    def __init__(self, max_concurrent: int = 3):
        self._max = max(1, max_concurrent)
        self._sem = asyncio.Semaphore(self._max)
        self._lock = asyncio.Lock()
        self._active = 0
        self._waiters: list[asyncio.Event] = []

    # -- public stats --------------------------------------------------------
    async def stats(self) -> dict:
        async with self._lock:
            return {
                "maxConcurrent": self._max,
                "active": self._active,
                "queued": len(self._waiters),
            }

    async def queue_position(self, event: asyncio.Event) -> int:
        """Return 1-based position of *event* in the waiting list, or 0 if not waiting."""
        async with self._lock:
            try:
                return self._waiters.index(event) + 1
            except ValueError:
                return 0

    # -- context manager (acquire / release) --------------------------------
    async def acquire(self, notify: asyncio.Event) -> None:
        """Register as waiting, acquire slot, then unregister."""
        async with self._lock:
            self._waiters.append(notify)
        try:
            await self._sem.acquire()
        finally:
            async with self._lock:
                if notify in self._waiters:
                    self._waiters.remove(notify)
                self._active += 1
        notify.set()  # unblock the generator

    async def release(self) -> None:
        async with self._lock:
            self._active = max(0, self._active - 1)
        self._sem.release()


_raw_max_analysis = os.getenv("MAX_CONCURRENT_ANALYSES", "3")
try:
    _max_analysis = max(1, int(_raw_max_analysis))
except Exception:
    _max_analysis = 3

analysis_queue = AnalysisQueue(max_concurrent=_max_analysis)


LANE_LEAD_MATCH_LIMIT_MAX = 21
LANE_LEAD_TARGET_MINUTE = 14


async def _compute_recent_lane_leads_at_minute(
    db: AsyncSession,
    puuid: str,
    platform_region: str,
    target_minute: int = LANE_LEAD_TARGET_MINUTE,
    limit: int = LANE_LEAD_MATCH_LIMIT_MAX,
    timeline_cache: dict | None = None,
) -> dict:
    """Compute average lane-opponent gold/xp leads at a target minute across recent matches.

    Uses the lightweight ``extract_lane_lead_at_minute`` instead of building
    a full timeline series per match, and relies on the library's built-in
    rate limiter instead of explicit sleeps.

    *timeline_cache* is an optional ``{match_id: timeline}`` dict that is
    both read from and written to so other consumers can reuse fetched
    timelines.

    Returns keys:
      - laneGoldLeadAt14
      - laneXpLeadAt14
      - laneLeadSampleSize
    """
    if timeline_cache is None:
        timeline_cache = {}

    try:
        result = await db.execute(
            select(Participant, Match)
            .join(Match)
            .where(Participant.puuid == puuid)
            .order_by(Match.game_creation.desc())
            .limit(limit)
        )
        rows = result.all()
        if not rows:
            return {"laneGoldLeadAt14": 0.0, "laneXpLeadAt14": 0.0, "laneLeadSampleSize": 0}

        regional_routing = REGION_TO_ROUTING.get((platform_region or "").lower(), "europe")

        # Throttle concurrent timeline API requests
        _timeline_sem = asyncio.Semaphore(3)

        async def _one(participant: Participant, match: Match):
            if match is None:
                return None

            match_id = getattr(match, "match_id", None)
            match_data = getattr(match, "data", None)
            if match_id is None or match_data is None:
                return None

            if not isinstance(match_data, dict):
                return None

            info = (match_data or {}).get("info", {})
            participants = info.get("participants", []) if isinstance(info, dict) else []
            me = next((p for p in participants if p.get("puuid") == puuid), None)
            if not me:
                return None

            my_team = me.get("teamId")
            my_role = me.get("teamPosition")
            my_pid = me.get("participantId")
            if not my_team or not my_role or not my_pid:
                return None

            enemy = next(
                (
                    p
                    for p in participants
                    if p.get("teamId") != my_team and p.get("teamPosition") == my_role
                ),
                None,
            )
            if not enemy:
                return None
            enemy_pid = enemy.get("participantId")
            if not enemy_pid:
                return None

            # Fetch timeline (cache-aware, no explicit sleep – library rate-limits)
            if match_id in timeline_cache:
                timeline = timeline_cache[match_id]
            else:
                async with _timeline_sem:
                    timeline = await riot_service.get_match_timeline(regional_routing, str(match_id))
                timeline_cache[match_id] = timeline

            if not timeline:
                return None

            # Lightweight extraction – single frame lookup instead of full series
            lead = extract_lane_lead_at_minute(timeline, int(my_pid), int(enemy_pid), target_minute)
            if lead is None:
                return None

            gold_lead, xp_lead = lead
            if not math.isfinite(gold_lead) or not math.isfinite(xp_lead):
                return None
            return (gold_lead, xp_lead)

        # Fetch timelines concurrently; RiotClient already rate-limits internally.
        tasks = [_one(participant, match) for participant, match in rows]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        gold_vals = []
        xp_vals = []
        for r in results:
            if isinstance(r, Exception) or r is None:
                continue
            if not (isinstance(r, tuple) and len(r) == 2):
                continue
            g, x = r
            try:
                gold_vals.append(float(g))
                xp_vals.append(float(x))
            except Exception:
                continue

        sample = min(len(gold_vals), len(xp_vals))
        if sample <= 0:
            return {"laneGoldLeadAt14": 0.0, "laneXpLeadAt14": 0.0, "laneLeadSampleSize": 0}

        return {
            "laneGoldLeadAt14": float(sum(gold_vals) / len(gold_vals)),
            "laneXpLeadAt14": float(sum(xp_vals) / len(xp_vals)),
            "laneLeadSampleSize": int(sample),
        }
    except Exception as e:
        logger.exception("Error computing recent lane leads")
        return {"laneGoldLeadAt14": 0.0, "laneXpLeadAt14": 0.0, "laneLeadSampleSize": 0}

router = APIRouter(prefix="/api")

class NumpyEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, np.integer):
            return int(o)
        if isinstance(o, np.floating):
            if np.isnan(o) or np.isinf(o):
                return None
            return float(o)
        if isinstance(o, np.bool_):
            return bool(o)
        if isinstance(o, np.ndarray):
            return o.tolist()
        if isinstance(o, float):
            if math.isnan(o) or math.isinf(o):
                return None
            return o
        return super().default(o)

def sanitize_for_json(obj):
    """Recursively sanitize a data structure for JSON serialization."""
    if isinstance(obj, dict):
        return {k: sanitize_for_json(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [sanitize_for_json(item) for item in obj]
    elif isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
        return obj
    elif isinstance(obj, (np.floating, np.integer)):
        if isinstance(obj, np.floating) and (np.isnan(obj) or np.isinf(obj)):
            return None
        return obj.item()
    elif isinstance(obj, np.bool_):
        return bool(obj)
    elif isinstance(obj, np.ndarray):
        return sanitize_for_json(obj.tolist())
    return obj

# Region to routing mapping
REGION_TO_ROUTING = {
    "euw1": "europe", "eun1": "europe", "tr1": "europe", "ru": "europe",
    "na1": "americas", "br1": "americas", "la1": "americas", "la2": "americas",
    "kr": "asia", "jp1": "asia",
    "oc1": "sea", "ph2": "sea", "sg2": "sea", "th2": "sea", "tw2": "sea", "vn2": "sea",
}

class AnalyzeRequest(BaseModel):
    riot_id: str
    region: str


def _clamp_percent(p: object) -> int:
    try:
        n = float(p)  # type: ignore[arg-type]
    except Exception:
        return 0
    if not math.isfinite(n):
        return 0
    return int(max(0, min(100, round(n))))

@router.get("/queue")
async def get_queue_status():
    """Return the current analysis queue stats."""
    return await analysis_queue.stats()


@router.post("/analyze")
async def analyze_player(request: AnalyzeRequest, background_tasks: BackgroundTasks, db: AsyncSession = Depends(get_db)):
    # 1. Parse Riot ID
    if "#" not in request.riot_id:
        raise HTTPException(status_code=400, detail="Invalid Riot ID format")
    
    game_name, tag_line = request.riot_id.split("#", 1)

    async def analysis_generator():
        slot_acquired = False
        try:
            async def _progress(stage: str, message: str, percent: object):
                payload = {
                    "type": "progress",
                    "stage": stage,
                    "message": message,
                    "percent": _clamp_percent(percent),
                }
                try:
                    payload["queue"] = await analysis_queue.stats()
                except Exception:
                    pass
                return json.dumps(payload) + "\n"

            # ---- Queue gate ------------------------------------------------
            ready_event = asyncio.Event()
            acquire_task = asyncio.ensure_future(analysis_queue.acquire(ready_event))

            # While we wait for a slot, stream queue-position updates.
            while not ready_event.is_set():
                pos = await analysis_queue.queue_position(ready_event)
                q_stats = await analysis_queue.stats()
                yield json.dumps({
                    "type": "progress",
                    "stage": "QUEUED",
                    "message": f"In queue — position {pos} of {q_stats['queued']}",
                    "percent": 0,
                    "queue": q_stats,
                    "queuePosition": pos,
                }) + "\n"
                # Re-check every ~1.5s
                try:
                    await asyncio.wait_for(asyncio.shield(acquire_task), timeout=1.5)
                except asyncio.TimeoutError:
                    pass

            # Ensure the acquire task is done (it should be)
            await acquire_task
            slot_acquired = True
            # ---- End queue gate --------------------------------------------

            yield await _progress("FIND_ACCOUNT", "Finding user account...", 5)

            ddragon_version = await get_ddragon_version()
            
            ingestion = IngestionService(db)
            ranked_data = None
            try:
                user = await ingestion.get_or_update_user("europe", request.region, game_name, tag_line)
                if not user:
                    yield json.dumps({"type": "error", "message": "User not found"}) + "\n"
                    return

                # Fetch ranked data
                yield await _progress("FETCH_RANKED", "Fetching ranked info...", 8)
                league_region = request.region
                if request.region in ['euw', 'eun', 'na', 'br', 'la', 'tr', 'jp', 'oc']:
                     league_region = request.region + '1'
                elif request.region == 'kr' or request.region == 'ru':
                     league_region = request.region
                
                league_entries = await riot_service.get_league_entries(league_region, user.puuid)
                for entry in league_entries:
                    if entry.get("queueType") == "RANKED_SOLO_5x5":
                        ranked_data = {
                            "tier": entry.get("tier", "UNRANKED"),
                            "rank": entry.get("rank", ""),
                            "lp": entry.get("leaguePoints", 0),
                            "wins": entry.get("wins", 0),
                            "losses": entry.get("losses", 0),
                            "hotStreak": entry.get("hotStreak", False),
                            "veteran": entry.get("veteran", False),
                            "freshBlood": entry.get("freshBlood", False),
                        }
                        break

                # Stream match ingestion progress
                match_count = 0
                async for progress in ingestion.ingest_match_history_generator(user, count=20):
                    current = progress["current"]
                    total = progress["total"]
                    if total and total > 0:
                        percent = 10 + int((current / total) * 60)  # Map 0-100% of matches to 10-70% total progress
                    else:
                        percent = 10
                    yield await _progress("MATCH_HISTORY", progress["status"], percent)
                    match_count = total

            except Exception as e:
                logger.exception("Error during ingestion")
                yield json.dumps({"type": "error", "message": str(e)}) + "\n"
                return

            yield await _progress("LOAD_MATCH_DATA", "Loading match data...", 72)

            df = await load_player_data(db, user.puuid)
            
            yield await _progress("TRAIN_MODEL", "Training AI model...", 75)
            metrics = model_instance.train(df)
            
            if "error" in metrics:
                # Handle partial analysis - convert user to dict
                user_dict = {
                    "game_name": user.game_name,
                    "tag_line": user.tag_line,
                    "region": user.region,
                    "profile_icon_id": user.profile_icon_id,
                    "summoner_level": user.summoner_level,
                    "puuid": user.puuid
                }
                partial_data = sanitize_for_json({
                    "status": "partial", 
                    "message": metrics["error"], 
                    "user": user_dict, 
                    # ... default empty structure ...
                    "win_probability": 50.0
                })
                yield json.dumps({"type": "result", "data": partial_data}) + "\n"
                return
            
            yield await _progress("PERFORMANCE_METRICS", "Calculating performance metrics...", 78)

            weighted_averages = model_instance.calculate_weighted_averages(df)

            # Shared timeline cache: lane leads, territory, and last-match
            # timeline all potentially fetch the same match timelines.
            # A simple dict avoids duplicate Riot API calls across stages.
            _timeline_cache: dict = {}

            # Add timeline-derived lane opponent leads (gold/xp) at ~14m.
            # Riot's `challenges.*GoldExpAdvantage` is unreliable; timeline is the source of truth.
            # Run lane leads + territory analysis concurrently (they're independent).
            try:
                lane_lead_limit = min(int(len(df)) if not df.empty else 0, LANE_LEAD_MATCH_LIMIT_MAX)
                if lane_lead_limit <= 0:
                    lane_lead_limit = LANE_LEAD_MATCH_LIMIT_MAX

                yield await _progress("LANE_LEADS", f"Computing lane leads & territory (last {lane_lead_limit} matches)...", 79)

                lane_leads_coro = _compute_recent_lane_leads_at_minute(
                    db,
                    user.puuid,
                    request.region,
                    target_minute=LANE_LEAD_TARGET_MINUTE,
                    limit=lane_lead_limit,
                    timeline_cache=_timeline_cache,
                )
                territory_coro = analyze_territory_for_player(
                    db, user.puuid, request.region, timeline_cache=_timeline_cache,
                )

                lane_leads, territory_metrics = await asyncio.gather(
                    lane_leads_coro, territory_coro, return_exceptions=False,
                )

                if isinstance(weighted_averages, dict) and isinstance(lane_leads, dict):
                    weighted_averages.update(lane_leads)
            except Exception as e:
                logger.exception("Error computing lane leads / territory")
                territory_metrics = {}
            
            last_match_stats = {}
            last_match_obj = None
            
            if not df.empty:
                last_row = df.iloc[0]
                raw_stats = last_row.to_dict()
                last_match_stats = {
                    k: (0 if (isinstance(v, float) and (math.isnan(v) or math.isinf(v))) else v)
                    for k, v in raw_stats.items()
                }
                
                # Fetch match object for enemy stats and timeline
                try:
                     result = await db.execute(
                        select(Match)
                        .join(Participant)
                        .where(Participant.puuid == user.puuid)
                        .order_by(Match.game_creation.desc())
                        .limit(1)
                     )
                     last_match_obj = result.scalar_one_or_none()
                except Exception as e:
                     logger.exception("Error fetching last match obj")

            yield await _progress("MOOD", "Analyzing player mood...", 83)

            player_moods = model_instance.analyze_player_mood(df)

            win_rate = float(df['win'].mean() * 100) if not df.empty else 50.0

            yield await _progress("WIN_PROB", "Calculating win probability...", 88)

            raw_model_prediction = model_instance.predict_win_probability(last_match_stats)
            win_probability = (win_rate * 0.7) + (raw_model_prediction * 0.3)
            
            yield await _progress("OPPONENT_COMPARE", "Comparing with opponent...", 90)
            
            # --- Extract Enemy Laner Stats for Comparison ---
            enemy_stats = {}
            enemy_p_id = None
            if last_match_obj and last_match_obj.data:
                try:
                    info = last_match_obj.data.get('info', {})
                    participants = info.get('participants', [])
                    
                    me = next((p for p in participants if p.get('puuid') == user.puuid), None)

                    if me:
                        my_team = me.get('teamId')
                        my_role = me.get('teamPosition')
                        
                        if my_role:
                            enemy = next((p for p in participants if p.get('teamId') != my_team and p.get('teamPosition') == my_role), None)
                            
                            if enemy:
                                enemy_p_id = enemy.get('participantId')
                                challenges = enemy.get('challenges', {})
                                game_duration = info.get('gameDuration', 1) / 60
                                if game_duration == 0: game_duration = 1
                                
                                enemy_stats = {
                                     'championName': enemy.get('championName', 'Opponent'),
                                     'visionScore': enemy.get('visionScore', 0),
                                     'goldPerMinute': enemy.get('goldEarned', 0) / game_duration,
                                     'damageDealtToChampions': enemy.get('totalDamageDealtToChampions', 0),
                                     'totalMinionsKilled': enemy.get('totalMinionsKilled', 0) + enemy.get('neutralMinionsKilled', 0),
                                     'towerDamageDealt': enemy.get('damageDealtToTurrets', 0),
                                     'xpPerMinute': enemy.get('champExperience', 0) / game_duration,
                                     'soloKills': challenges.get('soloKills', 0),
                                     'killParticipation': challenges.get('killParticipation', 0),
                                     'skillshotHitRate': challenges.get('skillshotsHit', 0), 
                                     'wardsPlaced': enemy.get('wardsPlaced', 0),
                                     'controlWardsPlaced': enemy.get('detectorWardsPlaced', 0),
                                     'detectorWardsPlaced': enemy.get('detectorWardsPlaced', 0), 

                                     'kills': enemy.get('kills', 0),
                                     'deaths': enemy.get('deaths', 0),
                                     'assists': enemy.get('assists', 0),
                                     'kda': (enemy.get('kills', 0) + enemy.get('assists', 0)) / (enemy.get('deaths', 0) if enemy.get('deaths', 0) > 0 else 1),
                                     'damagePerMinute': enemy.get('totalDamageDealtToChampions', 0) / game_duration,
                                     'damageTakenOnTeamPercentage': challenges.get('damageTakenOnTeamPercentage', 0),
                                     'teamDamagePercentage': challenges.get('teamDamagePercentage', 0),

                                     'enemyMissingPings': enemy.get('enemyMissingPings', 0),
                                     'onMyWayPings': enemy.get('onMyWayPings', 0),
                                     'assistMePings': enemy.get('assistMePings', 0),
                                     'getBackPings': enemy.get('getBackPings', 0),
                                     'allInPings': enemy.get('allInPings', 0),
                                     'commandPings': enemy.get('commandPings', 0),
                                     'pushPings': enemy.get('pushPings', 0),
                                     'visionClearedPings': enemy.get('visionClearedPings', 0),
                                     'needVisionPings': enemy.get('needVisionPings', 0),
                                     'holdPings': enemy.get('holdPings', 0),

                                     'laneMinionsFirst10Minutes': challenges.get('laneMinionsFirst10Minutes') or 0,
                                     'turretPlatesTaken': challenges.get('turretPlatesTaken') or 0,
                                     'skillshotsDodged': challenges.get('skillshotsDodged') or 0,
                                     'skillshotsHit': challenges.get('skillshotsHit') or 0,

                                     'earlyLaningPhaseGoldExpAdvantage': challenges.get('earlyLaningPhaseGoldExpAdvantage') or 0,
                                     'laningPhaseGoldExpAdvantage': challenges.get('laningPhaseGoldExpAdvantage') or 0,
                                     'maxCsAdvantageOnLaneOpponent': challenges.get('maxCsAdvantageOnLaneOpponent') or 0,
                                     'maxLevelLeadLaneOpponent': challenges.get('maxLevelLeadLaneOpponent') or 0,
                                     'visionScoreAdvantageLaneOpponent': challenges.get('visionScoreAdvantageLaneOpponent') or 0,
                                     'controlWardTimeCoverageInRiverOrEnemyHalf': challenges.get('controlWardTimeCoverageInRiverOrEnemyHalf') or 0,
                                }
                except Exception as e:
                    logger.exception("Error extracting enemy stats")

            yield await _progress("WIN_FACTORS", "Analyzing win factors...", 92)

            win_drivers = model_instance.get_win_driver_insights(df, last_match_stats, enemy_stats)
            skill_focus = model_instance.get_skill_focus(df, last_match_stats, enemy_stats)

            yield await _progress("FETCH_TIMELINE", "Fetching match timeline...", 95)

            # 11. Timeline Series (Gold/XP Difference) + Heatmap Data
            match_timeline_series = {}
            heatmap_data = None
            if last_match_obj:
                 try:
                     regional_routing = REGION_TO_ROUTING.get(request.region.lower(), "europe")

                     # Reuse cached timeline if lane-leads or territory already fetched it
                     if last_match_obj.match_id in _timeline_cache:
                         timeline = _timeline_cache[last_match_obj.match_id]
                     else:
                         timeline = await riot_service.get_match_timeline(regional_routing, last_match_obj.match_id)
                         _timeline_cache[last_match_obj.match_id] = timeline

                     # Find participant ID from match object
                     p_id = 0
                     if last_match_obj.data:
                         for p in last_match_obj.data.get('info', {}).get('participants', []):
                             if p.get('puuid') == user.puuid:
                                 p_id = p.get('participantId')
                                 break

                     if p_id > 0:
                         match_timeline_series = analyze_match_timeline_series(timeline, p_id, enemy_p_id)

                         # Fallback for early-game advantage stats.
                         # Riot's `challenges.*GoldExpAdvantage` keys are not reliably present in all queues/patches,
                         # which would otherwise make these indicators always 0.
                         try:
                             timeline_points = (match_timeline_series or {}).get("timeline") or []

                             def _closest_point(target_minute: int):
                                 valid = [
                                     p for p in timeline_points
                                     if isinstance(p, dict)
                                     and ("minute" in p)
                                     and isinstance(p.get("minute"), (int, float))
                                 ]
                                 if not valid:
                                     return None
                                 return min(valid, key=lambda p: abs(float(p["minute"]) - float(target_minute)))

                             for target_minute, stat_key in [
                                 (8, "earlyLaningPhaseGoldExpAdvantage"),
                                 (14, "laningPhaseGoldExpAdvantage"),
                             ]:
                                 # Only overwrite when missing/zero (preserve Riot-provided value if present).
                                 current_val = last_match_stats.get(stat_key, 0) if isinstance(last_match_stats, dict) else 0
                                 try:
                                     current_num = float(current_val) if current_val is not None else 0.0
                                 except Exception:
                                     current_num = 0.0

                                 if current_num == 0.0:
                                     point = _closest_point(target_minute)
                                     if point and ("laneGoldDelta" in point) and ("laneXpDelta" in point):
                                         try:
                                             lane_gold = float(point.get("laneGoldDelta") or 0)
                                             lane_xp = float(point.get("laneXpDelta") or 0)
                                             # Approximate Riot's combined gold+xp advantage metric.
                                             last_match_stats[stat_key] = lane_gold + lane_xp
                                         except Exception:
                                             pass
                         except Exception as e:
                             logger.exception("Error computing early-game advantage fallback")

                     # Extract heatmap data for all participants
                     if timeline and last_match_obj.data:
                         heatmap_data = extract_heatmap_data(timeline, last_match_obj.data)

                 except Exception as e:
                    logger.exception("Error fetching timeline series")

            yield await _progress("PREPARE_RESULTS", "Preparing results...", 98)

            performance_trends = []
            if not df.empty:
                trend_cols = ['kda', 'visionScore', 'killParticipation', 'win', 'gameCreation', 'aggressionScore', 'visionDominance', 'jungleInvasionPressure', 'goldPerMinute', 'damagePerMinute']
                valid_cols = [c for c in trend_cols if c in df.columns]
                performance_trends = df[valid_cols].to_dict(orient='records')
                
            result_data = {
                "status": "success",
                "user": user,
                "metrics": metrics,
                "win_probability": win_probability,
                "player_moods": player_moods,
                "weighted_averages": weighted_averages,
                "last_match_stats": last_match_stats,
                "enemy_stats": enemy_stats,
                "win_drivers": win_drivers,
                "skill_focus": skill_focus,
                "match_timeline_series": match_timeline_series,
                "performance_trends": performance_trends,
                "win_rate": win_rate,
                "total_matches": len(df),
                "territory_metrics": territory_metrics,
                "ranked_data": ranked_data,
                "ddragon_version": ddragon_version,
                "heatmap_data": heatmap_data
            }
            
            result_data["user"] = {
                "game_name": user.game_name,
                "tag_line": user.tag_line,
                "region": user.region,
                "profile_icon_id": user.profile_icon_id,
                "summoner_level": user.summoner_level,
                "puuid": user.puuid
            }
            
            result_data = sanitize_for_json(result_data)
            
            yield json.dumps({"type": "result", "data": result_data}) + "\n"
        
        except Exception as e:
             logger.exception("Server error during analysis")
             yield json.dumps({"type": "error", "message": f"Server error: {str(e)}"}) + "\n"
        finally:
            if slot_acquired:
                await analysis_queue.release()

    headers = {
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
        "Connection": "keep-alive",
    }
    return StreamingResponse(
        analysis_generator(),
        media_type="application/x-ndjson; charset=utf-8",
        headers=headers,
    )


async def analyze_territory_for_player(
    db: AsyncSession,
    puuid: str,
    region: str,
    limit: int = 5,
    timeline_cache: dict | None = None,
) -> dict:
    """Analyze territorial control for a player's recent matches.

    Accepts an optional *timeline_cache* dict to avoid re-fetching timelines
    already retrieved by other pipeline stages (e.g. lane-lead computation).
    Fetches all required timelines concurrently instead of sequentially.
    """
    if timeline_cache is None:
        timeline_cache = {}

    try:
        # Get recent match IDs with participant info
        result = await db.execute(
            select(Participant, Match)
            .join(Match)
            .where(Participant.puuid == puuid)
            .order_by(Match.game_creation.desc())
            .options(selectinload(Participant.match))
            .limit(limit)
        )

        matches_data = result.all()

        if not matches_data:
            return {}

        regional_routing = REGION_TO_ROUTING.get(region.lower(), "europe")
        _timeline_sem = asyncio.Semaphore(3)

        async def _analyze_one(participant, match):
            try:
                stats = participant.stats_json or {}
                participant_id = stats.get('participantId', 1)

                # Use cached timeline if available
                if match.match_id in timeline_cache:
                    timeline = timeline_cache[match.match_id]
                else:
                    async with _timeline_sem:
                        timeline = await riot_service.get_match_timeline(regional_routing, match.match_id)
                    timeline_cache[match.match_id] = timeline

                if not timeline:
                    return None

                return calculate_territory_metrics(timeline, participant_id, participant.team_id)
            except Exception:
                logger.exception("Error analyzing timeline for %s", match.match_id)
                return None

        # Fetch & analyze all timelines concurrently
        tasks = [_analyze_one(row[0], row[1]) for row in matches_data]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        territory_results: list[dict[str, float]] = [
            r for r in results
            if isinstance(r, dict)
        ]

        if territory_results:
            return aggregate_territory_metrics(territory_results)

        return {}

    except Exception:
        logger.exception("Error in territory analysis")
        return {}


# ---------------------------------------------------------------------------
# AI Coach endpoint (GPT-5 nano via Responses API)
# ---------------------------------------------------------------------------

class CoachRequest(BaseModel):
    system_prompt: str
    user_prompt: str


@router.post("/coach")
async def ai_coach(req: CoachRequest):
    """Call OpenAI with server-side key and return coaching analysis."""
    import openai as _openai

    api_key = os.getenv("OPENAI_API_KEY", "")
    if not api_key:
        raise HTTPException(status_code=503, detail="OpenAI API key not configured on server.")

    client = _openai.AsyncOpenAI(api_key=api_key)

    try:
        response = await client.responses.create(
            model=os.getenv("OPENAI_COACH_MODEL", "gpt-5-nano"),
            instructions=req.system_prompt,
            input=req.user_prompt,
            max_output_tokens=1800,
            # Optional for GPT-5 family (adjust if you want)
            reasoning={"effort": "low"},
        )

        # SDKs typically expose a convenience property for text output
        content = getattr(response, "output_text", "") or ""

        # Fallback parser in case output_text is empty / unavailable
        if not content:
            parts = []
            for item in getattr(response, "output", []) or []:
                for c in getattr(item, "content", []) or []:
                    if getattr(c, "type", None) == "output_text":
                        text = getattr(c, "text", "")
                        if text:
                            parts.append(text)
            content = "".join(parts)

        return {"content": content}

    except _openai.AuthenticationError:
        raise HTTPException(status_code=401, detail="Invalid OpenAI API key.")
    except _openai.RateLimitError:
        raise HTTPException(status_code=429, detail="OpenAI rate limit reached. Try again later.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"OpenAI error: {str(e)}")
