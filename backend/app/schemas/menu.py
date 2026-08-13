"""Menu schemas."""

from pydantic import BaseModel, ConfigDict, Field, computed_field


class MenuItemRead(BaseModel):
    """A menu item as returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: str
    price_cents: int = Field(description="Price in integer cents, e.g. 1299 == $12.99")
    image_url: str
    category: str
    is_available: bool

    @computed_field  # type: ignore[prop-decorator]
    @property
    def price(self) -> float:
        """Convenience decimal price. `price_cents` stays the source of truth."""
        return round(self.price_cents / 100, 2)
