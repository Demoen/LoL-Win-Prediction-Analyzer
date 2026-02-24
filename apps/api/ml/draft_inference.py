"""
Draft inference — loads the trained composition model and matrices,
provides real-time predictions and suggestions with role awareness.
"""

from __future__ import annotations

import json
import logging
import pickle
from pathlib import Path
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)

_HERE = Path(__file__).resolve().parent
_DATA_DIR = _HERE / "data"

MODEL_PATH = _DATA_DIR / "draft_model.pkl"
MATRICES_PATH = _DATA_DIR / "draft_matrices.json"
CHAMPION_MAP_PATH = _DATA_DIR / "champion_map.json"
CHAMPION_ROLES_PATH = _DATA_DIR / "champion_roles.json"

ROLES = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "SUPPORT"]


class DraftAnalyzer:
    """Singleton that loads the trained draft model and lookup matrices."""

    def __init__(self) -> None:
        self._loaded = False
        self.model = None
        self.champion_ids: list[int] = []
        self.champ_to_idx: dict[int, int] = {}
        self.n_champs: int = 0
        self.synergy: dict[str, dict] = {}
        self.counters: dict[str, dict] = {}
        self.champion_stats: dict[str, dict] = {}
        self.champion_names: dict[int, str] = {}
        self.champion_roles: dict[str, dict] = {}  # keyed by str(champ_id)

    def load(self) -> None:
        """Load model artefacts from disk. Call once at startup."""
        if self._loaded:
            return

        # Model
        with open(MODEL_PATH, "rb") as f:
            art = pickle.load(f)
        self.model = art["model"]
        self.champion_ids = art["champion_ids"]
        self.champ_to_idx = art["champ_to_idx"]
        self.n_champs = art["n_champs"]

        # Matrices
        with open(MATRICES_PATH) as f:
            matrices = json.load(f)
        self.synergy = matrices["synergy"]
        self.counters = matrices["counters"]
        self.champion_stats = matrices["champion_stats"]

        # Name map
        with open(CHAMPION_MAP_PATH) as f:
            raw = json.load(f)
        self.champion_names = {int(k): v for k, v in raw.items()}

        # Champion roles
        if CHAMPION_ROLES_PATH.exists():
            with open(CHAMPION_ROLES_PATH) as f:
                self.champion_roles = json.load(f)
            logger.info("Champion roles loaded: %d champions", len(self.champion_roles))
        else:
            logger.warning("champion_roles.json not found — role filtering disabled")

        self._loaded = True
        logger.info(
            "DraftAnalyzer loaded: %d champions, %d synergy pairs, %d counter pairs",
            self.n_champs,
            len(self.synergy),
            len(self.counters),
        )

    # ------------------------------------------------------------------
    # Core prediction
    # ------------------------------------------------------------------

    def _encode(self, blue: list[int], red: list[int]) -> np.ndarray:
        vec = np.zeros(2 * self.n_champs, dtype=np.float32)
        for cid in blue:
            idx = self.champ_to_idx.get(cid)
            if idx is not None:
                vec[idx] = 1.0
        for cid in red:
            idx = self.champ_to_idx.get(cid)
            if idx is not None:
                vec[self.n_champs + idx] = 1.0
        return vec

    def predict_win_probability(
        self, blue: list[int], red: list[int]
    ) -> float:
        """Return blue-side win probability (0-1).

        Works with partial drafts (empty lists OK → returns ~0.5).
        """
        if not blue and not red:
            return 0.5
        vec = self._encode(blue, red).reshape(1, -1)
        prob = float(self.model.predict_proba(vec)[0, 1])
        return prob

    # ------------------------------------------------------------------
    # Role helpers
    # ------------------------------------------------------------------

    def get_champion_role_info(self, cid: int) -> dict:
        """Return role info for a champion."""
        return self.champion_roles.get(str(cid), {
            "primary": "MIDDLE",
            "secondary": None,
            "viable_roles": ["MIDDLE"],
            "roles": {},
        })

    def _assign_roles(self, champ_ids: list[int]) -> dict[int, str]:
        """Greedily assign each picked champion to their best available role.

        Returns {champ_id: assigned_role}.
        """
        assignments: dict[int, str] = {}
        filled_roles: set[str] = set()

        # Build (champion, role_preferences) list sorted by specificity
        # Champions with fewer viable roles get assigned first (specialists first)
        champ_prefs: list[tuple[int, list[tuple[str, float]]]] = []
        for cid in champ_ids:
            info = self.get_champion_role_info(cid)
            roles = info.get("roles", {})
            sorted_roles = sorted(roles.items(), key=lambda x: x[1], reverse=True)
            champ_prefs.append((cid, sorted_roles))

        # Sort by number of viable roles (ascending) — specialists first
        champ_prefs.sort(key=lambda x: len(x[1]))

        for cid, prefs in champ_prefs:
            info = self.get_champion_role_info(cid)
            viable = set(info.get("viable_roles", []))
            assigned = False
            # First pass: only assign to viable roles (≥ threshold play rate)
            for role, rate in prefs:
                if role in viable and role in ROLES and role not in filled_roles:
                    assignments[cid] = role
                    filled_roles.add(role)
                    assigned = True
                    break
            if not assigned:
                # Second pass: allow any played role (handles rare flex edge-cases)
                for role, rate in prefs:
                    if role in ROLES and role not in filled_roles:
                        assignments[cid] = role
                        filled_roles.add(role)
                        assigned = True
                        break
            if not assigned:
                # Last resort: any unfilled standard role
                for role in ROLES:
                    if role not in filled_roles:
                        assignments[cid] = role
                        filled_roles.add(role)
                        break

        return assignments

    def _get_filled_roles(self, champ_ids: list[int]) -> set[str]:
        """Determine which roles are already filled by the given champions."""
        assignments = self._assign_roles(champ_ids)
        return set(assignments.values())

    def _get_unfilled_roles(self, champ_ids: list[int]) -> set[str]:
        """Determine which roles still need to be filled."""
        filled = self._get_filled_roles(champ_ids)
        return set(ROLES) - filled

    def _champion_fits_role(self, cid: int, needed_roles: set[str]) -> tuple[bool, str | None]:
        """Check if a champion can fill any of the needed roles.

        Returns (fits, best_fitting_role).
        """
        if not needed_roles:
            return True, None  # All roles filled, don't filter

        info = self.get_champion_role_info(cid)
        roles = info.get("roles", {})

        # Only match against viable roles (≥ threshold play rate).
        # This prevents low-sample suggestions like Jinx (MID 3%) showing up.
        viable = info.get("viable_roles", [])
        for role in viable:
            if role in needed_roles:
                return True, role

        return False, None

    # ------------------------------------------------------------------
    # Suggestions
    # ------------------------------------------------------------------

    def suggest_best_picks(
        self,
        ally_champs: list[int],
        enemy_champs: list[int],
        banned: list[int],
        user_side: str,
        top_n: int = 5,
    ) -> list[dict]:
        """Suggest the best champion to pick next for the user's side.

        Role-aware: only suggests champions for unfilled roles.
        Simulates adding each candidate and ranks by win-prob delta.
        """
        taken = set(ally_champs) | set(enemy_champs) | set(banned) | {0}
        candidates = [cid for cid in self.champion_ids if cid not in taken]

        # Determine unfilled roles
        unfilled = self._get_unfilled_roles(ally_champs)
        ally_assignments = self._assign_roles(ally_champs)

        if user_side == "blue":
            base_blue, base_red = list(ally_champs), list(enemy_champs)
        else:
            base_blue, base_red = list(enemy_champs), list(ally_champs)

        base_prob = self.predict_win_probability(base_blue, base_red)

        results = []
        for cid in candidates:
            # Role filtering: only suggest champions that fit unfilled roles
            if unfilled:
                fits, best_role = self._champion_fits_role(cid, unfilled)
                if not fits:
                    continue
            else:
                best_role = self.get_champion_role_info(cid).get("primary", "MIDDLE")

            if user_side == "blue":
                test_blue = base_blue + [cid]
                test_red = base_red
            else:
                test_blue = base_blue
                test_red = base_red + [cid]

            prob = self.predict_win_probability(test_blue, test_red)
            user_prob = prob if user_side == "blue" else 1.0 - prob
            base_user_prob = base_prob if user_side == "blue" else 1.0 - base_prob
            delta = user_prob - base_user_prob

            # Synergy score with allies
            syn_score = self._synergy_score(cid, ally_champs)
            # Counter score against enemies
            cnt_score = self._counter_score(cid, enemy_champs)

            stats = self.champion_stats.get(str(cid), {})
            role_info = self.get_champion_role_info(cid)
            reason = self._build_pick_reason(cid, ally_champs, enemy_champs, syn_score, cnt_score, best_role)

            results.append({
                "id": cid,
                "name": self.champion_names.get(cid, f"Champion_{cid}"),
                "win_probability": round(user_prob * 100, 1),
                "win_delta": round(delta * 100, 1),
                "synergy_score": round(syn_score, 3),
                "counter_score": round(cnt_score, 3),
                "base_win_rate": round(stats.get("win_rate", 0.5) * 100, 1),
                "games_in_dataset": stats.get("games", 0),
                "role": best_role,
                "viable_roles": role_info.get("viable_roles", []),
                "reason": reason,
            })

        # Sort by composite score: prioritise matchup quality, reduce raw-model bias.
        #   40% synergy with allies  (absolute value, scaled)
        #   40% counter vs enemies   (absolute value, scaled)
        #   20% model win delta      (kept low to avoid popular-champ bias)
        # When there are no allies yet (first pick) we fall back to model delta only.
        if results:
            max_delta = max(abs(r["win_delta"]) for r in results) or 1
            max_syn = max(abs(r["synergy_score"]) for r in results) or 1
            max_cnt = max(abs(r["counter_score"]) for r in results) or 1

            has_allies = len(ally_champs) > 0
            has_enemies = len(enemy_champs) > 0

            for r in results:
                syn_w = 0.40 if has_allies else 0.0
                cnt_w = 0.40 if has_enemies else 0.0
                delta_w = 1.0 - syn_w - cnt_w  # fills the rest

                r["_score"] = (
                    delta_w * (r["win_delta"] / max_delta)
                    + syn_w  * (r["synergy_score"] / max_syn)
                    + cnt_w  * (r["counter_score"] / max_cnt)
                )

        results.sort(key=lambda x: x.get("_score", 0), reverse=True)
        # Clean up internal score
        for r in results:
            r.pop("_score", None)

        return results[:top_n]

    def suggest_bans(
        self,
        ally_champs: list[int],
        enemy_champs: list[int],
        already_banned: list[int],
        user_side: str,
        top_n: int = 5,
    ) -> list[dict]:
        """Suggest champions to ban — those that would hurt the user most if
        picked by the enemy.

        Role-aware: considers what roles the enemy still needs.
        """
        taken = set(ally_champs) | set(enemy_champs) | set(already_banned) | {0}
        candidates = [cid for cid in self.champion_ids if cid not in taken]

        # Determine what roles the enemy still needs
        enemy_unfilled = self._get_unfilled_roles(enemy_champs)

        if user_side == "blue":
            base_blue, base_red = list(ally_champs), list(enemy_champs)
        else:
            base_blue, base_red = list(enemy_champs), list(ally_champs)

        base_prob = self.predict_win_probability(base_blue, base_red)
        base_user_prob = base_prob if user_side == "blue" else 1.0 - base_prob

        results = []
        for cid in candidates:
            # Simulate enemy picking this champion
            if user_side == "blue":
                test_blue = base_blue
                test_red = base_red + [cid]
            else:
                test_blue = base_blue + [cid]
                test_red = base_red

            prob = self.predict_win_probability(test_blue, test_red)
            user_prob = prob if user_side == "blue" else 1.0 - prob
            threat = base_user_prob - user_prob  # how much user's WR drops

            # Boost threat for champions that fill enemy's needed roles
            role_info = self.get_champion_role_info(cid)
            fits_enemy, enemy_role = self._champion_fits_role(cid, enemy_unfilled)
            role_boost = 1.2 if fits_enemy else 0.6  # Champions unlikely to be picked by enemy are less ban-worthy

            stats = self.champion_stats.get(str(cid), {})
            adjusted_threat = threat * role_boost

            results.append({
                "id": cid,
                "name": self.champion_names.get(cid, f"Champion_{cid}"),
                "threat_score": round(adjusted_threat * 100, 1),
                "base_win_rate": round(stats.get("win_rate", 0.5) * 100, 1),
                "pick_rate": round(stats.get("pick_rate", 0) * 100, 1),
                "games_in_dataset": stats.get("games", 0),
                "role": role_info.get("primary", "MIDDLE"),
                "reason": f"High threat — banning {self.champion_names.get(cid, '')} removes {round(adjusted_threat * 100, 1)}% enemy advantage",
            })

        results.sort(key=lambda x: x["threat_score"], reverse=True)
        return results[:top_n]

    def get_synergies(
        self, champ_id: int, ally_champs: list[int]
    ) -> list[dict]:
        """Pairwise synergy info between champ_id and each ally."""
        result = []
        for ally in ally_champs:
            a, b = sorted([champ_id, ally])
            key = f"{a}_{b}"
            syn = self.synergy.get(key, {})
            result.append({
                "ally_id": ally,
                "ally_name": self.champion_names.get(ally, ""),
                "games": syn.get("games", 0),
                "win_rate": round(syn.get("win_rate", 0.5) * 100, 1),
                "delta": round(syn.get("delta", 0) * 100, 1),
            })
        return result

    def get_counters(
        self, champ_id: int, enemy_champs: list[int]
    ) -> list[dict]:
        """Pairwise counter info between champ_id and each enemy."""
        result = []
        for enemy in enemy_champs:
            key = f"{champ_id}_vs_{enemy}"
            cnt = self.counters.get(key, {})
            result.append({
                "enemy_id": enemy,
                "enemy_name": self.champion_names.get(enemy, ""),
                "games": cnt.get("games", 0),
                "win_rate_vs": round(cnt.get("win_rate_a", 0.5) * 100, 1),
            })
        return result

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _synergy_score(self, cid: int, allies: list[int]) -> float:
        """Average synergy delta with all current allies."""
        if not allies:
            return 0.0
        deltas = []
        for ally in allies:
            a, b = sorted([cid, ally])
            key = f"{a}_{b}"
            syn = self.synergy.get(key)
            if syn:
                deltas.append(syn["delta"])
        return sum(deltas) / len(deltas) if deltas else 0.0

    def _counter_score(self, cid: int, enemies: list[int]) -> float:
        """Average win-rate advantage against current enemies."""
        if not enemies:
            return 0.0
        scores = []
        for enemy in enemies:
            key = f"{cid}_vs_{enemy}"
            cnt = self.counters.get(key)
            if cnt:
                scores.append(cnt["win_rate_a"] - 0.5)
        return sum(scores) / len(scores) if scores else 0.0

    def _build_pick_reason(
        self, cid: int,
        allies: list[int],
        enemies: list[int],
        syn_score: float,
        cnt_score: float,
        role: str | None = None,
    ) -> str:
        name = self.champion_names.get(cid, "This champion")
        parts = []
        if role:
            parts.append(f"fills {role}")
        if syn_score > 0.02:
            parts.append(f"strong synergy with your team (+{round(syn_score*100,1)}%)")
        if cnt_score > 0.02:
            parts.append(f"counters enemy picks (+{round(cnt_score*100,1)}%)")
        stats = self.champion_stats.get(str(cid), {})
        wr = stats.get("win_rate", 0.5)
        if wr > 0.52:
            parts.append(f"{round(wr*100,1)}% overall win rate")
        if not parts:
            parts.append("solid overall composition fit")
        return f"{name}: {', '.join(parts)}"

    def get_all_champion_ids(self) -> list[int]:
        """Return all valid champion IDs (excludes 0 = No Champion)."""
        return [cid for cid in self.champion_ids if cid != 0]

    def get_champion_list(self) -> list[dict]:
        """Return a list of all champions with their stats and role info for the UI."""
        result = []
        for cid in self.champion_ids:
            if cid == 0:
                continue
            stats = self.champion_stats.get(str(cid), {})
            role_info = self.get_champion_role_info(cid)
            result.append({
                "id": cid,
                "name": self.champion_names.get(cid, f"Champion_{cid}"),
                "win_rate": round(stats.get("win_rate", 0.5) * 100, 1),
                "pick_rate": round(stats.get("pick_rate", 0) * 100, 1),
                "games": stats.get("games", 0),
                "primary_role": role_info.get("primary", "MIDDLE"),
                "viable_roles": role_info.get("viable_roles", []),
            })
        return result

    def get_team_role_assignments(self, champ_ids: list[int]) -> list[dict]:
        """Return role assignments for a team, for use in the API response."""
        assignments = self._assign_roles(champ_ids)
        unfilled = self._get_unfilled_roles(champ_ids)
        result = []
        for cid in champ_ids:
            role = assignments.get(cid, "UNKNOWN")
            result.append({
                "champion_id": cid,
                "champion_name": self.champion_names.get(cid, ""),
                "assigned_role": role,
            })
        return result


# Module-level singleton, loaded lazily
draft_analyzer = DraftAnalyzer()
