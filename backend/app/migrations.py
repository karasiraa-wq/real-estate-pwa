"""Idempotent SQLite schema upgrades, run at startup before create_all.

The MVP has no Alembic; the deployed database predates the land-listings
feature, and Base.metadata.create_all never alters existing tables. Every step
here is a no-op once applied, so restarting the service is always safe.
"""
from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.schema import CreateTable

from .models import Listing

# Columns added after the first production deploy, per table. ADD COLUMN with a
# constant default is safe and instant in SQLite.
_ADDED_COLUMNS: dict[str, dict[str, str]] = {
    "listings": {
        "category": "VARCHAR(16) NOT NULL DEFAULT 'rental'",
        "asking_price_ugx": "INTEGER",
        "plot_size": "VARCHAR(40)",
        "tenure": "VARCHAR(16)",
        "title_status": "VARCHAR(16)",
        "video_url": "VARCHAR(200)",
        "latitude": "FLOAT",
        "longitude": "FLOAT",
    },
    "credit_grants": {"category": "VARCHAR(16) NOT NULL DEFAULT 'rental'"},
    "reveals": {
        "category": "VARCHAR(16) NOT NULL DEFAULT 'rental'",
        "premium_pass_id": "INTEGER REFERENCES premium_passes (id)",
    },
    "payment_claims": {
        "category": "VARCHAR(16) NOT NULL DEFAULT 'rental'",
        "product": "VARCHAR(16) NOT NULL DEFAULT 'standard_rental'",
    },
}

# One-time backfills, keyed by the just-added column that triggers them: the
# rental default is right for old rental claims, but old land claims must
# become the land product. Runs only in the same transaction that adds the
# column, so it can never touch rows written by the new code.
_BACKFILLS: dict[tuple[str, str], str] = {
    ("payment_claims", "product"): (
        "UPDATE payment_claims SET product = 'land' WHERE category = 'land'"
    ),
}


def _table_info(conn: Connection, table: str) -> list:
    return conn.exec_driver_sql(f"PRAGMA table_info({table})").fetchall()


def _rebuild_listings(conn: Connection) -> None:
    """Relax listings.rent_ugx to nullable (land listings have no rent).

    SQLite cannot drop NOT NULL in place, so this is the standard rebuild:
    create the table from the current model DDL under a temporary name, copy
    every row, swap it in. Runs inside the caller's transaction. FK references
    from photos/reveals are unaffected: SQLAlchemy does not enable SQLite FK
    enforcement, and the final RENAME never rewrites them because nothing
    references the temporary name.
    """
    ddl = str(CreateTable(Listing.__table__).compile(conn)).replace(
        "CREATE TABLE listings", "CREATE TABLE _listings_new", 1
    )
    conn.exec_driver_sql(ddl)
    columns = ", ".join(row[1] for row in _table_info(conn, "_listings_new"))
    conn.exec_driver_sql(f"INSERT INTO _listings_new ({columns}) SELECT {columns} FROM listings")
    conn.exec_driver_sql("DROP TABLE listings")
    conn.exec_driver_sql("ALTER TABLE _listings_new RENAME TO listings")
    for index in Listing.__table__.indexes:
        index.create(conn, checkfirst=True)


def upgrade_schema(engine: Engine) -> None:
    with engine.begin() as conn:
        existing_tables = {
            row[0]
            for row in conn.exec_driver_sql(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
        for table, columns in _ADDED_COLUMNS.items():
            if table not in existing_tables:
                continue  # fresh database: create_all builds it complete
            present = {row[1] for row in _table_info(conn, table)}
            for name, ddl in columns.items():
                if name not in present:
                    conn.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}")
                    backfill = _BACKFILLS.get((table, name))
                    if backfill:
                        conn.exec_driver_sql(backfill)
        if "listings" in existing_tables:
            rent_not_null = any(
                row[1] == "rent_ugx" and row[3] for row in _table_info(conn, "listings")
            )
            if rent_not_null:
                _rebuild_listings(conn)
        conn.execute(text("PRAGMA optimize"))
