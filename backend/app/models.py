import enum
import hashlib
import math
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class ListingStatus(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class ListingCategory(str, enum.Enum):
    RENTAL = "rental"
    LAND = "land"


class PaymentProduct(str, enum.Enum):
    """What a payment buys: a standard rental credit bundle, a Premium Day
    Pass (rentals above the tier threshold), or a land credit bundle."""

    STANDARD_RENTAL = "standard_rental"
    PREMIUM_PASS = "premium_pass"
    LAND = "land"


KAMPALA = ZoneInfo("Africa/Kampala")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def as_utc(dt: datetime) -> datetime:
    """SQLite drops tzinfo on storage; datetimes we wrote are UTC wall time,
    so re-attach UTC when they come back naive."""
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def next_kampala_midnight(now: datetime) -> datetime:
    """A Premium Day Pass is a calendar-day product for Ugandan users: it
    expires at the midnight AFTER `now` in Africa/Kampala (EAT, UTC+3), not
    midnight UTC. Returned as an aware UTC datetime."""
    local = as_utc(now).astimezone(KAMPALA)
    midnight = (local + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return midnight.astimezone(timezone.utc)


class Base(DeclarativeBase):
    pass


class Listing(Base):
    __tablename__ = "listings"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(120))
    category: Mapped[str] = mapped_column(
        String(16), default=ListingCategory.RENTAL.value, server_default="rental", index=True
    )
    property_type: Mapped[str] = mapped_column(String(32))
    district: Mapped[str] = mapped_column(String(64))
    area: Mapped[str] = mapped_column(String(120))
    landmark: Mapped[str | None] = mapped_column(String(200))
    # Rentals price by monthly rent; land by asking price. Exactly one is set.
    rent_ugx: Mapped[int | None]
    asking_price_ugx: Mapped[int | None]
    plot_size: Mapped[str | None] = mapped_column(String(40))
    tenure: Mapped[str | None] = mapped_column(String(16))
    title_status: Mapped[str | None] = mapped_column(String(16))
    # Only ever a validated YouTube URL; video files are never stored here.
    video_url: Mapped[str | None] = mapped_column(String(200))
    # Exact coordinates. For rentals these are paid content (see public_latitude);
    # for land they are public because location is intrinsic to land value.
    latitude: Mapped[float | None]
    longitude: Mapped[float | None]
    description: Mapped[str] = mapped_column(Text)
    landlord_name: Mapped[str] = mapped_column(String(80))
    whatsapp_phone: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(
        String(16), default=ListingStatus.PENDING.value, index=True
    )
    # Only ever exposed on admin endpoints (PRD: "never shown publicly").
    rejection_reason: Mapped[str | None] = mapped_column(Text)
    # Secret returned only to the submitter; required to attach photos to the listing.
    photo_token: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    photos: Mapped[list["Photo"]] = relationship(
        back_populates="listing", order_by="Photo.id", lazy="selectin"
    )

    @property
    def photo_urls(self) -> list[str]:
        return [f"/uploads/{p.filename}" for p in self.photos]

    @property
    def photo_url(self) -> str | None:
        return self.photo_urls[0] if self.photos else None

    # LOCATION PRIVACY RULE: a rental's exact coordinates are paid content,
    # gated exactly like the WhatsApp number. Public responses only ever see
    # these public_* values: exact for land, displaced ~150-300m for rentals.
    # The offset is derived from the listing's own secret (photo_token), so it
    # is stable across requests but cannot be reversed by someone who reads
    # this code.
    def _approx_coords(self) -> tuple[float, float]:
        digest = hashlib.sha256(f"approx-loc:{self.photo_token}:{self.id}".encode()).digest()
        angle = digest[0] / 256 * 2 * math.pi
        meters = 150 + (digest[1] / 256) * 150
        dlat = meters * math.cos(angle) / 111_320
        dlng = meters * math.sin(angle) / (111_320 * math.cos(math.radians(self.latitude)))
        return round(self.latitude + dlat, 5), round(self.longitude + dlng, 5)

    @property
    def location_approximate(self) -> bool:
        return self.category != ListingCategory.LAND.value

    @property
    def public_latitude(self) -> float | None:
        if self.latitude is None:
            return None
        return self.latitude if not self.location_approximate else self._approx_coords()[0]

    @property
    def public_longitude(self) -> float | None:
        if self.longitude is None:
            return None
        return self.longitude if not self.location_approximate else self._approx_coords()[1]


class Tenant(Base):
    """Minimal phone-based tenant identity. Auth is an opaque bearer token
    handed out once at registration and stored only as a SHA-256 hash; the
    shape leaves room to bolt on OTP verification later without a migration
    of the auth model."""

    __tablename__ = "tenants"

    id: Mapped[int] = mapped_column(primary_key=True)
    phone: Mapped[str] = mapped_column(String(16), unique=True, index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class CreditGrant(Base):
    """One purchase of reveal credits, granted manually by the admin after
    verifying a mobile-money payment. momo_tx_id is unique so the same
    payment can never be redeemed twice (via claim or manual grant)."""

    __tablename__ = "credit_grants"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    credits: Mapped[int]
    source: Mapped[str] = mapped_column(String(16))  # "claim" | "manual"
    # Credits are category-scoped: rental credits can never reveal land
    # contacts and vice versa (land is priced separately).
    category: Mapped[str] = mapped_column(
        String(16), default=ListingCategory.RENTAL.value, server_default="rental"
    )
    momo_tx_id: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Reveal(Base):
    """A tenant's paid (or flag-off free) access to one listing's contact.
    charged=False rows record flag-off reveals so they never count against
    credits bought later. The UNIQUE pair makes re-reveals free by design."""

    __tablename__ = "reveals"
    __table_args__ = (UniqueConstraint("tenant_id", "listing_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    listing_id: Mapped[int] = mapped_column(ForeignKey("listings.id"), index=True)
    charged: Mapped[bool] = mapped_column(default=True)
    # Denormalized from the listing at spend time so balance math per category
    # never needs a join inside the atomic-spend statement.
    category: Mapped[str] = mapped_column(
        String(16), default=ListingCategory.RENTAL.value, server_default="rental"
    )
    # Set when a Premium Day Pass covered this reveal (charged stays False:
    # pass usage is metered on the pass itself, never against credit bundles).
    premium_pass_id: Mapped[int | None] = mapped_column(ForeignKey("premium_passes.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class PremiumPass(Base):
    """A Premium Day Pass: unlocks ALL rental listings (both tiers, never
    land) from admin approval until midnight Africa/Kampala of that same day,
    capped at settings.premium_pass_max_reveals reveals. expires_at is
    computed at grant time; validity checks and the reveals_used increment
    are done atomically in SQL against these columns."""

    __tablename__ = "premium_passes"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    granted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    reveals_used: Mapped[int] = mapped_column(default=0)
    source: Mapped[str] = mapped_column(String(16))  # "claim" | "manual"
    # Unique here AND cross-checked against credit_grants: one MoMo payment
    # can never buy both a pass and a credit bundle.
    momo_tx_id: Mapped[str] = mapped_column(String(64), unique=True)


class PaymentClaim(Base):
    """Tenant-submitted 'I paid, here is my MoMo transaction ID' claim,
    verified by the owner on their phone and approved from the admin panel."""

    __tablename__ = "payment_claims"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    momo_tx_id: Mapped[str] = mapped_column(String(64), unique=True)
    # Which credit bundle the tenant paid for; approval grants that category.
    # Kept alongside product for pre-tiering clients that only send category.
    category: Mapped[str] = mapped_column(
        String(16), default=ListingCategory.RENTAL.value, server_default="rental"
    )
    # What approval delivers: standard_rental | premium_pass | land.
    product: Mapped[str] = mapped_column(
        String(16),
        default=PaymentProduct.STANDARD_RENTAL.value,
        server_default="standard_rental",
    )
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Photo(Base):
    __tablename__ = "photos"

    id: Mapped[int] = mapped_column(primary_key=True)
    listing_id: Mapped[int] = mapped_column(ForeignKey("listings.id"), index=True)
    # Random (uuid4) name on disk, so files are not enumerable before approval.
    filename: Mapped[str] = mapped_column(String(80), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    listing: Mapped[Listing] = relationship(back_populates="photos")
