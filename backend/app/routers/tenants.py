"""Tenant paywall: phone-based identity, credit balance, payment claims, and
the ONLY code path that ever serves a landlord's WhatsApp number to the public
side of the app. Entitlement is enforced server-side here (CLAUDE.md Rule 6 /
the paywall invariant); the frontend can never bypass it.
"""
import secrets

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, insert, literal, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..deps import get_db, hash_token, limit_tenant_ops, require_tenant
from ..models import (
    CreditGrant,
    Listing,
    ListingCategory,
    ListingStatus,
    PaymentClaim,
    Reveal,
    Tenant,
    utcnow,
)
from ..schemas import (
    ContactResponse,
    PaymentClaimCreate,
    PaymentClaimResponse,
    TenantMe,
    TenantRegister,
    TenantRegisterResponse,
)

router = APIRouter(tags=["tenants"])


def credits_remaining(db: Session, tenant_id: int, category: str) -> int:
    # Credits are category-scoped: a rental credit can never pay for a land
    # reveal and vice versa, so balances are computed per category.
    granted = db.scalar(
        select(func.coalesce(func.sum(CreditGrant.credits), 0)).where(
            CreditGrant.tenant_id == tenant_id, CreditGrant.category == category
        )
    )
    charged = db.scalar(
        select(func.count())
        .select_from(Reveal)
        .where(
            Reveal.tenant_id == tenant_id,
            Reveal.charged.is_(True),
            Reveal.category == category,
        )
    )
    return granted - charged


@router.post(
    "/api/tenants/register",
    status_code=201,
    response_model=TenantRegisterResponse,
    dependencies=[Depends(limit_tenant_ops)],
)
def register(payload: TenantRegister, db: Session = Depends(get_db)):
    # No OTP yet: possession of the phone number is implicitly verified at
    # payment time (the owner sees the paying MoMo number). Re-registering the
    # same phone rotates the token, which doubles as "log in again".
    token = secrets.token_urlsafe(32)
    tenant = db.scalar(select(Tenant).where(Tenant.phone == payload.phone))
    if tenant is None:
        tenant = Tenant(phone=payload.phone, token_hash=hash_token(token))
        db.add(tenant)
    else:
        tenant.token_hash = hash_token(token)
    db.commit()
    return TenantRegisterResponse(token=token, phone=tenant.phone)


@router.get("/api/tenants/me", response_model=TenantMe)
def me(request: Request, tenant: Tenant = Depends(require_tenant), db: Session = Depends(get_db)):
    reveals_count = db.scalar(
        select(func.count()).select_from(Reveal).where(Reveal.tenant_id == tenant.id)
    )
    return TenantMe(
        phone=tenant.phone,
        credits_remaining=credits_remaining(db, tenant.id, ListingCategory.RENTAL.value),
        land_credits_remaining=credits_remaining(db, tenant.id, ListingCategory.LAND.value),
        reveals_count=reveals_count,
        paywall_enabled=request.app.state.settings.paywall_enabled,
    )


@router.post(
    "/api/tenants/payment-claims",
    status_code=201,
    response_model=PaymentClaimResponse,
    dependencies=[Depends(limit_tenant_ops)],
)
def submit_payment_claim(
    payload: PaymentClaimCreate,
    tenant: Tenant = Depends(require_tenant),
    db: Session = Depends(get_db),
):
    # A transaction ID already used by any claim or grant can never buy again.
    already_granted = db.scalar(
        select(CreditGrant.id).where(CreditGrant.momo_tx_id == payload.momo_tx_id)
    )
    if already_granted is not None:
        raise HTTPException(status_code=409, detail="This transaction ID has already been used")
    claim = PaymentClaim(
        tenant_id=tenant.id, momo_tx_id=payload.momo_tx_id, category=payload.category
    )
    db.add(claim)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="This transaction ID has already been submitted")
    return claim


def _contact_payload(db: Session, tenant: Tenant, listing: Listing) -> ContactResponse:
    return ContactResponse(
        whatsapp_phone=listing.whatsapp_phone,
        # Exact coordinates are part of the revealed contact (for rentals this
        # is the only endpoint that ever serves them).
        latitude=listing.latitude,
        longitude=listing.longitude,
        credits_remaining=credits_remaining(db, tenant.id, listing.category),
    )


@router.post("/api/listings/{listing_id}/contact", response_model=ContactResponse)
def reveal_contact(
    listing_id: int,
    request: Request,
    tenant: Tenant = Depends(require_tenant),
    db: Session = Depends(get_db),
):
    settings = request.app.state.settings
    listing = db.scalar(
        # Same rule as the public detail endpoint: non-approved listings 404
        # identically to nonexistent ones.
        select(Listing).where(
            Listing.id == listing_id, Listing.status == ListingStatus.APPROVED.value
        )
    )
    if listing is None:
        raise HTTPException(status_code=404, detail="Listing not found")

    already = db.scalar(
        select(Reveal.id).where(Reveal.tenant_id == tenant.id, Reveal.listing_id == listing.id)
    )
    if already is not None:
        return _contact_payload(db, tenant, listing)

    category = listing.category
    if not settings.paywall_enabled:
        # Launch state: reveals are free but still recorded, uncharged, so they
        # never count against credits bought after the paywall turns on.
        db.add(
            Reveal(tenant_id=tenant.id, listing_id=listing.id, charged=False, category=category)
        )
        try:
            db.commit()
        except IntegrityError:
            db.rollback()  # lost a race with our own duplicate request: already revealed
        return _contact_payload(db, tenant, listing)

    # Atomic spend: the balance check and the reveal insert are one SQL
    # statement, so concurrent requests cannot both spend the last credit —
    # SQLite serializes writers and the losing insert sees the updated balance.
    # Only credits of the LISTING's category count toward the balance.
    granted = (
        select(func.coalesce(func.sum(CreditGrant.credits), 0))
        .where(CreditGrant.tenant_id == tenant.id, CreditGrant.category == category)
        .scalar_subquery()
    )
    charged = (
        select(func.count())
        .select_from(Reveal)
        .where(
            Reveal.tenant_id == tenant.id,
            Reveal.charged.is_(True),
            Reveal.category == category,
        )
        .scalar_subquery()
    )
    spend = insert(Reveal).from_select(
        ["tenant_id", "listing_id", "charged", "category", "created_at"],
        select(
            literal(tenant.id),
            literal(listing.id),
            literal(True),
            literal(category),
            literal(utcnow()),
        ).where(granted - charged > 0),
    )
    try:
        result = db.execute(spend)
        db.commit()
    except IntegrityError:
        db.rollback()  # concurrent duplicate for the same listing: it's revealed, no double charge
        return _contact_payload(db, tenant, listing)
    if result.rowcount == 0:
        if category == ListingCategory.LAND.value:
            price, bundle, noun = settings.land_price_ugx, settings.land_credits_per_purchase, "land"
        else:
            price, bundle, noun = settings.price_ugx, settings.credits_per_purchase, "rental"
        pending_claim = db.scalar(
            select(PaymentClaim.id).where(
                PaymentClaim.tenant_id == tenant.id,
                PaymentClaim.status == "pending",
                PaymentClaim.category == category,
            )
        )
        raise HTTPException(
            status_code=402,
            detail={
                "category": category,
                "credits_remaining": max(credits_remaining(db, tenant.id, category), 0),
                "price_ugx": price,
                "credits_per_purchase": bundle,
                "momo_number": settings.momo_number,
                "momo_name": settings.momo_name,
                "payment_instructions": (
                    f"Send UGX {price:,} by Mobile Money to "
                    f"{settings.momo_number} ({settings.momo_name}), then enter the "
                    f"transaction ID below. You get {bundle} {noun} contact reveals "
                    "once we verify the payment."
                ),
                "pending_claim": pending_claim is not None,
            },
        )
    return _contact_payload(db, tenant, listing)
