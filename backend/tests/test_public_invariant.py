"""The core invariant (CLAUDE.md Rule 2): public endpoints never expose a listing
that is not approved — not in the feed, not by direct id, not via query tricks,
and never any admin-only field."""
import json

from conftest import approve, reject, submit


def test_new_submission_is_pending_and_not_public(client):
    listing_id = submit(client)
    assert client.get("/api/listings").json() == []
    assert client.get(f"/api/listings/{listing_id}").status_code == 404


def test_feed_returns_only_approved(client):
    pending_id = submit(client, title="Pending listing in Ntinda")
    approved_id = submit(client, title="Approved listing in Ntinda")
    rejected_id = submit(client, title="Rejected listing in Ntinda")
    approve(client, approved_id)
    reject(client, rejected_id, reason="photos look fake")

    feed = client.get("/api/listings").json()
    assert [l["id"] for l in feed] == [approved_id]
    assert pending_id not in {l["id"] for l in feed}
    assert rejected_id not in {l["id"] for l in feed}


def test_detail_404_for_pending_rejected_and_missing(client):
    pending_id = submit(client)
    rejected_id = submit(client)
    reject(client, rejected_id)

    for listing_id in (pending_id, rejected_id, 99999):
        r = client.get(f"/api/listings/{listing_id}")
        assert r.status_code == 404
        # identical body for non-approved and nonexistent: no existence leak
        assert r.json() == {"detail": "Listing not found"}


def test_feed_ignores_status_query_param(client):
    pending_id = submit(client)
    for qs in ("?status=pending", "?status=rejected", "?status=all", "?approved=false"):
        feed = client.get(f"/api/listings{qs}")
        assert feed.status_code == 200
        assert pending_id not in {l["id"] for l in feed.json()}


def test_public_payloads_never_contain_admin_fields(client):
    approved_id = submit(client)
    approve(client, approved_id)

    # Key check, not substring: public land fields like title_status are fine,
    # the admin-only "status" and "rejection_reason" keys are not.
    feed = client.get("/api/listings").json()
    detail = client.get(f"/api/listings/{approved_id}").json()
    for obj in (*feed, detail):
        assert "rejection_reason" not in obj
        assert "status" not in obj


def test_rejection_reason_never_reaches_public_responses(client):
    secret = "landlord submitted someone else's house"
    rejected_id = submit(client)
    reject(client, rejected_id, reason=secret)
    approved_id = submit(client)
    approve(client, approved_id)

    for path in ("/api/listings", f"/api/listings/{approved_id}",
                 f"/api/listings/{rejected_id}"):
        assert secret not in client.get(path).text


def test_approval_makes_listing_public_immediately(client):
    listing_id = submit(client)
    assert client.get(f"/api/listings/{listing_id}").status_code == 404
    approve(client, listing_id)
    r = client.get(f"/api/listings/{listing_id}")
    assert r.status_code == 200
    assert r.json()["id"] == listing_id


def test_feed_is_newest_approved_first(client):
    first = submit(client, title="Approved first, oldest live")
    second = submit(client, title="Approved second, newest live")
    approve(client, first)
    approve(client, second)
    feed = client.get("/api/listings").json()
    assert [l["id"] for l in feed] == [second, first]
