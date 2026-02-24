"""ML Pipeline for Win Prediction.

Uses truly predictive features (early-game leads and habit-based metrics)
rather than outcome-correlated stats.
"""
import json
import os
import pandas as pd
from sqlalchemy.future import select
from sqlalchemy.ext.asyncio import AsyncSession
from models import Participant, Match

SKILLSHOT_DATA = {}
try:
    current_dir = os.path.dirname(os.path.abspath(__file__))
    data_path = os.path.join(current_dir, 'data', 'lol_skillshots.json')
    if os.path.exists(data_path):
        with open(data_path, 'r', encoding='utf-8') as f:
            SKILLSHOT_DATA = json.load(f)
    else:
        print(f"Warning: Skillshot data file not found at {data_path}")
except Exception as e:
    print(f"Error loading skillshot data: {e}")

# Predictive features: early-game leads and habit-based metrics
PREDICTIVE_FEATURES = [
    # Early game leads (measured at 8-14 min)
    'earlyLaningPhaseGoldExpAdvantage',
    'laningPhaseGoldExpAdvantage',
    'maxCsAdvantageOnLaneOpponent',
    'maxLevelLeadLaneOpponent',
    'visionScoreAdvantageLaneOpponent',

    # Early game efficiency
    'laneMinionsFirst10Minutes',
    'turretPlatesTaken',
    'skillshotsEarlyGame',

    # Mechanical skill (calculated ratios)
    'skillshotHitRate',
    'skillshotDodgeRate',

    # Vision habits
    'wardsPlaced',
    'controlWardsPlaced',
    'detectorWardsPlaced',
    'controlWardTimeCoverageInRiverOrEnemyHalf',

    # Communication habits
    'enemyMissingPings',
    'onMyWayPings',
    'assistMePings',
    'getBackPings',

    # Context
    'hadAfkTeammate',
]

# Display-only features: outcome-correlated, shown in UI but not used for prediction
DISPLAY_FEATURES = [
    # Combat
    'kills', 'deaths', 'assists', 'kda',
    'killParticipation', 'soloKills',
    'totalDamageDealtToChampions', 'damagePerMinute',
    'teamDamagePercentage', 'damageTakenOnTeamPercentage',
    'totalDamageTaken', 'totalHeal', 'timeCCingOthers',

    # Economy
    'goldPerMinute', 'totalMinionsKilled', 'neutralMinionsKilled',

    # Objectives
    'damageDealtToObjectives',
    'turretTakedowns', 'dragonTakedowns', 'baronTakedowns',
    'dragonKills', 'baronKills',
    'objectivesStolen', 'epicMonsterSteals',

    # Vision
    'visionScore', 'visionScorePerMinute', 'wardsKilled',

    # Mechanical
    'skillshotsHit', 'skillshotsDodged',
    'spell1Casts', 'spell2Casts', 'spell3Casts', 'spell4Casts',

    # Jungle
    'junglerKillsEarlyJungle',
    'killsOnLanersEarlyJungleAsJungler',
    'epicMonsterKillsNearEnemyJungler',

    # Pings
    'allInPings', 'commandPings', 'holdPings',
    'needVisionPings', 'pushPings', 'visionClearedPings',

    # Composite
    'aggressionScore', 'visionDominance', 'jungleInvasionPressure', 'combat_efficiency',
]

ALL_FEATURES = PREDICTIVE_FEATURES + DISPLAY_FEATURES

def get_skillshot_casts(stats, champion_name):
    """Calculate total casts of skillshot abilities for a champion."""
    if not champion_name or champion_name not in SKILLSHOT_DATA:
        return (
            stats.get('spell1Casts', 0) + 
            stats.get('spell2Casts', 0) + 
            stats.get('spell3Casts', 0) + 
            stats.get('spell4Casts', 0)
        )
    
    skillshot_keys = SKILLSHOT_DATA[champion_name]
    total_casts = 0
    for key in skillshot_keys:
        total_casts += stats.get(f'spell{key}Casts', 0)
    return total_casts


async def load_player_data(db: AsyncSession, puuid: str, limit: int = 50) -> pd.DataFrame:
    """Load match data for a specific player from the database."""
    result = await db.execute(
        select(Participant, Match)
        .join(Match)
        .where(Participant.puuid == puuid)
        .order_by(Match.game_creation.desc())
        .limit(limit)
    )
    
    rows = []
    query_rows = result.all()
    
    for participant, match in query_rows:
        row = {}
        stats = participant.stats_json
        challenges = stats.get('challenges', {})
        champion_name = stats.get('championName')
        
        for feature in ALL_FEATURES:
            if feature == 'kda':
                continue
            if feature in ['skillshotHitRate', 'skillshotDodgeRate', 'skillshotsDodged', 'skillshotsHit', 'spell1Casts', 'spell2Casts', 'spell3Casts', 'spell4Casts']:
                continue

            val = 0
            if hasattr(participant, feature) and getattr(participant, feature) is not None:
                val = getattr(participant, feature)
            elif feature in stats:
                val = stats[feature]
            elif feature in challenges:
                val = challenges[feature]
            
            row[feature] = val

        row['skillshotsHit'] = challenges.get('skillshotsHit', 0)
        row['skillshotsDodged'] = challenges.get('skillshotsDodged', 0)
        row['spell1Casts'] = stats.get('spell1Casts', 0)
        row['spell2Casts'] = stats.get('spell2Casts', 0)
        row['spell3Casts'] = stats.get('spell3Casts', 0)
        row['spell4Casts'] = stats.get('spell4Casts', 0)
        row['championName'] = champion_name

        spell_casts = get_skillshot_casts(stats, champion_name)

        skillshot_keys_list = []
        if champion_name and champion_name in SKILLSHOT_DATA:
            key_map = {1: 'Q', 2: 'W', 3: 'E', 4: 'R'}
            skillshot_keys_list = [key_map.get(k, str(k)) for k in sorted(SKILLSHOT_DATA[champion_name])]
        else:
            skillshot_keys_list = ['Q', 'W', 'E', 'R']
        row['championSkillshots'] = skillshot_keys_list
        
        skillshots_hit = challenges.get('skillshotsHit', 0)
        hit_rate = (skillshots_hit / spell_casts * 100) if spell_casts > 0 else 0
        row['skillshotHitRate'] = min(hit_rate, 100.0)

        skillshots_dodged = challenges.get('skillshotsDodged', 0)
        enemy_spell_casts = 0
        enemy_total_casts = 0

        if match.data:
            match_info = match.data.get('info', {})
            participants_data = match_info.get('participants', [])
            player_team_id = participant.team_id

            for p_data in participants_data:
                if p_data.get('teamId') != player_team_id:
                     enemy_champ = p_data.get('championName')
                     enemy_spell_casts += get_skillshot_casts(p_data, enemy_champ)
                     enemy_total_casts += (
                         p_data.get('spell1Casts', 0) + p_data.get('spell2Casts', 0) +
                         p_data.get('spell3Casts', 0) + p_data.get('spell4Casts', 0)
                     )

        denominator = enemy_spell_casts if enemy_spell_casts > 0 else enemy_total_casts
        row['skillshotDodgeRate'] = (skillshots_dodged / denominator * 100) if denominator > 0 else 0
        row['enemySkillshotCasts'] = denominator
        row['mySkillshotCasts'] = spell_casts

        if champion_name in SKILLSHOT_DATA:
            keys = SKILLSHOT_DATA[champion_name]
            mapping = {1: 'Q', 2: 'W', 3: 'E', 4: 'R'}
            valid_keys = [k for k in keys if k in mapping]
            mapped_keys = [mapping[k] for k in sorted(valid_keys)]
            config_str = "[" + ", ".join(mapped_keys) + "]"
        else:
            config_str = "[Q, W, E, R]"
        row['skillshotConfig'] = config_str

        # KDA
        k = row.get('kills', 0)
        d = row.get('deaths', 0)
        a = row.get('assists', 0)
        row['kda'] = (k + a) / d if d > 0 else k + a
        
        row['win'] = 1 if participant.win else 0
        row['gameCreation'] = match.game_creation
        row['match_id'] = match.match_id
        row['gameDuration'] = match.game_duration
        row['queueId'] = match.queue_id

        if 'goldPerMinute' not in row or row['goldPerMinute'] == 0:
            gold_earned = row.get('goldEarned', stats.get('goldEarned', 0))
            game_duration_min = match.game_duration / 60 if match.game_duration > 0 else 1
            row['goldPerMinute'] = gold_earned / game_duration_min

        # Composite features
        dmg_per_min = row.get('damagePerMinute', 0)
        solo_kills = row.get('soloKills', 0)
        
        BENCHMARK_DPM = 1000.0
        BENCHMARK_SOLO = 5.0

        dpm_score = min(dmg_per_min / BENCHMARK_DPM, 1.2) * 100
        solo_score = min(solo_kills / BENCHMARK_SOLO, 1.5) * 100
        raw_aggression = (dpm_score * 0.7) + (solo_score * 0.3)
        row['aggressionScore'] = min(raw_aggression, 100.0)

        vision_score = row.get('visionScore', 0)
        control_wards = row.get('controlWardsPlaced', 0)
        wards_killed = row.get('wardsKilled', 0)
        row['visionDominance'] = (vision_score * 1.5) + (control_wards * 5) + (wards_killed * 2)

        enemy_jungle_kills = challenges.get('enemyJungleMonsterKills', 0)
        epic_steals = challenges.get('epicMonsterSteals', 0)
        row['jungleInvasionPressure'] = (enemy_jungle_kills * 2) + (epic_steals * 50)

        gold_earned = row.get('goldEarned', stats.get('goldEarned', 0))
        total_dmg = row.get('totalDamageDealtToChampions', 0)
        if gold_earned > 0:
            dpg_ratio = total_dmg / gold_earned
            efficiency = (dpg_ratio / 2.0) * 100
            row['combat_efficiency'] = min(100.0, max(0.0, efficiency))
        else:
            row['combat_efficiency'] = 0.0

        rows.append(row)
        
    return pd.DataFrame(rows)


def prepare_features(df: pd.DataFrame, use_predictive_only: bool = True) -> pd.DataFrame:
    """Prepare feature matrix for model training."""
    features = PREDICTIVE_FEATURES if use_predictive_only else ALL_FEATURES
    if df.empty:
        return pd.DataFrame(columns=features)
    
    # Add any missing columns in bulk
    missing = [c for c in features if c not in df.columns]
    if missing:
        df = df.assign(**{c: 0 for c in missing})
            
    return pd.to_numeric(df[features].stack(), errors='coerce').unstack().fillna(0)


def get_feature_categories() -> dict:
    """Return categorized predictive features for UI display."""
    return {
        'Early Game Leads': [
            'earlyLaningPhaseGoldExpAdvantage',
            'laningPhaseGoldExpAdvantage',
            'maxCsAdvantageOnLaneOpponent',
            'maxLevelLeadLaneOpponent',
            'visionScoreAdvantageLaneOpponent',
        ],
        'Early Game Efficiency': [
            'laneMinionsFirst10Minutes',
            'turretPlatesTaken',
        ],
        'Vision Habits': [
            'wardsPlaced',
            'controlWardsPlaced',
            'detectorWardsPlaced',
            'controlWardTimeCoverageInRiverOrEnemyHalf',
        ],
        'Communication Habits': [
            'enemyMissingPings',
            'onMyWayPings',
            'assistMePings',
            'getBackPings',
        ],
    }
