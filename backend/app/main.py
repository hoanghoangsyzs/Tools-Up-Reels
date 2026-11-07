from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException

from app.api.routes.auth import router as facebook_auth_router
from app.api.routes.videos import router as videos_router
from app.core.config import settings
from app.core.database import Base, engine, check_database
from app.core.redis import check_redis
from app.models.video import Video  # noqa: F401 - registers model metadata


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(title=settings.app_name, version="1.1.0", lifespan=lifespan)
app.include_router(facebook_auth_router)
app.include_router(videos_router)


@app.get("/")
def root():
    return {"success": True, "message": "FB Reels Publisher API is running"}


@app.get("/api/health")
def health():
    return {"status": "healthy", "application": settings.app_name}


@app.get("/api/health/database")
def database_health():
    try:
        check_database()
        return {"status": "connected", "database": "PostgreSQL"}
    except Exception:
        raise HTTPException(status_code=503, detail="PostgreSQL is unavailable")


@app.get("/api/health/redis")
def redis_health():
    try:
        check_redis()
        return {"status": "connected", "database": "Redis"}
    except Exception:
        raise HTTPException(status_code=503, detail="Redis is unavailable")
