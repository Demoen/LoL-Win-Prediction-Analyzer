from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
import os

# Try to load .env files for local development (optional)
try:
    from dotenv import load_dotenv
    from pathlib import Path
    
    # Try loading from various locations for local dev
    current_dir = Path(__file__).resolve().parent
    load_dotenv(current_dir / ".env")  # apps/api/.env
    load_dotenv(current_dir / "dev.env")  # apps/api/dev.env
    
    # Try parent directories for monorepo structure
    for parent in current_dir.parents:
        env_file = parent / "dev.env"
        if env_file.exists():
            load_dotenv(env_file)
            break
except ImportError:
    pass  # python-dotenv not installed, rely on system env vars

# Use SQLite for dev, allow override for Postgres in production
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./params.db")

# Convert Railway's postgres:// to postgresql+asyncpg:// for async support
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql+asyncpg://", 1)
elif DATABASE_URL.startswith("postgresql://") and "+asyncpg" not in DATABASE_URL:
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://", 1)

is_sqlite = DATABASE_URL.startswith("sqlite")

# Configure engine with connection pooling for PostgreSQL
engine_kwargs = {
    "echo": os.getenv("SQL_ECHO", "false").lower() == "true",
    "future": True,
}

# Add connection pooling for PostgreSQL (SQLite doesn't support it)
if not is_sqlite:
    engine_kwargs.update({
        "pool_size": 5,           # Base pool connections
        "max_overflow": 10,       # Extra connections when pool is full
        "pool_pre_ping": True,    # Health check connections before use
        "pool_recycle": 300,      # Recycle connections after 5 minutes
    })

engine = create_async_engine(DATABASE_URL, **engine_kwargs)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)

class Base(DeclarativeBase):
    pass

async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
