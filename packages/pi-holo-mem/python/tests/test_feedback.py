"""Tests for fact_feedback (Task 6.3).

Covers helpful / unhelpful trust adjustment, clamping, and error handling.
"""

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
    db_path = tmp_path / "test.db"
    s = MemoryStore(db_path=str(db_path))
    yield s
    s.close()


# ---------------------------------------------------------------------------
# Helpful feedback
# ---------------------------------------------------------------------------

class TestHelpfulFeedback:
    """record_feedback(helpful=True) behaviour."""

    def test_helpful_increases_trust(self, store):
        """Helpful feedback should increase trust_score by 0.05."""
        fid = store.add_fact("Test fact")
        result = store.record_feedback(fid, helpful=True)
        assert result["new_trust"] == pytest.approx(0.55)  # 0.5 + 0.05

    def test_helpful_increments_helpful_count(self, store):
        """Helpful feedback should increment helpful_count by 1."""
        fid = store.add_fact("Test fact")
        result = store.record_feedback(fid, helpful=True)
        assert result["helpful_count"] == 1

    def test_helpful_returns_expected_keys(self, store):
        """Result dict should contain fact_id, old_trust, new_trust, helpful_count."""
        fid = store.add_fact("Test fact")
        result = store.record_feedback(fid, helpful=True)
        assert set(result.keys()) == {"fact_id", "old_trust", "new_trust", "helpful_count"}
        assert result["fact_id"] == fid

    def test_multiple_helpful_cumulative(self, store):
        """Multiple helpful feedbacks should accumulate."""
        fid = store.add_fact("Test fact")
        store.record_feedback(fid, helpful=True)
        r2 = store.record_feedback(fid, helpful=True)
        assert r2["old_trust"] == pytest.approx(0.55)
        assert r2["new_trust"] == pytest.approx(0.60)
        assert r2["helpful_count"] == 2

    def test_helpful_updates_database(self, store):
        """The underlying database row should reflect the changes."""
        fid = store.add_fact("Test fact")
        store.record_feedback(fid, helpful=True)
        row = store._conn.execute(
            "SELECT trust_score, helpful_count FROM facts WHERE fact_id = ?", (fid,)
        ).fetchone()
        assert row["trust_score"] == pytest.approx(0.55)
        assert row["helpful_count"] == 1

    def test_helpful_on_max_trust(self, store):
        """Trust clamped at 1.0 when already at max."""
        fid = store.add_fact("Test fact")
        store.update_fact(fid, trust_delta=0.5)  # trust = 1.0
        result = store.record_feedback(fid, helpful=True)
        assert result["new_trust"] == 1.0  # clamped


# ---------------------------------------------------------------------------
# Unhelpful feedback
# ---------------------------------------------------------------------------

class TestUnhelpfulFeedback:
    """record_feedback(helpful=False) behaviour."""

    def test_unhelpful_decreases_trust(self, store):
        """Unhelpful feedback should decrease trust_score by 0.10."""
        fid = store.add_fact("Test fact")
        result = store.record_feedback(fid, helpful=False)
        assert result["new_trust"] == pytest.approx(0.40)  # 0.5 - 0.10

    def test_unhelpful_does_not_increment_helpful_count(self, store):
        """Unhelpful feedback should NOT increment helpful_count."""
        fid = store.add_fact("Test fact")
        result = store.record_feedback(fid, helpful=False)
        assert result["helpful_count"] == 0  # stays at 0

    def test_unhelpful_returns_expected_keys(self, store):
        """Result dict should contain fact_id, old_trust, new_trust, helpful_count."""
        fid = store.add_fact("Test fact")
        result = store.record_feedback(fid, helpful=False)
        assert set(result.keys()) == {"fact_id", "old_trust", "new_trust", "helpful_count"}

    def test_multiple_unhelpful_cumulative(self, store):
        """Multiple unhelpful feedbacks should accumulate."""
        fid = store.add_fact("Test fact")
        store.record_feedback(fid, helpful=False)
        r2 = store.record_feedback(fid, helpful=False)
        assert r2["old_trust"] == pytest.approx(0.40)
        assert r2["new_trust"] == pytest.approx(0.30)
        assert r2["helpful_count"] == 0  # still 0

    def test_unhelpful_on_min_trust(self, store):
        """Trust clamped at 0.0 when already at min."""
        fid = store.add_fact("Test fact")
        store.update_fact(fid, trust_delta=-0.5)  # trust = 0.0
        result = store.record_feedback(fid, helpful=False)
        assert result["new_trust"] == 0.0  # clamped


# ---------------------------------------------------------------------------
# Mixed feedback
# ---------------------------------------------------------------------------

class TestMixedFeedback:
    """Interleaving helpful and unhelpful feedback."""

    def test_helpful_then_unhelpful(self, store):
        """Helpful then unhelpful should result in net decrease."""
        fid = store.add_fact("Test fact")
        r1 = store.record_feedback(fid, helpful=True)  # 0.55
        r2 = store.record_feedback(fid, helpful=False)  # 0.55 - 0.10 = 0.45
        assert r2["new_trust"] == pytest.approx(0.45)

    def test_unhelpful_then_helpful(self, store):
        """Unhelpful then helpful should result in net decrease."""
        fid = store.add_fact("Test fact")
        r1 = store.record_feedback(fid, helpful=False)  # 0.40
        r2 = store.record_feedback(fid, helpful=True)  # 0.40 + 0.05 = 0.45
        assert r2["new_trust"] == pytest.approx(0.45)

    def test_helpful_count_only_helpful(self, store):
        """helpful_count should only reflect helpful feedbacks."""
        fid = store.add_fact("Test fact")
        store.record_feedback(fid, helpful=True)   # count = 1
        store.record_feedback(fid, helpful=False)  # count = 1 (not incremented)
        store.record_feedback(fid, helpful=True)   # count = 2
        row = store._conn.execute(
            "SELECT helpful_count FROM facts WHERE fact_id = ?", (fid,)
        ).fetchone()
        assert row["helpful_count"] == 2


# ---------------------------------------------------------------------------
# Error cases
# ---------------------------------------------------------------------------

class TestFeedbackErrors:
    """Error handling for record_feedback."""

    def test_unknown_fact_id_raises_keyerror(self, store):
        """Non-existent fact_id should raise KeyError."""
        with pytest.raises(KeyError) as exc:
            store.record_feedback(999, helpful=True)
        assert "999" in str(exc.value)

    def test_negative_fact_id_raises_keyerror(self, store):
        """Negative fact_id should raise KeyError."""
        with pytest.raises(KeyError):
            store.record_feedback(-1, helpful=True)
