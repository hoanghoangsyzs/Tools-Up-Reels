from fastapi import FastAPI, HTTPException
from app.api.routes.auth import router as facebook_auth_router
from app.core.config import settings
from app.core.database import check_database
from app.core.redis import check_redis

app = FastAPI(
    
    title=settings.app_name,
    version="1.0.0"
)
app.include_router(facebook_auth_router)

@app.get("/")
def root():
    return {
        "success": True,
        "message": "FB Reels Publisher API is running"
    }


@app.get("/api/health")
def health():
    return {
        "status": "healthy",
        "application": settings.app_name
    }


@app.get("/api/health/database")
def database_health():
    try:
        check_database()
        return {"status": "connected", "database": "PostgreSQL"}
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@app.get("/api/health/redis")
def redis_health():
    try:
        check_redis()
        return {"status": "connected", "database": "Redis"}
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))