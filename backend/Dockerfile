# Slim image, non-root user, dependencies cached separately from source.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Copied first so a source-only change does not reinstall dependencies.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# Never run the app as root.
RUN useradd --create-home --uid 1001 appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

# One worker on purpose: WebSocket fan-out is in-process, so a second worker
# would only reach its own subscribers. Scaling out needs a shared broker
# (Redis pub/sub) behind the ConnectionManager first.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]
