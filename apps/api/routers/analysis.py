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
from ml.timeline_analysis import analyze_match_territory, aggregate_territory_metrics, analyze_match_timeline_series, extract_heatmap_data
from models import Match, Participant
from pydantic import BaseModel
from typing import Optional
import asyncio
import numpy as np
import math
import json

router = APIRouter(prefix="/api")

# Custom JSON encoder for numpy types and NaN/Infinity handling
class NumpyEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, np.integer):
            return int(obj)
        if isinstance(obj, np.floating):
            # Handle NaN and Infinity - convert to None (null in JSON)
            if np.isnan(obj) or np.isinf(obj):
                return None
            return float(obj)
        if isinstance(obj, np.bool_):
            return bool(obj)
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        if isinstance(obj, float):
            # Handle Python native float NaN/Infinity
            if math.isnan(obj) or math.isinf(obj):
                return None
            return obj
        return super().default(obj)

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
        return obj.item()  # Convert to Python native type
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

@router.post("/analyze")
async def analyze_player(request: AnalyzeRequest, background_tasks: BackgroundTasks, db: AsyncSession = Depends(get_db)):
    # 1. Parse Riot ID
    if "#" not in request.riot_id:
        raise HTTPException(status_code=400, detail="Invalid Riot ID format")
    
    game_name, tag_line = request.riot_id.split("#", 1)

    async def analysis_generator():
        try:
            yield json.dumps({"type": "progress", "message": "Finding user account...", "percent": 5}) + "\n"

            ddragon_version = await get_ddragon_version()
            
            # 2. Ingest Data
            ingestion = IngestionService(db)
            ranked_data = None
            try:
                user = await ingestion.get_or_update_user("europe", request.region, game_name, tag_line)
                if not user:
                    yield json.dumps({"type": "error", "message": "User not found"}) + "\n"
                    return

                # Fetch ranked data
                yield json.dumps({"type": "progress", "message": "Fetching ranked info...", "percent": 8}) + "\n"
                # Ensure region has proper format (e.g., euw1 not euw)
                league_region = request.region
                # Simple mapping for common regions that need '1' appended
                if request.region in ['euw', 'eun', 'na', 'br', 'la', 'tr', 'jp', 'oc']:
                     league_region = request.region + '1'
                elif request.region == 'kr' or request.region == 'ru':
                     league_region = request.region
                
                print(f"Fetching league for region: {league_region}")
                league_entries = await riot_service.get_league_entries(league_region, user.puuid)
                print(f"Got {len(league_entries)} league entries")
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
                    percent = 10 + int((current / total) * 60) # Map 0-100% of matches to 10-70% total progress
                    yield json.dumps({"type": "progress", "message": progress["status"], "percent": percent}) + "\n"
                    match_count = total

            except Exception as e:
                import traceback
                traceback.print_exc()
                yield json.dumps({"type": "error", "message": str(e)}) + "\n"
                return

            yield json.dumps({"type": "progress", "message": "Loading match data...", "percent": 72}) + "\n"
            
            # 3. Load Data & Train
            df = await load_player_data(db, user.puuid)
            
            yield json.dumps({"type": "progress", "message": "Training AI model...", "percent": 75}) + "\n"
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
            
            yield json.dumps({"type": "progress", "message": "Calculating performance metrics...", "percent": 78}) + "\n"

            # 4. Calculate weighted averages
            weighted_averages = model_instance.calculate_weighted_averages(df)
            
            # 8. Extract last match stats
            last_match_stats = {}
            last_match_obj = None
            
            if not df.empty:
                last_row = df.iloc[0]
                raw_stats = last_row.to_dict()
                import math
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
                     print(f"Error fetching last match obj: {e}")

            yield json.dumps({"type": "progress", "message": "Analyzing player mood...", "percent": 80}) + "\n"
            
            # 6. Analyze player mood
            player_moods = model_instance.analyze_player_mood(df)
            
            # 7. Calculate win rate
            win_rate = float(df['win'].mean() * 100) if not df.empty else 50.0
            
            yield json.dumps({"type": "progress", "message": "Analyzing territorial control...", "percent": 83}) + "\n"
            
            # 9. Analyze territorial control
            territory_metrics = await analyze_territory_for_player(db, user.puuid, request.region)

            yield json.dumps({"type": "progress", "message": "Calculating win probability...", "percent": 88}) + "\n"

            # 10. Win Prediction & Drivers
            raw_model_prediction = model_instance.predict_win_probability(last_match_stats)
            win_probability = (win_rate * 0.7) + (raw_model_prediction * 0.3)
            
            yield json.dumps({"type": "progress", "message": "Comparing with opponent...", "percent": 90}) + "\n"
            
            # --- Extract Enemy Laner Stats for Comparison ---
            enemy_stats = {}
            enemy_p_id = None
            if last_match_obj and last_match_obj.data:
                try:
                    info = last_match_obj.data.get('info', {})
                    participants = info.get('participants', [])
                    
                    # Find me
                    me = next((p for p in participants if p.get('puuid') == user.puuid), None)
                    
                    if me:
                        my_team = me.get('teamId')
                        my_role = me.get('teamPosition')
                        
                        # Find enemy laner (same role, different team)
                        # If role is empty/invalid (e.g. ARAM), might fallback to no comparison
                        if my_role:
                            enemy = next((p for p in participants if p.get('teamId') != my_team and p.get('teamPosition') == my_role), None)
                            
                            if enemy:
                                enemy_p_id = enemy.get('participantId')
                                challenges = enemy.get('challenges', {})
                                game_duration = info.get('gameDuration', 1) / 60
                                if game_duration == 0: game_duration = 1
                                
                                # Map commonly used features
                                # We try to match keys in FEATURE_COLUMNS
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
                                     
                                     # --- Combat ---
                                     'kills': enemy.get('kills', 0),
                                     'deaths': enemy.get('deaths', 0),
                                     'assists': enemy.get('assists', 0),
                                     'kda': (enemy.get('kills', 0) + enemy.get('assists', 0)) / (enemy.get('deaths', 0) if enemy.get('deaths', 0) > 0 else 1),
                                     'damagePerMinute': enemy.get('totalDamageDealtToChampions', 0) / game_duration,
                                     'damageTakenOnTeamPercentage': challenges.get('damageTakenOnTeamPercentage', 0),
                                     'teamDamagePercentage': challenges.get('teamDamagePercentage', 0),

                                     # --- Pings (Predictive & Display) ---
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
                                     
                                     # --- Early Game / Skill ---
                                     'laneMinionsFirst10Minutes': challenges.get('laneMinionsFirst10Minutes') or 0,
                                     'turretPlatesTaken': challenges.get('turretPlatesTaken') or 0,
                                     'skillshotsDodged': challenges.get('skillshotsDodged') or 0,
                                     'skillshotsHit': challenges.get('skillshotsHit') or 0,
                                     
                                     # --- Advantage Stats (Enemy perspective) ---
                                     'earlyLaningPhaseGoldExpAdvantage': challenges.get('earlyLaningPhaseGoldExpAdvantage') or 0,
                                     'laningPhaseGoldExpAdvantage': challenges.get('laningPhaseGoldExpAdvantage') or 0,
                                     'maxCsAdvantageOnLaneOpponent': challenges.get('maxCsAdvantageOnLaneOpponent') or 0,
                                     'maxLevelLeadLaneOpponent': challenges.get('maxLevelLeadLaneOpponent') or 0,
                                     'visionScoreAdvantageLaneOpponent': challenges.get('visionScoreAdvantageLaneOpponent') or 0,
                                     'controlWardTimeCoverageInRiverOrEnemyHalf': challenges.get('controlWardTimeCoverageInRiverOrEnemyHalf') or 0,
                                }
                except Exception as e:
                    print(f"Error extracting enemy stats: {e}")

            yield json.dumps({"type": "progress", "message": "Analyzing win factors...", "percent": 92}) + "\n"

            win_drivers = model_instance.get_win_driver_insights(df, last_match_stats, enemy_stats)
            skill_focus = model_instance.get_skill_focus(df, last_match_stats, enemy_stats)

            yield json.dumps({"type": "progress", "message": "Fetching match timeline...", "percent": 95}) + "\n"

            # 11. Timeline Series (Gold/XP Difference) + Heatmap Data
            match_timeline_series = {}
            heatmap_data = {}
            if last_match_obj:
                 try:
                     regional_routing = REGION_TO_ROUTING.get(request.region.lower(), "europe")
                     timeline = await riot_service.get_match_timeline(regional_routing, last_match_obj.match_id)

                     # Find participant ID from match object
                     p_id = 0
                     if last_match_obj.data:
                         for p in last_match_obj.data.get('info', {}).get('participants', []):
                             if p.get('puuid') == user.puuid:
                                 p_id = p.get('participantId')
                                 break

                     if p_id > 0:
                         match_timeline_series = analyze_match_timeline_series(timeline, p_id, enemy_p_id)

                     # Extract heatmap data for all participants
                     if timeline and last_match_obj.data:
                         heatmap_data = extract_heatmap_data(timeline, last_match_obj.data)

                 except Exception as e:
                    print(f"Error fetching timeline series: {e}")

            yield json.dumps({"type": "progress", "message": "Preparing results...", "percent": 98}) + "\n"

            # 12. Performance Trends (Last 50 games)
            # We already have `df` which contains the last 50 games (limit=50 in load_player_data)
            # We can just serialize relevant columns
            performance_trends = []
            if not df.empty:
                # Select columns for trends
                trend_cols = ['kda', 'visionScore', 'killParticipation', 'win', 'gameCreation', 'aggressionScore', 'visionDominance', 'jungleInvasionPressure', 'goldPerMinute', 'damagePerMinute']
                # Ensure columns exist
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
            
            # Use a custom JSON encoder for SQLAlchemy objects if needed, or rely on Pydantic/FastAPI
            # But since we are manually dumping to JSON line, we need to be careful with SQLAlchemy objects.
            # Convert user object to dict manually to be safe for json.dumps
            result_data["user"] = {
                "game_name": user.game_name,
                "tag_line": user.tag_line,
                "region": user.region,
                "profile_icon_id": user.profile_icon_id,
                "summoner_level": user.summoner_level,
                "puuid": user.puuid
            }
            
            # Sanitize the entire result to handle NaN/Infinity and numpy types
            result_data = sanitize_for_json(result_data)
            
            yield json.dumps({"type": "result", "data": result_data}) + "\n"
        
        except Exception as e:
             import traceback
             traceback.print_exc()
             yield json.dumps({"type": "error", "message": f"Server error: {str(e)}"}) + "\n"

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


async def analyze_territory_for_player(db: AsyncSession, puuid: str, region: str, limit: int = 5) -> dict:
    """
    Analyze territorial control for a player's recent matches.
    Fetches timeline data for the most recent matches.
    """
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
        print(f"Territory analysis: Found {len(matches_data)} matches for {puuid[:8]}...")
        
        if not matches_data:
            print("No matches found for territory analysis")
            return {}
        
        # Get regional routing
        regional_routing = REGION_TO_ROUTING.get(region.lower(), "europe")
        print(f"Using regional routing: {regional_routing}")
        
        # Analyze each match's timeline
        territory_results = []
        for row in matches_data:
            participant = row[0]  # First element is Participant
            match = row[1]        # Second element is Match
            
            try:
                # Get participant_id from stats_json (not a model attribute)
                stats = participant.stats_json or {}
                participant_id = stats.get('participantId', 1)  # Default to 1 if not found
                
                print(f"Analyzing timeline for match {match.match_id} (participant {participant_id})...")
                metrics = await analyze_match_territory(
                    riot_service,
                    regional_routing,
                    match.match_id,
                    puuid,
                    participant_id,
                    participant.team_id
                )
                print(f"Got territory metrics: {metrics}")
                territory_results.append(metrics)
            except Exception as e:
                print(f"Error analyzing timeline for {match.match_id}: {e}")
                import traceback
                traceback.print_exc()
                continue
        
        # Aggregate results
        if territory_results:
            aggregated = aggregate_territory_metrics(territory_results)
            print(f"Aggregated territory metrics: {aggregated}")
            return aggregated
        
        print("No territory results to aggregate")
        return {}
        
    except Exception as e:
        print(f"Error in territory analysis: {e}")
        import traceback
        traceback.print_exc()
        return {}

