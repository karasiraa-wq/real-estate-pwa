import secrets
import time
from collections import defaultdict, deque

from fastapi import Header, HTTPException, Request


def get_db(request: Request):
    db = request.app.state.sessionmaker()
    try:
        yield db
    finally:
        db.close()


def require_admin(request: Request, x_admin_token: str | None = Header(default=None)):
    """Fail-closed admin gate: 503 if no token is configured, 401 on missing/bad token."""
    configured = request.app.state.settings.admin_token
    if not configured:
        raise HTTPException(status_code=503, detail="Admin interface is not configured")
    if not x_admin_token or not secrets.compare_digest(
        x_admin_token.encode(), configured.encode()
    ):
        raise HTTPException(status_code=401, detail="Invalid admin credentials")


class SlidingWindowLimiter:
    """Per-key in-memory rate limiter. Single-process only, which matches the
    MVP deployment (one uvicorn worker + SQLite)."""

    def __init__(self, limit: int, window_seconds: int):
        self.limit = limit
        self.window = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        q = self._hits[key]
        while q and now - q[0] > self.window:
            q.popleft()
        if len(q) >= self.limit:
            return False
        q.append(now)
        return True


def limit_submissions(request: Request):
    ip = request.client.host if request.client else "unknown"
    if not request.app.state.submission_limiter.allow(ip):
        raise HTTPException(
            status_code=429,
            detail="Too many submissions from this device. Please try again later.",
        )


def limit_photo_uploads(request: Request):
    ip = request.client.host if request.client else "unknown"
    if not request.app.state.photo_limiter.allow(ip):
        raise HTTPException(
            status_code=429,
            detail="Too many photo uploads. Please try again later.",
        )
