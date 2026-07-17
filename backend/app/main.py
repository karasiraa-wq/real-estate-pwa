"""App factory. Run locally with:

    uvicorn app.main:create_app --factory --reload

Configuration comes from the environment (see app/config.py); ADMIN_TOKEN must be
set or every admin endpoint returns 503 (fail closed, never fail open).
"""
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from .config import Settings
from .deps import SlidingWindowLimiter
from .migrations import upgrade_schema
from .models import Base
from .routers import admin, public, tenants


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    engine = create_engine(settings.database_url, connect_args={"check_same_thread": False})
    upgrade_schema(engine)
    Base.metadata.create_all(engine)

    app = FastAPI(title="Real Estate PWA API")
    app.state.settings = settings
    app.state.sessionmaker = sessionmaker(bind=engine, expire_on_commit=False)
    app.state.submission_limiter = SlidingWindowLimiter(
        settings.rate_limit_submissions, settings.rate_limit_window_seconds
    )
    # A submitter legitimately uploads up to 8 photos per listing.
    app.state.photo_limiter = SlidingWindowLimiter(
        settings.rate_limit_submissions * public.MAX_PHOTOS,
        settings.rate_limit_window_seconds,
    )
    app.state.tenant_limiter = SlidingWindowLimiter(
        settings.rate_limit_tenant_ops, settings.rate_limit_window_seconds
    )
    app.include_router(public.router)
    app.include_router(tenants.router)
    app.include_router(admin.router)

    upload_dir = Path(settings.upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)
    # Photo files use unguessable uuid4 names and their URLs only appear in API
    # responses once a listing is approved, so static serving stays within the
    # approval-gate invariant.
    app.mount("/uploads", StaticFiles(directory=upload_dir), name="uploads")
    return app
