"""Tenant paywall invariants.

The core one mirrors the approval gate: the landlord's WhatsApp number is paid
content and must NEVER appear in a public/unauthenticated response — with the
paywall flag on or off. Reveals only happen through the authenticated contact
endpoint, whose entitlement check is server-side and atomic (no double-spend).
"""
import json
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from conftest import ADMIN, approve, make_settings, submit

MOMO = dict(momo_number="0779999999", momo_name="Andrew K")


@pytest.fixture
def client_on(tmp_path):
    """App with the paywall live (PAYWALL_ENABLED=true)."""
    settings = make_settings(tmp_path, paywall_enabled=True, **MOMO)
    with TestClient(create_app(settings)) as c:
        yield c


@pytest.fixture(params=["off", "on"])
def any_client(request, tmp_path):
    """Runs a test against both flag states."""
    settings = make_settings(tmp_path, paywall_enabled=request.param == "on", **MOMO)
    with TestClient(create_app(settings)) as c:
        yield c


def register(client, phone="0700111222") -> dict:
    r = client.post("/api/tenants/register", json={"phone": phone})
    assert r.status_code == 201, r.text
    body = r.json()
    return {"Authorization": f"Bearer {body['token']}"}


def grant(client, phone, tx_id, credits=None):
    payload = {"phone": phone, "momo_tx_id": tx_id}
    if credits is not None:
        payload["credits"] = credits
    return client.post("/api/admin/credit-grants", json=payload, headers=ADMIN)


def approved_listing(client) -> int:
    listing_id = submit(client)
    approve(client, listing_id)
    return listing_id


# --- The paywall invariant ---------------------------------------------------


def test_public_responses_never_contain_whatsapp(any_client):
    client = any_client
    listing_id = approved_listing(client)
    pending_id = submit(client)

    for r in (
        client.get("/api/listings"),
        client.get(f"/api/listings/{listing_id}"),
        client.get(f"/api/listings/{pending_id}"),  # 404 body must not leak either
        client.get("/api/listings/999999"),
    ):
        assert "whatsapp" not in r.text.lower()
        assert "+2567" not in r.text


def test_contact_requires_auth(any_client):
    client = any_client
    listing_id = approved_listing(client)
    assert client.post(f"/api/listings/{listing_id}/contact").status_code == 401
    r = client.post(
        f"/api/listings/{listing_id}/contact",
        headers={"Authorization": "Bearer not-a-real-token"},
    )
    assert r.status_code == 401
    assert "whatsapp" not in r.text.lower()


def test_contact_404_for_unapproved_and_missing(any_client):
    client = any_client
    auth = register(client)
    pending_id = submit(client)
    for listing_id in (pending_id, 999999):
        r = client.post(f"/api/listings/{listing_id}/contact", headers=auth)
        assert r.status_code == 404
        assert r.json() == {"detail": "Listing not found"}


def test_tenant_me_requires_auth(any_client):
    assert any_client.get("/api/tenants/me").status_code == 401


# --- Flag off: free reveals, number still gated behind auth ------------------


def test_flag_off_contact_succeeds_with_zero_credits(client):
    listing_id = approved_listing(client)
    auth = register(client)

    r = client.post(f"/api/listings/{listing_id}/contact", headers=auth)
    assert r.status_code == 200
    assert r.json()["whatsapp_phone"] == "+256771234567"

    me = client.get("/api/tenants/me", headers=auth).json()
    assert me == {
        "phone": "+256700111222",
        "credits_remaining": 0,
        "land_credits_remaining": 0,
        "reveals_count": 1,
        "paywall_enabled": False,
    }


def test_flag_off_reveals_never_consume_later_credits(client):
    # A reveal made while the paywall was dark must not count against credits
    # bought after it turns on: it is recorded as uncharged.
    listing_id = approved_listing(client)
    auth = register(client)
    client.post(f"/api/listings/{listing_id}/contact", headers=auth)
    grant(client, "0700111222", "TX-LATER", credits=5)
    me = client.get("/api/tenants/me", headers=auth).json()
    assert me["credits_remaining"] == 5


# --- Flag on: credits are enforced -------------------------------------------


def test_flag_on_no_credits_402_with_payment_info(client_on):
    listing_id = approved_listing(client_on)
    auth = register(client_on)

    r = client_on.post(f"/api/listings/{listing_id}/contact", headers=auth)
    assert r.status_code == 402
    detail = r.json()["detail"]
    assert detail["credits_remaining"] == 0
    assert detail["price_ugx"] == 5000
    assert detail["credits_per_purchase"] == 20
    assert detail["momo_number"] == MOMO["momo_number"]
    assert detail["momo_name"] == MOMO["momo_name"]
    assert "payment_instructions" in detail
    assert detail["pending_claim"] is False
    assert "whatsapp" not in json.dumps(detail).lower()


def test_flag_on_grant_reveal_decrement_and_free_rereveal(client_on):
    auth = register(client_on)
    assert grant(client_on, "0700111222", "TX-1").status_code == 201  # default 20

    first = approved_listing(client_on)
    r = client_on.post(f"/api/listings/{first}/contact", headers=auth)
    assert r.status_code == 200
    assert r.json() == {
        "whatsapp_phone": "+256771234567",
        "latitude": None,
        "longitude": None,
        "credits_remaining": 19,
    }

    # Re-revealing the same listing is free.
    r = client_on.post(f"/api/listings/{first}/contact", headers=auth)
    assert r.status_code == 200
    assert r.json()["credits_remaining"] == 19

    # Burn the remaining 19 on distinct listings; the 21st distinct reveal is 402.
    for _ in range(19):
        listing_id = approved_listing(client_on)
        assert client_on.post(f"/api/listings/{listing_id}/contact", headers=auth).status_code == 200

    over = approved_listing(client_on)
    r = client_on.post(f"/api/listings/{over}/contact", headers=auth)
    assert r.status_code == 402
    assert r.json()["detail"]["credits_remaining"] == 0

    me = client_on.get("/api/tenants/me", headers=auth).json()
    assert me["credits_remaining"] == 0
    assert me["reveals_count"] == 20


def test_concurrent_reveals_cannot_double_spend_last_credit(client_on):
    auth = register(client_on)
    grant(client_on, "0700111222", "TX-ONE", credits=1)
    a, b = approved_listing(client_on), approved_listing(client_on)

    def hit(listing_id):
        return client_on.post(f"/api/listings/{listing_id}/contact", headers=auth)

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(hit, [a, b]))

    statuses = sorted(r.status_code for r in responses)
    assert statuses == [200, 402], [r.text for r in responses]
    me = client_on.get("/api/tenants/me", headers=auth).json()
    assert me["credits_remaining"] == 0
    assert me["reveals_count"] == 1


def test_concurrent_same_listing_charges_once(client_on):
    auth = register(client_on)
    grant(client_on, "0700111222", "TX-SAME", credits=5)
    listing_id = approved_listing(client_on)

    with ThreadPoolExecutor(max_workers=4) as pool:
        responses = list(
            pool.map(
                lambda _: client_on.post(f"/api/listings/{listing_id}/contact", headers=auth),
                range(4),
            )
        )

    assert all(r.status_code == 200 for r in responses), [r.text for r in responses]
    me = client_on.get("/api/tenants/me", headers=auth).json()
    assert me["credits_remaining"] == 4  # exactly one credit spent
    assert me["reveals_count"] == 1


# --- Registration and tokens --------------------------------------------------


def test_register_normalizes_phone_and_rotates_token(client):
    r1 = client.post("/api/tenants/register", json={"phone": "0700 111-222"})
    assert r1.status_code == 201
    assert r1.json()["phone"] == "+256700111222"
    old = {"Authorization": f"Bearer {r1.json()['token']}"}
    assert client.get("/api/tenants/me", headers=old).status_code == 200

    r2 = client.post("/api/tenants/register", json={"phone": "+256700111222"})
    new = {"Authorization": f"Bearer {r2.json()['token']}"}
    # Same phone re-registered: one account, new token; the old one is dead.
    assert client.get("/api/tenants/me", headers=old).status_code == 401
    assert client.get("/api/tenants/me", headers=new).status_code == 200


def test_register_rejects_bad_phone(client):
    assert client.post("/api/tenants/register", json={"phone": "12345"}).status_code == 422


def test_register_rate_limited(tmp_path):
    settings = make_settings(tmp_path, rate_limit_tenant_ops=3)
    with TestClient(create_app(settings)) as client:
        for i in range(3):
            assert client.post(
                "/api/tenants/register", json={"phone": f"070011122{i}"}
            ).status_code == 201
        assert client.post(
            "/api/tenants/register", json={"phone": "0700111229"}
        ).status_code == 429


# --- Payment claims and admin grants ------------------------------------------


def test_claim_flow_end_to_end(client_on):
    listing_id = approved_listing(client_on)
    auth = register(client_on)

    r = client_on.post(
        "/api/tenants/payment-claims", json={"momo_tx_id": "MTN12345"}, headers=auth
    )
    assert r.status_code == 201
    claim = r.json()
    assert claim["status"] == "pending"

    # While the claim is pending, 402 tells the client so.
    r = client_on.post(f"/api/listings/{listing_id}/contact", headers=auth)
    assert r.status_code == 402
    assert r.json()["detail"]["pending_claim"] is True

    queue = client_on.get("/api/admin/payment-claims", headers=ADMIN).json()
    assert [(c["momo_tx_id"], c["tenant_phone"]) for c in queue] == [
        ("MTN12345", "+256700111222")
    ]

    r = client_on.post(f"/api/admin/payment-claims/{claim['id']}/approve", headers=ADMIN)
    assert r.status_code == 200
    assert r.json()["credits"] == 20
    assert client_on.get("/api/admin/payment-claims", headers=ADMIN).json() == []

    # Credits are live: the reveal now works.
    r = client_on.post(f"/api/listings/{listing_id}/contact", headers=auth)
    assert r.status_code == 200
    assert r.json()["credits_remaining"] == 19

    # A claim cannot be approved twice.
    r = client_on.post(f"/api/admin/payment-claims/{claim['id']}/approve", headers=ADMIN)
    assert r.status_code == 409


def test_duplicate_momo_tx_id_rejected_everywhere(client_on):
    auth = register(client_on)
    other = register(client_on, phone="0700333444")

    # Same tenant, same tx id twice.
    assert client_on.post(
        "/api/tenants/payment-claims", json={"momo_tx_id": "DUP-1"}, headers=auth
    ).status_code == 201
    assert client_on.post(
        "/api/tenants/payment-claims", json={"momo_tx_id": "DUP-1"}, headers=auth
    ).status_code == 409
    # A different tenant cannot reuse it either.
    assert client_on.post(
        "/api/tenants/payment-claims", json={"momo_tx_id": "DUP-1"}, headers=other
    ).status_code == 409

    # Manual grants: duplicate tx id rejected across grants...
    assert grant(client_on, "0700111222", "DUP-2").status_code == 201
    assert grant(client_on, "0700333444", "DUP-2").status_code == 409
    # ...and a tx id already granted cannot be claimed afterwards.
    assert client_on.post(
        "/api/tenants/payment-claims", json={"momo_tx_id": "DUP-2"}, headers=other
    ).status_code == 409


def test_manual_grant_unknown_phone_404(client_on):
    assert grant(client_on, "0700999888", "TX-NOBODY").status_code == 404


def test_manual_grant_custom_credits(client_on):
    auth = register(client_on)
    r = grant(client_on, "0700111222", "TX-CUSTOM", credits=7)
    assert r.status_code == 201
    assert r.json()["credits"] == 7
    me = client_on.get("/api/tenants/me", headers=auth).json()
    assert me["credits_remaining"] == 7
