"""Photo upload: token-gated, type/size validated, and photo URLs only surface
through the public API once the listing is approved."""
from conftest import ADMIN, VALID_LISTING, approve

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64
WEBP = b"RIFF\x00\x00\x00\x00WEBP" + b"\x00" * 64


def submit_full(client):
    r = client.post("/api/listings", json=VALID_LISTING)
    assert r.status_code == 201, r.text
    body = r.json()
    return body["id"], body["photo_token"]


def upload(client, listing_id, token, data=PNG, name="photo.png"):
    return client.post(
        f"/api/listings/{listing_id}/photos",
        headers={"X-Photo-Token": token},
        files={"photo": (name, data, "image/png")},
    )


def test_submission_returns_photo_token(client):
    _, token = submit_full(client)
    assert len(token) >= 24


def test_upload_photo_succeeds(client):
    listing_id, token = submit_full(client)
    r = upload(client, listing_id, token)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["photo_count"] == 1
    assert body["photo_url"].startswith("/uploads/")
    # The stored file is actually served.
    assert client.get(body["photo_url"]).status_code == 200


def test_jpeg_and_webp_accepted(client):
    listing_id, token = submit_full(client)
    assert upload(client, listing_id, token, JPEG, "a.jpg").status_code == 201
    assert upload(client, listing_id, token, WEBP, "b.webp").status_code == 201


def test_upload_without_token_rejected(client):
    listing_id, _ = submit_full(client)
    r = client.post(
        f"/api/listings/{listing_id}/photos",
        files={"photo": ("p.png", PNG, "image/png")},
    )
    assert r.status_code == 404


def test_upload_with_wrong_token_rejected(client):
    listing_id, _ = submit_full(client)
    assert upload(client, listing_id, "wrong-token").status_code == 404


def test_upload_to_missing_listing_matches_wrong_token(client):
    _, token = submit_full(client)
    assert upload(client, 99999, token).status_code == 404


def test_non_image_rejected(client):
    listing_id, token = submit_full(client)
    r = upload(client, listing_id, token, b"<html>not an image</html>", "p.png")
    assert r.status_code == 415


def test_oversized_photo_rejected(client, tmp_path):
    from conftest import make_settings
    from fastapi.testclient import TestClient

    from app.main import create_app

    with TestClient(create_app(make_settings(tmp_path, max_photo_bytes=100))) as small:
        listing_id, token = submit_full(small)
        assert upload(small, listing_id, token, PNG + b"\x00" * 200).status_code == 413


def test_photo_limit_is_eight(client):
    listing_id, token = submit_full(client)
    for _ in range(8):
        assert upload(client, listing_id, token).status_code == 201
    assert upload(client, listing_id, token).status_code == 409


def test_no_uploads_after_review(client):
    listing_id, token = submit_full(client)
    approve(client, listing_id)
    assert upload(client, listing_id, token).status_code == 409


def test_photo_urls_appear_publicly_only_after_approval(client):
    listing_id, token = submit_full(client)
    url = upload(client, listing_id, token).json()["photo_url"]

    # Pending: the listing (and therefore its photo URL) is not public.
    assert client.get(f"/api/listings/{listing_id}").status_code == 404
    assert all(card["id"] != listing_id for card in client.get("/api/listings").json())

    approve(client, listing_id)
    detail = client.get(f"/api/listings/{listing_id}").json()
    assert detail["photo_urls"] == [url]
    card = next(c for c in client.get("/api/listings").json() if c["id"] == listing_id)
    assert card["photo_url"] == url


def test_photo_token_never_exposed_publicly_or_to_admin(client):
    listing_id, _ = submit_full(client)
    admin_view = client.get("/api/admin/listings", headers=ADMIN).json()
    assert all("photo_token" not in item for item in admin_view)
    approve(client, listing_id)
    assert "photo_token" not in client.get(f"/api/listings/{listing_id}").json()
