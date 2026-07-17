"""Admin auth (fail closed), input validation, and submission rate limiting."""
import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from conftest import ADMIN, VALID_LISTING, make_settings, submit


ADMIN_PATHS = [
    ("GET", "/api/admin/listings"),
    ("POST", "/api/admin/listings/1/approve"),
    ("POST", "/api/admin/listings/1/reject"),
    ("GET", "/api/admin/payment-claims"),
    ("POST", "/api/admin/payment-claims/1/approve"),
    ("POST", "/api/admin/credit-grants"),
]


@pytest.mark.parametrize("method,path", ADMIN_PATHS)
def test_admin_requires_token(client, method, path):
    assert client.request(method, path).status_code == 401
    assert client.request(method, path, headers={"X-Admin-Token": "wrong"}).status_code == 401


@pytest.mark.parametrize("method,path", ADMIN_PATHS)
def test_admin_fails_closed_when_unconfigured(tmp_path, method, path):
    app = create_app(make_settings(tmp_path, admin_token=""))
    with TestClient(app) as unconfigured:
        r = unconfigured.request(method, path, headers=ADMIN)
        assert r.status_code == 503


@pytest.mark.parametrize("field,value", [
    ("title", "shrt"),
    ("property_type", "castle"),
    ("rent_ugx", 0),
    ("rent_ugx", -5000),
    ("rent_ugx", 200_000_000),
    ("description", "too short"),
    ("whatsapp_phone", "12345"),
    ("whatsapp_phone", "0881234567"),   # not a UG mobile prefix
    ("whatsapp_phone", "+254712345678"),  # Kenyan number
    ("district", ""),
    ("landlord_name", ""),
])
def test_submission_validation_rejects_bad_input(client, field, value):
    payload = {**VALID_LISTING, field: value}
    assert client.post("/api/listings", json=payload).status_code == 422


@pytest.mark.parametrize("raw,normalized", [
    ("0771234567", "+256771234567"),
    ("+256771234567", "+256771234567"),
    ("256 771 234 567", "+256771234567"),
    ("0701-234-567", "+256701234567"),
])
def test_phone_is_normalized(client, raw, normalized):
    listing_id = submit(client, whatsapp_phone=raw)
    admin_view = client.get("/api/admin/listings", headers=ADMIN).json()
    row = next(l for l in admin_view if l["id"] == listing_id)
    assert row["whatsapp_phone"] == normalized


def test_submission_rate_limit(tmp_path):
    app = create_app(make_settings(tmp_path, rate_limit_submissions=3))
    with TestClient(app) as client:
        for _ in range(3):
            assert client.post("/api/listings", json=VALID_LISTING).status_code == 201
        r = client.post("/api/listings", json=VALID_LISTING)
        assert r.status_code == 429
        # reads are not rate-limited
        assert client.get("/api/listings").status_code == 200
