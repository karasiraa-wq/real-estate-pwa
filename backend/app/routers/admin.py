from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..deps import get_db, require_admin
from ..models import Listing, ListingStatus, utcnow
from ..schemas import AdminListing, RejectRequest

router = APIRouter(
    prefix="/api/admin/listings",
    tags=["admin"],
    dependencies=[Depends(require_admin)],
)


@router.get("", response_model=list[AdminListing])
def review_queue(
    status: ListingStatus = Query(default=ListingStatus.PENDING),
    db: Session = Depends(get_db),
):
    # Queue is oldest-first so the longest-waiting landlord is reviewed first.
    rows = db.scalars(
        select(Listing)
        .where(Listing.status == status.value)
        .order_by(Listing.created_at.asc(), Listing.id.asc())
    )
    return list(rows)


def _get_pending(db: Session, listing_id: int) -> Listing:
    listing = db.get(Listing, listing_id)
    if listing is None:
        raise HTTPException(status_code=404, detail="Listing not found")
    if listing.status != ListingStatus.PENDING.value:
        # Lifecycle is pending -> approved | rejected only; no re-reviews in MVP.
        raise HTTPException(
            status_code=409,
            detail=f"Listing is already {listing.status}; only pending listings can be reviewed",
        )
    return listing


@router.post("/{listing_id}/approve", response_model=AdminListing)
def approve(listing_id: int, db: Session = Depends(get_db)):
    listing = _get_pending(db, listing_id)
    listing.status = ListingStatus.APPROVED.value
    listing.reviewed_at = utcnow()
    db.commit()
    return listing


@router.post("/{listing_id}/reject", response_model=AdminListing)
def reject(listing_id: int, payload: RejectRequest | None = None, db: Session = Depends(get_db)):
    listing = _get_pending(db, listing_id)
    listing.status = ListingStatus.REJECTED.value
    listing.rejection_reason = payload.reason if payload else None
    listing.reviewed_at = utcnow()
    db.commit()
    return listing
