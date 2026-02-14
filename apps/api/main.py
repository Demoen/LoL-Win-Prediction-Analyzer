# Bump commit: 2026-02-04
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import analysis
import os
from contextlib import asynccontextmanager
from init_db import init_models

@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_models()
    yield

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

@app.get("/api/health")
async def health_check():
    return {"status": "ok", "version": "0.1.0"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
