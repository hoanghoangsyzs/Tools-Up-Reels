from sqlalchemy import Boolean, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class FacebookPage(Base):
    __tablename__ = "facebook_pages"
    __table_args__ = (
        UniqueConstraint("facebook_user_id", "page_id", name="uq_facebook_user_page"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    facebook_user_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    page_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    category: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    tasks_json: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    connected: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
