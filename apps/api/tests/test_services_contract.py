from __future__ import annotations

from types import SimpleNamespace

import pytest


@pytest.mark.anyio
async def test_riot_get_account_by_riot_id_returns_object_with_fields(monkeypatch):
    from services import riot as riot_mod

    async def fake_get_by_riot_id(region_routing: str, game_name: str, tag_line: str):
        assert region_routing
        assert game_name
        assert tag_line
        return SimpleNamespace(puuid="puuid-1", gameName=game_name, tagLine=tag_line)

    fake_client = SimpleNamespace(account=SimpleNamespace(get_by_riot_id=fake_get_by_riot_id))
    monkeypatch.setattr(riot_mod.riot_service, "client", fake_client)

    acct = await riot_mod.riot_service.get_account_by_riot_id("europe", "Name", "EUW")
    assert getattr(acct, "puuid")
    assert getattr(acct, "gameName") == "Name"
    assert getattr(acct, "tagLine") == "EUW"


@pytest.mark.anyio
async def test_riot_get_summoner_by_puuid_returns_object_with_fields(monkeypatch):
    from services import riot as riot_mod

    async def fake_get_by_puuid(platform_region: str, puuid: str):
        assert platform_region
        assert puuid
        return SimpleNamespace(profileIconId=111, summonerLevel=222)

    fake_client = SimpleNamespace(summoner=SimpleNamespace(get_by_puuid=fake_get_by_puuid))
    monkeypatch.setattr(riot_mod.riot_service, "client", fake_client)

    summ = await riot_mod.riot_service.get_summoner_by_puuid("euw1", "puuid-1")
    assert getattr(summ, "profileIconId") == 111
    assert getattr(summ, "summonerLevel") == 222


@pytest.mark.anyio
async def test_riot_get_match_history_returns_list_of_match_ids(monkeypatch):
    from services import riot as riot_mod

    async def fake_get_match_ids_by_puuid(regional_routing: str, puuid: str, queue: int, count: int):
        assert regional_routing
        assert puuid
        assert queue == 420
        assert count == 20
        return ["EUW1_1", "EUW1_2"]

    fake_client = SimpleNamespace(match=SimpleNamespace(get_match_ids_by_puuid=fake_get_match_ids_by_puuid))
    monkeypatch.setattr(riot_mod.riot_service, "client", fake_client)

    ids = await riot_mod.riot_service.get_match_history("europe", "puuid-1", count=20)
    assert ids == ["EUW1_1", "EUW1_2"]


@pytest.mark.anyio
async def test_riot_get_match_details_returns_dict(monkeypatch):
    from services import riot as riot_mod

    async def fake_get_match(regional_routing: str, match_id: str):
        assert regional_routing
        assert match_id
        return {"metadata": {"matchId": match_id}, "info": {"gameDuration": 1800}}

    fake_client = SimpleNamespace(match=SimpleNamespace(get_match=fake_get_match))
    monkeypatch.setattr(riot_mod.riot_service, "client", fake_client)

    match = await riot_mod.riot_service.get_match_details("europe", "EUW1_123")
    assert isinstance(match, dict)
    assert match.get("metadata", {}).get("matchId") == "EUW1_123"


@pytest.mark.anyio
async def test_riot_get_league_entries_model_dump(monkeypatch):
    from services import riot as riot_mod

    class FakeEntry:
        def __init__(self, data):
            self._data = data

        def model_dump(self):
            return dict(self._data)

    async def fake_get_league_entries_by_puuid(platform_region: str, puuid: str):
        assert platform_region
        assert puuid
        return [FakeEntry({"queueType": "RANKED_SOLO_5x5", "tier": "GOLD"})]

    fake_client = SimpleNamespace(
        league=SimpleNamespace(get_league_entries_by_puuid=fake_get_league_entries_by_puuid)
    )
    monkeypatch.setattr(riot_mod.riot_service, "client", fake_client)

    entries = await riot_mod.riot_service.get_league_entries("euw1", "test-puuid")
    assert isinstance(entries, list)
    assert entries and isinstance(entries[0], dict)
    assert entries[0].get("queueType") == "RANKED_SOLO_5x5"


@pytest.mark.anyio
async def test_riot_get_league_entries_returns_empty_on_error(monkeypatch):
    from services import riot as riot_mod

    async def boom(*args, **kwargs):  # noqa: ANN001
        raise RuntimeError("rate limit")

    fake_client = SimpleNamespace(league=SimpleNamespace(get_league_entries_by_puuid=boom))
    monkeypatch.setattr(riot_mod.riot_service, "client", fake_client)

    entries = await riot_mod.riot_service.get_league_entries("euw1", "test-puuid")
    assert entries == []


@pytest.mark.anyio
async def test_riot_get_match_timeline_returns_none_on_error(monkeypatch):
    from services import riot as riot_mod

    async def boom(*args, **kwargs):  # noqa: ANN001
        raise RuntimeError("timeline unavailable")

    fake_client = SimpleNamespace(match=SimpleNamespace(get_timeline=boom))
    monkeypatch.setattr(riot_mod.riot_service, "client", fake_client)

    timeline = await riot_mod.riot_service.get_match_timeline("europe", "EUW1_123")
    assert timeline is None


@pytest.mark.anyio
async def test_ddragon_version_pinned(monkeypatch):
    from services import ddragon

    monkeypatch.setenv("DDRAGON_VERSION", "13.1.1")
    v = await ddragon.get_ddragon_version()
    assert v == "13.1.1"


@pytest.mark.anyio
async def test_ddragon_version_fallback_when_http_fails(monkeypatch):
    from services import ddragon

    monkeypatch.delenv("DDRAGON_VERSION", raising=False)
    monkeypatch.setattr(ddragon, "_cache_version", None)
    monkeypatch.setattr(ddragon, "_cache_fetched_at", 0.0)

    class FakeResp:
        def raise_for_status(self):
            raise RuntimeError("503")

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):  # noqa: ANN001
            return False

        async def get(self, url: str):
            assert url
            return FakeResp()

    monkeypatch.setattr(ddragon.httpx, "AsyncClient", lambda **kwargs: FakeClient())

    v = await ddragon.get_ddragon_version()
    assert isinstance(v, str) and v
    assert v == "14.24.1"
