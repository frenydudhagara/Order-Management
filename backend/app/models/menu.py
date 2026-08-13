"""Menu item model."""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.utils.time import utcnow


class MenuItem(Base):
    """A single purchasable dish.

    Prices are stored as integer cents. Floats are never used for money:
    0.1 + 0.2 != 0.3 in binary floating point, and rounding drift in a total
    is the kind of bug that only shows up in production.
    """

    __tablename__ = "menu_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    price_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    image_url: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    category: Mapped[str] = mapped_column(String(60), nullable=False, default="Mains", index=True)
    is_available: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<MenuItem id={self.id} name={self.name!r} price_cents={self.price_cents}>"
