import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    database_url: str = "sqlite:///./realestate.db"
    # Admin auth is fail-closed: with no token configured, admin endpoints return 503.
    admin_token: str = ""
    rate_limit_submissions: int = 5
    rate_limit_window_seconds: int = 3600
    upload_dir: str = "./uploads"
    # Photos are compressed client-side to ~150KB; 2MB leaves headroom without
    # letting a hostile client fill the disk quickly.
    max_photo_bytes: int = 2_000_000

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            database_url=os.environ.get("DATABASE_URL", cls.database_url),
            admin_token=os.environ.get("ADMIN_TOKEN", ""),
            rate_limit_submissions=int(os.environ.get("RATE_LIMIT_SUBMISSIONS", "5")),
            rate_limit_window_seconds=int(os.environ.get("RATE_LIMIT_WINDOW_SECONDS", "3600")),
            upload_dir=os.environ.get("UPLOAD_DIR", cls.upload_dir),
            max_photo_bytes=int(os.environ.get("MAX_PHOTO_BYTES", str(cls.max_photo_bytes))),
        )
