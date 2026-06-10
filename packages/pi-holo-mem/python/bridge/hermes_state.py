"""Stub for hermes_state dependency required by upstream store.py.

Provides minimal WAL mode fallback for database connections.
"""

import sqlite3


def apply_wal_with_fallback(conn: sqlite3.Connection, db_label: str = "") -> None:
    """Enable WAL journal mode with graceful fallback.
    
    Attempts to set journal_mode=WAL for better concurrency.
    Silently ignores errors (e.g., on filesystems that don't support WAL).
    
    Args:
        conn: SQLite connection to configure
        db_label: Optional label for logging (ignored in stub)
    """
    try:
        conn.execute("PRAGMA journal_mode=WAL")
    except Exception:
        # Silently ignore - WAL not supported on this filesystem
        pass
