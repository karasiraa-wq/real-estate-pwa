import enum
import re
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


class PropertyType(str, enum.Enum):
    SINGLE_ROOM = "single_room"
    SELF_CONTAINED = "self_contained"
    APARTMENT = "apartment"
    HOUSE = "house"


# Ugandan mobile numbers: 07XXXXXXXX or +2567XXXXXXXX (9 digits after the country code).
UG_PHONE = re.compile(r"^(?:\+?256|0)(7\d{8})$")


class ListingSubmission(BaseModel):
    model_config = ConfigDict(use_enum_values=True, str_strip_whitespace=True)

    title: str = Field(min_length=5, max_length=120)
    property_type: PropertyType
    district: str = Field(min_length=2, max_length=64)
    area: str = Field(min_length=2, max_length=120)
    landmark: str | None = Field(default=None, max_length=200)
    rent_ugx: int = Field(gt=0, le=100_000_000)
    description: str = Field(min_length=10, max_length=5000)
    landlord_name: str = Field(min_length=2, max_length=80)
    whatsapp_phone: str

    @field_validator("whatsapp_phone")
    @classmethod
    def normalize_phone(cls, v: str) -> str:
        m = UG_PHONE.match(re.sub(r"[\s\-]", "", v))
        if not m:
            raise ValueError("must be a Ugandan mobile number, e.g. 0771234567 or +256771234567")
        return f"+256{m.group(1)}"


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
    property_type: str
    district: str
    area: str
    rent_ugx: int
    photo_url: str | None = None


class PublicListingDetail(PublicListingCard):
    landmark: str | None
    description: str
    landlord_name: str
    whatsapp_phone: str
    created_at: datetime
    photo_urls: list[str] = []


class AdminListing(PublicListingDetail):
    status: str
    rejection_reason: str | None
    reviewed_at: datetime | None


class RejectRequest(BaseModel):
    reason: str | None = Field(default=None, max_length=500)
