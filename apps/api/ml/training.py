"""
Advanced Win Prediction Model using XGBoost with Probability Calibration
Refactored to use PREDICTIVE features (not outcome-correlated stats).
"""
import numpy as np
import pandas as pd
from xgboost import XGBClassifier
from sklearn.calibration import CalibratedClassifierCV
from .pipeline import PREDICTIVE_FEATURES, DISPLAY_FEATURES, ALL_FEATURES, prepare_features, get_feature_categories
import logging

logger = logging.getLogger(__name__)


def to_native(obj):
    """Convert numpy types to Python native types for JSON serialization."""
    if isinstance(obj, np.floating):
        return float(obj)
    elif isinstance(obj, np.integer):
        return int(obj)
    elif isinstance(obj, np.ndarray):
        return obj.tolist()
    elif isinstance(obj, dict):
        return {k: to_native(v) for k, v in obj.items()}
    elif isinstance(obj, (list, tuple)):
        return [to_native(item) for item in obj]
    return obj


# Use predictive features for training (legacy compatibility)
FEATURE_COLUMNS = PREDICTIVE_FEATURES


class WinPredictionModel:
    """
    XGBoost-based win prediction model with:
    - Gradient boosting (better than Random Forest per research)
    - Probability calibration (Platt scaling)
    - Weighted recent performance (most recent games matter more)
    - PREDICTIVE features (not outcome-correlated stats)
    - Training cache to skip redundant retraining for same user data
    """
    
    def __init__(self):
        self.base_model = XGBClassifier(
            n_estimators=200,
            max_depth=6,
            learning_rate=0.1,
            objective='binary:logistic',
            eval_metric='logloss',
            random_state=42
        )
        self.model = None  # Will be calibrated model after training
        self.is_trained = False
        self.trained_df = None
        self.cached_metrics = None  # Cache training metrics to avoid recomputation
        self._training_cache_key = None  # Cache key to detect if retrain needed
        
        # Use refactored predictive feature categories
        self.feature_categories = get_feature_categories()
    
    def _get_data_cache_key(self, df: pd.DataFrame) -> str:
        """Generate a cache key based on dataframe content to detect changes."""
        if df.empty:
            return ""
        # Use: number of rows + first game creation + last game creation + sum of wins
        # This is fast and catches most data changes
        key_parts = [
            str(len(df)),
            str(df['gameCreation'].iloc[0]) if 'gameCreation' in df.columns else "0",
            str(df['gameCreation'].iloc[-1]) if 'gameCreation' in df.columns else "0",
            str(int(df['win'].sum())) if 'win' in df.columns else "0"
        ]
        return "|".join(key_parts)
        
    def train(self, df: pd.DataFrame):
        """Train the model with weighted recent performance."""
        if df.empty or len(df) < 5:
            return {"error": "Not enough data (need at least 5 matches)"}
        
        # Check if we can skip retraining (same data as before)
        cache_key = self._get_data_cache_key(df)
        if cache_key and cache_key == self._training_cache_key and self.cached_metrics:
            logger.info(f"Skipping model training - using cached results (key: {cache_key})")
            return self.cached_metrics
            
        logger.info(f"Training model with new data (key: {cache_key})")
        
        X = prepare_features(df)
        y = df['win']
        
        # Sample weights: prioritize recent games (research-backed)
        n_matches = len(df)
        weights = np.array([
            4.0 if i == 0 else 2.0 if i < 5 else 1.0 
            for i in range(n_matches)
        ])
        
        # Train base XGBoost model with weights
        self.base_model.fit(X, y, sample_weight=weights)
        
        # Calibrate probabilities (Platt scaling) for well-calibrated outputs
        # We use a simple approach since we have limited data
        try:
            self.model = CalibratedClassifierCV(self.base_model, method='sigmoid', cv=3)
            self.model.fit(X, y, sample_weight=weights)
        except Exception:
            # Fallback to uncalibrated if not enough data for CV
            self.model = self.base_model
            
        self.is_trained = True
        self.trained_df = df
        self._training_cache_key = cache_key  # Save cache key for next request
        
        # Calculate metrics and cache them
        self.cached_metrics = self._calculate_metrics(df, X, y)
        return self.cached_metrics
    
    def _calculate_metrics(self, df: pd.DataFrame, X: pd.DataFrame, y: pd.Series):
        """Calculate training metrics and insights."""
        import math
        
        def safe_float(val):
            """Convert to float, replacing NaN/Inf with 0."""
            f = float(val) if not pd.isna(val) else 0.0
            return f if math.isfinite(f) else 0.0
        
        # Feature importance from base model
        importances = self.base_model.feature_importances_
        feature_importance = dict(zip(FEATURE_COLUMNS, importances))
        sorted_importance = sorted(feature_importance.items(), key=lambda x: x[1], reverse=True)
        
        # Category importance
        category_importance = {}
        for category, features in self.feature_categories.items():
            total = sum(feature_importance.get(f, 0) for f in features if f in feature_importance)
            category_importance[category] = total
        sorted_category = sorted(category_importance.items(), key=lambda x: x[1], reverse=True)
        
        # Win vs Loss analysis
        wins_df = df[df['win'] == 1]
        losses_df = df[df['win'] == 0]
        
        performance_insights = {}
        top_differentiators = []
        
        if len(wins_df) > 0 and len(losses_df) > 0:
            for feature in FEATURE_COLUMNS:
                if feature in df.columns:
                    avg_win = safe_float(wins_df[feature].mean())
                    avg_loss = safe_float(losses_df[feature].mean())
                    difference = avg_win - avg_loss
                    percent_diff = (difference / avg_loss * 100) if avg_loss != 0 else 0.0
                    # Ensure percent_diff is finite
                    percent_diff = percent_diff if math.isfinite(percent_diff) else 0.0
                    
                    performance_insights[feature] = {
                        'avg_when_winning': avg_win,
                        'avg_when_losing': avg_loss,
                        'difference': difference,
                        'percent_difference': percent_diff
                    }
            
            top_differentiators = sorted(
                performance_insights.items(),
                key=lambda x: abs(x[1]['percent_difference']),
                reverse=True
            )[:10]

        # Calculate Consistency Score (Inverse CV of Gold Per Minute)
        consistency_score = 0.0
        if not df.empty and 'goldPerMinute' in df.columns:
            gpm = pd.to_numeric(df['goldPerMinute'], errors='coerce').fillna(0)
            if gpm.mean() > 0:
                cv = gpm.std() / gpm.mean()
                # Score 0-100: 0 CV = 100 consistency, 0.5 CV = 0 consistency
                consistency_score = max(0, min(100, (1.0 - (cv * 2)) * 100))
        
        
        # Model accuracy
        try:
            accuracy = self.model.score(X, y) if self.model else 0
        except Exception:
            accuracy = self.base_model.score(X, y)
        
        return to_native({
            "feature_importance": sorted_importance,
            "category_importance": sorted_category,
            "performance_insights": performance_insights,
            "top_differentiators": top_differentiators,
            "accuracy": accuracy,
            "total_matches": len(df),
            "wins": int(y.sum()),
            "losses": int(len(df) - y.sum()),
            "consistency_score": consistency_score
        })
    
    def calculate_weighted_averages(self, df: pd.DataFrame) -> dict:
        """
        Calculate weighted averages prioritizing recent games.
        Most recent: 4x, games 2-5: 2x, older: 1x
        """
        import math
        
        if df.empty:
            return {}
            
        n = len(df)
        weights = np.array([4.0 if i == 0 else 2.0 if i < 5 else 1.0 for i in range(n)])
        
        weighted_averages = {}
        # Use ALL_FEATURES (predictive + display) for UI display
        for feature in ALL_FEATURES:
            if feature in df.columns:
                # Fix FutureWarning by explicitly converting to numeric before filling
                series = pd.to_numeric(df[feature], errors='coerce')
                val = float(np.average(series.fillna(0), weights=weights))
                # Replace NaN/Inf with 0 for JSON compatibility
                weighted_averages[feature] = val if math.isfinite(val) else 0.0
        
        return weighted_averages
    
    def predict_win_probability(self, stats: dict) -> float:
        """Predict win probability from weighted average stats."""
        if not self.is_trained:
            return 50.0  # Default 50% if not trained
            
        df = pd.DataFrame([stats])
        X = prepare_features(df)
        
        # DEBUG: Print Win Prediction Inputs (User Request)
        print(f"DEBUG: Win Prediction Input (Last Game Features):")
        for col in X.columns:
            val = X[col].values[0]
            if val != 0:
                print(f"  {col}: {val}")
        
        try:
            proba = self.model.predict_proba(X)[0][1]
        except Exception:
            proba = self.base_model.predict_proba(X)[0][1]
            
        return float(proba * 100)  # Return as percentage, ensure native float
    
    def analyze_player_mood(self, df: pd.DataFrame) -> list:
        """
        Analyze last 3 matches to detect player's current 'mood'.
        Returns list of fun/meme-like tags based on performance patterns.
        Ported from legacy with all 31 mood patterns.
        """
        if df.empty:
            return []
        
        # Use last 3 matches
        recent = df.head(3)
        
        if recent.empty:
            return []
            
        moods = []
        
        # Calculate recent stats with safe gets
        def safe_mean(col):
            if col in recent.columns:
                return recent[col].mean()
            return 0
        
        avg_kda = safe_mean('kda') if 'kda' in recent.columns else (
            (safe_mean('kills') + safe_mean('assists')) / max(safe_mean('deaths'), 1)
        )
        win_rate = safe_mean('win') * 100
        avg_deaths = safe_mean('deaths')
        avg_kills = safe_mean('kills')
        avg_assists = safe_mean('assists')
        avg_vision = safe_mean('visionScore')
        avg_kp = safe_mean('killParticipation')
        avg_damage_share = safe_mean('teamDamagePercentage')
        avg_damage_taken_share = safe_mean('damageTakenOnTeamPercentage')
        avg_solo_kills = safe_mean('soloKills')
        avg_gold_min = safe_mean('goldPerMinute')
        avg_cs_diff = safe_mean('maxCsAdvantageOnLaneOpponent')
        avg_obj_damage = safe_mean('damageDealtToObjectives')
        early_gold_adv = safe_mean('earlyLaningPhaseGoldExpAdvantage')
        lane_minions = safe_mean('laneMinionsFirst10Minutes')
        missing_pings = safe_mean('enemyMissingPings')
        control_wards = safe_mean('controlWardsPlaced')
        total_heal = safe_mean('totalHeal')
        time_ccing = safe_mean('timeCCingOthers')
        objectives_stolen = recent['objectivesStolen'].sum() if 'objectivesStolen' in recent.columns else 0
        had_afk = recent['hadAfkTeammate'].sum() if 'hadAfkTeammate' in recent.columns else 0
        
        # --- MOOD DETECTION RULES (31 patterns from legacy) ---
        
        # 1. Smurf Detected
        if win_rate == 100 and avg_kda > 5.0:
            moods.append({
                "title": "Smurf Detected",
                "icon": "crown",
                "color": "text-yellow-400",
                "description": f"Clean sweep! {int(win_rate)}% WR and {avg_kda:.1f} KDA last 3 matches. Are you boosting this account?",
                "advice": "Touch grass. Seriously."
            })
        # 2. Locked In
        elif win_rate >= 66 and avg_kda > 3.5:
            moods.append({
                "title": "Locked In",
                "icon": "flame",
                "color": "text-orange-500",
                "description": f"You're sweating with a {int(win_rate)}% WR and {avg_kda:.1f} KDA last 3 matches.",
                "advice": "Stop tryharding in normals."
            })
        
        # 3. Gray Screen Simulator
        if avg_deaths > 9:
            moods.append({
                "title": "Gray Screen Simulator",
                "icon": "skull",
                "color": "text-gray-500",
                "description": f"Averaging {avg_deaths:.1f} deaths last 3 matches. Your team hates you.",
                "advice": "Uninstall or play Yuumi."
            })
        # 4. Tilt Queue
        elif avg_deaths > 7 and win_rate < 34:
            moods.append({
                "title": "Tilt Queue?",
                "icon": "heart-crack",
                "color": "text-red-500",
                "description": f"Losing ({int(win_rate)}% WR) and feeding ({avg_deaths:.1f} deaths) last 3 matches.",
                "advice": "Alt+F4 is a valid combo."
            })
        
        # 5. Loser's Queue Victim
        if win_rate <= 33 and avg_kda > 3.0 and avg_damage_share > 0.25:
            moods.append({
                "title": "Loser's Queue Victim",
                "icon": "umbrella",
                "color": "text-blue-400",
                "description": f"Playing perfectly ({avg_kda:.1f} KDA) but Riot hates you personally last 3 matches.",
                "advice": "Cry about it on Reddit."
            })
        
        # 6. Backpack Enjoyer (Getting Carried)
        if win_rate >= 66 and avg_kda < 2.0 and avg_damage_share < 0.15:
            moods.append({
                "title": "Backpack Enjoyer",
                "icon": "baby",
                "color": "text-pink-400",
                "description": f"Winning while doing nothing ({avg_damage_share*100:.1f}% dmg) last 3 matches.",
                "advice": "Say 'gg ez' after getting carried."
            })
        
        # 7. 4v5 Warrior
        if had_afk > 0:
            moods.append({
                "title": "4v5 Warrior",
                "icon": "user-x",
                "color": "text-red-400",
                "description": f"Had an AFK in {int(had_afk)} games. Riot's matchmaking at its finest last 3 matches.",
                "advice": "Scream into a pillow."
            })
        
        # 8. Main Character Syndrome
        if avg_solo_kills > 2:
            moods.append({
                "title": "Main Character Syndrome",
                "icon": "swords",
                "color": "text-orange-600",
                "description": f"You ignore the team and 1v1 everyone ({avg_solo_kills:.1f} solo kills) last 3 matches.",
                "advice": "It's a team game, genius."
            })
        
        # 9. Lane Kingdom
        if avg_cs_diff > 20:
            moods.append({
                "title": "Lane Kingdom",
                "icon": "castle",
                "color": "text-purple-500",
                "description": f"Bullying your laner (+{avg_cs_diff:.0f} CS diff) last 3 matches. They reported you.",
                "advice": "Stop torturing them and end."
            })
        
        # 10. PvE Player (The Farmer)
        if lane_minions > 80:
            moods.append({
                "title": "PvE Player",
                "icon": "wheat",
                "color": "text-green-400",
                "description": "You're playing Stardew Valley while your team fights last 3 matches.",
                "advice": "Minions don't give LP."
            })
        
        # 11. Ward Bot
        if avg_vision > 50:
            moods.append({
                "title": "Ward Bot",
                "icon": "eye",
                "color": "text-cyan-400",
                "description": f"Vision score {avg_vision:.1f}. You're basically a walking ward last 3 matches.",
                "advice": "Try doing damage next time."
            })
        # 12. Lee Sin Cosplay (No Vision)
        elif avg_vision < 10 and control_wards < 0.5:
            moods.append({
                "title": "Lee Sin Cosplay",
                "icon": "eye-off",
                "color": "text-gray-400",
                "description": f"Vision score {avg_vision:.1f}. You play with your monitor off last 3 matches.",
                "advice": "Buy a ward, you cheapskate."
            })
        
        # 13. Yasuo Main Energy (Coinflip)
        if avg_kills > 8 and avg_deaths > 8:
            moods.append({
                "title": "Yasuo Main Energy",
                "icon": "coins",
                "color": "text-yellow-600",
                "description": f"Feeding ({avg_deaths:.1f}) and killing ({avg_kills:.1f}). Complete coinflip last 3 matches.",
                "advice": "Stop diving under tower."
            })
        
        # 14. Unkillable Demon King
        if avg_damage_taken_share > 0.30 and avg_deaths < 6:
            moods.append({
                "title": "Unkillable Demon King",
                "icon": "shield",
                "color": "text-indigo-400",
                "description": f"Tanking {avg_damage_taken_share*100:.1f}% of damage. They can't kill you last 3 matches.",
                "advice": "Spam mastery emote while tanking."
            })
        # 15. Damage Sponge
        elif avg_damage_taken_share > 0.30 and avg_deaths >= 6:
            moods.append({
                "title": "Damage Sponge",
                "icon": "target",
                "color": "text-red-300",
                "description": f"Taking {avg_damage_taken_share*100:.1f}% damage by face-checking last 3 matches.",
                "advice": "Learn to dodge."
            })
        
        # 16. 1v9 Machine
        if avg_damage_share > 0.35:
            moods.append({
                "title": "1v9 Machine",
                "icon": "sword",
                "color": "text-red-600",
                "description": f"Doing {avg_damage_share*100:.1f}% of team damage. Your team is useless last 3 matches.",
                "advice": "Don't break your back carrying."
            })
        
        # 17. Objective Obsessed
        if avg_obj_damage > 20000:
            moods.append({
                "title": "Objective Obsessed",
                "icon": "target",
                "color": "text-emerald-500",
                "description": f"{avg_obj_damage/1000:.1f}k obj damage. You hit dragons more than champions last 3 matches.",
                "advice": "Champions give gold too."
            })
        
        # 18. Capitalist Pig
        if avg_gold_min > 500:
            moods.append({
                "title": "Capitalist Pig",
                "icon": "banknote",
                "color": "text-yellow-300",
                "description": f"Hoarding {avg_gold_min:.0f} Gold/Min. Share with the poor last 3 matches.",
                "advice": "Full build at 20 min? Touch grass."
            })
        
        # 19. Toxic Pinger
        if missing_pings > 15:
            moods.append({
                "title": "Toxic Pinger",
                "icon": "help-circle",
                "color": "text-yellow-500",
                "description": f"Spamming '?' {missing_pings:.1f} times/game. We know you're flaming last 3 matches.",
                "advice": "Unbind your ping key."
            })
        
        # 20. KDA Player (Pacifist)
        if avg_damage_share < 0.10 and avg_assists > 8:
            moods.append({
                "title": "KDA Player",
                "icon": "heart-handshake",
                "color": "text-teal-300",
                "description": f"Only {avg_damage_share*100:.1f}% dmg. Scared to fight last 3 matches?",
                "advice": "Right-click the enemy champions."
            })
        
        # 21. Burglar (Objective Stealer)
        if objectives_stolen > 0:
            moods.append({
                "title": "Burglar",
                "icon": "ghost",
                "color": "text-purple-600",
                "description": "Stole an objective. Probably luck last 3 matches.",
                "advice": "Don't push your luck."
            })
        
        # 22. Participation Trophy
        if avg_kp > 0.70:
            moods.append({
                "title": "Participation Trophy",
                "icon": "users",
                "color": "text-cyan-500",
                "description": f"{avg_kp*100:.0f}% KP. You're just following your team around last 3 matches.",
                "advice": "Try doing something on your own."
            })
        # 23. AFK Splitpusher
        elif avg_kp < 0.25 and win_rate > 50:
            moods.append({
                "title": "AFK Splitpusher",
                "icon": "move-horizontal",
                "color": "text-gray-300",
                "description": f"Winning with {avg_kp*100:.0f}% KP. Playing single player last 3 matches.",
                "advice": "Group up or get reported."
            })
        
        # 24. Lane Liability
        if early_gold_adv < -500:
            moods.append({
                "title": "Lane Liability",
                "icon": "trending-down",
                "color": "text-red-400",
                "description": "Losing lane by 500+ gold. You are the reason we lose last 3 matches.",
                "advice": "Learn to lane or play support."
            })
        
        # 25. Professional Choker
        if early_gold_adv > 300 and win_rate < 34:
            moods.append({
                "title": "Professional Choker",
                "icon": "frown",
                "color": "text-blue-500",
                "description": "You win lane hard, then throw the game harder last 3 matches.",
                "advice": "Stop 1v5ing and group."
            })
        
        # 26. Lucky Charm
        if early_gold_adv < -300 and win_rate > 66:
            moods.append({
                "title": "Lucky Charm",
                "icon": "sparkles",
                "color": "text-green-500",
                "description": "Got rolled in lane but got carried last 3 matches.",
                "advice": "Better lucky than good."
            })
        
        # 27. The Fun Police
        if time_ccing > 30:
            moods.append({
                "title": "The Fun Police",
                "icon": "hand",
                "color": "text-indigo-500",
                "description": "You don't let anyone play the game (>30s CC) last 3 matches.",
                "advice": "Your opponents hate you. Good."
            })
        
        # 28. Hospital Bed (High Healing)
        if total_heal > 15000:
            moods.append({
                "title": "Hospital Bed",
                "icon": "heart-pulse",
                "color": "text-red-300",
                "description": "Healing numbers go brrr last 3 matches.",
                "advice": "You can't heal stupidity."
            })
        
        # Default: NPC Energy
        if not moods:
            moods.append({
                "title": "NPC Energy",
                "icon": "bot",
                "color": "text-gray-400",
                "description": "You exist. That's about it last 3 matches.",
                "advice": "Do something. Anything."
            })
        
        # Deduplicate and return
        unique_moods = {m['title']: m for m in moods}
        return list(unique_moods.values())

    def get_win_driver_insights(self, df: pd.DataFrame, stats: dict, enemy_stats: dict = None) -> list:
        """
        Compare current game stats against enemy laner (or average winning stats if no enemy stats) to identify Win Drivers.
        Returns a list of drivers sorted by impact.
        """
        if not self.is_trained or df.empty:
            return []

        # Use cached metrics instead of recalculating (performance optimization)
        training_insights = self.cached_metrics or {}
        perf_insights = training_insights.get('performance_insights', {})

        drivers = []
        
        # Define some readable names map
        names_map = {
            'visionScore': 'Vision Control',
            'goldPerMinute': 'Economy',
            'damageDealtToChampions': 'Combat Output',
            'killParticipation': 'Teamfighting',
            'towerDamageDealt': 'Objective Pressure',
            'totalMinionsKilled': 'Farming',
            'xpPerMinute': 'Experience Gain',
            'earlyLaningPhaseGoldExpAdvantage': 'Early Gold Lead',
            'laningPhaseGoldExpAdvantage': 'Mid-Game Gold Lead',
            'maxCsAdvantageOnLaneOpponent': 'CS Dominance',
            'maxLevelLeadLaneOpponent': 'Level Advantage',
            'visionScoreAdvantageLaneOpponent': 'Vision Gap',
            'laneMinionsFirst10Minutes': 'Early Farming',
            'turretPlatesTaken': 'Tower Aggression',
            'skillshotHitRate': 'Skill Accuracy',
            'skillshotDodgeRate': 'Dodge Skill',
            'wardsPlaced': 'Warding Habit',
            'controlWardsPlaced': 'Control Ward Usage',
            'controlWardTimeCoverageInRiverOrEnemyHalf': 'Deep Vision',
            'enemyMissingPings': 'Map Awareness',
            'soloKills': 'Solo Kill Pressure',
            'aggressionScore': 'Aggression',
            'visionDominance': 'Vision Dominance',
            'jungleInvasionPressure': 'Invasion Pressure',
        }

        feature_cols = FEATURE_COLUMNS # Use the predictive features

        for feature in feature_cols:
             if feature in stats:
                val = stats[feature]
                if val is None: continue
                
                # Determine baseline: Enemy Laner > Average Winner
                baseline = 0
                baseline_source = "avg"
                
                if enemy_stats:
                    if feature in enemy_stats:
                        baseline = enemy_stats[feature]
                        baseline_source = "enemy"
                    else:
                        continue # Strict Mode: Skip if we can't compare to enemy
                elif feature in perf_insights:
                    baseline = perf_insights[feature]['avg_when_winning']
                else:
                    continue
                
                # --- RAW STAT MAPPING ---
                # For UI clarity, map "Advantage" stats to their raw counterparts
                raw_map = {
                    'visionScoreAdvantageLaneOpponent': 'visionScore',
                    'maxCsAdvantageOnLaneOpponent': 'totalMinionsKilled',
                    'earlyLaningPhaseGoldExpAdvantage': 'goldPerMinute', 
                    'laningPhaseGoldExpAdvantage': 'goldPerMinute',
                    'maxLevelLeadLaneOpponent': 'xpPerMinute'
                }

                display_val = val
                display_baseline = baseline
                
                if feature in raw_map:
                    raw_key = raw_map[feature]
                    if raw_key in stats and enemy_stats and raw_key in enemy_stats:
                        display_val = stats[raw_key]
                        display_baseline = enemy_stats[raw_key]
                        # Re-calculate diff based on raw stats for consistency
                        val = display_val
                        baseline = display_baseline
                # ------------------------
                
                # Calculate difference
                # If baseline is 0, handle carefully
                if baseline == 0:
                    if val > 0:
                        diff_pct = 1.0 # 100% better
                    elif val < 0:
                        diff_pct = -1.0
                    else:
                        diff_pct = 0.0
                else:
                    diff_pct = (val - baseline) / abs(baseline)
                    
                # Filter logic: Only show positive drivers (better than baseline)
                # For strictly positive stats (Gold), val > baseline
                # For leads (Gold Diff), val > baseline.
                
                # Logic for "Good" performance
                is_positive = diff_pct > 0.05 # At least 5% better
                
                if is_positive:
                    impact = "Low"
                    if diff_pct > 0.15: impact = "Medium"
                    if diff_pct > 0.4: impact = "High"
                    
                    readable_name = names_map.get(feature, feature.replace('_', ' ').title())
                    
                    drivers.append({
                        "name": readable_name,
                        "impact": impact,
                        "value": display_val,
                        "baseline": display_baseline,
                        "diff_pct": diff_pct,
                        "feature": feature,
                        "source": baseline_source
                    })

        # Sort by diff_pct descending, weighted by category priority
        # Priority: Combat/Gold/Aggression > Vision/Pings
        priority_weights = {
            # High priority — laning fundamentals
            'earlyLaningPhaseGoldExpAdvantage': 1.6,
            'laningPhaseGoldExpAdvantage': 1.6,
            'maxCsAdvantageOnLaneOpponent': 1.5,
            'maxLevelLeadLaneOpponent': 1.5,
            'laneMinionsFirst10Minutes': 1.4,
            'turretPlatesTaken': 1.4,
            'skillshotHitRate': 1.3,
            'skillshotDodgeRate': 1.3,
            'visionScoreAdvantageLaneOpponent': 1.2,

            # Medium priority
            'damageDealtToChampions': 1.0,
            'goldPerMinute': 1.0,
            'soloKills': 1.0,
            'aggressionScore': 1.0,
            'totalMinionsKilled': 1.0,
            'killParticipation': 1.0,

            # Low priority — vision habits
            'wardsPlaced': 0.5,
            'controlWardsPlaced': 0.5,
            'controlWardTimeCoverageInRiverOrEnemyHalf': 0.5,
            'detectorWardsPlaced': 0.5,
            'visionScore': 0.5,

            # Very low priority — pings (deprioritized)
            'enemyMissingPings': 0.1,
            'onMyWayPings': 0.1,
            'assistMePings': 0.1,
            'getBackPings': 0.1,
        }

        drivers.sort(key=lambda x: x['diff_pct'] * priority_weights.get(x['feature'], 1.0), reverse=True)
        return drivers[:3] # Top 3

    def get_skill_focus(self, df: pd.DataFrame, stats: dict, enemy_stats: dict = None) -> list:
        """
        Identify areas for improvement compared to enemy laner (or winning averages).
        """
        if not self.is_trained or df.empty:
            return []
            
        # Use cached metrics instead of recalculating (performance optimization)
        training_insights = self.cached_metrics or {}
        perf_insights = training_insights.get('performance_insights', {})
        
        improvements = []
        name_map = {
             # Vision
             'visionScore': {'title': 'Vision Control', 'desc': 'Place more wards and clear enemy vision.'},
             'visionScoreAdvantageLaneOpponent': {'title': 'Vision Gap', 'desc': 'Your opponent is out-visioning you.'},
             'wardsPlaced': {'title': 'Wards Placed', 'desc': 'Use your trinket more often.'},
             'controlWardsPlaced': {'title': 'Control Wards', 'desc': 'Buy and place pink wards to deny vision.'},
             'controlWardTimeCoverageInRiverOrEnemyHalf': {'title': 'Deep Vision', 'desc': 'Place control wards further up for better info.'},
             
             # Farming / Economy
             'goldPerMinute': {'title': 'Farming & Economy', 'desc': 'Improve CSing and look for more resource efficient rotations.'},
             'totalMinionsKilled': {'title': 'CS Numbers', 'desc': 'Focus on last hitting minions.'},
             'laneMinionsFirst10Minutes': {'title': 'Early Farm (10m)', 'desc': 'Practice last hitting in the early laning phase.'},
             'earlyLaningPhaseGoldExpAdvantage': {'title': 'Early Gold Lead', 'desc': 'Work on winning the first 8 minutes of lane.'},
             'laningPhaseGoldExpAdvantage': {'title': 'Lane Gold Lead', 'desc': 'Focus on building a lead by 14 minutes.'},
             'maxCsAdvantageOnLaneOpponent': {'title': 'CS Gap', 'desc': 'Deny enemy CS while securing your own.'},
             'turretPlatesTaken': {'title': 'Turret Plates', 'desc': 'Push for plates when opponents recall or roam.'},
             
             # Combat / Mechanics
             'killParticipation': {'title': 'Map Presence', 'desc': 'Roam more often to assist your team.'},
             'damageDealtToChampions': {'title': 'Damage Output', 'desc': 'Look for more safe trading opportunities.'},
             'kda': {'title': 'Survival', 'desc': 'Play safer and avoid unnecessary deaths.'},
             'skillshotHitRate': {'title': 'Skill Accuracy', 'desc': 'Practice hitting your skillshots consistently.'},
             'skillshotDodgeRate': {'title': 'Dodge Skill', 'desc': 'Focus on sidestepping enemy abilities.'},
             'maxLevelLeadLaneOpponent': {'title': 'Level Lead', 'desc': 'Soak XP and deny enemy recall timings.'},
             
             # Communication
             'enemyMissingPings': {'title': 'Missing Pings', 'desc': 'Ping missing when your laner roams.'},
             'onMyWayPings': {'title': 'Roam Communication', 'desc': 'Ping on my way when moving to help.'},
             'assistMePings': {'title': 'Help Requests', 'desc': 'Ask for help before getting dove.'},
             'getBackPings': {'title': 'Danger Pings', 'desc': 'Warn teammates of incoming danger.'},
        }
        
        for feature in FEATURE_COLUMNS:
             if feature in stats:
                val = stats[feature]
                
                # Determine baseline: Enemy Laner > Average Winner
                baseline = 0
                baseline_source = "avg"
                
                if enemy_stats:
                    if feature in enemy_stats:
                         baseline = enemy_stats[feature]
                         baseline_source = "enemy"
                    else:
                         continue # Strict Mode
                elif feature in perf_insights:
                     baseline = perf_insights[feature]['avg_when_winning']
                else:
                     continue

                # --- RAW STAT MAPPING ---
                raw_map = {
                    'visionScoreAdvantageLaneOpponent': 'visionScore',
                    'maxCsAdvantageOnLaneOpponent': 'totalMinionsKilled',
                    'earlyLaningPhaseGoldExpAdvantage': 'goldPerMinute', 
                    'laningPhaseGoldExpAdvantage': 'goldPerMinute',
                    'maxLevelLeadLaneOpponent': 'xpPerMinute'
                }
                
                display_val = val
                display_baseline = baseline

                if feature in raw_map:
                    raw_key = raw_map[feature]
                    if raw_key in stats and enemy_stats and raw_key in enemy_stats:
                        display_val = stats[raw_key]
                        display_baseline = enemy_stats[raw_key]
                        # Use raw values for diff calc to ensure "Gap" makes sense
                        val = display_val
                        baseline = display_baseline
                # ------------------------

                # If value is significantly WORSE than baseline
                if val is not None:
                    # Avoid division by zero
                    denom = abs(baseline) if baseline != 0 else 1.0 
                    
                    diff_pct = (val - baseline) / denom
                    
                    # Identify "Bad" performance. 
                    # If diff_pct is negative, it means we are worse than baseline (assuming higher is better).
                    # Exceptions: Deaths (lower is better), but usually we handle deaths via KDA or similar which is higher=better.
                    
                    threshold = -0.1 if baseline_source == "enemy" else -0.15
                    
                    if diff_pct < threshold: 
                         readable_feature = feature.replace('_', ' ').replace('LaneOpponent','').title()
                         info = name_map.get(feature, {'title': readable_feature, 'desc': f'Improve your {readable_feature}.'})
                         improvements.append({
                             "title": info['title'],
                             "description": info['desc'],
                             "current": display_val,
                             "target": display_baseline,
                             "diff": diff_pct,
                             "feature": feature,
                             "source": baseline_source
                         })
                         
        # Sort by diff (lowest/most negative first), weighted by priority.
        # Weight > 1 makes the negative diff LARGER (more negative) -> Higher priority
        priority_weights = {
            # High priority — laning fundamentals
            'earlyLaningPhaseGoldExpAdvantage': 1.6,
            'laningPhaseGoldExpAdvantage': 1.6,
            'maxCsAdvantageOnLaneOpponent': 1.5,
            'maxLevelLeadLaneOpponent': 1.5,
            'laneMinionsFirst10Minutes': 1.4,
            'turretPlatesTaken': 1.4,
            'skillshotHitRate': 1.3,
            'skillshotDodgeRate': 1.3,
            'visionScoreAdvantageLaneOpponent': 1.2,

            # Medium priority
            'damageDealtToChampions': 1.0,
            'goldPerMinute': 1.0,
            'soloKills': 1.0,
            'aggressionScore': 1.0,
            'totalMinionsKilled': 1.0,

            # Low priority — vision habits
            'wardsPlaced': 0.5,
            'controlWardsPlaced': 0.5,
            'controlWardTimeCoverageInRiverOrEnemyHalf': 0.5,
            'detectorWardsPlaced': 0.5,
            'visionScore': 0.5,

            # Very low priority — pings
            'enemyMissingPings': 0.1,
            'onMyWayPings': 0.1,
            'assistMePings': 0.1,
            'getBackPings': 0.1,
        }
        
        improvements.sort(key=lambda x: x['diff'] * priority_weights.get(x['feature'], 1.0)) 
        return improvements[:3]


# Global instance
model_instance = WinPredictionModel()
