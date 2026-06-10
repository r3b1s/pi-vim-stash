"""Tests for MemoryStore initialization and schema creation (Task 6.1)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "python"))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "python" / "bridge"))

import pytest
from upstream.store import MemoryStore


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def store(tmp_path):
    """Create a MemoryStore backed by a temporary SQLite database."""
    db_path = tmp_path / "test.db"
    s = MemoryStore(db_path=str(db_path))
    yield s
    s.close()


@pytest.fixture
def populated_store(store):
    """Add a few facts for tests that need pre-existing data."""
    store.add_fact("Python is a programming language", category="tech", tags="python")
    store.add_fact("The sky is blue", category="science", tags="sky,color")
    store.add_fact("Alice works at AcmeCorp", category="work", tags="alice,acme")
    return store


# ---------------------------------------------------------------------------
# Initialisation & schema
# ---------------------------------------------------------------------------

class TestInit:
    """MemoryStore initialisation and database schema."""

    def test_creates_db_file(self, tmp_path):
        """The database file should exist after creating a MemoryStore."""
        db_path = tmp_path / "fresh.db"
        s = MemoryStore(db_path=str(db_path))
        assert db_path.exists()
        s.close()

    def test_creates_parent_directories(self, tmp_path):
        """Parent directories that don't exist yet should be created."""
        db_path = tmp_path / "nested" / "dirs" / "store.db"
        s = MemoryStore(db_path=str(db_path))
        assert db_path.exists()
        s.close()

    def test_all_tables_exist(self, store):
        """All expected tables should be present after init."""
        tables = store._conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        ).fetchall()
        table_names = {row["name"] for row in tables}
        expected = {"facts", "entities", "fact_entities", "facts_fts", "memory_banks"}
        assert expected.issubset(table_names), f"Missing tables: {expected - table_names}"

    def test_all_indexes_exist(self, store):
        """All expected indexes should be present after init."""
        indexes = store._conn.execute(
            "SELECT name FROM sqlite_master WHERE type='index' ORDER BY name"
        ).fetchall()
        index_names = {row["name"] for row in indexes}
        expected = {"idx_facts_trust", "idx_facts_category", "idx_entities_name"}
        for name in expected:
            assert name in index_names, f"Missing index: {name}"

    def test_ftsvirtual_table_exists(self, store):
        """FTS5 virtual table should be queryable."""
        row = store._conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='facts_fts'"
        ).fetchone()
        assert row is not None

    def test_ftsvirtual_table_has_content_and_tags(self, store):
        """FTS5 table should index content and tags columns."""
        # Verify we can MATCH against it
        store.add_fact("hello world test")
        rows = store._conn.execute(
            "SELECT rowid FROM facts_fts WHERE facts_fts MATCH ?", ("hello",)
        ).fetchall()
        assert len(rows) > 0

    def test_default_trust(self, store):
        """Default trust_score should be 0.5."""
        assert store.default_trust == 0.5

    def test_custom_default_trust(self, tmp_path):
        """Custom default_trust should be honoured."""
        db_path = tmp_path / "custom_trust.db"
        s = MemoryStore(db_path=str(db_path), default_trust=0.8)
        assert s.default_trust == 0.8
        s.close()

    def test_hrr_availability(self, store):
        """_hrr_available should be True when numpy is installed."""
        assert store._hrr_available is True

    def test_hrr_dim_default(self, store):
        """Default HRR dimension should be 1024."""
        assert store.hrr_dim == 1024

    def test_custom_hrr_dim(self, tmp_path):
        """Custom HRR dimension should be honoured."""
        db_path = tmp_path / "custom_hrr.db"
        s = MemoryStore(db_path=str(db_path), hrr_dim=512)
        assert s.hrr_dim == 512
        s.close()

    def test_hrr_vector_column_migration(self, tmp_path):
        """The hrr_vector column should be added if it doesn't exist (migration path)."""
        # Create a database WITHOUT the hrr_vector column, then init
        import sqlite3

        db_path = tmp_path / "migrate.db"

        # Manually create schema without hrr_vector to simulate an old DB
        conn = sqlite3.connect(str(db_path))
        conn.executescript("""
            CREATE TABLE facts (
                fact_id         INTEGER PRIMARY KEY AUTOINCREMENT,
                content         TEXT NOT NULL UNIQUE,
                category        TEXT DEFAULT 'general',
                tags            TEXT DEFAULT '',
                trust_score     REAL DEFAULT 0.5,
                retrieval_count INTEGER DEFAULT 0,
                helpful_count   INTEGER DEFAULT 0,
                created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)
        conn.close()

        # Now initialise MemoryStore on this existing DB
        s = MemoryStore(db_path=str(db_path))
        columns = {row[1] for row in s._conn.execute("PRAGMA table_info(facts)").fetchall()}
        assert "hrr_vector" in columns
        s.close()

    def test_wal_mode_enabled(self, store):
        """WAL journal mode should be enabled when supported."""
        row = store._conn.execute("PRAGMA journal_mode").fetchone()
        # WAL mode returns "wal"; fallback returns "delete" or others
        assert row[0].lower() == "wal"


# ---------------------------------------------------------------------------
# Close / cleanup
# ---------------------------------------------------------------------------

class TestClose:
    """MemoryStore close behaviour."""

    def test_close_does_not_raise(self, store):
        """Closing an open store should not raise."""
        store.close()

    def test_called_after_yield(self, tmp_path):
        """The fixture's yield + close pattern should work."""
        db_path = tmp_path / "yield_test.db"
        s = MemoryStore(db_path=str(db_path))
        s.close()
        # Should be able to call close again without error
        s.close()

    def test_context_manager_support(self, tmp_path):
        """MemoryStore should support 'with' statement."""
        db_path = tmp_path / "context.db"
        with MemoryStore(db_path=str(db_path)) as s:
            fact_id = s.add_fact("Context manager test")
            assert fact_id > 0
        # Connection should be closed after with-block
        import sqlite3
        with pytest.raises(sqlite3.ProgrammingError):
            s.list_facts()
