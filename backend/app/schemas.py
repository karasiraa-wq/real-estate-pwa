import enum
import re
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .models import ListingCategory, PaymentProduct


class PropertyType(str, enum.Enum):
    SINGLE_ROOM = "single_room"
    SELF_CONTAINED = "self_contained"
    APARTMENT = "apartment"
    HOUSE = "house"


class LandTenure(str, enum.Enum):
    FREEHOLD = "freehold"
    MAILO = "mailo"
    LEASEHOLD = "leasehold"
    CUSTOMARY = "customary"


class TitleStatus(str, enum.Enum):
    HAS_TITLE = "has_title"
    NO_TITLE = "no_title"
    PROCESSING = "processing"


# Ugandan mobile numbers: 07XXXXXXXX or +2567XXXXXXXX (9 digits after the country code).
UG_PHONE = re.compile(r"^(?:\+?256|0)(7\d{8})$")

# Only YouTube links are accepted; we never host or store video files
# (3G budget + zero storage cost). Captures the 11-char video id.
YOUTUBE_URL = re.compile(
    r"^https?://(?:www\.|m\.)?"
    r"(?:youtube\.com/(?:watch\?(?:[^#\s]*&)?v=|shorts/)|youtu\.be/)"
    r"([A-Za-z0-9_-]{11})(?:[?&#][^\s]*)?$"
)

# Uganda's bounding box; anything outside is a mistake or a lie.
UG_LAT_MIN, UG_LAT_MAX = -1.6, 4.3
UG_LNG_MIN, UG_LNG_MAX = 29.5, 35.1


def normalize_ug_phone(v: str) -> str:
    m = UG_PHONE.match(re.sub(r"[\s\-]", "", v))
    if not m:
        raise ValueError("must be a Ugandan mobile number, e.g. 0771234567 or +256771234567")
    return f"+256{m.group(1)}"


class ListingSubmission(BaseModel):
    model_config = ConfigDict(use_enum_values=True, str_strip_whitespace=True)

    category: ListingCategory = ListingCategory.RENTAL
    title: str = Field(min_length=5, max_length=120)
    # Required for rentals (enforced below); land listings are stored with
    # property_type "land".
    property_type: PropertyType | None = None
    district: str = Field(min_length=2, max_length=64)
    area: str = Field(min_length=2, max_length=120)
    landmark: str | None = Field(default=None, max_length=200)
    rent_ugx: int | None = Field(default=None, gt=0, le=100_000_000)
    # Land-only fields.
    asking_price_ugx: int | None = Field(default=None, gt=0, le=100_000_000_000)
    plot_size: str | None = Field(default=None, min_length=2, max_length=40)
    tenure: LandTenure | None = None
    title_status: TitleStatus | None = None
    # Optional for both categories.
    video_url: str | None = Field(default=None, max_length=200)
    latitude: float | None = Field(default=None, ge=UG_LAT_MIN, le=UG_LAT_MAX)
    longitude: float | None = Field(default=None, ge=UG_LNG_MIN, le=UG_LNG_MAX)
    description: str = Field(min_length=10, max_length=5000)
    landlord_name: str = Field(min_length=2, max_length=80)
    whatsapp_phone: str

    @field_validator("whatsapp_phone")
    @classmethod
    def normalize_phone(cls, v: str) -> str:
        return normalize_ug_phone(v)

    @field_validator("video_url")
    @classmethod
    def youtube_only(cls, v: str | None) -> str | None:
        if v is None or v == "":
            return None
        if not YOUTUBE_URL.match(v):
            raise ValueError(
                "must be a YouTube link, e.g. https://youtu.be/VIDEOID or "
                "https://www.youtube.com/watch?v=VIDEOID"
            )
        return v

    @model_validator(mode="after")
    def per_category_rules(self) -> "ListingSubmission":
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("provide both latitude and longitude, or neither")
        if self.category == ListingCategory.LAND.value:
            missing = [
                name
                for name in ("plot_size", "tenure", "title_status", "asking_price_ugx")
                if getattr(self, name) is None
            ]
            if missing:
                raise ValueError(f"land listings require: {', '.join(missing)}")
            # Land is priced by asking price and typed as land; a stray rent or
            # rental property_type would corrupt feed filters.
            self.rent_ugx = None
            self.property_type = "land"
        else:
            if self.property_type is None:
                raise ValueError("property_type is required for rental listings")
            if self.rent_ugx is None:
                raise ValueError("rent_ugx is required for rental listings")
            self.asking_price_ugx = None
            self.plot_size = None
            self.tenure = None
            self.title_status = None
        return self


class SubmissionResponse(BaseModel):
    id: int
    status: str
    message: str
    # Secret the submitter needs to attach photos; never exposed anywhere else.
    photo_token: str


class PhotoUploadResponse(BaseModel):
    photo_url: str
    photo_count: int


class PublicListingCard(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    category: str
    property_type: str
    district: str
    area: str
    rent_ugx: int | None = None
    # Land-only fields; null on rentals.
    asking_price_ugx: int | None = None
    plot_size: str | None = None
    tenure: str | None = None
    title_status: str | None = None
    photo_url: str | None = None
    # Rental access tier ("standard" | "premium" by rent vs the threshold).
    # Only populated while the paywall is live, so the dark-launch UI is
    # byte-identical to today; always null for land.
    tier: str | None = None


class PublicListingDetail(PublicListingCard):
    # PAYWALL INVARIANT: whatsapp_phone must never be a field on any public
    # schema. The contact is only ever served by the authenticated
    # /api/listings/{id}/contact endpoint after a server-side entitlement check.
    #
    # LOCATION PRIVACY: exact rental coordinates are gated the same way. The
    # only coordinate fields on public schemas are the model's public_* values
    # (exact for land, ~150-300m displaced for rentals) — never Listing.latitude.
    landmark: str | None
    description: str
    landlord_name: str
    created_at: datetime
    video_url: str | None = None
    public_latitude: float | None = None
    public_longitude: float | None = None
    location_approximate: bool = True
    photo_urls: list[str] = []


class AdminListing(PublicListingDetail):
    whatsapp_phone: str
    # Exact coordinates: the admin reviews what the landlord actually pinned.
    latitude: float | None = None
    longitude: float | None = None
    status: str
    rejection_reason: str | None
    reviewed_at: datetime | None


class RejectRequest(BaseModel):
    reason: str | None = Field(default=None, max_length=500)


# --- Tenant paywall ---------------------------------------------------------


class TenantRegister(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    phone: str

    @field_validator("phone")
    @classmethod
    def normalize(cls, v: str) -> str:
        return normalize_ug_phone(v)


class TenantRegisterResponse(BaseModel):
    # The opaque bearer token is returned exactly once; only its hash is stored.
    token: str
    phone: str


class TenantMe(BaseModel):
    phone: str
    # Rental credits keep the original field name so existing clients are unaffected.
    credits_remaining: int
    land_credits_remaining: int
    reveals_count: int
    # Lets the client hide all payment UI while the paywall ships dark.
    paywall_enabled: bool
    # Premium Day Pass state. "active" | "none" | "expired"; an exhausted but
    # unexpired pass reports active with 0 reveals remaining.
    premium_pass_status: str = "none"
    premium_pass_expires_at: datetime | None = None
    premium_pass_reveals_remaining: int | None = None


class ContactResponse(BaseModel):
    whatsapp_phone: str
    # Exact coordinates ride with the contact: for rentals this is the only
    # place they are ever served ("Get directions" after a paid reveal).
    latitude: float | None = None
    longitude: float | None = None
    credits_remaining: int
    # Reveals left on the tenant's active day pass; null when no active pass.
    pass_reveals_remaining: int | None = None


def _reconcile_product(payload) -> None:
    """Old clients send only category (rental|land); new ones send product.
    Whichever arrives, both fields end up consistent."""
    if payload.product is None:
        payload.product = (
            PaymentProduct.LAND.value
            if payload.category == ListingCategory.LAND.value
            else PaymentProduct.STANDARD_RENTAL.value
        )
    # A premium pass is a rental product; land credits are the land product.
    payload.category = (
        ListingCategory.LAND.value
        if payload.product == PaymentProduct.LAND.value
        else ListingCategory.RENTAL.value
    )


class PaymentClaimCreate(BaseModel):
    model_config = ConfigDict(use_enum_values=True, str_strip_whitespace=True)

    momo_tx_id: str = Field(min_length=4, max_length=64, pattern=r"^[A-Za-z0-9.\-]+$")
    category: ListingCategory = ListingCategory.RENTAL
    product: PaymentProduct | None = None

    @model_validator(mode="after")
    def reconcile(self) -> "PaymentClaimCreate":
        _reconcile_product(self)
        return self


class PaymentClaimResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    momo_tx_id: str
    category: str
    product: str
    status: str
    created_at: datetime


class AdminPaymentClaim(PaymentClaimResponse):
    tenant_phone: str


class ManualGrantRequest(BaseModel):
    model_config = ConfigDict(use_enum_values=True, str_strip_whitespace=True)

    phone: str
    momo_tx_id: str = Field(min_length=4, max_length=64, pattern=r"^[A-Za-z0-9.\-]+$")
    # Only meaningful for credit bundles; a day pass has a fixed reveal cap.
    credits: int | None = Field(default=None, gt=0, le=1000)
    category: ListingCategory = ListingCategory.RENTAL
    product: PaymentProduct | None = None

    @field_validator("phone")
    @classmethod
    def normalize(cls, v: str) -> str:
        return normalize_ug_phone(v)

    @model_validator(mode="after")
    def reconcile(self) -> "ManualGrantRequest":
        _reconcile_product(self)
        return self


class GrantResponse(BaseModel):
    id: int
    tenant_phone: str
    # Credits granted for bundle products; null for a premium pass.
    credits: int | None = None
    category: str
    product: str
    momo_tx_id: str
    source: str
    # Premium pass only: when the granted pass stops working.
    expires_at: datetime | None = None
