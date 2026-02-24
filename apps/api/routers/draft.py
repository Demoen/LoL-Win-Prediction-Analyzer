"""
Draft analysis API router — champion list + real-time draft analysis.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ml.draft_inference import draft_analyzer
from services.ddragon import get_ddragon_version

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/draft", tags=["draft"])


# ---------------------------------------------------------------------------
# Request / Response schemas
# ---------------------------------------------------------------------------

class DraftAnalyzeRequest(BaseModel):
    blue_champions: list[int] = Field(default_factory=list, max_length=5)
    red_champions: list[int] = Field(default_factory=list, max_length=5)
    banned_champions: list[int] = Field(default_factory=list, max_length=10)
    user_side: str = Field(default="blue", pattern="^(blue|red)$")
    # The side currently making a pick/ban (may differ from user_side during red's turn)
    picking_side: Optional[str] = Field(default=None, pattern="^(blue|red|ban)$")


class ChampionInfo(BaseModel):
    id: int
    name: str
    win_rate: float
    pick_rate: float
    games: int
    icon_url: str = ""
    primary_role: str = ""
    viable_roles: list[str] = Field(default_factory=list)


class PickSuggestion(BaseModel):
    id: int
    name: str
    icon_url: str = ""
    win_probability: float
    win_delta: float
    synergy_score: float
    counter_score: float
    base_win_rate: float
    games_in_dataset: int
    role: Optional[str] = None
    viable_roles: list[str] = Field(default_factory=list)
    reason: str


class BanSuggestion(BaseModel):
    id: int
    name: str
    icon_url: str = ""
    threat_score: float
    base_win_rate: float
    pick_rate: float
    games_in_dataset: int
    role: str = ""
    reason: str


class SynergyDetail(BaseModel):
    ally_id: int
    ally_name: str
    games: int
    win_rate: float
    delta: float


class CounterDetail(BaseModel):
    enemy_id: int
    enemy_name: str
    games: int
    win_rate_vs: float


class RoleAssignment(BaseModel):
    champion_id: int
    champion_name: str
    assigned_role: str


class DraftAnalyzeResponse(BaseModel):
    win_probability: float
    suggested_picks: list[PickSuggestion]
    suggested_bans: list[BanSuggestion]
    synergies: list[SynergyDetail]
    counters: list[CounterDetail]
    ally_roles: list[RoleAssignment]
    enemy_roles: list[RoleAssignment]
    unfilled_roles: list[str]
    ddragon_version: str


class ChampionListResponse(BaseModel):
    champions: list[ChampionInfo]
    ddragon_version: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_DDRAGON_ICON_TEMPLATE = (
    "https://ddragon.leagueoflegends.com/cdn/{version}/img/champion/{name}.png"
)

# Champion names that differ between our dataset and DDragon naming
_DDRAGON_NAME_OVERRIDES: dict[str, str] = {
    "Wukong": "MonkeyKing",
    "Renata Glasc": "Renata",
    "Nunu & Willump": "Nunu",
    "K'Sante": "KSante",
    "Bel'Veth": "Belveth",
    "Kai'Sa": "Kaisa",
    "Kha'Zix": "Khazix",
    "LeBlanc": "Leblanc",
    "Vel'Koz": "Velkoz",
    "Cho'Gath": "Chogath",
    "Kog'Maw": "KogMaw",
    "Rek'Sai": "RekSai",
    "Xin Zhao": "XinZhao",
    "Lee Sin": "LeeSin",
    "Master Yi": "MasterYi",
    "Miss Fortune": "MissFortune",
    "Twisted Fate": "TwistedFate",
    "Jarvan IV": "JarvanIV",
    "Dr. Mundo": "DrMundo",
    "Tahm Kench": "TahmKench",
    "Aurelion Sol": "AurelionSol",
}


def _icon_url(name: str, version: str) -> str:
    """Build DDragon champion icon URL, handling name mismatches."""
    ddragon_name = _DDRAGON_NAME_OVERRIDES.get(name, name)
    # Remove spaces and special chars for DDragon compatibility
    ddragon_name = ddragon_name.replace(" ", "").replace("'", "")
    return _DDRAGON_ICON_TEMPLATE.format(version=version, name=ddragon_name)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/champions", response_model=ChampionListResponse)
async def get_champions():
    """Return all champions with stats and DDragon icon URLs."""
    _ensure_loaded()
    version = await get_ddragon_version()

    def _build_champion_list():
        champs = draft_analyzer.get_champion_list()
        return [
            ChampionInfo(
                id=c["id"],
                name=c["name"],
                win_rate=c["win_rate"],
                pick_rate=c["pick_rate"],
                games=c["games"],
                icon_url=_icon_url(c["name"], version),
                primary_role=c.get("primary_role", ""),
                viable_roles=c.get("viable_roles", []),
            )
            for c in champs
        ]

    result = await asyncio.to_thread(_build_champion_list)
    return ChampionListResponse(champions=result, ddragon_version=version)


@router.post("/analyze", response_model=DraftAnalyzeResponse)
async def analyze_draft(req: DraftAnalyzeRequest):
    """Analyse the current draft state and return win probability + suggestions."""
    _ensure_loaded()
    version = await get_ddragon_version()

    # Validate champion IDs (fast path — checked before spawning a thread)
    valid_ids = set(draft_analyzer.champion_ids)
    for cid in req.blue_champions + req.red_champions + req.banned_champions:
        if cid not in valid_ids:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown champion ID: {cid}",
            )

    # -------------------------------------------------------------------
    # All CPU-bound work runs inside a thread so the event loop stays free
    # to serve other requests concurrently.
    # -------------------------------------------------------------------
    def _compute() -> DraftAnalyzeResponse:
        # Determine ally / enemy from user perspective
        if req.user_side == "blue":
            ally = req.blue_champions
            enemy = req.red_champions
        else:
            ally = req.red_champions
            enemy = req.blue_champions

        # The side currently picking (may be the opponent's turn)
        # If not supplied, default to user's side
        picking_side = req.picking_side if req.picking_side and req.picking_side != "ban" else req.user_side

        # Determine which team is actively picking right now
        if picking_side == "blue":
            active_ally = req.blue_champions
            active_enemy = req.red_champions
        else:
            active_ally = req.red_champions
            active_enemy = req.blue_champions

        # Win probability (from user's perspective)
        blue_prob = draft_analyzer.predict_win_probability(
            req.blue_champions, req.red_champions
        )
        user_win_prob = blue_prob if req.user_side == "blue" else 1.0 - blue_prob

        # Damp toward 50% when few picks have been made — the model was trained on
        # full/near-full drafts and produces unreliable extremes on partial boards.
        # reliability reaches 1.0 at 8 total picks (both teams near-complete).
        total_picks = len(req.blue_champions) + len(req.red_champions)
        reliability = min(1.0, total_picks / 8.0)
        displayed_win_prob = 0.5 + (user_win_prob - 0.5) * reliability

        # Suggested picks — always for the side that is CURRENTLY picking
        picks_raw = draft_analyzer.suggest_best_picks(
            active_ally, active_enemy, req.banned_champions, picking_side, top_n=8
        )
        suggested_picks = [
            PickSuggestion(
                icon_url=_icon_url(p["name"], version),
                **p,
            )
            for p in picks_raw
        ]

        # Suggested bans — always for the side that is CURRENTLY banning
        # (use active picking side so ban suggestions are relevant)
        bans_raw = draft_analyzer.suggest_bans(
            active_ally, active_enemy, req.banned_champions, picking_side, top_n=8
        )
        suggested_bans = [
            BanSuggestion(
                icon_url=_icon_url(b["name"], version),
                **b,
            )
            for b in bans_raw
        ]

        # Synergy details — always for the currently-active team
        synergies: list[SynergyDetail] = []
        for cid in active_ally:
            others = [a for a in active_ally if a != cid]
            if others:
                syn = draft_analyzer.get_synergies(cid, others)
                synergies.extend([SynergyDetail(**s) for s in syn])

        # Counter details — for the currently-active team vs their enemy
        counters_list: list[CounterDetail] = []
        for cid in active_ally:
            if active_enemy:
                cnt = draft_analyzer.get_counters(cid, active_enemy)
                counters_list.extend([CounterDetail(**c) for c in cnt])

        # Role assignments (always shown from both teams' perspective)
        ally_role_assignments = draft_analyzer.get_team_role_assignments(active_ally)
        enemy_role_assignments = draft_analyzer.get_team_role_assignments(active_enemy)
        unfilled = list(draft_analyzer._get_unfilled_roles(active_ally))

        return DraftAnalyzeResponse(
            win_probability=round(displayed_win_prob * 100, 1),
            suggested_picks=suggested_picks,
            suggested_bans=suggested_bans,
            synergies=synergies,
            counters=counters_list,
            ally_roles=[RoleAssignment(**r) for r in ally_role_assignments],
            enemy_roles=[RoleAssignment(**r) for r in enemy_role_assignments],
            unfilled_roles=unfilled,
            ddragon_version=version,
        )

    return await asyncio.to_thread(_compute)


def _ensure_loaded() -> None:
    """Lazy-load the draft model (first request only)."""
    if not draft_analyzer._loaded:
        try:
            draft_analyzer.load()
        except FileNotFoundError:
            raise HTTPException(
                status_code=503,
                detail="Draft model not trained yet. Run `python -m ml.draft_model` first.",
            )
