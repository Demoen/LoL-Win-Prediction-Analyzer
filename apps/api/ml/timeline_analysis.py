"""
Timeline Analysis for Territorial Control Metrics
Like football's "possession in opponent half" statistics.

Uses Riot API Match Timeline data to calculate:
- Time spent in enemy territory
- Forward positioning percentage
- Jungle invasion pressure
- Aggression score
"""
from typing import Dict, Any, Optional, List
import math


# Summoner's Rift map constants (approximate)
# The map is roughly 14500x14500 units
MAP_CENTER_X = 7250  # X coordinate of map center
MAP_CENTER_Y = 7250  # Y coordinate of map center
ENEMY_JUNGLE_X_BLUE = 9500  # X threshold for blue side (enemy jungle is higher X)
ENEMY_JUNGLE_X_RED = 5000   # X threshold for red side (enemy jungle is lower X)


def _get_attr_or_key(obj, key, default=None):
    """Safely get attribute or dictionary key from object (handles Pydantic models and dicts)."""
    if obj is None:
        return default
    if hasattr(obj, key):
        return getattr(obj, key, default)
    if isinstance(obj, dict):
        return obj.get(key, default)
    return default


def calculate_territory_metrics(
    timeline_data: Any,
    participant_id: int,
    team_id: int
) -> Dict[str, float]:
    """
    Calculate territorial control metrics from timeline data.
    
    Args:
        timeline_data: Match timeline DTO from Riot API (Pydantic model or dict)
        participant_id: The participant ID (1-10) in this match
        team_id: 100 (blue) or 200 (red)
    
    Returns:
        Dict with territorial metrics
    """
    if not timeline_data:
        return _empty_metrics()
    
    try:
        # Handle both Pydantic models and dicts
        info = _get_attr_or_key(timeline_data, 'info', {})
        frames = _get_attr_or_key(info, 'frames', [])
        
        if not frames:
            print(f"No frames found in timeline. Info type: {type(info)}")
            return _empty_metrics()
            
    except Exception as e:
        print(f"Error accessing timeline frames: {e}")
        return _empty_metrics()
    
    # Convert team_id to side (blue = lower coords, red = higher coords)
    is_blue_side = team_id == 100
    
    total_frames = 0
    enemy_territory_frames = 0
    river_frames = 0
    enemy_jungle_frames = 0
    forward_distances = []
    
    for frame in frames:
        try:
            # Get participant frames - handle both Pydantic and dict
            participant_frames = _get_attr_or_key(frame, 'participantFrames', {})
            
            if not participant_frames:
                continue
            
            # participantFrames is keyed by string "1", "2", etc.
            participant_data = _get_attr_or_key(participant_frames, str(participant_id))
            if not participant_data:
                continue
            
            # Get position
            position = _get_attr_or_key(participant_data, 'position', {})
            if not position:
                continue
                
            x = _get_attr_or_key(position, 'x', MAP_CENTER_X)
            y = _get_attr_or_key(position, 'y', MAP_CENTER_Y)
            
            # Skip if position seems invalid (0,0 or very near spawn)
            if x == 0 and y == 0:
                continue
                
            total_frames += 1
            
            # Calculate if in enemy territory based on diagonal from base to base
            # Blue base is bottom-left, Red base is top-right
            if is_blue_side:
                # Blue side: enemy territory is upper-right (higher X + Y sum)
                # The diagonal roughly goes from (0,0) to (14500, 14500)
                in_enemy_territory = (x + y) > (MAP_CENTER_X + MAP_CENTER_Y + 1000)
                in_enemy_jungle = x > ENEMY_JUNGLE_X_BLUE and y > MAP_CENTER_Y
                forward_distance = max(0, (x + y) - (MAP_CENTER_X + MAP_CENTER_Y)) / 100
            else:
                # Red side: enemy territory is lower-left (lower X + Y sum)
                in_enemy_territory = (x + y) < (MAP_CENTER_X + MAP_CENTER_Y - 1000)
                in_enemy_jungle = x < ENEMY_JUNGLE_X_RED and y < MAP_CENTER_Y
                forward_distance = max(0, (MAP_CENTER_X + MAP_CENTER_Y) - (x + y)) / 100
            
            # River runs from roughly (2000, 12500) to (12500, 2000)
            # Check if near the diagonal
            river_center_dist = abs((x - y) - 0) / 1.414  # Distance from y=x line
            in_river = river_center_dist < 2500 and 2500 < x < 12000 and 2500 < y < 12000
            
            if in_enemy_territory:
                enemy_territory_frames += 1
            if in_river:
                river_frames += 1
            if in_enemy_jungle:
                enemy_jungle_frames += 1
            
            forward_distances.append(forward_distance)
            
        except Exception as e:
            continue
    
    if total_frames == 0:
        print(f"No valid frames processed. Team: {team_id}, Participant: {participant_id}")
        return _empty_metrics()
    
    return {
        'time_in_enemy_territory_pct': (enemy_territory_frames / total_frames) * 100,
        # Normalize forward positioning: 145 is approx max distance (corner to corner in 100s units)
        # We want this to be a 0-100 "Aggression/Extension" score.
        'forward_positioning_score': min(100, (sum(forward_distances) / len(forward_distances) / 1.45)) if forward_distances else 0,
        'jungle_invasion_pct': (enemy_jungle_frames / total_frames) * 100,
        'river_control_pct': (river_frames / total_frames) * 100,
    }


def _empty_metrics() -> Dict[str, float]:
    """Return empty metrics when data is unavailable."""
    return {
        'time_in_enemy_territory_pct': 0.0,
        'forward_positioning_score': 0.0,
        'jungle_invasion_pct': 0.0,
        'river_control_pct': 0.0,
    }


async def analyze_match_territory(
    riot_service,
    regional_routing: str,
    match_id: str,
    puuid: str,
    participant_id: int,
    team_id: int
) -> Dict[str, float]:
    """
    Fetch timeline and calculate territorial metrics for a player.
    """
    try:
        timeline = await riot_service.get_match_timeline(regional_routing, match_id)
        if not timeline:
            print(f"No timeline returned for {match_id}")
            return _empty_metrics()
        
        result = calculate_territory_metrics(timeline, participant_id, team_id)
        print(f"Territory analysis for {match_id}: {result}")
        return result
        
    except Exception as e:
        print(f"Error in analyze_match_territory: {e}")
        return _empty_metrics()


def aggregate_territory_metrics(metrics_list: List[Dict[str, float]]) -> Dict[str, float]:
    """
    Aggregate territorial metrics across multiple matches.
    """
    if not metrics_list:
        return _empty_metrics()
    
    # Filter out empty results
    valid_metrics = [m for m in metrics_list if m.get('time_in_enemy_territory_pct', 0) > 0 or m.get('river_control_pct', 0) > 0]
    
    if not valid_metrics:
        return _empty_metrics()
    
    aggregated = {}
    for key in valid_metrics[0].keys():
        values = [m[key] for m in valid_metrics if key in m]
        aggregated[key] = sum(values) / len(values) if values else 0.0
    
    return aggregated


def analyze_match_timeline_series(
    timeline_data: Any,
    participant_id: int,
    enemy_participant_id: Optional[int] = None
) -> Dict[str, List[Dict[str, Any]]]:
    """
    Extract time-series data for a specific participant vs the match average (and enemy laner).
    Returns Gold and XP deltas at each frame (minute).
    """
    if not timeline_data:
        return {}

    try:
        # Handle both Pydantic models and dicts
        info = _get_attr_or_key(timeline_data, 'info', {})
        frames = _get_attr_or_key(info, 'frames', [])
        
        if not frames:
            return {}

        series_data = []
        
        for i, frame in enumerate(frames):
            participant_frames = _get_attr_or_key(frame, 'participantFrames', {})
            if not participant_frames:
                continue

            # Get target participant data
            my_data = _get_attr_or_key(participant_frames, str(participant_id))
            if not my_data:
                continue
                
            my_gold = _get_attr_or_key(my_data, 'totalGold', 0)
            my_xp = _get_attr_or_key(my_data, 'xp', 0)

            # Get enemy laner data if available
            enemy_gold = 0
            enemy_xp = 0
            has_enemy = False
            
            if enemy_participant_id:
                enemy_data = _get_attr_or_key(participant_frames, str(enemy_participant_id))
                if enemy_data:
                    enemy_gold = _get_attr_or_key(enemy_data, 'totalGold', 0)
                    enemy_xp = _get_attr_or_key(enemy_data, 'xp', 0)
                    has_enemy = True

            # Calculate match averages
            total_gold = 0
            total_xp = 0
            count = 0
            
            # Iterate through all participants (1-10) to get average
            for p_id in range(1, 11):
                p_data = _get_attr_or_key(participant_frames, str(p_id))
                if p_data:
                    total_gold += _get_attr_or_key(p_data, 'totalGold', 0)
                    total_xp += _get_attr_or_key(p_data, 'xp', 0)
                    count += 1
            
            avg_gold = total_gold / max(count, 1)
            avg_xp = total_xp / max(count, 1)
            
            # Calculate timestamp in minutes
            timestamp = _get_attr_or_key(frame, 'timestamp', 0)
            minute = round(timestamp / 60000)
            
            data_point = {
                "minute": minute,
                "goldDelta": my_gold - avg_gold, # Delta vs Avg (Legacy support)
                "xpDelta": my_xp - avg_xp,       # Delta vs Avg
                "myGold": my_gold,
                "avgGold": avg_gold,
                "myXp": my_xp,
                "avgXp": avg_xp
            }
            
            # Add enemy specific data if available
            if has_enemy:
                data_point["enemyGold"] = enemy_gold
                data_point["enemyXp"] = enemy_xp
                data_point["laneGoldDelta"] = my_gold - enemy_gold # Direct comparison
                data_point["laneXpDelta"] = my_xp - enemy_xp
            
            series_data.append(data_point)
            
        return {"timeline": series_data}
        
    except Exception as e:
        print(f"Error in analyze_match_timeline_series: {e}")
        return {}


def extract_heatmap_data(
    timeline_data: Any,
    match_data: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Extract spatial data from timeline for heatmap visualization.
    Returns positions for all 10 participants, kill events, and ward events with coordinates.
    """
    if not timeline_data or not match_data:
        return {}

    try:
        info = _get_attr_or_key(timeline_data, 'info', {})
        frames = _get_attr_or_key(info, 'frames', [])
        if not frames:
            return {}

        # Build participant lookup from match data
        match_info = match_data.get('info', {}) if isinstance(match_data, dict) else {}
        match_participants = match_info.get('participants', [])
        participant_lookup = {}
        for p in match_participants:
            pid = p.get('participantId')
            if pid:
                participant_lookup[pid] = {
                    'championName': p.get('championName', 'Unknown'),
                    'teamId': p.get('teamId', 0),
                }

        # Initialize per-participant position tracking
        participant_positions: Dict[int, List[Dict[str, Any]]] = {pid: [] for pid in range(1, 11)}
        prev_gold: Dict[int, int] = {}
        kill_events = []
        ward_events = []

        for frame in frames:
            timestamp = _get_attr_or_key(frame, 'timestamp', 0)
            participant_frames = _get_attr_or_key(frame, 'participantFrames', {})

            # Extract positions and gold for each participant
            if participant_frames:
                for pid in range(1, 11):
                    p_data = _get_attr_or_key(participant_frames, str(pid))
                    if not p_data:
                        continue
                    position = _get_attr_or_key(p_data, 'position', {})
                    if not position:
                        continue
                    x = _get_attr_or_key(position, 'x', 0)
                    y = _get_attr_or_key(position, 'y', 0)
                    if x == 0 and y == 0:
                        continue
                    total_gold = _get_attr_or_key(p_data, 'totalGold', 0)
                    gold_delta = total_gold - prev_gold.get(pid, total_gold)
                    prev_gold[pid] = total_gold
                    participant_positions[pid].append({
                        'x': x, 'y': y,
                        'timestamp': timestamp,
                        'totalGold': total_gold,
                        'goldDelta': max(0, gold_delta),
                    })

            # Extract events
            events = _get_attr_or_key(frame, 'events', [])
            if events:
                for event in events:
                    event_type = _get_attr_or_key(event, 'type', '')

                    if event_type == 'CHAMPION_KILL':
                        pos = _get_attr_or_key(event, 'position', {})
                        ex = _get_attr_or_key(pos, 'x', 0)
                        ey = _get_attr_or_key(pos, 'y', 0)
                        if ex == 0 and ey == 0:
                            continue
                        kill_events.append({
                            'x': ex, 'y': ey,
                            'killerId': _get_attr_or_key(event, 'killerId', 0),
                            'victimId': _get_attr_or_key(event, 'victimId', 0),
                            'assistingParticipantIds': _get_attr_or_key(event, 'assistingParticipantIds', []),
                            'timestamp': _get_attr_or_key(event, 'timestamp', timestamp),
                        })

                    elif event_type == 'WARD_PLACED':
                        pos = _get_attr_or_key(event, 'position', {})
                        if not pos:
                            continue
                        wx = _get_attr_or_key(pos, 'x', 0)
                        wy = _get_attr_or_key(pos, 'y', 0)
                        if wx == 0 and wy == 0:
                            continue
                        ward_events.append({
                            'x': wx, 'y': wy,
                            'wardType': _get_attr_or_key(event, 'wardType', 'UNDEFINED'),
                            'creatorId': _get_attr_or_key(event, 'creatorId', 0),
                            'timestamp': _get_attr_or_key(event, 'timestamp', timestamp),
                        })

        # Build final participants array
        participants = []
        for pid in range(1, 11):
            lookup = participant_lookup.get(pid, {})
            participants.append({
                'participantId': pid,
                'championName': lookup.get('championName', 'Unknown'),
                'teamId': lookup.get('teamId', 0),
                'positions': participant_positions.get(pid, []),
            })

        return {
            'participants': participants,
            'kill_events': kill_events,
            'ward_events': ward_events,
        }

    except Exception as e:
        print(f"Error in extract_heatmap_data: {e}")
        return {}
