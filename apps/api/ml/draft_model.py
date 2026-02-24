"""
Draft composition model — trains an XGBoost classifier on 214K+ matches
from TeamMatchTbl.csv to predict win probability from champion compositions.

Also pre-computes:
  - champion synergy matrix  (ally pair → win-rate delta)
  - champion counter matrix   (enemy pair → win-rate delta)
  - per-champion base stats   (win rate, pick rate, avg kills/deaths)

Run standalone:
    cd apps/api
    python -m ml.draft_model
"""

from __future__ import annotations

import json
import logging
import os
import pickle
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.model_selection import train_test_split
from xgboost import XGBClassifier

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
_HERE = Path(__file__).resolve().parent
_DATA_DIR = _HERE / "data"
_DATASET_DIR = _HERE.parent.parent.parent / "dataset"

MODEL_PATH = _DATA_DIR / "draft_model.pkl"
MATRICES_PATH = _DATA_DIR / "draft_matrices.json"
CHAMPION_MAP_PATH = _DATA_DIR / "champion_map.json"
CHAMPION_ROLES_PATH = _DATA_DIR / "champion_roles.json"

BLUE_CHAMP_COLS = [f"B{i}Champ" for i in range(1, 6)]
RED_CHAMP_COLS = [f"R{i}Champ" for i in range(1, 6)]

ROLES = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "SUPPORT"]

# ---------------------------------------------------------------------------
# Curated champion role overrides
# ---------------------------------------------------------------------------
# The Riot API returns "BOTTOM" for both ADC and Support players, causing the
# dataset's statistical role inference to be unreliable for bot-lane champions.
# These overrides define the ground-truth viable roles for each champion, taking
# precedence over the dataset-derived statistics. Keep in alphabetical order.
CHAMPION_ROLE_OVERRIDES: dict[str, list[str]] = {
    # ── Pure supports (never legitimately played as ADC) ─────────────────────
    "Alistar":    ["SUPPORT"],
    "Bard":       ["SUPPORT"],
    "Blitzcrank": ["SUPPORT"],
    "Braum":      ["SUPPORT"],
    "Janna":      ["SUPPORT"],
    "Leona":      ["SUPPORT"],
    "Lulu":       ["SUPPORT"],
    "Milio":      ["SUPPORT"],
    "Nami":       ["SUPPORT"],
    "Nautilus":   ["SUPPORT"],
    "Rakan":      ["SUPPORT"],
    "Rell":       ["SUPPORT"],
    "Sona":       ["SUPPORT"],
    "Soraka":     ["SUPPORT"],
    "Taric":      ["SUPPORT"],
    "Thresh":     ["SUPPORT"],
    "Yuumi":      ["SUPPORT"],
    # ── Support-primary with real secondary lanes ─────────────────────────────
    "Brand":      ["SUPPORT", "MIDDLE"],
    "Elise":      ["JUNGLE"],            # dataset noise adds SUPPORT/BOTTOM
    "Karma":      ["SUPPORT", "MIDDLE", "TOP"],
    "Lux":        ["SUPPORT", "MIDDLE"],
    "Mel":        ["MIDDLE", "SUPPORT"],
    "Morgana":    ["SUPPORT", "MIDDLE"],
    "Neeko":      ["SUPPORT", "MIDDLE"],
    "Poppy":      ["TOP", "SUPPORT", "JUNGLE"],
    "Pyke":       ["SUPPORT", "MIDDLE"],
    "Renata":     ["SUPPORT"],
    "Seraphine":  ["SUPPORT", "MIDDLE"],
    "Swain":      ["SUPPORT", "MIDDLE", "TOP"],
    "TahmKench":  ["SUPPORT", "TOP"],
    "Velkoz":     ["SUPPORT", "MIDDLE"],
    "Xerath":     ["SUPPORT", "MIDDLE"],
    "Zilean":     ["SUPPORT", "MIDDLE"],
    "Zyra":       ["SUPPORT", "MIDDLE"],
    # ── ADCs with false positive non-BOTTOM roles ─────────────────────────────
    "Kalista":    ["BOTTOM"],
    "KogMaw":     ["BOTTOM"],
    "Varus":      ["BOTTOM", "MIDDLE"],   # Varus mid (lethality) is real
    # ── Champions with misleading primary role from dataset ───────────────────
    "Jayce":      ["TOP", "MIDDLE"],      # dataset shows JUNGLE as primary
    "Malphite":   ["TOP", "SUPPORT"],     # dataset shows JUNGLE as primary
    "Senna":      ["BOTTOM", "SUPPORT"],  # flex pick — keep both
}


# ---------------------------------------------------------------------------
# Data loading helpers
# ---------------------------------------------------------------------------

def _load_champions() -> dict[int, str]:
    """Return {champion_id: champion_name} from ChampionTbl.csv."""
    df = pd.read_csv(_DATASET_DIR / "ChampionTbl.csv")
    return dict(zip(df["ChampionId"].astype(int), df["ChampionName"].astype(str)))


def _load_team_matches() -> pd.DataFrame:
    """Load TeamMatchTbl.csv with only the columns we need."""
    cols = (
        ["MatchFk"]
        + BLUE_CHAMP_COLS
        + RED_CHAMP_COLS
        + ["BlueWin", "RedWin"]
    )
    df = pd.read_csv(_DATASET_DIR / "TeamMatchTbl.csv", usecols=cols)
    # Drop rows where any champion slot is 0 ("No Champion") — remakes / invalid
    for c in BLUE_CHAMP_COLS + RED_CHAMP_COLS:
        df = df[df[c] != 0]
    return df.reset_index(drop=True)


def _build_champion_roles(champ_names: dict[int, str]) -> dict[str, dict]:
    """Mine champion → role distribution from MatchStatsTbl + SummonerMatchTbl.

    Returns dict keyed by champion ID (str) with structure:
    {
        "name": "Ahri",
        "roles": {"MIDDLE": 0.88, "TOP": 0.063, ...},
        "primary": "MIDDLE",
        "secondary": "TOP" | null,
        "viable_roles": ["MIDDLE"]
    }

    A champion is "viable" in a role if ≥10% of their games are in that role.
    """
    stats = pd.read_csv(_DATASET_DIR / "MatchStatsTbl.csv", usecols=["SummonerMatchFk", "Lane"])
    smatch = pd.read_csv(_DATASET_DIR / "SummonerMatchTbl.csv", usecols=["SummonerMatchId", "ChampionFk"])

    merged = stats.merge(smatch, left_on="SummonerMatchFk", right_on="SummonerMatchId")

    # Normalize lane names
    merged["Lane"] = merged["Lane"].replace({"UTILITY": "SUPPORT", "NONE": None})
    merged = merged.dropna(subset=["Lane"])
    # Keep only standard 5 roles
    merged = merged[merged["Lane"].isin(ROLES)]

    role_counts = merged.groupby(["ChampionFk", "Lane"]).size().reset_index(name="count")
    totals = merged.groupby("ChampionFk").size().reset_index(name="total")
    role_counts = role_counts.merge(totals, on="ChampionFk")
    role_counts["rate"] = role_counts["count"] / role_counts["total"]

    VIABLE_THRESHOLD = 0.15  # 15% minimum to be considered viable in a role

    result: dict[str, dict] = {}
    for cid in role_counts["ChampionFk"].unique():
        cid_int = int(cid)
        rows = role_counts[role_counts["ChampionFk"] == cid].sort_values("rate", ascending=False)

        roles_dict: dict[str, float] = {}
        for _, r in rows.iterrows():
            roles_dict[r["Lane"]] = round(float(r["rate"]), 4)

        sorted_roles = sorted(roles_dict.items(), key=lambda x: x[1], reverse=True)
        primary = sorted_roles[0][0] if sorted_roles else "MIDDLE"
        secondary = sorted_roles[1][0] if len(sorted_roles) > 1 and sorted_roles[1][1] >= VIABLE_THRESHOLD else None
        viable = [role for role, rate in sorted_roles if rate >= VIABLE_THRESHOLD]

        result[str(cid_int)] = {
            "name": champ_names.get(cid_int, f"Champion_{cid_int}"),
            "roles": roles_dict,
            "primary": primary,
            "secondary": secondary,
            "viable_roles": viable,
        }

    # Apply curated overrides — corrects for Riot API returning "BOTTOM"
    # for both ADC and Support, which corrupts the statistical role inference.
    for entry in result.values():
        name = entry["name"]
        if name in CHAMPION_ROLE_OVERRIDES:
            override_viable = CHAMPION_ROLE_OVERRIDES[name]
            entry["viable_roles"] = override_viable
            entry["primary"] = override_viable[0]
            entry["secondary"] = override_viable[1] if len(override_viable) > 1 else None

    logger.info("Champion role mappings built for %d champions", len(result))
    return result


# ---------------------------------------------------------------------------
# Feature engineering
# ---------------------------------------------------------------------------

def _build_champion_universe(df: pd.DataFrame) -> list[int]:
    """Sorted list of all champion IDs appearing in the dataset."""
    ids: set[int] = set()
    for c in BLUE_CHAMP_COLS + RED_CHAMP_COLS:
        ids.update(df[c].unique())
    return sorted(ids)


def _encode_composition(
    blue_ids: list[int],
    red_ids: list[int],
    champ_to_idx: dict[int, int],
    n_champs: int,
) -> np.ndarray:
    """Return a 1-D binary feature vector of length 2*n_champs.

    First n_champs slots: 1 if champion present on blue side.
    Next  n_champs slots: 1 if champion present on red side.
    """
    vec = np.zeros(2 * n_champs, dtype=np.float32)
    for cid in blue_ids:
        idx = champ_to_idx.get(cid)
        if idx is not None:
            vec[idx] = 1.0
    for cid in red_ids:
        idx = champ_to_idx.get(cid)
        if idx is not None:
            vec[n_champs + idx] = 1.0
    return vec


def _build_feature_matrix(
    df: pd.DataFrame,
    champ_to_idx: dict[int, int],
    n_champs: int,
) -> tuple[np.ndarray, np.ndarray]:
    """Return (X, y) arrays for training."""
    blue_arr = df[BLUE_CHAMP_COLS].values
    red_arr = df[RED_CHAMP_COLS].values
    y = df["BlueWin"].values.astype(np.float32)

    X = np.zeros((len(df), 2 * n_champs), dtype=np.float32)
    for i in range(len(df)):
        for cid in blue_arr[i]:
            idx = champ_to_idx.get(int(cid))
            if idx is not None:
                X[i, idx] = 1.0
        for cid in red_arr[i]:
            idx = champ_to_idx.get(int(cid))
            if idx is not None:
                X[i, n_champs + idx] = 1.0
    return X, y


# ---------------------------------------------------------------------------
# Synergy / counter matrices
# ---------------------------------------------------------------------------

def _compute_synergy_matrix(df: pd.DataFrame, champion_ids: list[int]) -> dict:
    """Compute ally-pair synergy: win-rate when both on the same team.

    Returns dict[f"{id_a}_{id_b}"] → { games, wins, win_rate }
    Only stores pairs with >= 30 co-occurrences.
    """
    from itertools import combinations

    synergy: dict[tuple[int, int], list[int]] = {}  # pair → [wins, games]

    for side_cols, win_col in [
        (BLUE_CHAMP_COLS, "BlueWin"),
        (RED_CHAMP_COLS, "RedWin"),
    ]:
        side_arr = df[side_cols].values
        wins = df[win_col].values
        for i in range(len(df)):
            champs = sorted(int(c) for c in side_arr[i])
            w = int(wins[i])
            for pair in combinations(champs, 2):
                if pair not in synergy:
                    synergy[pair] = [0, 0]
                synergy[pair][0] += w
                synergy[pair][1] += 1

    # Compute overall per-champion win rates for delta calculation
    champ_wr = _per_champion_win_rates(df, champion_ids)

    result: dict[str, dict] = {}
    for (a, b), (w, g) in synergy.items():
        if g < 30:
            continue
        pair_wr = w / g
        expected = (champ_wr.get(a, 0.5) + champ_wr.get(b, 0.5)) / 2
        result[f"{a}_{b}"] = {
            "games": g,
            "wins": w,
            "win_rate": round(pair_wr, 4),
            "delta": round(pair_wr - expected, 4),
        }
    return result


def _compute_counter_matrix(df: pd.DataFrame, champion_ids: list[int]) -> dict:
    """Compute cross-team matchup stats: how a champion performs against another.

    For each ordered pair (champ_a_on_blue, champ_b_on_red):
      - games where a is on blue and b is on red
      - blue wins in those games

    Returns dict[f"{a}_vs_{b}"] → { games, wins_for_a, win_rate_a }
    Only stores pairs with >= 20 co-occurrences.
    """
    counter: dict[tuple[int, int], list[int]] = {}  # (a, b) → [a_wins, games]

    blue_arr = df[BLUE_CHAMP_COLS].values
    red_arr = df[RED_CHAMP_COLS].values
    blue_wins = df["BlueWin"].values

    for i in range(len(df)):
        b_champs = [int(c) for c in blue_arr[i]]
        r_champs = [int(c) for c in red_arr[i]]
        bw = int(blue_wins[i])
        for a in b_champs:
            for b in r_champs:
                key = (a, b)
                if key not in counter:
                    counter[key] = [0, 0]
                counter[key][0] += bw
                counter[key][1] += 1

    # Also add red-perspective (b on red vs a on blue → invert)
    # Already captured above; we also want (b plays, a is enemy) perspective
    # So add the reverse: for red champs vs blue champs
    red_wins_vals = df["RedWin"].values
    for i in range(len(df)):
        b_champs = [int(c) for c in blue_arr[i]]
        r_champs = [int(c) for c in red_arr[i]]
        rw = int(red_wins_vals[i])
        for a in r_champs:
            for b in b_champs:
                key = (a, b)
                if key not in counter:
                    counter[key] = [0, 0]
                counter[key][0] += rw
                counter[key][1] += 1

    result: dict[str, dict] = {}
    for (a, b), (w, g) in counter.items():
        if g < 20:
            continue
        wr = w / g
        result[f"{a}_vs_{b}"] = {
            "games": g,
            "wins_for_a": w,
            "win_rate_a": round(wr, 4),
        }
    return result


def _per_champion_win_rates(
    df: pd.DataFrame, champion_ids: list[int]
) -> dict[int, float]:
    """Overall win rate per champion across both sides."""
    stats: dict[int, list[int]] = {}  # cid → [wins, games]
    for side_cols, win_col in [
        (BLUE_CHAMP_COLS, "BlueWin"),
        (RED_CHAMP_COLS, "RedWin"),
    ]:
        arr = df[side_cols].values
        wins = df[win_col].values
        for i in range(len(df)):
            for cid_raw in arr[i]:
                cid = int(cid_raw)
                if cid not in stats:
                    stats[cid] = [0, 0]
                stats[cid][0] += int(wins[i])
                stats[cid][1] += 1

    return {cid: s[0] / s[1] if s[1] > 0 else 0.5 for cid, s in stats.items()}


def _build_champion_stats(
    df: pd.DataFrame, champion_ids: list[int], champ_names: dict[int, str]
) -> dict[str, dict]:
    """Per-champion aggregate stats for the UI."""
    total_matches = len(df) * 2  # each row has blue + red
    stats: dict[int, list[int]] = {}  # cid → [wins, games]

    for side_cols, win_col in [
        (BLUE_CHAMP_COLS, "BlueWin"),
        (RED_CHAMP_COLS, "RedWin"),
    ]:
        arr = df[side_cols].values
        wins = df[win_col].values
        for i in range(len(df)):
            for cid_raw in arr[i]:
                cid = int(cid_raw)
                if cid not in stats:
                    stats[cid] = [0, 0]
                stats[cid][0] += int(wins[i])
                stats[cid][1] += 1

    result: dict[str, dict] = {}
    for cid in champion_ids:
        s = stats.get(cid, [0, 0])
        result[str(cid)] = {
            "id": int(cid),
            "name": champ_names.get(cid, f"Champion_{cid}"),
            "games": int(s[1]),
            "wins": int(s[0]),
            "win_rate": round(s[0] / s[1], 4) if s[1] > 0 else 0.5,
            "pick_rate": round(s[1] / total_matches, 4) if total_matches > 0 else 0,
        }
    return result


# ---------------------------------------------------------------------------
# Training
# ---------------------------------------------------------------------------

def train_draft_model() -> dict:
    """Train the composition-based model and persist artefacts.

    Returns a summary dict with metrics.
    """
    logger.info("Loading dataset …")
    df = _load_team_matches()
    champ_names = _load_champions()
    champion_ids = _build_champion_universe(df)
    n_champs = len(champion_ids)
    champ_to_idx = {cid: i for i, cid in enumerate(champion_ids)}

    logger.info(
        "Dataset: %d matches, %d unique champions, %d features",
        len(df), n_champs, 2 * n_champs,
    )

    # Build X, y
    X, y = _build_feature_matrix(df, champ_to_idx, n_champs)

    # Train/test split
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    # XGBoost
    xgb = XGBClassifier(
        n_estimators=300,
        max_depth=6,
        learning_rate=0.08,
        subsample=0.8,
        colsample_bytree=0.8,
        eval_metric="logloss",
        use_label_encoder=False,
        random_state=42,
        n_jobs=-1,
    )
    xgb.fit(X_train, y_train)

    # Calibrate probabilities
    calibrated = CalibratedClassifierCV(xgb, cv=3, method="sigmoid")
    calibrated.fit(X_train, y_train)

    # Evaluate
    from sklearn.metrics import accuracy_score, log_loss, roc_auc_score

    y_pred = calibrated.predict(X_test)
    y_prob = calibrated.predict_proba(X_test)[:, 1]
    acc = accuracy_score(y_test, y_pred)
    ll = log_loss(y_test, y_prob)
    auc = roc_auc_score(y_test, y_prob)

    logger.info("Accuracy: %.4f  |  Log-loss: %.4f  |  AUC: %.4f", acc, ll, auc)

    # Persist model
    _DATA_DIR.mkdir(parents=True, exist_ok=True)

    model_artefact = {
        "model": calibrated,
        "champion_ids": champion_ids,
        "champ_to_idx": champ_to_idx,
        "n_champs": n_champs,
    }
    with open(MODEL_PATH, "wb") as f:
        pickle.dump(model_artefact, f)
    logger.info("Model saved → %s", MODEL_PATH)

    # Compute matrices
    logger.info("Computing synergy matrix …")
    synergy = _compute_synergy_matrix(df, champion_ids)
    logger.info("Synergy pairs: %d", len(synergy))

    logger.info("Computing counter matrix …")
    counters = _compute_counter_matrix(df, champion_ids)
    logger.info("Counter pairs: %d", len(counters))

    # Champion stats
    champ_stats = _build_champion_stats(df, champion_ids, champ_names)

    matrices = {
        "synergy": synergy,
        "counters": counters,
        "champion_stats": champ_stats,
    }
    with open(MATRICES_PATH, "w") as f:
        json.dump(matrices, f)
    logger.info("Matrices saved → %s", MATRICES_PATH)

    # Champion ID→name map (needed by API)
    with open(CHAMPION_MAP_PATH, "w") as f:
        json.dump({str(k): v for k, v in champ_names.items()}, f)
    logger.info("Champion map saved → %s", CHAMPION_MAP_PATH)

    # Champion roles
    logger.info("Building champion role mappings …")
    champion_roles = _build_champion_roles(champ_names)
    with open(CHAMPION_ROLES_PATH, "w") as f:
        json.dump(champion_roles, f)
    logger.info("Champion roles saved → %s  (%d champions)", CHAMPION_ROLES_PATH, len(champion_roles))

    return {
        "matches": len(df),
        "champions": n_champs,
        "accuracy": round(acc, 4),
        "log_loss": round(ll, 4),
        "auc": round(auc, 4),
        "synergy_pairs": len(synergy),
        "counter_pairs": len(counters),
    }


# ---------------------------------------------------------------------------
if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s  %(levelname)-8s  %(message)s",
    )
    summary = train_draft_model()
    print("\n✅  Training complete")
    for k, v in summary.items():
        print(f"   {k}: {v}")
