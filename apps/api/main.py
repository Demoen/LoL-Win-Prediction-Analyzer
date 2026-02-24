from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import analysis, draft
import os
import asyncio
import logging
from contextlib import asynccontextmanager
from init_db import init_models

logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_models()
    # Eager-load the draft model in a thread so the event loop stays free
    # and the very first /draft request is not slow for users.
    from ml.draft_inference import draft_analyzer
    try:
        await asyncio.to_thread(draft_analyzer.load)
        logger.info("Draft model loaded at startup.")
    except Exception as exc:
        logger.warning("Draft model could not be pre-loaded at startup: %s", exc)
    yield
    # Gracefully close the Riot API client on shutdown
    from services.riot import riot_service
    await riot_service.close()

app = FastAPI(title="Riot Win Prediction API", lifespan=lifespan)

# CORS setup
raw_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000")
origins = [o.strip() for o in raw_origins.split(",") if o.strip()]

# If you set ALLOWED_ORIGINS="*" we must disable credentials (browser/CORS spec)
allow_all = len(origins) == 1 and origins[0] == "*"

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if allow_all else origins,
    allow_credentials=False if allow_all else True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(analysis.router)
app.include_router(draft.router)

@app.get("/api/health")
async def health_check():
    return {"status": "ok", "version": "0.1.0"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
