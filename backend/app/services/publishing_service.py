from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable

import httpx
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.redis import redis_client
from app.models.publish_job import PublishJob
from app.models.video import Video

MIN_INTERVAL_MINUTES = 1
MAX_INTERVAL_MINUTES = 10080


def build_schedule_times(start_at: datetime, count: int, interval_minutes: int) -> list[datetime]:
    if start_at.tzinfo is None or start_at.utcoffset() is None:
        raise ValueError("Thời điểm bắt đầu phải có múi giờ.")
    if count < 1:
        raise ValueError("Phải chọn ít nhất một video.")
    if not MIN_INTERVAL_MINUTES <= interval_minutes <= MAX_INTERVAL_MINUTES:
        raise ValueError("Khoảng cách đăng phải từ 1 đến 10080 phút.")
    start_utc = start_at.astimezone(timezone.utc)
    return [start_utc + timedelta(minutes=interval_minutes * index) for index in range(count)]


def create_publish_jobs(
    db: Session,
    *,
    video_ids: Iterable[int],
    facebook_user_id: str,
    page_id: str,
    page_name: str,
    start_at: datetime,
    interval_minutes: int,
) -> list[PublishJob]:
    ids = list(dict.fromkeys(video_ids))
    times = build_schedule_times(start_at, len(ids), interval_minutes)
    videos = db.query(Video).filter(Video.id.in_(ids)).all()
    by_id = {video.id: video for video in videos}
    missing = [video_id for video_id in ids if video_id not in by_id]
    if missing:
        raise ValueError(f"Không tìm thấy video có ID: {', '.join(map(str, missing))}.")
    not_ready = [str(video_id) for video_id in ids if by_id[video_id].status != "ready"]
    if not_ready:
        raise ValueError(f"Video chưa sẵn sàng: {', '.join(not_ready)}.")

    jobs = [
        PublishJob(
            video_id=video_id,
            facebook_user_id=facebook_user_id,
            page_id=page_id,
            page_name=page_name,
            scheduled_at=scheduled_at,
            status="pending",
        )
        for video_id, scheduled_at in zip(ids, times)
    ]
    db.add_all(jobs)
    db.commit()
    for job in jobs:
        db.refresh(job)
    return jobs


def publish_reel(job_id: int, db: Session) -> str:
    job = db.get(PublishJob, job_id)
    if not job:
        raise ValueError("Không tìm thấy lịch đăng.")
    video = db.get(Video, job.video_id)
    if not video:
        raise ValueError("Video của lịch đăng không còn tồn tại.")

    page_token = redis_client.get(f"facebook:page_token:{job.facebook_user_id}:{job.page_id}")
    if not page_token:
        raise ValueError("Page Access Token đã hết hạn hoặc không còn trong Redis. Hãy kết nối lại Facebook.")

    video_path = Path(settings.video_storage_dir) / video.stored_name
    if not video_path.is_file():
        raise ValueError("Không tìm thấy tệp video trên máy chủ.")

    version = settings.meta_graph_version.lstrip("v")
    graph_base = f"https://graph.facebook.com/v{version}"
    timeout = httpx.Timeout(300.0, connect=30.0)

    with httpx.Client(timeout=timeout) as client:
        start_response = client.post(
            f"{graph_base}/{job.page_id}/video_reels",
            params={"upload_phase": "start", "access_token": page_token},
        )
        start_response.raise_for_status()
        start_data = start_response.json()
        video_id = start_data.get("video_id")
        upload_url = start_data.get("upload_url")
        if not video_id or not upload_url:
            raise RuntimeError("Facebook không trả về thông tin phiên tải video.")

        file_size = video_path.stat().st_size
        def file_chunks():
            with video_path.open("rb") as stream:
                while chunk := stream.read(1024 * 1024):
                    yield chunk

        upload_response = client.post(
            upload_url,
            headers={
                "Authorization": f"OAuth {page_token}",
                "offset": "0",
                "file_size": str(file_size),
                "Content-Type": "application/octet-stream",
            },
            content=file_chunks(),
        )
        upload_response.raise_for_status()

        finish_response = client.post(
            f"{graph_base}/{job.page_id}/video_reels",
            params={
                "upload_phase": "finish",
                "video_id": video_id,
                "video_state": "PUBLISHED",
                "description": video.caption or "",
                "access_token": page_token,
            },
        )
        finish_response.raise_for_status()
        finish_data = finish_response.json()

    if finish_data.get("success") is False:
        raise RuntimeError("Facebook không xác nhận đăng Reels thành công.")
    return str(video_id)
