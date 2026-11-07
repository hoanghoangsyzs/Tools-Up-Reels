import os
import uuid
from pathlib import Path
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from app.core.database import SessionLocal
from app.models.video import Video

router = APIRouter(prefix="/api/videos", tags=["Videos"])
VIDEO_DIR = Path(os.getenv("VIDEO_STORAGE_DIR", "storage/videos"))
MAX_VIDEO_SIZE = 500 * 1024 * 1024
ALLOWED_EXTENSIONS = {".mp4", ".mov", ".m4v"}
ALLOWED_CONTENT_TYPES = {"video/mp4", "video/quicktime", "application/octet-stream"}

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@router.get("")
def list_videos(db: Session = Depends(get_db)):
    videos = db.query(Video).order_by(Video.created_at.desc()).all()
    return {"success": True, "total": len(videos), "videos": [
        {"id": v.id, "name": v.original_name, "size_bytes": v.size_bytes,
         "caption": v.caption, "status": v.status, "created_at": v.created_at.isoformat(),
         "download_url": f"/api/videos/{v.id}/file"} for v in videos
    ]}

@router.post("", status_code=status.HTTP_201_CREATED)
async def upload_video(file: UploadFile = File(...), caption: str = "", db: Session = Depends(get_db)):
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(400, "Chỉ chấp nhận video MP4, MOV hoặc M4V.")
    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(400, "Định dạng nội dung video không hợp lệ.")
    VIDEO_DIR.mkdir(parents=True, exist_ok=True)
    stored_name = f"{uuid.uuid4().hex}{suffix}"
    destination = VIDEO_DIR / stored_name
    size = 0
    try:
        with destination.open("wb") as output:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_VIDEO_SIZE:
                    raise HTTPException(413, "Video vượt quá giới hạn 500 MB.")
                output.write(chunk)
        if size == 0:
            raise HTTPException(400, "Tệp video rỗng.")
        video = Video(original_name=Path(file.filename or "video").name[:255],
                      stored_name=stored_name, mime_type=file.content_type or "application/octet-stream",
                      size_bytes=size, caption=caption[:5000])
        db.add(video)
        db.commit()
        db.refresh(video)
        return {"success": True, "message": "Tải video lên thành công.",
                "video": {"id": video.id, "name": video.original_name,
                          "size_bytes": video.size_bytes, "status": video.status,
                          "download_url": f"/api/videos/{video.id}/file"}}
    except Exception:
        if destination.exists():
            destination.unlink()
        raise
    finally:
        await file.close()

@router.get("/{video_id}/file")
def download_video(video_id: int, db: Session = Depends(get_db)):
    video = db.get(Video, video_id)
    if not video:
        raise HTTPException(404, "Không tìm thấy video.")
    path = VIDEO_DIR / video.stored_name
    if not path.is_file():
        raise HTTPException(404, "Tệp video không còn trên máy chủ.")
    return FileResponse(path, media_type=video.mime_type, filename=video.original_name)

@router.delete("/{video_id}")
def delete_video(video_id: int, db: Session = Depends(get_db)):
    video = db.get(Video, video_id)
    if not video:
        raise HTTPException(404, "Không tìm thấy video.")
    path = VIDEO_DIR / video.stored_name
    db.delete(video)
    db.commit()
    if path.is_file():
        path.unlink()
    return {"success": True, "message": "Đã xóa video."}
