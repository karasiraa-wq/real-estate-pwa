"""Land listings (PRD extension): premium category with plot fields, plus the
video-link and location features shared with rentals.

Location privacy invariant: a RENTAL's exact coordinates are paid content and
must never appear in public responses (only a ~150-300m displaced point may);
a LAND listing's exact coordinates are public.
"""
import math

from conftest import VALID_LAND, VALID_LISTING, approve, submit

# Kansanga, well inside Uganda's bounding box.
LAT, LNG = 0.2933, 32.6053


def submit_land(client, **overrides) -> int:
    return submit(client, **{**VALID_LAND, **overrides})


# --- Submission validation ----------------------------------------------------


def test_land_submission_accepted_and_pending(client):
    payload = {**VALID_LAND}
    r = client.post("/api/listings", json=payload)
    assert r.status_code == 201
    assert r.json()["status"] == "pending"


def test_land_requires_plot_fields(client):
    for missing in ("plot_size", "tenure", "title_status", "asking_price_ugx"):
        payload = {**VALID_LAND}
        del payload[missing]
        r = client.post("/api/listings", json=payload)
        assert r.status_code == 422, f"{missing} should be required for land"
        assert missing in r.text


def test_land_rejects_bad_enum_values(client):
    assert client.post(
        "/api/listings", json={**VALID_LAND, "tenure": "squatting"}
    ).status_code == 422
    assert client.post(
        "/api/listings", json={**VALID_LAND, "title_status": "trust_me"}
    ).status_code == 422


def test_rental_submission_unchanged(client):
    # The original payload, with no category and no land fields, still works.
    listing_id = submit(client)
    approve(client, listing_id)
    detail = client.get(f"/api/listings/{listing_id}").json()
    assert detail["category"] == "rental"
    assert detail["rent_ugx"] == VALID_LISTING["rent_ugx"]
    assert detail["asking_price_ugx"] is None
    assert detail["plot_size"] is None


def test_rental_still_requires_rent_and_property_type(client):
    payload = {**VALID_LISTING}
    del payload["rent_ugx"]
    assert client.post("/api/listings", json=payload).status_code == 422
    payload = {**VALID_LISTING}
    del payload["property_type"]
    assert client.post("/api/listings", json=payload).status_code == 422


def test_land_detail_has_plot_fields_and_no_rent(client):
    listing_id = submit_land(client)
    approve(client, listing_id)
    detail = client.get(f"/api/listings/{listing_id}").json()
    assert detail["category"] == "land"
    assert detail["plot_size"] == "50x100"
    assert detail["tenure"] == "mailo"
    assert detail["title_status"] == "has_title"
    assert detail["asking_price_ugx"] == 35_000_000
    assert detail["rent_ugx"] is None


# --- Feed category filter -------------------------------------------------------


def test_default_feed_is_rentals_only(client):
    rental_id = submit(client)
    land_id = submit_land(client)
    approve(client, rental_id)
    approve(client, land_id)

    default_feed = client.get("/api/listings").json()
    assert [l["id"] for l in default_feed] == [rental_id]

    land_feed = client.get("/api/listings?category=land").json()
    assert [l["id"] for l in land_feed] == [land_id]
    assert land_feed[0]["asking_price_ugx"] == 35_000_000

    rental_feed = client.get("/api/listings?category=rental").json()
    assert [l["id"] for l in rental_feed] == [rental_id]


def test_bogus_category_rejected(client):
    assert client.get("/api/listings?category=mansion").status_code == 422


def test_land_feed_respects_approval_gate(client):
    pending = submit_land(client)
    feed = client.get("/api/listings?category=land").json()
    assert feed == []
    assert client.get(f"/api/listings/{pending}").status_code == 404


# --- Video links ---------------------------------------------------------------


def test_valid_youtube_urls_stored_and_returned(client):
    for url in (
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "https://youtu.be/dQw4w9WgXcQ",
        "https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=30s",
        "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    ):
        listing_id = submit(client, video_url=url)
        approve(client, listing_id)
        assert client.get(f"/api/listings/{listing_id}").json()["video_url"] == url


def test_invalid_video_urls_rejected(client):
    for url in (
        "https://vimeo.com/12345678",
        "https://example.com/watch?v=dQw4w9WgXcQ",
        "http://youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
        "javascript:alert(1)",
        "not a url",
        "https://www.youtube.com/watch?v=short",
    ):
        r = client.post("/api/listings", json={**VALID_LISTING, "video_url": url})
        assert r.status_code == 422, f"{url!r} should be rejected"


def test_video_optional_on_both_categories(client):
    rental_id = submit(client)
    land_id = submit_land(client, video_url="https://youtu.be/dQw4w9WgXcQ")
    approve(client, rental_id)
    approve(client, land_id)
    assert client.get(f"/api/listings/{rental_id}").json()["video_url"] is None
    assert client.get(f"/api/listings/{land_id}").json()["video_url"] == "https://youtu.be/dQw4w9WgXcQ"


# --- Coordinates: Uganda bounding box -------------------------------------------


def test_coordinates_outside_uganda_rejected(client):
    for lat, lng in ((51.5, 32.6), (-3.0, 32.6), (0.3, 36.9), (0.3, 28.0)):
        r = client.post(
            "/api/listings", json={**VALID_LISTING, "latitude": lat, "longitude": lng}
        )
        assert r.status_code == 422, f"({lat}, {lng}) should be outside Uganda"


def test_half_a_coordinate_rejected(client):
    assert client.post(
        "/api/listings", json={**VALID_LISTING, "latitude": LAT}
    ).status_code == 422
    assert client.post(
        "/api/listings", json={**VALID_LISTING, "longitude": LNG}
    ).status_code == 422


def test_listing_without_coordinates_has_no_map_data(client):
    listing_id = submit(client)
    approve(client, listing_id)
    detail = client.get(f"/api/listings/{listing_id}").json()
    assert detail["public_latitude"] is None
    assert detail["public_longitude"] is None


# --- Location privacy invariant --------------------------------------------------


def meters_between(lat1, lng1, lat2, lng2):
    dlat = (lat2 - lat1) * 111_320
    dlng = (lng2 - lng1) * 111_320 * math.cos(math.radians(lat1))
    return math.hypot(dlat, dlng)


def test_rental_public_coordinates_are_displaced_not_exact(client):
    listing_id = submit(client, latitude=LAT, longitude=LNG)
    approve(client, listing_id)
    detail = client.get(f"/api/listings/{listing_id}").json()

    assert detail["location_approximate"] is True
    distance = meters_between(LAT, LNG, detail["public_latitude"], detail["public_longitude"])
    assert 50 <= distance <= 350, f"approximation should be ~150-300m off, was {distance:.0f}m"

    # No public schema ever carries the exact-coordinate fields for a rental.
    feed_item = client.get("/api/listings").json()[0]
    for obj in (detail, feed_item):
        assert "latitude" not in obj
        assert "longitude" not in obj

    # Stable across requests: repeated fetches don't let a scraper average
    # the jitter away.
    again = client.get(f"/api/listings/{listing_id}").json()
    assert again["public_latitude"] == detail["public_latitude"]
    assert again["public_longitude"] == detail["public_longitude"]


def test_land_public_coordinates_are_exact(client):
    listing_id = submit_land(client, latitude=LAT, longitude=LNG)
    approve(client, listing_id)
    detail = client.get(f"/api/listings/{listing_id}").json()
    assert detail["location_approximate"] is False
    assert detail["public_latitude"] == LAT
    assert detail["public_longitude"] == LNG


def test_rental_exact_coordinates_only_via_contact_reveal(client):
    listing_id = submit(client, latitude=LAT, longitude=LNG)
    approve(client, listing_id)

    r = client.post("/api/tenants/register", json={"phone": "0700111222"})
    auth = {"Authorization": f"Bearer {r.json()['token']}"}
    contact = client.post(f"/api/listings/{listing_id}/contact", headers=auth).json()
    assert contact["latitude"] == LAT
    assert contact["longitude"] == LNG


def test_admin_sees_exact_coordinates_and_land_fields(client):
    from conftest import ADMIN

    submit_land(client, latitude=LAT, longitude=LNG, video_url="https://youtu.be/dQw4w9WgXcQ")
    queue = client.get("/api/admin/listings", headers=ADMIN).json()
    assert len(queue) == 1
    item = queue[0]
    assert item["category"] == "land"
    assert item["latitude"] == LAT
    assert item["longitude"] == LNG
    assert item["plot_size"] == "50x100"
    assert item["video_url"] == "https://youtu.be/dQw4w9WgXcQ"
