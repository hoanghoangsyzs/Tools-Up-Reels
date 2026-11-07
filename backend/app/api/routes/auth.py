import secrets
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import RedirectResponse

from app.core.config import settings
from app.core.redis import redis_client

router = APIRouter(prefix="/api/auth/facebook", tags=["Facebook Auth"])

PERMISSIONS = [
    "pages_show_list",
    "pages_read_engagement",
    "pages_manage_posts",
]


def graph_url(path: str) -> str:
    version = settings.meta_graph_version.lstrip("v")
    return f"https://graph.facebook.com/v{version}/{path.lstrip('/')}"


@router.get("/login")

def facebook_login():
    if not settings.meta_app_id or not settings.meta_app_secret:
        raise HTTPException(
            status_code=500,
            detail="Chưa cấu hình Meta App ID hoặc App Secret",
        )

    if not settings.meta_config_id:
        raise HTTPException(
            status_code=500,
            detail="Chưa cấu hình META_CONFIG_ID",
        )

    state = secrets.token_urlsafe(32)

    redis_client.setex(
        f"facebook:oauth:state:{state}",
        600,
        "1",
    )

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
    print("FACEBOOK LOGIN URL:", login_url)
    return RedirectResponse(login_url)


@router.get("/callback")
def facebook_callback(
    code: str | None = Query(default=None),
    state: str | None = Query(default=None),
    error: str | None = Query(default=None),
    error_description: str | None = Query(default=None),
):
    if error:
        raise HTTPException(
            status_code=400,
            detail=f"Facebook từ chối đăng nhập: {error_description or error}",
        )

    if not code or not state:
        raise HTTPException(
            status_code=400,
            detail="Thiếu authorization code hoặc state",
        )

    # Kiểm tra và tiêu thụ state để chống CSRF/replay.
    valid_state = redis_client.getdel(f"facebook:oauth:state:{state}")

    if not valid_state:
        raise HTTPException(
            status_code=400,
            detail="State không hợp lệ hoặc đã hết hạn. Hãy đăng nhập lại.",
        )

    params = {
        "client_id": settings.meta_app_id,
        "client_secret": settings.meta_app_secret,
        "redirect_uri": settings.meta_redirect_uri,
        "code": code,
    }

    try:
        with httpx.Client(timeout=30) as client:
            token_response = client.get(
                graph_url("oauth/access_token"),
                params=params,
            )
            token_response.raise_for_status()
            token_data = token_response.json()

            access_token = token_data["access_token"]

            profile_response = client.get(
                graph_url("me"),
                params={
                    "fields": "id,name",
                    "access_token": access_token,
                },
            )
            profile_response.raise_for_status()
            profile = profile_response.json()

    except (httpx.HTTPError, KeyError, ValueError):
        raise HTTPException(
            status_code=502,
            detail="Không thể xác thực với Facebook. Hãy kiểm tra cấu hình Meta App.",
        )

    # Lưu tạm token ở Redis để dùng trong bước lấy danh sách Fanpage.
    # Bước sau sẽ chuyển token sang lưu trữ bền vững và mã hóa trong database.
    expires_in = int(token_data.get("expires_in", 3600))

    redis_client.setex(
        f"facebook:user_token:{profile['id']}",
        expires_in,
        access_token,
    )

    return {
        "success": True,
        "message": "Facebook OAuth thành công",
        "facebook_user": {
            "id": profile.get("id"),
            "name": profile.get("name"),
        },
        "token_expires_in": expires_in,
    }

@router.get("/pages")
def get_facebook_pages(facebook_user_id: str):
    # Lấy User Access Token từ Redis
    user_token = redis_client.get(
        f"facebook:user_token:{facebook_user_id}"
    )

    if not user_token:
        raise HTTPException(
            status_code=401,
            detail="Không tìm thấy phiên Facebook. Hãy đăng nhập lại."
        )

    try:
        with httpx.Client(timeout=30) as client:
            response = client.get(
                graph_url("me/accounts"),
                params={
                    "fields": "id,name,category,tasks,access_token",
                    "access_token": user_token,
                    "limit": 100,
                },
            )

            response.raise_for_status()
            result = response.json()

            pages = result.get("data", [])

            # Lưu Page Access Token tạm vào Redis.
            # Không trả token về trình duyệt.
            for page in pages:
                page_id = page["id"]
                page_token = page.get("access_token")

                if page_token:
                    redis_client.setex(
                        f"facebook:page_token:{facebook_user_id}:{page_id}",
                        5183961,
                        page_token,
                    )

            return {
                "success": True,
                "total": len(pages),
                "pages": [
                    {
                        "id": page.get("id"),
                        "name": page.get("name"),
                        "category": page.get("category"),
                        "tasks": page.get("tasks", []),
                    }
                    for page in pages
                ],
            }

    except httpx.HTTPStatusError:
        raise HTTPException(
            status_code=502,
            detail="Facebook API từ chối yêu cầu lấy danh sách Fanpage."
        )
    except httpx.RequestError:
        raise HTTPException(
            status_code=502,
            detail="Không thể kết nối Facebook API."
        )