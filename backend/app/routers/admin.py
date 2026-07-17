from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..deps import get_db, require_admin
from ..models import (
    CreditGrant,
    Listing,
    ListingCategory,
    ListingStatus,
    PaymentClaim,
    PaymentProduct,
    PremiumPass,
    Tenant,
    as_utc,
    next_kampala_midnight,
    utcnow,
)
from ..schemas import (
    AdminListing,
    AdminPaymentClaim,
    GrantResponse,
    ManualGrantRequest,
    RejectRequest,
)

router = APIRouter(
    prefix="/api/admin",
    tags=["admin"],
    dependencies=[Depends(require_admin)],
)


@router.get("/listings", response_model=list[AdminListing])
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


@router.post("/listings/{listing_id}/approve", response_model=AdminListing)
def approve(listing_id: int, db: Session = Depends(get_db)):
    listing = _get_pending(db, listing_id)
    listing.status = ListingStatus.APPROVED.value
    listing.reviewed_at = utcnow()
    db.commit()
    return listing


@router.post("/listings/{listing_id}/reject", response_model=AdminListing)
def reject(listing_id: int, payload: RejectRequest | None = None, db: Session = Depends(get_db)):
    listing = _get_pending(db, listing_id)
    listing.status = ListingStatus.REJECTED.value
    listing.rejection_reason = payload.reason if payload else None
    listing.reviewed_at = utcnow()
    db.commit()
    return listing


# --- Paywall: payment claims and credit grants ------------------------------


@router.get("/payment-claims", response_model=list[AdminPaymentClaim])
def payment_claims(db: Session = Depends(get_db)):
    # Pending only, oldest first: this is the owner's verification work queue.
    rows = db.execute(
        select(PaymentClaim, Tenant.phone)
        .join(Tenant, PaymentClaim.tenant_id == Tenant.id)
        .where(PaymentClaim.status == "pending")
        .order_by(PaymentClaim.created_at.asc(), PaymentClaim.id.asc())
    ).all()
    return [
        AdminPaymentClaim(
            id=claim.id,
            momo_tx_id=claim.momo_tx_id,
            category=claim.category,
            product=claim.product,
            status=claim.status,
            created_at=claim.created_at,
            tenant_phone=phone,
        )
        for claim, phone in rows
    ]


def _tx_id_taken(db: Session, momo_tx_id: str) -> bool:
    """One MoMo payment buys exactly one product, ever: the unique constraint
    on each table is backed by this cross-table check (grant vs pass)."""
    return (
        db.scalar(select(CreditGrant.id).where(CreditGrant.momo_tx_id == momo_tx_id)) is not None
        or db.scalar(select(PremiumPass.id).where(PremiumPass.momo_tx_id == momo_tx_id))
        is not None
    )


def _create_grant(
    db: Session,
    request: Request,
    tenant: Tenant,
    momo_tx_id: str,
    credits: int | None,
    source: str,
    category: str,
) -> GrantResponse:
    settings = request.app.state.settings
    if _tx_id_taken(db, momo_tx_id):
        raise HTTPException(
            status_code=409, detail="This transaction ID has already been used for a grant"
        )
    # Each category has its own bundle size (land shoppers contact few sellers).
    default_bundle = (
        settings.land_credits_per_purchase
        if category == ListingCategory.LAND.value
        else settings.credits_per_purchase
    )
    grant = CreditGrant(
        tenant_id=tenant.id,
        credits=credits or default_bundle,
        source=source,
        category=category,
        momo_tx_id=momo_tx_id,
    )
    db.add(grant)
    try:
        db.commit()
    except IntegrityError:
        # momo_tx_id is unique across all grants: one payment buys credits once.
        db.rollback()
        raise HTTPException(
            status_code=409, detail="This transaction ID has already been used for a grant"
        )
    return GrantResponse(
        id=grant.id,
        tenant_phone=tenant.phone,
        credits=grant.credits,
        category=grant.category,
        product=(
            PaymentProduct.LAND.value
            if grant.category == ListingCategory.LAND.value
            else PaymentProduct.STANDARD_RENTAL.value
        ),
        momo_tx_id=grant.momo_tx_id,
        source=grant.source,
    )


def _create_pass(
    db: Session, request: Request, tenant: Tenant, momo_tx_id: str, source: str
) -> GrantResponse:
    """Grant a Premium Day Pass. The clock starts NOW — at admin approval,
    not when the tenant submitted the claim — and runs until the next
    midnight Africa/Kampala."""
    if _tx_id_taken(db, momo_tx_id):
        raise HTTPException(
            status_code=409, detail="This transaction ID has already been used for a grant"
        )
    now = utcnow()
    day_pass = PremiumPass(
        tenant_id=tenant.id,
        granted_at=now,
        expires_at=next_kampala_midnight(now),
        source=source,
        momo_tx_id=momo_tx_id,
    )
    db.add(day_pass)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409, detail="This transaction ID has already been used for a grant"
        )
    return GrantResponse(
        id=day_pass.id,
        tenant_phone=tenant.phone,
        credits=None,
        category=ListingCategory.RENTAL.value,
        product=PaymentProduct.PREMIUM_PASS.value,
        momo_tx_id=day_pass.momo_tx_id,
        source=day_pass.source,
        expires_at=as_utc(day_pass.expires_at),
    )


@router.post("/payment-claims/{claim_id}/approve", response_model=GrantResponse)
def approve_payment_claim(claim_id: int, request: Request, db: Session = Depends(get_db)):
    claim = db.get(PaymentClaim, claim_id)
    if claim is None:
        raise HTTPException(status_code=404, detail="Payment claim not found")
    if claim.status != "pending":
        raise HTTPException(status_code=409, detail=f"Payment claim is already {claim.status}")
    tenant = db.get(Tenant, claim.tenant_id)
    claim.status = "approved"
    if claim.product == PaymentProduct.PREMIUM_PASS.value:
        return _create_pass(db, request, tenant, claim.momo_tx_id, source="claim")
    return _create_grant(
        db,
        request,
        tenant,
        claim.momo_tx_id,
        credits=None,
        source="claim",
        category=claim.category,
    )


@router.post("/credit-grants", status_code=201, response_model=GrantResponse)
def manual_grant(payload: ManualGrantRequest, request: Request, db: Session = Depends(get_db)):
    # For tenants who pay without submitting a claim: the owner types the phone
    # number they see on the MoMo payment plus its transaction ID.
    tenant = db.scalar(select(Tenant).where(Tenant.phone == payload.phone))
    if tenant is None:
        raise HTTPException(
            status_code=404,
            detail="No tenant is registered with this phone number",
        )
    if payload.product == PaymentProduct.PREMIUM_PASS.value:
        return _create_pass(db, request, tenant, payload.momo_tx_id, source="manual")
    return _create_grant(
        db,
        request,
        tenant,
        payload.momo_tx_id,
        credits=payload.credits,
        source="manual",
        category=payload.category,
    )
