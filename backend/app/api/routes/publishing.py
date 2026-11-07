from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import SessionLocal
from app.core.redis import redis_client
from app.models.posting_setting import PostingSetting
from app.models.publish_job import PublishJob
from app.models.video import Video
from app.services.publishing_service import (
    MAX_INTERVAL_MINUTES,
    MIN_INTERVAL_MINUTES,
    create_publish_jobs,
)

router = APIRouter(prefix="/api/publishing", tags=["Reels Publishing"])


def get_db():
    if settings.app_env != "development":
        raise HTTPException(
            status_code=503,
            detail="Publishing API is disabled until application authentication is configured.",
        )
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class ScheduleRequest(BaseModel):
    facebook_user_id: str = Field(min_length=1, max_length=64)
    page_id: str = Field(min_length=1, max_length=64)
    page_name: str = Field(default="", max_length=255)
    video_ids: list[int] = Field(min_length=1, max_length=100)
    start_at: datetime
    interval_minutes: int | None = Field(default=None, ge=MIN_INTERVAL_MINUTES, le=MAX_INTERVAL_MINUTES)

    @field_validator("video_ids")
    @classmethod
    def unique_video_ids(cls, value: list[int]) -> list[int]:
        if len(value) != len(set(value)):
            raise ValueError("Danh sách video không được chứa ID trùng lặp.")
        return value


class IntervalRequest(BaseModel):
    interval_minutes: int = Field(ge=MIN_INTERVAL_MINUTES, le=MAX_INTERVAL_MINUTES)


def job_to_dict(job: PublishJob) -> dict:
    return {
        "id": job.id,
        "video_id": job.video_id,
        "facebook_user_id": job.facebook_user_id,
        "page_id": job.page_id,
        "page_name": job.page_name,
        "scheduled_at": job.scheduled_at.isoformat(),
        "status": job.status,
        "facebook_video_id": job.facebook_video_id,
        "error_message": job.error_message,
        "attempts": job.attempts,
        "created_at": job.created_at.isoformat() if job.created_at else None,
    }


@router.get("/settings")
def get_settings(db: Session = Depends(get_db)):
    setting = db.get(PostingSetting, 1)
    return {"success": True, "interval_minutes": setting.interval_minutes if setting else 30}


@router.put("/settings")
def update_settings(payload: IntervalRequest, db: Session = Depends(get_db)):
    setting = db.get(PostingSetting, 1)
    if setting is None:
        setting = PostingSetting(id=1, interval_minutes=payload.interval_minutes)
        db.add(setting)
    else:
        setting.interval_minutes = payload.interval_minutes
        setting.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {"success": True, "interval_minutes": setting.interval_minutes}


@router.get("/jobs")
def list_jobs(
    status_filter: Literal["pending", "publishing", "published", "failed", "cancelled"] | None = Query(default=None, alias="status"),
    db: Session = Depends(get_db),
):
    query = db.query(PublishJob).order_by(PublishJob.scheduled_at.desc())
    if status_filter:
        query = query.filter(PublishJob.status == status_filter)
    jobs = query.limit(200).all()
    return {"success": True, "total": len(jobs), "jobs": [job_to_dict(job) for job in jobs]}


@router.post("/schedule", status_code=201)
def schedule_reels(payload: ScheduleRequest, db: Session = Depends(get_db)):
    page_token = redis_client.get(
        f"facebook:page_token:{payload.facebook_user_id}:{payload.page_id}"
    )
    if not page_token:
        raise HTTPException(
            status_code=401,
            detail="Không tìm thấy Page Access Token. Hãy kết nối Facebook và tải lại danh sách Fanpage.",
        )
    setting = db.get(PostingSetting, 1)
    interval = payload.interval_minutes or (setting.interval_minutes if setting else 30)
    try:
        jobs = create_publish_jobs(
            db,
            video_ids=payload.video_ids,
            facebook_user_id=payload.facebook_user_id,
            page_id=payload.page_id,
            page_name=payload.page_name,
            start_at=payload.start_at,
            interval_minutes=interval,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {
        "success": True,
        "message": f"Đã tạo {len(jobs)} lịch đăng.",
        "interval_minutes": interval,
        "jobs": [job_to_dict(job) for job in jobs],
    }


@router.delete("/jobs/{job_id}")
def cancel_job(job_id: int, db: Session = Depends(get_db)):
    job = db.get(PublishJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Không tìm thấy lịch đăng.")
    if job.status != "pending":
        raise HTTPException(status_code=409, detail="Chỉ có thể hủy lịch đang chờ đăng.")
    job.status = "cancelled"
    job.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {"success": True, "message": "Đã hủy lịch đăng.", "job": job_to_dict(job)}
