import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

ADMIN_TOKEN = "test-admin-token"
ADMIN = {"X-Admin-Token": ADMIN_TOKEN}

VALID_LISTING = {
    "title": "Self-contained single room in Kansanga",
    "property_type": "self_contained",
    "district": "Kampala",
    "area": "Kansanga",
    "landmark": "Near Kansanga Miracle Centre",
    "rent_ugx": 450_000,
    "description": "Clean self-contained room with water and power, close to the main road.",
    "landlord_name": "Andrew K",
    "whatsapp_phone": "0771234567",
}

VALID_LAND = {
    "category": "land",
    "title": "50x100 titled plot in Gayaza",
    "district": "Wakiso",
    "area": "Gayaza",
    "landmark": "Off Gayaza-Zirobwe road",
    "plot_size": "50x100",
    "tenure": "mailo",
    "title_status": "has_title",
    "asking_price_ugx": 35_000_000,
    "description": "Quarter-acre plot with a private mailo title, ready to transfer.",
    "landlord_name": "Andrew K",
    "whatsapp_phone": "0772345678",
}


def make_settings(tmp_path, **overrides) -> Settings:
    defaults = dict(
        database_url=f"sqlite:///{tmp_path}/test.db",
        admin_token=ADMIN_TOKEN,
        rate_limit_submissions=1000,  # high default so unrelated tests never hit it
        rate_limit_window_seconds=3600,
        upload_dir=f"{tmp_path}/uploads",
    )
    defaults.update(overrides)
    return Settings(**defaults)


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(make_settings(tmp_path))) as c:
        yield c


def submit(client, **overrides) -> int:
    payload = {**VALID_LISTING, **overrides}
    r = client.post("/api/listings", json=payload)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def approve(client, listing_id: int):
    r = client.post(f"/api/admin/listings/{listing_id}/approve", headers=ADMIN)
    assert r.status_code == 200, r.text
    return r.json()


def reject(client, listing_id: int, reason=None):
    body = {"reason": reason} if reason is not None else None
    r = client.post(f"/api/admin/listings/{listing_id}/reject", headers=ADMIN, json=body)
    assert r.status_code == 200, r.text
    return r.json()
