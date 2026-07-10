import secrets
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Header, HTTPException, Query, Request, UploadFile
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..deps import get_db, limit_photo_uploads, limit_submissions
from ..models import Listing, ListingStatus, Photo
from ..schemas import (
    ListingSubmission,
    PhotoUploadResponse,
    PropertyType,
    PublicListingCard,
    PublicListingDetail,
    SubmissionResponse,
)

router = APIRouter(prefix="/api/listings", tags=["public"])

# Every public read in this router MUST filter on status == APPROVED (CLAUDE.md Rule 2).
APPROVED = ListingStatus.APPROVED.value

MAX_PHOTOS = 8

# Type is validated by magic bytes, not the client-supplied Content-Type.
MAGIC_BYTES = {
    b"\xff\xd8\xff": "jpg",
    b"\x89PNG\r\n\x1a\n": "png",
}


def sniff_extension(data: bytes) -> str | None:
    for magic, ext in MAGIC_BYTES.items():
        if data.startswith(magic):
            return ext
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


@router.post("", status_code=201, response_model=SubmissionResponse,
             dependencies=[Depends(limit_submissions)])
def submit_listing(payload: ListingSubmission, db: Session = Depends(get_db)):
    listing = Listing(
        **payload.model_dump(),
        status=ListingStatus.PENDING.value,
        photo_token=secrets.token_urlsafe(24),
    )
    db.add(listing)
    db.commit()
    return SubmissionResponse(
        id=listing.id,
        status=listing.status,
        message="Your listing is under review. It will go live once verified.",
        photo_token=listing.photo_token,
    )


@router.post("/{listing_id}/photos", status_code=201, response_model=PhotoUploadResponse,
             dependencies=[Depends(limit_photo_uploads)])
async def upload_photo(
    listing_id: int,
    request: Request,
    photo: UploadFile = File(...),
    x_photo_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    listing = db.scalar(select(Listing).where(Listing.id == listing_id))
    # Missing listing and bad token answer identically, so the endpoint cannot be
    # used to probe which listing ids exist.
    if (
        listing is None
        or not x_photo_token
        or not listing.photo_token
        or not secrets.compare_digest(x_photo_token.encode(), listing.photo_token.encode())
    ):
        raise HTTPException(status_code=404, detail="Listing not found")
    if listing.status != ListingStatus.PENDING.value:
        raise HTTPException(status_code=409, detail="This listing has already been reviewed")
    if len(listing.photos) >= MAX_PHOTOS:
        raise HTTPException(status_code=409, detail=f"A listing can have at most {MAX_PHOTOS} photos")

    settings = request.app.state.settings
    data = await photo.read(settings.max_photo_bytes + 1)
    if len(data) > settings.max_photo_bytes:
        raise HTTPException(status_code=413, detail="Photo is too large")
    ext = sniff_extension(data)
    if ext is None:
        raise HTTPException(status_code=415, detail="Photo must be a JPEG, PNG or WebP image")

    filename = f"{uuid.uuid4().hex}.{ext}"
    upload_dir = Path(settings.upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)
    (upload_dir / filename).write_bytes(data)

    db.add(Photo(listing_id=listing.id, filename=filename))
    db.commit()
    db.refresh(listing)
    return PhotoUploadResponse(
        photo_url=f"/uploads/{filename}", photo_count=len(listing.photos)
    )


@router.get("", response_model=list[PublicListingCard])
def list_approved(
    q: str | None = Query(default=None, max_length=120, description="Location or title text"),
    property_type: PropertyType | None = None,
    min_rent: int | None = Query(default=None, ge=0),
    max_rent: int | None = Query(default=None, ge=0),
    limit: int = Query(default=20, ge=1, le=50),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
):
    # Filters only ever narrow the mandatory APPROVED clause; they can never widen it.
    stmt = select(Listing).where(Listing.status == APPROVED)
    if q and q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                Listing.district.ilike(like),
                Listing.area.ilike(like),
                Listing.landmark.ilike(like),
                Listing.title.ilike(like),
            )
        )
    if property_type is not None:
        stmt = stmt.where(Listing.property_type == property_type.value)
    if min_rent is not None:
        stmt = stmt.where(Listing.rent_ugx >= min_rent)
    if max_rent is not None:
        stmt = stmt.where(Listing.rent_ugx <= max_rent)
    rows = db.scalars(
        stmt.order_by(Listing.reviewed_at.desc(), Listing.id.desc())
        .limit(limit)
        .offset(offset)
    )
    return list(rows)


@router.get("/{listing_id}", response_model=PublicListingDetail)
def get_approved(listing_id: int, db: Session = Depends(get_db)):
    listing = db.scalar(
        select(Listing).where(Listing.id == listing_id, Listing.status == APPROVED)
    )
    if listing is None:
        # Non-approved listings 404 identically to nonexistent ones: their
        # existence is never acknowledged publicly.
        raise HTTPException(status_code=404, detail="Listing not found")
    return listing
