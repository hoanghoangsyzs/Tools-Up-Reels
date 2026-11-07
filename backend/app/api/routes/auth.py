import json
import secrets
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import SessionLocal
from app.core.redis import redis_client
from app.models.facebook_page import FacebookPage

router = APIRouter(prefix="/api/auth/facebook", tags=["Facebook Auth"])

PERMISSIONS = ["pages_show_list", "pages_read_engagement", "pages_manage_posts"]
PAGE_TOKEN_TTL = 5183961


def graph_url(path: str) -> str:
    version = settings.meta_graph_version.lstrip("v")
    return f"https://graph.facebook.com/v{version}/{path.lstrip('/')}"


def oauth_result_html(*, success: bool, payload: dict) -> HTMLResponse:
    # Values are JSON encoded, then safely embedded as a script literal.
    message = json.dumps(
        {"type": "reels-studio:facebook-oauth", "success": success, **payload},
        ensure_ascii=False,
    ).replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
    origin = json.dumps(settings.frontend_url.rstrip("/"))
    html = f"""<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kết nối Facebook</title></head><body style="font-family:Arial,sans-serif;padding:32px;text-align:center"><h2>{'Kết nối thành công' if success else 'Kết nối thất bại'}</h2><p>{'Bạn có thể đóng cửa sổ này và quay lại Reels Studio.' if success else 'Hãy quay lại ứng dụng và thử kết nối lại.'}</p><script>if(window.opener){{window.opener.postMessage({message},{origin});window.close();}}</script></body></html>"""
    return HTMLResponse(html)


@router.get("/login")
def facebook_login():
    if not settings.meta_app_id or not settings.meta_app_secret:
        raise HTTPException(500, "Chưa cấu hình Meta App ID hoặc App Secret")
    if not settings.meta_config_id:
        raise HTTPException(500, "Chưa cấu hình META_CONFIG_ID")
    state = secrets.token_urlsafe(32)
    redis_client.setex(f"facebook:oauth:state:{state}", 600, "1")
    params = {
        "client_id": settings.meta_app_id,
        "redirect_uri": settings.meta_redirect_uri,
        "config_id": settings.meta_config_id,
        "response_type": "code",
        "state": state,
    }
    login_url = (
        f"https://www.facebook.com/v{settings.meta_graph_version.lstrip('v')}"
        f"/dialog/oauth?{urlencode(params)}"
    )
    return RedirectResponse(login_url)


@router.get("/callback", response_class=HTMLResponse)
def facebook_callback(
    code: str | None = Query(default=None),
    state: str | None = Query(default=None),
    error: str | None = Query(default=None),
    error_description: str | None = Query(default=None),
):
    if error:
        return oauth_result_html(success=False, payload={"error": "Facebook từ chối cấp quyền."})
    if not code or not state:
        return oauth_result_html(success=False, payload={"error": "Thiếu authorization code hoặc state."})
    valid_state = redis_client.getdel(f"facebook:oauth:state:{state}")
    if not valid_state:
        return oauth_result_html(success=False, payload={"error": "Phiên OAuth không hợp lệ hoặc đã hết hạn."})

    params = {
        "client_id": settings.meta_app_id,
        "client_secret": settings.meta_app_secret,
        "redirect_uri": settings.meta_redirect_uri,
        "code": code,
    }
    try:
        with httpx.Client(timeout=30) as client:
            token_response = client.get(graph_url("oauth/access_token"), params=params)
            token_response.raise_for_status()
            token_data = token_response.json()
            access_token = token_data["access_token"]
            profile_response = client.get(
                graph_url("me"),
                params={"fields": "id,name", "access_token": access_token},
            )
            profile_response.raise_for_status()
            profile = profile_response.json()
        expires_in = max(60, int(token_data.get("expires_in", 3600)))
        redis_client.setex(f"facebook:user_token:{profile['id']}", expires_in, access_token)
        redis_client.setex(
            f"facebook:user_profile:{profile['id']}",
            expires_in,
            json.dumps({"id": profile["id"], "name": profile.get("name", "")}),
        )
        return oauth_result_html(
            success=True,
            payload={
                "facebook_user": {"id": profile["id"], "name": profile.get("name", "")},
                "token_expires_in": expires_in,
            },
        )
    except (httpx.HTTPError, KeyError, ValueError):
        return oauth_result_html(success=False, payload={"error": "Không thể xác thực với Facebook. Kiểm tra cấu hình Meta App."})


def _get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@router.get("/pages")
def get_facebook_pages(facebook_user_id: str, db: Session = Depends(_get_db)):
    user_token = redis_client.get(f"facebook:user_token:{facebook_user_id}")
    if not user_token:
        raise HTTPException(401, "Phiên Facebook đã hết hạn. Hãy kết nối lại.")
    try:
        with httpx.Client(timeout=30) as client:
            response = client.get(
                graph_url("me/accounts"),
                params={"fields": "id,name,category,tasks,access_token", "access_token": user_token, "limit": 100},
            )
            response.raise_for_status()
            pages = response.json().get("data", [])
        for page in pages:
            page_id = str(page["id"])
            page_token = page.get("access_token")
            if page_token:
                redis_client.setex(f"facebook:page_token:{facebook_user_id}:{page_id}", PAGE_TOKEN_TTL, page_token)
            record = db.query(FacebookPage).filter_by(facebook_user_id=facebook_user_id, page_id=page_id).first()
            if record is None:
                record = FacebookPage(facebook_user_id=facebook_user_id, page_id=page_id)
                db.add(record)
            record.name = page.get("name", "")
            record.category = page.get("category", "")
            record.tasks_json = json.dumps(page.get("tasks", []))
            record.connected = bool(page_token)
        db.commit()
        saved = db.query(FacebookPage).filter_by(facebook_user_id=facebook_user_id).order_by(FacebookPage.name.asc()).all()
        return {
            "success": True,
            "total": len(saved),
            "pages": [{
                "id": item.page_id, "name": item.name, "category": item.category,
                "tasks": json.loads(item.tasks_json or "[]"), "connected": item.connected,
                "is_default": item.is_default,
            } for item in saved],
        }
    except httpx.HTTPStatusError:
        raise HTTPException(502, "Facebook API từ chối yêu cầu lấy danh sách Fanpage.")
    except httpx.RequestError:
        raise HTTPException(502, "Không thể kết nối Facebook API.")


@router.post("/pages/{page_id}/default")
def set_default_page(facebook_user_id: str, page_id: str, db: Session = Depends(_get_db)):
    page = db.query(FacebookPage).filter_by(facebook_user_id=facebook_user_id, page_id=page_id).first()
    if not page:
        raise HTTPException(404, "Không tìm thấy Fanpage trong danh sách đã kết nối.")
    db.query(FacebookPage).filter_by(facebook_user_id=facebook_user_id).update({FacebookPage.is_default: False})
    page.is_default = True
    db.commit()
    return {"success": True, "message": f"Đã đặt {page.name} làm Fanpage mặc định."}


@router.delete("/pages/{page_id}")
def disconnect_page(facebook_user_id: str, page_id: str, db: Session = __import__("fastapi").Depends(_get_db)):
    page = db.query(FacebookPage).filter_by(facebook_user_id=facebook_user_id, page_id=page_id).first()
    if not page:
        raise HTTPException(404, "Không tìm thấy Fanpage.")
    redis_client.delete(f"facebook:page_token:{facebook_user_id}:{page_id}")
    db.delete(page)
    db.commit()
    return {"success": True, "message": f"Đã ngắt kết nối {page.name}."}


@router.delete("/connection")
def disconnect_facebook(facebook_user_id: str):
    redis_client.delete(f"facebook:user_token:{facebook_user_id}", f"facebook:user_profile:{facebook_user_id}")
    keys = list(redis_client.scan_iter(match=f"facebook:page_token:{facebook_user_id}:*"))
    if keys:
        redis_client.delete(*keys)
    return {"success": True, "message": "Đã ngắt kết nối tài khoản Facebook."}
