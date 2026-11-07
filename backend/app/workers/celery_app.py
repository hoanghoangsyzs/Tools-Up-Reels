from celery import Celery

from app.core.config import settings

celery_app = Celery(
    "reels_publisher",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=["app.workers.tasks"],
)
celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    beat_schedule={
        "dispatch-due-reels-every-30-seconds": {
            "task": "app.workers.tasks.dispatch_due_reels",
            "schedule": 30.0,
        }
    },
)
