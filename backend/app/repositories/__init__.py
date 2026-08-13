"""Data access layer.

Repositories are the only place that talks SQLAlchemy. Services depend on
them rather than on sessions and queries, which keeps business rules readable
and makes swapping the storage engine a contained change.
"""

from app.repositories.menu import MenuRepository
from app.repositories.order import OrderRepository

__all__ = ["MenuRepository", "OrderRepository"]
