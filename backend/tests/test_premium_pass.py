"""Tiered rental pricing: rentals above RENT_TIER_THRESHOLD_UGX are premium
and can ONLY be revealed with a Premium Day Pass (valid from admin approval
until midnight Africa/Kampala that day, capped at PREMIUM_PASS_MAX_REVEALS).
A valid pass also covers standard rentals; standard credits never cover
premium listings; land is completely untouched by the pass.

Time is controlled by monkeypatching the utcnow name each router resolved at
import time: app.routers.admin.utcnow drives when a pass is granted (the
clock starts at APPROVAL) and app.routers.tenants.utcnow drives when a reveal
is attempted.
"""
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

import app.routers.admin as admin_router
import app.routers.tenants as tenants_router
from app.main import create_app
from conftest import ADMIN, VALID_LAND, approve, make_settings, submit

MOMO = dict(momo_number="0779999999", momo_name="Andrew K")

# 12:00 noon in Kampala (EAT = UTC+3) on 2026-07-17. Kampala midnight after it
# is 2026-07-18 00:00 EAT = 2026-07-17 21:00 UTC.
NOON_KAMPALA = datetime(2026, 7, 17, 9, 0, tzinfo=timezone.utc)
MIDNIGHT_UTC = datetime(2026, 7, 17, 21, 0, tzinfo=timezone.utc)


@pytest.fixture
def client_on(tmp_path):
    settings = make_settings(tmp_path, paywall_enabled=True, **MOMO)
    with TestClient(create_app(settings)) as c:
        yield c


def register(client, phone="0700111222") -> dict:
    r = client.post("/api/tenants/register", json={"phone": phone})
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def grant_credits(client, phone, tx_id, credits=None, category=None):
    payload = {"phone": phone, "momo_tx_id": tx_id}
    if credits is not None:
        payload["credits"] = credits
    if category is not None:
        payload["category"] = category
    return client.post("/api/admin/credit-grants", json=payload, headers=ADMIN)


def grant_pass(client, phone, tx_id):
    return client.post(
        "/api/admin/credit-grants",
        json={"phone": phone, "momo_tx_id": tx_id, "product": "premium_pass"},
        headers=ADMIN,
    )


def standard_listing(client) -> int:
    listing_id = submit(client, rent_ugx=250_000)
    approve(client, listing_id)
    return listing_id


def premium_listing(client, rent=800_000) -> int:
    listing_id = submit(client, rent_ugx=rent)
    approve(client, listing_id)
    return listing_id


def land_listing(client) -> int:
    listing_id = submit(client, **VALID_LAND)
    approve(client, listing_id)
    return listing_id


def contact(client, listing_id, auth):
    return client.post(f"/api/listings/{listing_id}/contact", headers=auth)


def freeze(monkeypatch, *, admin_at=None, reveal_at=None):
    if admin_at is not None:
        monkeypatch.setattr(admin_router, "utcnow", lambda: admin_at)
    if reveal_at is not None:
        monkeypatch.setattr(tenants_router, "utcnow", lambda: reveal_at)


# --- Tier boundary ------------------------------------------------------------


def test_listing_at_exact_threshold_is_standard(client_on):
    auth = register(client_on)
    grant_credits(client_on, "0700111222", "TX-STD", credits=1)
    at_threshold = premium_listing(client_on, rent=300_000)  # exactly the threshold
    r = contact(client_on, at_threshold, auth)
    assert r.status_code == 200, r.text  # standard credit covered it


def test_listing_one_above_threshold_is_premium(client_on):
    auth = register(client_on)
    grant_credits(client_on, "0700111222", "TX-STD", credits=20)
    just_over = premium_listing(client_on, rent=300_001)

    r = contact(client_on, just_over, auth)
    assert r.status_code == 402
    detail = r.json()["detail"]
    assert detail["tier"] == "premium"
    assert detail["product"] == "premium_pass"
    assert detail["price_ugx"] == 20_000
    assert detail["pass_max_reveals"] == 30
    assert detail["pass_status"] == "none"
    assert detail["credits_per_purchase"] is None
    assert "until midnight" in detail["payment_instructions"]
    assert "up to 30 contacts" in detail["payment_instructions"]
    assert "unlimited" not in detail["payment_instructions"].lower()
    assert "whatsapp" not in json.dumps(detail).lower()

    # The 20 standard credits were never touched by the premium attempt.
    me = client_on.get("/api/tenants/me", headers=auth).json()
    assert me["credits_remaining"] == 20
    assert me["reveals_count"] == 0


def test_env_overrides_threshold(tmp_path):
    settings = make_settings(
        tmp_path, paywall_enabled=True, rent_tier_threshold_ugx=1_000_000, **MOMO
    )
    with TestClient(create_app(settings)) as client:
        auth = register(client)
        grant_credits(client, "0700111222", "TX-1", credits=1)
        listing_id = premium_listing(client, rent=800_000)  # standard under 1M threshold
        assert contact(client, listing_id, auth).status_code == 200


# --- What the pass unlocks ------------------------------------------------------


def test_pass_opens_both_rental_tiers_and_spares_credits(client_on):
    auth = register(client_on)
    assert grant_pass(client_on, "0700111222", "TX-PASS").status_code == 201

    prem, std = premium_listing(client_on), standard_listing(client_on)
    r = contact(client_on, prem, auth)
    assert r.status_code == 200
    assert r.json()["whatsapp_phone"] == "+256771234567"
    assert r.json()["pass_reveals_remaining"] == 29

    r = contact(client_on, std, auth)
    assert r.status_code == 200
    assert r.json()["pass_reveals_remaining"] == 28

    me = client_on.get("/api/tenants/me", headers=auth).json()
    assert me["credits_remaining"] == 0  # pass reveals never touch credit balances
    assert me["premium_pass_status"] == "active"
    assert me["premium_pass_reveals_remaining"] == 28
    assert me["reveals_count"] == 2


def test_standard_credits_spent_before_pass(client_on):
    auth = register(client_on)
    grant_credits(client_on, "0700111222", "TX-C", credits=1)
    grant_pass(client_on, "0700111222", "TX-P")

    r = contact(client_on, standard_listing(client_on), auth)
    assert r.status_code == 200
    me = client_on.get("/api/tenants/me", headers=auth).json()
    assert me["credits_remaining"] == 0  # the credit went first
    assert me["premium_pass_reveals_remaining"] == 30  # pass untouched


def test_pass_never_unlocks_land(client_on):
    auth = register(client_on)
    grant_pass(client_on, "0700111222", "TX-P")

    r = contact(client_on, land_listing(client_on), auth)
    assert r.status_code == 402
    detail = r.json()["detail"]
    assert detail["category"] == "land"
    assert detail["product"] == "land"
    assert detail["price_ugx"] == 50_000
    assert "pass_status" not in detail  # land 402s never mention the pass

    me = client_on.get("/api/tenants/me", headers=auth).json()
    assert me["premium_pass_reveals_remaining"] == 30  # land attempt spent nothing


def test_land_credits_untouched_by_pass_reveals(client_on):
    auth = register(client_on)
    grant_pass(client_on, "0700111222", "TX-P")
    grant_credits(client_on, "0700111222", "TX-L", category="land")

    assert contact(client_on, premium_listing(client_on), auth).status_code == 200
    me = client_on.get("/api/tenants/me", headers=auth).json()
    assert me["land_credits_remaining"] == 3


# --- Expiry: midnight Africa/Kampala, computed at approval ----------------------


def test_expires_at_is_kampala_midnight_not_utc(client_on, monkeypatch):
    # 22:30 UTC on the 16th is ALREADY 01:30 on the 17th in Kampala, so the
    # pass must run to midnight Kampala on the 17th (21:00 UTC), not to
    # midnight UTC — a naive-UTC implementation would expire ~21h too early.
    freeze(monkeypatch, admin_at=datetime(2026, 7, 16, 22, 30, tzinfo=timezone.utc))
    auth = register(client_on)
    r = grant_pass(client_on, "0700111222", "TX-P")
    assert r.status_code == 201
    expires = datetime.fromisoformat(r.json()["expires_at"].replace("Z", "+00:00"))
    assert expires == MIDNIGHT_UTC

    me = client_on.get("/api/tenants/me", headers=auth).json()
    assert datetime.fromisoformat(
        me["premium_pass_expires_at"].replace("Z", "+00:00")
    ) == MIDNIGHT_UTC


def test_reveal_at_2359_kampala_works_at_0000_fails(client_on, monkeypatch):
    freeze(monkeypatch, admin_at=NOON_KAMPALA)
    auth = register(client_on)
    grant_pass(client_on, "0700111222", "TX-P")
    a, b = premium_listing(client_on), premium_listing(client_on)

    # 23:59 Kampala on the grant day: still valid.
    freeze(monkeypatch, reveal_at=datetime(2026, 7, 17, 20, 59, tzinfo=timezone.utc))
    assert contact(client_on, a, auth).status_code == 200

    # 00:00 Kampala the next day: expired, with the correct 402.
    freeze(monkeypatch, reveal_at=MIDNIGHT_UTC)
    r = contact(client_on, b, auth)
    assert r.status_code == 402
    detail = r.json()["detail"]
    assert detail["product"] == "premium_pass"
    assert detail["pass_status"] == "expired"

    me = client_on.get("/api/tenants/me", headers=auth).json()
    assert me["premium_pass_status"] == "expired"
    assert me["premium_pass_reveals_remaining"] == 0


def test_pass_clock_starts_at_approval_not_claim(client_on, monkeypatch):
    auth = register(client_on)
    r = client_on.post(
        "/api/tenants/payment-claims",
        json={"momo_tx_id": "MTN-PP-1", "product": "premium_pass"},
        headers=auth,
    )
    assert r.status_code == 201
    claim = r.json()
    assert claim["product"] == "premium_pass"
    assert claim["category"] == "rental"

    # The admin only verifies the payment two days later, at noon Kampala on
    # the 19th: the pass must run to midnight Kampala on the 19th, not the 17th.
    freeze(monkeypatch, admin_at=datetime(2026, 7, 19, 9, 0, tzinfo=timezone.utc))
    r = client_on.post(f"/api/admin/payment-claims/{claim['id']}/approve", headers=ADMIN)
    assert r.status_code == 200
    body = r.json()
    assert body["product"] == "premium_pass"
    assert body["credits"] is None
    expires = datetime.fromisoformat(body["expires_at"].replace("Z", "+00:00"))
    assert expires == datetime(2026, 7, 19, 21, 0, tzinfo=timezone.utc)


def test_already_revealed_stays_accessible_after_expiry(client_on, monkeypatch):
    freeze(monkeypatch, admin_at=NOON_KAMPALA)
    auth = register(client_on)
    grant_pass(client_on, "0700111222", "TX-P")
    listing_id = premium_listing(client_on)

    freeze(monkeypatch, reveal_at=datetime(2026, 7, 17, 12, 0, tzinfo=timezone.utc))
    assert contact(client_on, listing_id, auth).status_code == 200

    # A week later, long after the pass died, the reveal is still theirs.
    freeze(monkeypatch, reveal_at=datetime(2026, 7, 24, 12, 0, tzinfo=timezone.utc))
    r = contact(client_on, listing_id, auth)
    assert r.status_code == 200
    assert r.json()["whatsapp_phone"] == "+256771234567"
    me = client_on.get("/api/tenants/me", headers=auth).json()
    assert me["reveals_count"] == 1  # re-reveal, not a new charge


# --- The reveal cap ---------------------------------------------------------------


def test_30th_reveal_works_31st_fails(client_on):
    auth = register(client_on)
    grant_pass(client_on, "0700111222", "TX-P")

    for i in range(30):
        r = contact(client_on, premium_listing(client_on), auth)
        assert r.status_code == 200, f"reveal {i + 1}: {r.text}"
    assert r.json()["pass_reveals_remaining"] == 0

    r = contact(client_on, premium_listing(client_on), auth)
    assert r.status_code == 402
    detail = r.json()["detail"]
    assert detail["pass_status"] == "exhausted"
    assert detail["product"] == "premium_pass"

    # Exhausted but unexpired: /me reports the pass active with 0 left.
    me = client_on.get("/api/tenants/me", headers=auth).json()
    assert me["premium_pass_status"] == "active"
    assert me["premium_pass_reveals_remaining"] == 0
    assert me["reveals_count"] == 30


def test_concurrent_reveals_cannot_race_past_cap(tmp_path):
    settings = make_settings(tmp_path, paywall_enabled=True, premium_pass_max_reveals=1, **MOMO)
    with TestClient(create_app(settings)) as client:
        auth = register(client)
        grant_pass(client, "0700111222", "TX-P")
        a, b = premium_listing(client), premium_listing(client)

        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(lambda lid: contact(client, lid, auth), [a, b]))

        assert sorted(r.status_code for r in responses) == [200, 402], [
            r.text for r in responses
        ]
        me = client.get("/api/tenants/me", headers=auth).json()
        assert me["premium_pass_reveals_remaining"] == 0
        assert me["reveals_count"] == 1


# --- Payments: claims, grants, duplicate transaction IDs ---------------------------


def test_premium_claim_pending_is_product_scoped(client_on):
    auth = register(client_on)
    prem, std = premium_listing(client_on), standard_listing(client_on)
    client_on.post(
        "/api/tenants/payment-claims",
        json={"momo_tx_id": "MTN-PP-2", "product": "premium_pass"},
        headers=auth,
    )

    r = contact(client_on, prem, auth)
    assert r.json()["detail"]["pending_claim"] is True
    # The pending premium claim does not mask the standard 402.
    r = contact(client_on, std, auth)
    detail = r.json()["detail"]
    assert detail["product"] == "standard_rental"
    assert detail["pending_claim"] is False
    assert detail["price_ugx"] == 5000
    assert detail["credits_per_purchase"] == 20

    queue = client_on.get("/api/admin/payment-claims", headers=ADMIN).json()
    assert [(c["momo_tx_id"], c["product"]) for c in queue] == [("MTN-PP-2", "premium_pass")]


def test_duplicate_tx_id_rejected_across_passes_and_grants(client_on):
    register(client_on)
    other = register(client_on, phone="0700333444")

    assert grant_pass(client_on, "0700111222", "TX-DUP").status_code == 201
    # Same tx cannot buy a credit bundle, another pass, or back a new claim.
    assert grant_credits(client_on, "0700111222", "TX-DUP").status_code == 409
    assert grant_pass(client_on, "0700333444", "TX-DUP").status_code == 409
    assert (
        client_on.post(
            "/api/tenants/payment-claims", json={"momo_tx_id": "TX-DUP"}, headers=other
        ).status_code
        == 409
    )

    # And the reverse: a tx spent on credits cannot buy a pass.
    assert grant_credits(client_on, "0700111222", "TX-DUP2").status_code == 201
    assert grant_pass(client_on, "0700111222", "TX-DUP2").status_code == 409


def test_manual_pass_grant_unknown_phone_404(client_on):
    assert grant_pass(client_on, "0700999888", "TX-NOBODY").status_code == 404


# --- Dark launch and public invariants ---------------------------------------------


def test_flag_off_premium_rentals_behave_exactly_like_today(client):
    # With the paywall dark, a premium-priced rental reveals free, exactly like
    # any other listing (this is the deployed behavior until the flag flips).
    auth = register(client)
    listing_id = premium_listing(client)
    r = contact(client, listing_id, auth)
    assert r.status_code == 200
    assert r.json()["whatsapp_phone"] == "+256771234567"
    me = client.get("/api/tenants/me", headers=auth).json()
    assert me["premium_pass_status"] == "none"


def test_public_tier_only_visible_when_paywall_live(client, client_on):
    for c, expected_std, expected_prem in ((client, None, None), (client_on, "standard", "premium")):
        std, prem, land = standard_listing(c), premium_listing(c), land_listing(c)
        by_id = {l["id"]: l for l in c.get("/api/listings").json()}
        assert by_id[std]["tier"] == expected_std
        assert by_id[prem]["tier"] == expected_prem
        assert c.get(f"/api/listings/{prem}").json()["tier"] == expected_prem
        assert c.get(f"/api/listings/{land}").json()["tier"] is None


def test_premium_public_responses_never_leak_contact_or_exact_coords(client_on):
    listing_id = submit(
        client_on, rent_ugx=900_000, latitude=0.3136, longitude=32.5811
    )
    approve(client_on, listing_id)
    for r in (client_on.get("/api/listings"), client_on.get(f"/api/listings/{listing_id}")):
        text = r.text
        assert "whatsapp" not in text.lower()
        assert "+2567" not in text
    detail = client_on.get(f"/api/listings/{listing_id}").json()
    assert detail["location_approximate"] is True
    assert detail["public_latitude"] != 0.3136
