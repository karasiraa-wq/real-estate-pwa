import enum
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class ListingStatus(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class Listing(Base):
    __tablename__ = "listings"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(120))
    property_type: Mapped[str] = mapped_column(String(32))
    district: Mapped[str] = mapped_column(String(64))
    area: Mapped[str] = mapped_column(String(120))
    landmark: Mapped[str | None] = mapped_column(String(200))
    rent_ugx: Mapped[int]
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


class Photo(Base):
    __tablename__ = "photos"

    id: Mapped[int] = mapped_column(primary_key=True)
    listing_id: Mapped[int] = mapped_column(ForeignKey("listings.id"), index=True)
    # Random (uuid4) name on disk, so files are not enumerable before approval.
    filename: Mapped[str] = mapped_column(String(80), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    listing: Mapped[Listing] = relationship(back_populates="photos")
