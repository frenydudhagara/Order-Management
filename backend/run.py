"""Development entry point: `python run.py`.

Equivalent to `uvicorn app.main:app --reload`, but it works the same on Windows
and POSIX without remembering the flags.
"""

import uvicorn

from app.config import settings

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host="127.0.0.1",
        port=8000,
        reload=settings.debug,
        log_level="debug" if settings.debug else "info",
    )
