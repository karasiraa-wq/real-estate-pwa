"""Category-scoped paywall: land reveals are priced separately (default UGX
50,000 for 3 reveals) and rental credits can never unlock a land contact, nor
land credits a rental contact. Same PAYWALL_ENABLED flag gates both."""
import json

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from conftest import ADMIN, VALID_LAND, approve, make_settings, submit

MOMO = dict(momo_number="0779999999", momo_name="Andrew K")


@pytest.fixture
def client_on(tmp_path):
    settings = make_settings(tmp_path, paywall_enabled=True, **MOMO)
    with TestClient(create_app(settings)) as c:
        yield c


def register(client, phone="0700111222") -> dict:
    r = client.post("/api/tenants/register", json={"phone": phone})
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def grant(client, phone, tx_id, credits=None, category=None):
    payload = {"phone": phone, "momo_tx_id": tx_id}
    if credits is not None:
        payload["credits"] = credits
    if category is not None:
        payload["category"] = category
    return client.post("/api/admin/credit-grants", json=payload, headers=ADMIN)


def approved_land(client) -> int:
    listing_id = submit(client, **VALID_LAND)
    approve(client, listing_id)
    return listing_id


def approved_rental(client) -> int:
    listing_id = submit(client)
    approve(client, listing_id)
    return listing_id


# --- Cross-category isolation ---------------------------------------------------


def test_rental_credits_never_unlock_land(client_on):
    auth = register(client_on)
    assert grant(client_on, "0700111222", "TX-R", credits=20).status_code == 201  # rental
    land_id = approved_land(client_on)

    r = client_on.post(f"/api/listings/{land_id}/contact", headers=auth)
    assert r.status_code == 402
    detail = r.json()["detail"]
    assert detail["category"] == "land"
    assert detail["credits_remaining"] == 0  # the 20 rental credits do not count
    assert detail["price_ugx"] == 50_000
    assert detail["credits_per_purchase"] == 3
    assert "whatsapp" not in json.dumps(detail).lower()

    me = client_on.get("/api/tenants/me", headers=auth).json()
    assert me["credits_remaining"] == 20  # untouched
    assert me["land_credits_remaining"] == 0


def test_land_credits_never_unlock_rentals(client_on):
    auth = register(client_on)
    assert grant(client_on, "0700111222", "TX-L", category="land").status_code == 201
    rental_id = approved_rental(client_on)

    r = client_on.post(f"/api/listings/{rental_id}/contact", headers=auth)
    assert r.status_code == 402
    detail = r.json()["detail"]
    assert detail["category"] == "rental"
    assert detail["price_ugx"] == 5000
    assert detail["credits_per_purchase"] == 20

    me = client_on.get("/api/tenants/me", headers=auth).json()
    assert me["land_credits_remaining"] == 3  # default land bundle, untouched


def test_land_reveal_spends_only_land_credits(client_on):
    auth = register(client_on)
    grant(client_on, "0700111222", "TX-L", category="land")  # 3 land credits
    grant(client_on, "0700111222", "TX-R", credits=20)  # 20 rental credits

    land_id = approved_land(client_on)
    r = client_on.post(f"/api/listings/{land_id}/contact", headers=auth)
    assert r.status_code == 200
    assert r.json()["whatsapp_phone"] == "+256772345678"
    assert r.json()["credits_remaining"] == 2

    me = client_on.get("/api/tenants/me", headers=auth).json()
    assert me["credits_remaining"] == 20
    assert me["land_credits_remaining"] == 2

    # Burn the remaining 2; the 4th distinct land reveal is 402 even though
    # 20 rental credits are still sitting there.
    for _ in range(2):
        assert (
            client_on.post(f"/api/listings/{approved_land(client_on)}/contact", headers=auth)
            .status_code
            == 200
        )
    r = client_on.post(f"/api/listings/{approved_land(client_on)}/contact", headers=auth)
    assert r.status_code == 402
    assert client_on.get("/api/tenants/me", headers=auth).json()["credits_remaining"] == 20


def test_env_overrides_land_pricing(tmp_path):
    settings = make_settings(
        tmp_path, paywall_enabled=True, land_price_ugx=75_000, land_credits_per_purchase=5, **MOMO
    )
    with TestClient(create_app(settings)) as client:
        auth = register(client)
        land_id = submit(client, **VALID_LAND)
        approve(client, land_id)
        detail = client.post(f"/api/listings/{land_id}/contact", headers=auth).json()["detail"]
        assert detail["price_ugx"] == 75_000
        assert detail["credits_per_purchase"] == 5


# --- Claims per category ----------------------------------------------------------


def test_land_claim_grants_land_bundle(client_on):
    auth = register(client_on)
    land_id = approved_land(client_on)

    r = client_on.post(
        "/api/tenants/payment-claims",
        json={"momo_tx_id": "MTN-LAND-1", "category": "land"},
        headers=auth,
    )
    assert r.status_code == 201
    claim = r.json()
    assert claim["category"] == "land"

    # A pending land claim is reported on the land 402, and it does not mask a
    # missing rental claim (pending_claim is per category).
    r = client_on.post(f"/api/listings/{land_id}/contact", headers=auth)
    assert r.json()["detail"]["pending_claim"] is True
    rental_id = approved_rental(client_on)
    r = client_on.post(f"/api/listings/{rental_id}/contact", headers=auth)
    assert r.json()["detail"]["pending_claim"] is False

    queue = client_on.get("/api/admin/payment-claims", headers=ADMIN).json()
    assert [(c["momo_tx_id"], c["category"]) for c in queue] == [("MTN-LAND-1", "land")]

    r = client_on.post(f"/api/admin/payment-claims/{claim['id']}/approve", headers=ADMIN)
    assert r.status_code == 200
    assert r.json()["credits"] == 3
    assert r.json()["category"] == "land"

    r = client_on.post(f"/api/listings/{land_id}/contact", headers=auth)
    assert r.status_code == 200
    assert r.json()["credits_remaining"] == 2


def test_claim_defaults_to_rental_category(client_on):
    auth = register(client_on)
    r = client_on.post(
        "/api/tenants/payment-claims", json={"momo_tx_id": "MTN-OLD-CLIENT"}, headers=auth
    )
    assert r.status_code == 201
    assert r.json()["category"] == "rental"


# --- Flag off: land ships dark exactly like rentals -------------------------------


def test_flag_off_land_contact_free_and_uncharged(client):
    auth = register(client)
    land_id = submit(client, **VALID_LAND)
    approve(client, land_id)

    r = client.post(f"/api/listings/{land_id}/contact", headers=auth)
    assert r.status_code == 200
    assert r.json()["whatsapp_phone"] == "+256772345678"

    # Land credits bought after launch are not consumed by dark-phase reveals.
    grant(client, "0700111222", "TX-AFTER", category="land")
    me = client.get("/api/tenants/me", headers=auth).json()
    assert me["land_credits_remaining"] == 3


@pytest.fixture(params=["off", "on"])
def any_client(request, tmp_path):
    settings = make_settings(tmp_path, paywall_enabled=request.param == "on", **MOMO)
    with TestClient(create_app(settings)) as c:
        yield c


def test_land_public_responses_never_contain_whatsapp(any_client):
    client = any_client
    land_id = submit(client, **VALID_LAND)
    approve(client, land_id)
    pending_id = submit(client, **VALID_LAND)

    for r in (
        client.get("/api/listings?category=land"),
        client.get(f"/api/listings/{land_id}"),
        client.get(f"/api/listings/{pending_id}"),
    ):
        assert "whatsapp" not in r.text.lower()
        assert "+2567" not in r.text
