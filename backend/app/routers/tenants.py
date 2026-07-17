"""Tenant paywall: phone-based identity, credit balance, payment claims, and
the ONLY code path that ever serves a landlord's WhatsApp number to the public
side of the app. Entitlement is enforced server-side here (CLAUDE.md Rule 6 /
the paywall invariant); the frontend can never bypass it.
"""
import secrets

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, insert, literal, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..config import Settings
from ..deps import get_db, hash_token, limit_tenant_ops, rental_tier, require_tenant
from ..models import (
    CreditGrant,
    Listing,
    ListingCategory,
    ListingStatus,
    PaymentClaim,
    PaymentProduct,
    PremiumPass,
    Reveal,
    Tenant,
    as_utc,
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


def latest_pass(db: Session, tenant_id: int) -> PremiumPass | None:
    return db.scalar(
        select(PremiumPass)
        .where(PremiumPass.tenant_id == tenant_id)
        .order_by(PremiumPass.expires_at.desc(), PremiumPass.id.desc())
        .limit(1)
    )


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
    settings = request.app.state.settings
    reveals_count = db.scalar(
        select(func.count()).select_from(Reveal).where(Reveal.tenant_id == tenant.id)
    )
    # Day-pass status: an exhausted-but-unexpired pass is "active" with 0
    # reveals remaining (the tenant can see exactly what they have left).
    day_pass = latest_pass(db, tenant.id)
    if day_pass is None:
        pass_status, pass_expires, pass_remaining = "none", None, None
    elif as_utc(day_pass.expires_at) <= utcnow():
        pass_status, pass_expires, pass_remaining = "expired", as_utc(day_pass.expires_at), 0
    else:
        pass_status = "active"
        pass_expires = as_utc(day_pass.expires_at)
        pass_remaining = max(settings.premium_pass_max_reveals - day_pass.reveals_used, 0)
    return TenantMe(
        phone=tenant.phone,
        credits_remaining=credits_remaining(db, tenant.id, ListingCategory.RENTAL.value),
        land_credits_remaining=credits_remaining(db, tenant.id, ListingCategory.LAND.value),
        reveals_count=reveals_count,
        paywall_enabled=settings.paywall_enabled,
        premium_pass_status=pass_status,
        premium_pass_expires_at=pass_expires,
        premium_pass_reveals_remaining=pass_remaining,
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
    # A transaction ID already used by any claim, grant or pass can never buy again.
    already_granted = db.scalar(
        select(CreditGrant.id).where(CreditGrant.momo_tx_id == payload.momo_tx_id)
    ) or db.scalar(
        select(PremiumPass.id).where(PremiumPass.momo_tx_id == payload.momo_tx_id)
    )
    if already_granted is not None:
        raise HTTPException(status_code=409, detail="This transaction ID has already been used")
    claim = PaymentClaim(
        tenant_id=tenant.id,
        momo_tx_id=payload.momo_tx_id,
        category=payload.category,
        product=payload.product,
    )
    db.add(claim)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="This transaction ID has already been submitted")
    return claim


def _contact_payload(
    db: Session, tenant: Tenant, listing: Listing, settings: Settings
) -> ContactResponse:
    # Like /me: an unexpired pass reports its remaining reveals (0 when
    # exhausted); null only when there is no live pass at all.
    day_pass = latest_pass(db, tenant.id)
    pass_remaining = None
    if day_pass is not None and as_utc(day_pass.expires_at) > utcnow():
        pass_remaining = max(settings.premium_pass_max_reveals - day_pass.reveals_used, 0)
    return ContactResponse(
        whatsapp_phone=listing.whatsapp_phone,
        # Exact coordinates are part of the revealed contact (for rentals this
        # is the only endpoint that ever serves them).
        latitude=listing.latitude,
        longitude=listing.longitude,
        credits_remaining=credits_remaining(db, tenant.id, listing.category),
        pass_reveals_remaining=pass_remaining,
    )


def _spend_pass_reveal(
    db: Session, tenant: Tenant, listing: Listing, settings: Settings, now
) -> bool:
    """Cover this reveal with the tenant's day pass. The expiry and cap guards
    are re-checked INSIDE the UPDATE, so concurrent requests can never push
    reveals_used past the cap or spend an expired pass: SQLite serializes
    writers and the losing UPDATE matches zero rows."""
    cap = settings.premium_pass_max_reveals
    pass_id = db.scalar(
        select(PremiumPass.id)
        .where(
            PremiumPass.tenant_id == tenant.id,
            PremiumPass.expires_at > now,
            PremiumPass.reveals_used < cap,
        )
        .order_by(PremiumPass.expires_at.asc())
        .limit(1)
    )
    if pass_id is None:
        return False
    result = db.execute(
        update(PremiumPass)
        .where(
            PremiumPass.id == pass_id,
            PremiumPass.expires_at > now,
            PremiumPass.reveals_used < cap,
        )
        .values(reveals_used=PremiumPass.reveals_used + 1)
    )
    if result.rowcount == 0:
        db.rollback()  # lost a race for the last pass reveal
        return False
    # charged=False: pass reveals are metered on the pass, never against
    # credit bundles. Same transaction as the increment, so a duplicate-reveal
    # rollback undoes the reveals_used bump too.
    db.add(
        Reveal(
            tenant_id=tenant.id,
            listing_id=listing.id,
            charged=False,
            category=listing.category,
            premium_pass_id=pass_id,
        )
    )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()  # concurrent duplicate for the same listing: already revealed
    return True


def _payment_required(
    db: Session, tenant: Tenant, listing: Listing, settings: Settings, now
) -> HTTPException:
    """402 whose payload sells the right product for THIS listing: standard
    bundle for standard rentals, day pass for premium rentals, land bundle for
    land. Never leaks the contact."""
    category = listing.category
    if category == ListingCategory.LAND.value:
        tier = None
        product = PaymentProduct.LAND.value
        price, bundle = settings.land_price_ugx, settings.land_credits_per_purchase
    else:
        tier = rental_tier(listing, settings)
        if tier == "premium":
            product = PaymentProduct.PREMIUM_PASS.value
            price, bundle = settings.premium_pass_price_ugx, None
        else:
            product = PaymentProduct.STANDARD_RENTAL.value
            price, bundle = settings.price_ugx, settings.credits_per_purchase

    if product == PaymentProduct.PREMIUM_PASS.value:
        instructions = (
            f"Send UGX {price:,} by Mobile Money to {settings.momo_number} "
            f"({settings.momo_name}), then enter the transaction ID below. You get a "
            f"Premium Day Pass — access to ALL rental listings until midnight today, "
            f"up to {settings.premium_pass_max_reveals} contacts — once we verify the payment."
        )
    else:
        noun = "land" if category == ListingCategory.LAND.value else "rental"
        instructions = (
            f"Send UGX {price:,} by Mobile Money to "
            f"{settings.momo_number} ({settings.momo_name}), then enter the "
            f"transaction ID below. You get {bundle} {noun} contact reveals "
            "once we verify the payment."
        )

    detail = {
        "category": category,
        "tier": tier,
        "product": product,
        "credits_remaining": max(credits_remaining(db, tenant.id, category), 0),
        "price_ugx": price,
        "credits_per_purchase": bundle,
        "momo_number": settings.momo_number,
        "momo_name": settings.momo_name,
        "payment_instructions": instructions,
        "pending_claim": db.scalar(
            select(PaymentClaim.id).where(
                PaymentClaim.tenant_id == tenant.id,
                PaymentClaim.status == "pending",
                PaymentClaim.product == product,
            )
        )
        is not None,
    }
    if category != ListingCategory.LAND.value:
        # Why the pass didn't (or wouldn't) cover it: none | expired | exhausted.
        day_pass = latest_pass(db, tenant.id)
        if day_pass is None:
            detail["pass_status"] = "none"
        elif as_utc(day_pass.expires_at) <= now:
            detail["pass_status"] = "expired"
        elif day_pass.reveals_used >= settings.premium_pass_max_reveals:
            detail["pass_status"] = "exhausted"
        else:
            detail["pass_status"] = "active"  # unreachable outside a lost race
        detail["pass_price_ugx"] = settings.premium_pass_price_ugx
        detail["pass_max_reveals"] = settings.premium_pass_max_reveals
    return HTTPException(status_code=402, detail=detail)


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
        # Already-revealed listings stay accessible forever, regardless of
        # pass expiry or credit balance.
        return _contact_payload(db, tenant, listing, settings)

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
        return _contact_payload(db, tenant, listing, settings)

    now = utcnow()

    # Premium rentals (rent above the tier threshold) are day-pass ONLY:
    # standard credit bundles never unlock them.
    if category != ListingCategory.LAND.value and rental_tier(listing, settings) == "premium":
        if _spend_pass_reveal(db, tenant, listing, settings, now):
            return _contact_payload(db, tenant, listing, settings)
        raise _payment_required(db, tenant, listing, settings, now)

    # Standard rentals and land: atomic credit spend — the balance check and
    # the reveal insert are one SQL statement, so concurrent requests cannot
    # both spend the last credit; SQLite serializes writers and the losing
    # insert sees the updated balance. Only credits of the LISTING's category
    # count toward the balance.
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
        return _contact_payload(db, tenant, listing, settings)
    if result.rowcount == 0:
        # Out of standard credits: a valid day pass also covers standard
        # rentals (premium unlocks all rentals — but never land).
        if category != ListingCategory.LAND.value and _spend_pass_reveal(
            db, tenant, listing, settings, now
        ):
            return _contact_payload(db, tenant, listing, settings)
        raise _payment_required(db, tenant, listing, settings, now)
    return _contact_payload(db, tenant, listing, settings)
