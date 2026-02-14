# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

NexusInsight — an ML-powered League of Legends match analysis app that predicts win probability using XGBoost, focused on skill-driven (causal) features rather than outcome-correlated stats. Monorepo with a FastAPI backend (`apps/api/`) and Next.js frontend (`apps/web/`).

## Development Commands

### API (FastAPI)
```bash
cd apps/api
pip install -r requirements.txt
uvicorn main:app --reload            # http://localhost:8000
```

### Web (Next.js)
```bash
cd apps/web
npm install
npm run dev                          # http://localhost:3000
npm run lint                         # ESLint
npm run build                        # Production build
```

### Production
```bash
# API
cd apps/api && uvicorn main:app --host 0.0.0.0 --port $PORT

# Web
cd apps/web && npm run build && npm start
```

## Architecture

### Backend (`apps/api/`)
- **Framework:** FastAPI (async-first), SQLAlchemy async ORM
- **Entry point:** `main.py` → mounts routers, configures CORS, initializes DB
- **Database:** SQLite (dev via `aiosqlite`) / PostgreSQL (prod via `asyncpg`). Models in `models.py`, connection in `database.py`
- **Core endpoint:** `POST /api/analyze` in `routers/analysis.py` — streams newline-delimited JSON (SSE-style) with real-time progress updates
- **Services:**
  - `services/riot.py` — Singleton `RiotService` wrapping `riotskillissue` client with semaphore-based rate limiting (5 concurrent)
  - `services/ingestion.py` — Fetches and persists match history to DB
- **ML pipeline (`ml/`):**
  - `pipeline.py` — Feature extraction; separates **predictive features** (early-game leads, CS, vision, skillshot accuracy) from **display-only features** (KDA, gold/min, damage). This separation is intentional to avoid outcome bias.
  - `training.py` — XGBoost with Platt-scaling calibration. Recency-weighted samples (4x recent, 2x mid, 1x old). Includes training cache to skip retraining on unchanged data.
  - `timeline_analysis.py` — Territorial control metrics from match timeline data

### Frontend (`apps/web/`)
- **Framework:** Next.js 16 + React 19 + TypeScript + Tailwind CSS 4
- **Routing:** App Router. Landing page at `app/page.tsx`, analysis at `app/summoner/[region]/[riotId]/page.tsx`
- **API communication:** `lib/api.ts` — streaming fetch wrapper that parses newline-delimited JSON progress events
- **Key components:** `SearchBar.tsx` (region + Riot ID input), `DetailedMatchAnalysis.tsx` (per-match breakdown), `PlayerPerformanceTrends.tsx` (charts via Recharts), `ElectricMap.tsx` (canvas-based Summoner's Rift visualization)
- **Theme:** Dark cyberpunk aesthetic — primary cyan `#00D1FF`, purple `#5842F4`
- **Path alias:** `@/*` maps to project root (configured in `tsconfig.json`)

## Environment Variables

**API** (`apps/api/`): `RIOT_API_KEY` (required), `DATABASE_URL` (SQLite default in `dev.env`), `PLATFORM_REGION` (e.g. `euw1`), `REGIONAL_ROUTING` (e.g. `europe`), `ALLOWED_ORIGINS` (CORS, comma-separated), `SECRET_KEY`

**Web** (`apps/web/`): `NEXT_PUBLIC_API_URL` (e.g. `http://localhost:8000/api`)

## Deployment

Railway with two services from same repo. Each has its own `railway.json` in its app directory. Web uses NixPacks builder with standalone output mode (`next.config.js`).

## Key Design Decisions

- **Predictive vs Display features:** The ML pipeline intentionally excludes KDA/damage/gold from prediction inputs — these correlate with wins but don't cause them. Predictive features focus on player agency (CS habits, vision, skillshots, early-game positioning).
- **Streaming analysis:** The analyze endpoint streams progress events so the frontend can show real-time status during the multi-step pipeline (account lookup → match ingestion → training → analysis).
- **Training cache:** Model retraining is skipped when input data hash hasn't changed, avoiding redundant computation.
- **TypeScript errors ignored at build:** `next.config.js` sets `typescript.ignoreBuildErrors = true`.
