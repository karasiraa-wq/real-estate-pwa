"""Status lifecycle: pending -> approved | rejected, no other transitions (PRD)."""
from conftest import ADMIN, approve, reject, submit


def test_submission_response_confirms_review(client):
    r = client.post("/api/listings", json={
        "title": "Two bedroom apartment in Bukoto",
        "property_type": "apartment",
        "district": "Kampala",
        "area": "Bukoto",
        "rent_ugx": 1_200_000,
        "description": "Spacious two bedroom apartment with balcony and parking.",
        "landlord_name": "Sarah N",
        "whatsapp_phone": "+256701234567",
    })
    assert r.status_code == 201
    body = r.json()
    assert body["status"] == "pending"
    assert "under review" in body["message"]


def test_approve_sets_status_and_reviewed_at(client):
    listing_id = submit(client)
    body = approve(client, listing_id)
    assert body["status"] == "approved"
    assert body["reviewed_at"] is not None


def test_reject_stores_optional_reason(client):
    with_reason = submit(client)
    body = reject(client, with_reason, reason="blurry photos")
    assert body["status"] == "rejected"
    assert body["rejection_reason"] == "blurry photos"

    without_reason = submit(client)
    body = reject(client, without_reason)
    assert body["status"] == "rejected"
    assert body["rejection_reason"] is None


def test_no_transitions_out_of_terminal_states(client):
    approved_id = submit(client)
    approve(client, approved_id)
    rejected_id = submit(client)
    reject(client, rejected_id)

    for listing_id in (approved_id, rejected_id):
        for action in ("approve", "reject"):
            r = client.post(f"/api/admin/listings/{listing_id}/{action}", headers=ADMIN)
            assert r.status_code == 409, f"{action} on {listing_id} should 409"


def test_double_approve_conflicts_and_state_survives(client):
    listing_id = submit(client)
    approve(client, listing_id)
    r = client.post(f"/api/admin/listings/{listing_id}/approve", headers=ADMIN)
    assert r.status_code == 409
    assert client.get(f"/api/listings/{listing_id}").status_code == 200


def test_review_actions_on_missing_listing_404(client):
    for action in ("approve", "reject"):
        r = client.post(f"/api/admin/listings/99999/{action}", headers=ADMIN)
        assert r.status_code == 404


def test_admin_queue_is_pending_oldest_first(client):
    older = submit(client, title="Submitted first, review first")
    newer = submit(client, title="Submitted second in Kabalagala")
    done = submit(client)
    approve(client, done)

    queue = client.get("/api/admin/listings", headers=ADMIN).json()
    assert [l["id"] for l in queue] == [older, newer]
    assert all(l["status"] == "pending" for l in queue)

    rejected_view = client.get("/api/admin/listings?status=rejected", headers=ADMIN)
    assert rejected_view.status_code == 200
    assert rejected_view.json() == []
