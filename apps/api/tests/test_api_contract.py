from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any, Dict, List, Literal, Optional, Union

import pandas as pd
from pydantic import BaseModel, Field


class ProgressEvent(BaseModel):
    type: Literal["progress"]
    message: str
    percent: Union[int, float]
    stage: Optional[str] = None
    limits: Optional[Dict[str, Any]] = None


class ErrorEvent(BaseModel):
    type: Literal["error"]
    message: str


class AnalysisUser(BaseModel):
    game_name: str
    tag_line: str
    region: str
    profile_icon_id: int
    summoner_level: int
    puuid: str


class HeatmapPosition(BaseModel):
    x: float
    y: float
    timestamp: int
    totalGold: Union[int, float]
    goldDelta: Union[int, float]


class HeatmapParticipant(BaseModel):
    participantId: int
    championName: str
    teamId: int
    positions: List[HeatmapPosition]


class HeatmapKillEvent(BaseModel):
    x: float
    y: float
    killerId: int
    victimId: int
    assistingParticipantIds: List[int]
    timestamp: int


class HeatmapWardEvent(BaseModel):
    x: float
    y: float
    wardType: str
    creatorId: int
    timestamp: int


class HeatmapData(BaseModel):
    participants: List[HeatmapParticipant]
    kill_events: List[HeatmapKillEvent]
    ward_events: List[HeatmapWardEvent]


class AnalysisResultData(BaseModel):
    status: str
    user: AnalysisUser
    metrics: Dict[str, Any] = Field(default_factory=dict)
    win_probability: Union[int, float]
    win_rate: Union[int, float]
    total_matches: int
    player_moods: List[Any]
    weighted_averages: Dict[str, Any]
    last_match_stats: Dict[str, Any]
    enemy_stats: Dict[str, Any]
    win_drivers: List[Any]
    skill_focus: List[Any]
    match_timeline_series: Any
    performance_trends: List[Any]
    territory_metrics: Any
    ranked_data: Any
    ddragon_version: str
    heatmap_data: Optional[HeatmapData]


class ResultEvent(BaseModel):
    type: Literal["result"]
    data: AnalysisResultData


AnalyzeEvent = Union[ProgressEvent, ErrorEvent, ResultEvent]


def _parse_ndjson_lines(raw_lines: List[object]) -> List[dict]:
    events: List[dict] = []
    for line in raw_lines:
        if not line:
            continue
        if isinstance(line, bytes):
            text = line.decode("utf-8")
        else:
            text = str(line)
        obj = json.loads(text)
        assert isinstance(obj, dict)
        events.append(obj)
    return events


def test_health_contract(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    data = r.json()
    assert set(data.keys()) >= {"status", "version"}
    assert data["status"] == "ok"
    assert isinstance(data["version"], str) and data["version"]


def test_analyze_rejects_invalid_riot_id(client):
    r = client.post("/api/analyze", json={"riot_id": "NoHashHere", "region": "euw1"})
    assert r.status_code == 400
    body = r.json()
    assert body.get("detail") == "Invalid Riot ID format"


def test_analyze_stream_contract_offline(client, monkeypatch):
    import routers.analysis as analysis

    class FakeIngestionService:
        def __init__(self, db):  # noqa: ANN001
            self.db = db

        async def get_or_update_user(self, region_routing: str, platform_region: str, game_name: str, tag_line: str):
            return SimpleNamespace(
                puuid="test-puuid",
                game_name=game_name,
                tag_line=tag_line,
                region=platform_region,
                profile_icon_id=123,
                summoner_level=456,
            )

        async def ingest_match_history_generator(self, user, count: int = 20):  # noqa: ANN001
            yield {"current": 1, "total": 2, "status": "Ingesting match 1/2"}
            yield {"current": 2, "total": 2, "status": "Ingesting match 2/2"}

    class FakeModel:
        def train(self, df):  # noqa: ANN001
            return {"ok": True}

        def calculate_weighted_averages(self, df):  # noqa: ANN001
            return {"kda": 3.2, "visionScore": 25}

        def analyze_player_mood(self, df):  # noqa: ANN001
            return [{"label": "stable", "score": 0.7}]

        def predict_win_probability(self, last_match_stats: dict):
            return 60.0

        def get_win_driver_insights(self, df, last_match_stats: dict, enemy_stats: dict):  # noqa: ANN001
            return [{"driver": "vision", "impact": 0.2}]

        def get_skill_focus(self, df, last_match_stats: dict, enemy_stats: dict):  # noqa: ANN001
            return [{"focus": "cs", "tip": "Aim for 7+ CS/min"}]

    class FakeRiotService:
        async def get_league_entries(self, league_region: str, puuid: str):
            return [
                {
                    "queueType": "RANKED_SOLO_5x5",
                    "tier": "GOLD",
                    "rank": "IV",
                    "leaguePoints": 12,
                    "wins": 10,
                    "losses": 8,
                    "hotStreak": False,
                    "veteran": False,
                    "freshBlood": True,
                }
            ]

        async def get_match_timeline(self, regional_routing: str, match_id: str):
            return {}

    async def fake_get_ddragon_version():
        return "14.24.1"

    async def fake_analyze_territory_for_player(*args, **kwargs):  # noqa: ANN001
        return {}

    async def fake_load_player_data(db, puuid: str):  # noqa: ANN001
        return pd.DataFrame(
            [
                {
                    "win": 1,
                    "kda": 3.5,
                    "visionScore": 28,
                    "killParticipation": 0.55,
                    "gameCreation": 1700000000,
                    "aggressionScore": 0.4,
                    "visionDominance": 0.6,
                    "jungleInvasionPressure": 0.2,
                    "goldPerMinute": 410,
                    "damagePerMinute": 520,
                },
                {
                    "win": 0,
                    "kda": 2.1,
                    "visionScore": 20,
                    "killParticipation": 0.42,
                    "gameCreation": 1690000000,
                    "aggressionScore": 0.35,
                    "visionDominance": 0.5,
                    "jungleInvasionPressure": 0.1,
                    "goldPerMinute": 380,
                    "damagePerMinute": 470,
                },
            ]
        )

    monkeypatch.setattr(analysis, "IngestionService", FakeIngestionService)
    monkeypatch.setattr(analysis, "model_instance", FakeModel())
    monkeypatch.setattr(analysis, "riot_service", FakeRiotService())
    monkeypatch.setattr(analysis, "get_ddragon_version", fake_get_ddragon_version)
    monkeypatch.setattr(analysis, "analyze_territory_for_player", fake_analyze_territory_for_player)
    monkeypatch.setattr(analysis, "load_player_data", fake_load_player_data)

    payload = {"riot_id": "TestName#EUW", "region": "euw1"}
    with client.stream("POST", "/api/analyze", json=payload) as r:
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("application/x-ndjson")
        raw_lines = list(r.iter_lines())

    events = _parse_ndjson_lines(raw_lines)
    assert events, "Expected at least one streamed event"

    parsed: List[AnalyzeEvent] = []
    for e in events:
        assert "type" in e
        t = e["type"]
        if t == "progress":
            parsed.append(ProgressEvent.model_validate(e))
        elif t == "result":
            parsed.append(ResultEvent.model_validate(e))
        elif t == "error":
            parsed.append(ErrorEvent.model_validate(e))
        else:
            raise AssertionError(f"Unknown event type: {t}")

    assert any(isinstance(p, ProgressEvent) for p in parsed)
    assert any(isinstance(p, ResultEvent) for p in parsed)
    assert not any(isinstance(p, ErrorEvent) for p in parsed)
