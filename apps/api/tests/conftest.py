from __future__ import annotations

import pathlib
import sys
from typing import AsyncIterator, Iterator

import pytest
from fastapi.testclient import TestClient


API_DIR = pathlib.Path(__file__).resolve().parents[1]
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))


class _FakeResult:
    def scalar_one_or_none(self):
        return None

    def scalars(self):
        return self

    def first(self):
        return None

    def all(self):
        return []


class FakeAsyncSession:
    async def execute(self, *args, **kwargs):  # noqa: ANN001
        return _FakeResult()

    async def commit(self):
        return None

    async def refresh(self, *args, **kwargs):  # noqa: ANN001
        return None

    async def rollback(self):
        return None

    def add(self, *args, **kwargs):  # noqa: ANN001
        return None


@pytest.fixture
def app():
    import main

    return main.app


@pytest.fixture
def client(app) -> Iterator[TestClient]:
    import database

    async def override_get_db() -> AsyncIterator[FakeAsyncSession]:
        yield FakeAsyncSession()

    app.dependency_overrides[database.get_db] = override_get_db

    with TestClient(app) as c:
        yield c

    app.dependency_overrides.clear()
