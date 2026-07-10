"""Feed search/filters: they narrow results, and never widen past the approval gate."""
from conftest import approve, submit


def ids(response):
    return [card["id"] for card in response.json()]


def seed(client):
    """Three approved listings with distinct locations, types and rents."""
    a = submit(client, area="Kansanga", property_type="single_room", rent_ugx=300_000,
               title="Cheap room near the stage")
    b = submit(client, area="Ntinda", property_type="apartment", rent_ugx=1_200_000,
               title="Two bedroom apartment", landmark="Ntinda shopping centre")
    c = submit(client, area="Kira", district="Wakiso", property_type="house",
               rent_ugx=2_500_000, title="Family house with compound", landmark=None)
    for listing_id in (a, b, c):
        approve(client, listing_id)
    return a, b, c


def test_search_matches_area_district_landmark_and_title(client):
    a, b, c = seed(client)
    assert ids(client.get("/api/listings?q=kansanga")) == [a]
    assert ids(client.get("/api/listings?q=wakiso")) == [c]
    assert ids(client.get("/api/listings?q=shopping centre")) == [b]
    assert ids(client.get("/api/listings?q=family house")) == [c]
    assert ids(client.get("/api/listings?q=nowhere-ville")) == []


def test_filter_by_property_type(client):
    a, b, c = seed(client)
    assert ids(client.get("/api/listings?property_type=apartment")) == [b]
    assert ids(client.get("/api/listings?property_type=single_room")) == [a]


def test_filter_by_rent_range(client):
    a, b, c = seed(client)
    assert ids(client.get("/api/listings?max_rent=500000")) == [a]
    assert ids(client.get("/api/listings?min_rent=500000&max_rent=2000000")) == [b]
    assert ids(client.get("/api/listings?min_rent=2000000")) == [c]


def test_filters_combine(client):
    a, b, c = seed(client)
    assert ids(client.get("/api/listings?q=ntinda&property_type=apartment&max_rent=1500000")) == [b]
    assert ids(client.get("/api/listings?q=ntinda&property_type=house")) == []


def test_invalid_property_type_rejected(client):
    seed(client)
    assert client.get("/api/listings?property_type=mansion").status_code == 422


def test_search_never_exposes_non_approved(client):
    """The invariant holds under every filter: a pending listing that matches the
    query perfectly is still invisible."""
    pending = submit(client, area="Kansanga", property_type="single_room",
                     rent_ugx=300_000, title="Pending room in Kansanga")
    for query in (
        "?q=kansanga",
        "?property_type=single_room",
        "?max_rent=400000",
        "?q=kansanga&property_type=single_room&min_rent=100000&max_rent=400000",
    ):
        assert pending not in ids(client.get(f"/api/listings{query}"))
