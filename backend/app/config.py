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
    # Tenant paywall. Ships dark: with the flag off the contact endpoint grants
    # reveals without charging credits, but the WhatsApp number still never
    # appears in public list/detail responses.
    paywall_enabled: bool = False
    price_ugx: int = 5000
    credits_per_purchase: int = 20
    # Land is premium: its reveals are priced and bundled separately from
    # rentals, behind the same PAYWALL_ENABLED flag.
    land_price_ugx: int = 50_000
    land_credits_per_purchase: int = 3
    # Rental tiering: listings renting above the threshold are "premium" and
    # can only be revealed with a Premium Day Pass (valid until midnight
    # Africa/Kampala on the day it is granted, capped at max_reveals).
    rent_tier_threshold_ugx: int = 300_000
    premium_pass_price_ugx: int = 20_000
    premium_pass_max_reveals: int = 30
    momo_number: str = ""
    momo_name: str = ""
    # Per-IP cap on tenant registration + payment-claim submissions.
    rate_limit_tenant_ops: int = 30

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            database_url=os.environ.get("DATABASE_URL", cls.database_url),
            admin_token=os.environ.get("ADMIN_TOKEN", ""),
            rate_limit_submissions=int(os.environ.get("RATE_LIMIT_SUBMISSIONS", "5")),
            rate_limit_window_seconds=int(os.environ.get("RATE_LIMIT_WINDOW_SECONDS", "3600")),
            upload_dir=os.environ.get("UPLOAD_DIR", cls.upload_dir),
            max_photo_bytes=int(os.environ.get("MAX_PHOTO_BYTES", str(cls.max_photo_bytes))),
            paywall_enabled=os.environ.get("PAYWALL_ENABLED", "false").strip().lower()
            in ("1", "true", "yes", "on"),
            price_ugx=int(os.environ.get("PRICE_UGX", str(cls.price_ugx))),
            credits_per_purchase=int(
                os.environ.get("CREDITS_PER_PURCHASE", str(cls.credits_per_purchase))
            ),
            land_price_ugx=int(os.environ.get("LAND_PRICE_UGX", str(cls.land_price_ugx))),
            land_credits_per_purchase=int(
                os.environ.get("LAND_CREDITS_PER_PURCHASE", str(cls.land_credits_per_purchase))
            ),
            rent_tier_threshold_ugx=int(
                os.environ.get("RENT_TIER_THRESHOLD_UGX", str(cls.rent_tier_threshold_ugx))
            ),
            premium_pass_price_ugx=int(
                os.environ.get("PREMIUM_PASS_PRICE_UGX", str(cls.premium_pass_price_ugx))
            ),
            premium_pass_max_reveals=int(
                os.environ.get("PREMIUM_PASS_MAX_REVEALS", str(cls.premium_pass_max_reveals))
            ),
            momo_number=os.environ.get("MOMO_NUMBER", ""),
            momo_name=os.environ.get("MOMO_NAME", ""),
            rate_limit_tenant_ops=int(
                os.environ.get("RATE_LIMIT_TENANT_OPS", str(cls.rate_limit_tenant_ops))
            ),
        )
