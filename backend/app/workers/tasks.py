from datetime import datetime, timezone

from sqlalchemy import update

from app.core.database import SessionLocal
from app.core.redis import redis_client
from app.models.publish_job import PublishJob
from app.services.publishing_service import publish_reel
from app.workers.celery_app import celery_app


@celery_app.task(name="app.workers.tasks.dispatch_due_reels")
def dispatch_due_reels():
    db = SessionLocal()
    try:
        due_ids = [
            row[0]
            for row in db.query(PublishJob.id)
            .filter(
                PublishJob.status == "pending",
                PublishJob.scheduled_at <= datetime.now(timezone.utc),
            )
            .order_by(PublishJob.scheduled_at.asc())
            .limit(50)
            .all()
        ]
    finally:
        db.close()

    queued = 0
    for job_id in due_ids:
        lock_key = f"publishing:dispatch:{job_id}"
        if redis_client.set(lock_key, "1", nx=True, ex=300):
            publish_scheduled_reel.delay(job_id)
            queued += 1
    return {"queued": queued}


@celery_app.task(name="app.workers.tasks.publish_scheduled_reel", bind=True, max_retries=0)
def publish_scheduled_reel(self, job_id: int):
    db = SessionLocal()
    try:
        claimed = db.execute(
            update(PublishJob)
            .where(PublishJob.id == job_id, PublishJob.status == "pending")
            .values(status="publishing", attempts=PublishJob.attempts + 1)
        )
        db.commit()
        redis_client.delete(f"publishing:dispatch:{job_id}")
        if claimed.rowcount != 1:
            return {"job_id": job_id, "skipped": True}

        try:
            facebook_video_id = publish_reel(job_id, db)
            job = db.get(PublishJob, job_id)
            job.status = "published"
            job.facebook_video_id = facebook_video_id
            job.error_message = None
            job.updated_at = datetime.now(timezone.utc)
            db.commit()
            return {"job_id": job_id, "status": "published"}
        except Exception as exc:
            db.rollback()
            job = db.get(PublishJob, job_id)
            if job:
                job.status = "failed"
                # Do not persist provider response bodies that could contain credentials.
                job.error_message = str(exc)[:1000]
                job.updated_at = datetime.now(timezone.utc)
                db.commit()
            return {"job_id": job_id, "status": "failed", "error": str(exc)[:300]}
    finally:
        db.close()
