"""The deployed SQLite database predates land listings; app startup must
upgrade it in place (add category/land/video/location columns, relax
rent_ugx to nullable) without losing a row. Schema below is the exact
pre-migration production schema."""
import sqlite3

from fastapi.testclient import TestClient

from app.main import create_app
from conftest import ADMIN, VALID_LAND, make_settings

OLD_SCHEMA = """
CREATE TABLE listings (
    id INTEGER NOT NULL,
    title VARCHAR(120) NOT NULL,
    property_type VARCHAR(32) NOT NULL,
    district VARCHAR(64) NOT NULL,
    area VARCHAR(120) NOT NULL,
    landmark VARCHAR(200),
    rent_ugx INTEGER NOT NULL,
    description TEXT NOT NULL,
    landlord_name VARCHAR(80) NOT NULL,
    whatsapp_phone VARCHAR(16) NOT NULL,
    status VARCHAR(16) NOT NULL,
    rejection_reason TEXT,
    photo_token VARCHAR(64) NOT NULL,
    created_at DATETIME NOT NULL,
    reviewed_at DATETIME,
    PRIMARY KEY (id)
);
CREATE INDEX ix_listings_status ON listings (status);
CREATE TABLE photos (
    id INTEGER NOT NULL,
    listing_id INTEGER NOT NULL,
    filename VARCHAR(80) NOT NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    FOREIGN KEY(listing_id) REFERENCES listings (id),
    UNIQUE (filename)
);
CREATE TABLE tenants (
    id INTEGER NOT NULL,
    phone VARCHAR(16) NOT NULL,
    token_hash VARCHAR(64) NOT NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (id)
);
CREATE TABLE credit_grants (
    id INTEGER NOT NULL,
    tenant_id INTEGER NOT NULL,
    credits INTEGER NOT NULL,
    source VARCHAR(16) NOT NULL,
    momo_tx_id VARCHAR(64) NOT NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    FOREIGN KEY(tenant_id) REFERENCES tenants (id),
    UNIQUE (momo_tx_id)
);
CREATE TABLE reveals (
    id INTEGER NOT NULL,
    tenant_id INTEGER NOT NULL,
    listing_id INTEGER NOT NULL,
    charged BOOLEAN NOT NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    UNIQUE (tenant_id, listing_id),
    FOREIGN KEY(tenant_id) REFERENCES tenants (id),
    FOREIGN KEY(listing_id) REFERENCES listings (id)
);
CREATE TABLE payment_claims (
    id INTEGER NOT NULL,
    tenant_id INTEGER NOT NULL,
    momo_tx_id VARCHAR(64) NOT NULL,
    status VARCHAR(16) NOT NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    FOREIGN KEY(tenant_id) REFERENCES tenants (id),
    UNIQUE (momo_tx_id)
);
"""


def build_old_db(path) -> None:
    con = sqlite3.connect(path)
    con.executescript(OLD_SCHEMA)
    con.execute(
        "INSERT INTO listings (id, title, property_type, district, area, landmark, rent_ugx,"
        " description, landlord_name, whatsapp_phone, status, photo_token, created_at, reviewed_at)"
        " VALUES (1, 'Old approved room in Ntinda', 'single_room', 'Kampala', 'Ntinda', NULL,"
        " 300000, 'A room that existed before the land feature.', 'Old Landlord',"
        " '+256771112223', 'approved', 'legacy-token', '2026-06-01 10:00:00', '2026-06-02 10:00:00')"
    )
    con.execute(
        "INSERT INTO tenants (id, phone, token_hash, created_at)"
        " VALUES (1, '+256700111222', 'deadbeef', '2026-06-03 10:00:00')"
    )
    con.execute(
        "INSERT INTO reveals (id, tenant_id, listing_id, charged, created_at)"
        " VALUES (1, 1, 1, 0, '2026-06-04 10:00:00')"
    )
    con.execute(
        "INSERT INTO credit_grants (id, tenant_id, credits, source, momo_tx_id, created_at)"
        " VALUES (1, 1, 20, 'manual', 'TX-OLD', '2026-06-05 10:00:00')"
    )
    con.execute(
        "INSERT INTO payment_claims (id, tenant_id, momo_tx_id, status, created_at)"
        " VALUES (1, 1, 'TX-PENDING', 'pending', '2026-06-06 10:00:00')"
    )
    con.commit()
    con.close()


def test_old_database_upgrades_in_place(tmp_path):
    db_path = tmp_path / "old.db"
    build_old_db(db_path)
    settings = make_settings(tmp_path, database_url=f"sqlite:///{db_path}")

    with TestClient(create_app(settings)) as client:
        # The pre-existing listing survives, is categorized as a rental, and
        # still serves on the default feed.
        feed = client.get("/api/listings").json()
        assert [(l["id"], l["category"], l["rent_ugx"]) for l in feed] == [(1, "rental", 300_000)]
        assert client.get("/api/listings?category=land").json() == []

        # Old paywall rows are scoped to the rental category.
        queue = client.get("/api/admin/payment-claims", headers=ADMIN).json()
        assert [(c["momo_tx_id"], c["category"]) for c in queue] == [("TX-PENDING", "rental")]

        # rent_ugx is nullable now: a land submission (no rent) works.
        r = client.post("/api/listings", json=VALID_LAND)
        assert r.status_code == 201, r.text

        # And a second boot on the migrated file is a clean no-op.
    with TestClient(create_app(settings)) as client:
        assert client.get("/api/listings").json()[0]["id"] == 1


def test_migrated_rows_keep_column_values(tmp_path):
    db_path = tmp_path / "old.db"
    build_old_db(db_path)
    settings = make_settings(tmp_path, database_url=f"sqlite:///{db_path}")
    with TestClient(create_app(settings)):
        pass

    con = sqlite3.connect(db_path)
    row = con.execute(
        "SELECT title, rent_ugx, category, status, photo_token FROM listings WHERE id = 1"
    ).fetchone()
    assert row == ("Old approved room in Ntinda", 300000, "rental", "approved", "legacy-token")
    # rent_ugx must have lost its NOT NULL (column index 3 of PRAGMA is notnull).
    rent = [r for r in con.execute("PRAGMA table_info(listings)") if r[1] == "rent_ugx"][0]
    assert rent[3] == 0
    grant = con.execute("SELECT credits, category FROM credit_grants WHERE id = 1").fetchone()
    assert grant == (20, "rental")
    reveal = con.execute("SELECT charged, category FROM reveals WHERE id = 1").fetchone()
    assert reveal == (0, "rental")
    con.close()
