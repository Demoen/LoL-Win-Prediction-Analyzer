"""Timeline analysis for territorial control metrics using Riot match timelines."""
from typing import Dict, Any, Optional, List


# Summoner's Rift map constants (map is ~14500x14500 units)
MAP_CENTER_X = 7250
MAP_CENTER_Y = 7250
ENEMY_JUNGLE_X_BLUE = 9500
ENEMY_JUNGLE_X_RED = 5000


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
    """Calculate territorial control metrics from timeline data."""
    if not timeline_data:
        return _empty_metrics()
    
    try:
        info = _get_attr_or_key(timeline_data, 'info', {})
        frames = _get_attr_or_key(info, 'frames', [])
        if not frames:
            return _empty_metrics()
    except Exception:
        return _empty_metrics()

    is_blue_side = team_id == 100
    
    total_frames = 0
    enemy_territory_frames = 0
    river_frames = 0
    enemy_jungle_frames = 0
    forward_distances = []
    
    for frame in frames:
        try:
            participant_frames = _get_attr_or_key(frame, 'participantFrames', {})
            
            if not participant_frames:
                continue
            
            # participantFrames is keyed by string "1", "2", etc.
            participant_data = _get_attr_or_key(participant_frames, str(participant_id))
            if not participant_data:
                continue

            position = _get_attr_or_key(participant_data, 'position', {})
            if not position:
                continue
                
            x = _get_attr_or_key(position, 'x', MAP_CENTER_X)
            y = _get_attr_or_key(position, 'y', MAP_CENTER_Y)

            if x == 0 and y == 0:
                continue
                
            total_frames += 1

            if is_blue_side:
                in_enemy_territory = (x + y) > (MAP_CENTER_X + MAP_CENTER_Y + 1000)
                in_enemy_jungle = x > ENEMY_JUNGLE_X_BLUE and y > MAP_CENTER_Y
                forward_distance = max(0, (x + y) - (MAP_CENTER_X + MAP_CENTER_Y)) / 100
            else:
                in_enemy_territory = (x + y) < (MAP_CENTER_X + MAP_CENTER_Y - 1000)
                in_enemy_jungle = x < ENEMY_JUNGLE_X_RED and y < MAP_CENTER_Y
                forward_distance = max(0, (MAP_CENTER_X + MAP_CENTER_Y) - (x + y)) / 100

            river_center_dist = abs((x - y)) / 1.414
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
        return _empty_metrics()
    
    return {
        'time_in_enemy_territory_pct': (enemy_territory_frames / total_frames) * 100,
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
    """Fetch timeline and calculate territorial metrics for a player."""
    try:
        timeline = await riot_service.get_match_timeline(regional_routing, match_id)
        if not timeline:
            return _empty_metrics()
        return calculate_territory_metrics(timeline, participant_id, team_id)
    except Exception:
        return _empty_metrics()


def aggregate_territory_metrics(metrics_list: List[Dict[str, float]]) -> Dict[str, float]:
    """Aggregate territorial metrics across multiple matches."""
    if not metrics_list:
        return _empty_metrics()
    
    valid_metrics = [m for m in metrics_list if m.get('time_in_enemy_territory_pct', 0) > 0 or m.get('river_control_pct', 0) > 0]
    
    if not valid_metrics:
        return _empty_metrics()
    
    aggregated = {}
    for key in valid_metrics[0].keys():
        values = [m[key] for m in valid_metrics if key in m]
        aggregated[key] = sum(values) / len(values) if values else 0.0
    
    return aggregated


def extract_lane_lead_at_minute(
    timeline_data: Any,
    participant_id: int,
    enemy_participant_id: int,
    target_minute: int = 14,
) -> Optional[tuple]:
    """Extract gold/xp lead vs lane opponent at a specific minute.

    Much lighter than :func:`analyze_match_timeline_series` – it only locates the
    single closest frame and reads two values instead of building the full series.

    Returns ``(gold_lead, xp_lead)`` or ``None``.
    """
    if not timeline_data:
        return None

    try:
        info = _get_attr_or_key(timeline_data, 'info', {})
        frames = _get_attr_or_key(info, 'frames', [])
        if not frames:
            return None

        target_ms = target_minute * 60000
        best_frame = None
        best_diff = float('inf')

        for frame in frames:
            timestamp = _get_attr_or_key(frame, 'timestamp', 0)
            diff = abs(timestamp - target_ms)
            if diff < best_diff:
                best_diff = diff
                best_frame = frame

        if not best_frame:
            return None

        participant_frames = _get_attr_or_key(best_frame, 'participantFrames', {})
        if not participant_frames:
            return None

        my_data = _get_attr_or_key(participant_frames, str(participant_id))
        enemy_data = _get_attr_or_key(participant_frames, str(enemy_participant_id))

        if not my_data or not enemy_data:
            return None

        my_gold = _get_attr_or_key(my_data, 'totalGold', 0)
        my_xp = _get_attr_or_key(my_data, 'xp', 0)
        enemy_gold = _get_attr_or_key(enemy_data, 'totalGold', 0)
        enemy_xp = _get_attr_or_key(enemy_data, 'xp', 0)

        return (my_gold - enemy_gold, my_xp - enemy_xp)
    except Exception:
        return None


def analyze_match_timeline_series(
    timeline_data: Any,
    participant_id: int,
    enemy_participant_id: Optional[int] = None
) -> Dict[str, List[Dict[str, Any]]]:
    """Extract time-series gold/XP data for a participant vs match average and enemy laner."""
    if not timeline_data:
        return {}

    try:
        info = _get_attr_or_key(timeline_data, 'info', {})
        frames = _get_attr_or_key(info, 'frames', [])
        if not frames:
            return {}

        series_data = []
        
        for i, frame in enumerate(frames):
            participant_frames = _get_attr_or_key(frame, 'participantFrames', {})
            if not participant_frames:
                continue

            my_data = _get_attr_or_key(participant_frames, str(participant_id))
            if not my_data:
                continue
                
            my_gold = _get_attr_or_key(my_data, 'totalGold', 0)
            my_xp = _get_attr_or_key(my_data, 'xp', 0)

            enemy_gold = 0
            enemy_xp = 0
            has_enemy = False
            
            if enemy_participant_id:
                enemy_data = _get_attr_or_key(participant_frames, str(enemy_participant_id))
                if enemy_data:
                    enemy_gold = _get_attr_or_key(enemy_data, 'totalGold', 0)
                    enemy_xp = _get_attr_or_key(enemy_data, 'xp', 0)
                    has_enemy = True

            total_gold = 0
            total_xp = 0
            count = 0
            for p_id in range(1, 11):
                p_data = _get_attr_or_key(participant_frames, str(p_id))
                if p_data:
                    total_gold += _get_attr_or_key(p_data, 'totalGold', 0)
                    total_xp += _get_attr_or_key(p_data, 'xp', 0)
                    count += 1
            
            avg_gold = total_gold / max(count, 1)
            avg_xp = total_xp / max(count, 1)

            timestamp = _get_attr_or_key(frame, 'timestamp', 0)
            minute = round(timestamp / 60000)
            
            data_point = {
                "minute": minute,
                "goldDelta": my_gold - avg_gold,
                "xpDelta": my_xp - avg_xp,
                "myGold": my_gold,
                "avgGold": avg_gold,
                "myXp": my_xp,
                "avgXp": avg_xp
            }
            
            if has_enemy:
                data_point["enemyGold"] = enemy_gold
                data_point["enemyXp"] = enemy_xp
                data_point["laneGoldDelta"] = my_gold - enemy_gold
                data_point["laneXpDelta"] = my_xp - enemy_xp
            
            series_data.append(data_point)
            
        return {"timeline": series_data}
        
    except Exception:
        return {}


def extract_heatmap_data(
    timeline_data: Any,
    match_data: Dict[str, Any]
) -> Dict[str, Any]:
    """Extract spatial data from timeline for heatmap visualization."""
    if not timeline_data or not match_data:
        return {}

    try:
        info = _get_attr_or_key(timeline_data, 'info', {})
        frames = _get_attr_or_key(info, 'frames', [])
        if not frames:
            return {}

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

        participant_positions: Dict[int, List[Dict[str, Any]]] = {pid: [] for pid in range(1, 11)}
        prev_gold: Dict[int, int] = {}
        kill_events = []
        ward_events = []

        for frame in frames:
            timestamp = _get_attr_or_key(frame, 'timestamp', 0)
            participant_frames = _get_attr_or_key(frame, 'participantFrames', {})
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
                        creator_id = _get_attr_or_key(event, 'creatorId', 0)
                        wx, wy = 0, 0
                        pos = _get_attr_or_key(event, 'position', {})
                        if pos:
                            wx = _get_attr_or_key(pos, 'x', 0)
                            wy = _get_attr_or_key(pos, 'y', 0)
                        if (wx == 0 and wy == 0) and creator_id and participant_frames:
                            creator_data = _get_attr_or_key(participant_frames, str(creator_id))
                            if creator_data:
                                creator_pos = _get_attr_or_key(creator_data, 'position', {})
                                if creator_pos:
                                    wx = _get_attr_or_key(creator_pos, 'x', 0)
                                    wy = _get_attr_or_key(creator_pos, 'y', 0)
                        if wx == 0 and wy == 0:
                            continue
                        ward_events.append({
                            'x': wx, 'y': wy,
                            'wardType': _get_attr_or_key(event, 'wardType', 'UNDEFINED'),
                            'creatorId': creator_id,
                            'timestamp': _get_attr_or_key(event, 'timestamp', timestamp),
                        })

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

    except Exception:
        return {}
