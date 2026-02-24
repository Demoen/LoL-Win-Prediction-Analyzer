# Stats Overview

A reference for every stat this application **fetches from the Riot API** and every stat it **calculates internally**.

---

## 1. Stats Fetched from the Riot API

### 1.1 Account & Summoner API
| Field | Description |
|---|---|
| `puuid` | Player unique identifier |
| `gameName` | Riot ID game name |
| `tagLine` | Riot ID tag line |
| `profileIconId` | Profile icon ID |
| `summonerLevel` | Summoner level |

### 1.2 Match Details API — Participant fields (`info.participants`)
These are stored directly in the `Participant` model and/or `stats_json`.

| Field | Description |
|---|---|
| `championId` / `championName` | Champion played |
| `teamId` | Team (100 = blue, 200 = red) |
| `teamPosition` | Lane role (TOP, JUNGLE, MID, BOTTOM, UTILITY) |
| `participantId` | In-match participant index (1–10) |
| `win` | Match outcome |
| `kills` | Total kills |
| `deaths` | Total deaths |
| `assists` | Total assists |
| `totalMinionsKilled` | Lane CS |
| `neutralMinionsKilled` | Jungle CS |
| `visionScore` | Vision score |
| `totalDamageDealtToChampions` | Total damage dealt |
| `totalDamageTaken` | Total damage taken |
| `totalHeal` | Total healing done |
| `timeCCingOthers` | Time spent CCing enemies (seconds) |
| `goldEarned` | Total gold earned |
| `damageDealtToObjectives` | Damage to objectives |
| `turretTakedowns` | Turret kills |
| `dragonKills` / `dragonTakedowns` | Dragon kills |
| `baronKills` / `baronTakedowns` | Baron kills |
| `objectivesStolen` | Objectives stolen |
| `spell1Casts` – `spell4Casts` | Q/W/E/R cast counts |

### 1.3 Match Details API — Challenges object (`info.participants[].challenges`)
Riot's pre-computed challenge metrics, accessed via the `challenges` sub-object.

**Used as ML prediction features:**
| Field | Description |
|---|---|
| `earlyLaningPhaseGoldExpAdvantage` | Gold + XP lead over lane opponent at ~8 min |
| `laningPhaseGoldExpAdvantage` | Gold + XP lead over lane opponent at ~14 min |
| `maxCsAdvantageOnLaneOpponent` | Peak CS lead over lane opponent |
| `maxLevelLeadLaneOpponent` | Peak level lead over lane opponent |
| `visionScoreAdvantageLaneOpponent` | Vision score lead over lane opponent |
| `laneMinionsFirst10Minutes` | CS at 10 minutes |
| `turretPlatesTaken` | Turret plates taken (early game only) |
| `skillshotsEarlyGame` | Skillshots landed in early game |
| `wardsPlaced` | Total wards placed |
| `controlWardsPlaced` | Control wards bought and placed |
| `detectorWardsPlaced` | Sweeper / detector ward usages |
| `controlWardTimeCoverageInRiverOrEnemyHalf` | % of game with control ward in river or enemy half |
| `enemyMissingPings` | "?" ping count (map awareness) |
| `onMyWayPings` | "OMW" ping count (coordination) |
| `assistMePings` | "Assist me" ping count |
| `getBackPings` | "Get back" ping count |
| `hadAfkTeammate` | Boolean — had AFK on team |

**Displayed in UI but not used for prediction (outcome-correlated):**
| Field | Description |
|---|---|
| `goldPerMinute` | Gold earned per minute |
| `killParticipation` | Kill participation % |
| `soloKills` | Solo kills |
| `damagePerMinute` | Damage dealt per minute |
| `teamDamagePercentage` | % of team's total damage |
| `damageTakenOnTeamPercentage` | % of team's damage taken |
| `visionScorePerMinute` | Vision score per minute |
| `wardsKilled` | Enemy wards destroyed |
| `skillshotsHit` | Total skillshots hit |
| `skillshotsDodged` | Enemy skillshots dodged |
| `junglerKillsEarlyJungle` | Kills as jungler in enemy jungle early |
| `killsOnLanersEarlyJungleAsJungler` | Kills on laners while invading early |
| `epicMonsterKillsNearEnemyJungler` | Epic monster kills contested near enemy jungler |
| `epicMonsterSteals` | Epic monster steals |
| `enemyJungleMonsterKills` | Enemy jungle camps taken |
| `allInPings` / `commandPings` / `holdPings` / `needVisionPings` / `pushPings` / `visionClearedPings` | Miscellaneous ping counts |

### 1.4 Match Timeline API (`match.get_timeline`)
Frame-by-frame positional and economic data (recorded every ~60 seconds).

| Field | Description |
|---|---|
| `participantFrames[n].position.x/y` | Map coordinates for each participant |
| `participantFrames[n].totalGold` | Cumulative gold at each frame |
| `participantFrames[n].xp` | Cumulative XP at each frame |
| Events: `CHAMPION_KILL` | Position, killer ID, victim ID, assisting IDs, timestamp |
| Events: `WARD_PLACED` | Ward type, creator ID, position, timestamp |

### 1.5 League API (`league.get_league_entries_by_puuid`)
| Field | Description |
|---|---|
| Ranked entries | Full league DTO: tier, rank, LP, wins, losses, veteran, hotStreak, etc. |

---

## 2. Stats Calculated Internally

### 2.1 Per-game ratios — `ml/pipeline.py`
Computed for every game row in the feature matrix.

| Calculated Stat | Formula | Purpose |
|---|---|---|
| `skillshotHitRate` | `skillshotsHit / skillshot_ability_casts × 100` (capped at 100%) | Mechanical accuracy; uses champion-specific skillshot spell list from `lol_skillshots.json` |
| `skillshotDodgeRate` | `skillshotsDodged / enemy_skillshot_casts × 100` | Dodge ability; denominator is sum of enemy skillshot spell casts |
| `kda` | `(kills + assists) / deaths` (or `kills + assists` when deaths = 0) | Kill/death/assist ratio |
| `goldPerMinute` (fallback) | `goldEarned / (gameDuration / 60)` | Used only when the challenge value is missing or zero |

### 2.2 Composite scores — `ml/pipeline.py`
Normalized 0–100 scores combining multiple raw stats into a single metric.

| Calculated Stat | Formula | Purpose |
|---|---|---|
| `aggressionScore` | `(damagePerMinute / 1000 × 0.7 + soloKills / 5 × 0.3) × 100`, capped at 100 | Overall aggression rating |
| `visionDominance` | `visionScore × 1.5 + controlWardsPlaced × 5 + wardsKilled × 2` | Vision control impact |
| `time_in_enemy_territory_pct` (displayed as **Time in Enemy Half**) | See territorial metrics section — frames in enemy territory / total frames × 100 | % of match time spent in enemy half; shown directly in the Performance Breakdown overview |
| `combat_efficiency` | `(totalDamageDealtToChampions / goldEarned / 2.0) × 100`, capped at 100 | Damage output relative to gold spent |

### 2.3 Territorial / positional metrics — `ml/timeline_analysis.py`
Derived from per-frame map coordinates in the match timeline.

| Calculated Stat | How it's calculated | What it represents |
|---|---|---|
| `time_in_enemy_territory_pct` | Frames where `(x + y) > map_center + 1000` (blue) or `(x + y) < map_center - 1000` (red), divided by total frames | % of match time spent past the map centre into enemy territory |
| `forward_positioning_score` | Mean forward distance from map centre, normalised to 0–100 | How aggressively a player positions on average |
| `jungle_invasion_pct` | Frames where player is past the enemy jungle X-threshold, divided by total frames | % of time physically in the enemy jungle |
| `river_control_pct` | Frames within 2500 units of the map's main diagonal (river line), divided by total frames | % of time spent contesting the river |

### 2.4 Time-series deltas — `ml/timeline_analysis.py`
Calculated at each timeline frame (minute-by-minute series).

| Calculated Stat | Formula | What it represents |
|---|---|---|
| `goldDelta` | `myGold − avgGold` | Player gold vs. match average (all 10 players) |
| `xpDelta` | `myXp − avgXp` | Player XP vs. match average |
| `laneGoldDelta` | `myGold − enemyGold` | Direct gold lead over lane opponent |
| `laneXpDelta` | `myXp − enemyXp` | Direct XP lead over lane opponent |

### 2.5 Cross-match aggregated metrics — `routers/analysis.py`
Averaged across up to 21 recent matches by fetching each game's timeline.

| Calculated Stat | How it's calculated | What it represents |
|---|---|---|
| `laneGoldLeadAt14` | Average `laneGoldDelta` at minute 14 across recent matches | Typical gold lead over lane opponent by mid-game |
| `laneXpLeadAt14` | Average `laneXpDelta` at minute 14 across recent matches | Typical XP lead over lane opponent by mid-game |
| `laneLeadSampleSize` | Number of matches with valid timeline data | Sample size for the above two metrics |

### 2.6 Model training metrics — `ml/training.py`
Produced once per training run on a player's last 50 games.

| Calculated Stat | What it represents |
|---|---|
| `consistency_score` | `(1 − (std(goldPerMinute) / mean(goldPerMinute)) × 2) × 100` — inverse coefficient of variation; 100 = perfectly consistent GPM, 0 = very erratic |
| `feature_importance` | XGBoost `feature_importances_` for each of the 29 predictive features |
| `category_importance` | Aggregated importance summed per category (Early Game Leads, Vision Habits, etc.) |
| `performance_insights` per feature | `avg_when_winning`, `avg_when_losing`, `difference`, `percent_difference` |
| Win probability | Output of `XGBClassifier` + Platt scaling calibration on the 29 predictive features |
| `accuracy` | In-sample accuracy on the player's own match history |

---

## 3. Feature Classification Summary

| Category | Used for ML prediction? | Source |
|---|---|---|
| Early game leads (laning phase advantages) | ✅ Yes | Riot API `challenges` |
| Early game efficiency (CS at 10, plates) | ✅ Yes | Riot API `challenges` |
| Skillshot hit / dodge rates | ✅ Yes | Calculated from `challenges` + `lol_skillshots.json` |
| Vision habits (wards placed, control wards) | ✅ Yes | Riot API `challenges` |
| Communication habits (pings) | ✅ Yes | Riot API `challenges` |
| External context (AFK teammate) | ✅ Yes | Riot API `challenges` |
| Combat stats (kills, damage, gold) | ❌ Display only | Riot API participant / `challenges` |
| Objective stats (dragons, barons) | ❌ Display only | Riot API participant / `challenges` |
| Composite scores (aggression, vision dominance) | ❌ Display only | Calculated |
| Territorial / positional metrics | ❌ Display only | Calculated from timeline |
| Lane lead time-series | ❌ Display only | Calculated from timeline |
