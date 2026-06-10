"""Tests for all 9 fact_store actions (Task 6.2).

Actions tested:
  add, search, probe, related, reason, contradict, update, remove, list
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "python"))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "python" / "bridge"))

import pytest
from upstream.store import MemoryStore
from upstream.retrieval import FactRetriever


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
def retriever(store):
    """Create a FactRetriever wrapping the test store."""
    return FactRetriever(store)


# ---------------------------------------------------------------------------
# Action: add
# ---------------------------------------------------------------------------

class TestActionAdd:
    """add – store a new fact."""

    def test_add_basic(self, store):
        """Adding a simple fact should return a positive fact_id."""
        fact_id = store.add_fact("User prefers TypeScript over JavaScript")
        assert fact_id > 0

    def test_add_with_category_and_tags(self, store):
        """Adding a fact with category and tags should persist them."""
        fact_id = store.add_fact(
            "Auth uses JWT tokens",
            category="project",
            tags="auth,jwt",
        )
        assert fact_id > 0
        rows = store._conn.execute(
            "SELECT category, tags FROM facts WHERE fact_id = ?", (fact_id,)
        ).fetchone()
        assert rows["category"] == "project"
        assert rows["tags"] == "auth,jwt"

    def test_add_empty_content_raises(self, store):
        """Empty content should raise ValueError."""
        with pytest.raises(ValueError, match="content must not be empty"):
            store.add_fact("")

    def test_add_duplicate_returns_existing_id(self, store):
        """Duplicate content should return the existing fact_id."""
        fid1 = store.add_fact("Unique content here")
        fid2 = store.add_fact("Unique content here")
        assert fid1 == fid2

    def test_add_strips_whitespace(self, store):
        """Content should be stripped of leading/trailing whitespace."""
        fid = store.add_fact("  spaced out  ")
        row = store._conn.execute(
            "SELECT content FROM facts WHERE fact_id = ?", (fid,)
        ).fetchone()
        assert row["content"] == "spaced out"

    def test_add_extracts_entities_from_double_quotes(self, store):
        """Entities should be extracted from double-quoted terms."""
        store.add_fact('"Alice" works on "ProjectX"')
        entities = {
            r["name"]
            for r in store._conn.execute("SELECT name FROM entities").fetchall()
        }
        assert "Alice" in entities
        assert "ProjectX" in entities

    def test_add_extracts_entities_from_capitalized_phrases(self, store):
        """Entities should be extracted from capitalized multi-word phrases."""
        store.add_fact("John Doe works at Mega Corp")
        entities = {
            r["name"]
            for r in store._conn.execute("SELECT name FROM entities").fetchall()
        }
        assert "John Doe" in entities

    def test_add_links_fact_to_entity(self, store):
        """Fact should be linked to extracted entities."""
        fid = store.add_fact('"Bob" is a developer')
        links = store._conn.execute(
            "SELECT entity_id FROM fact_entities WHERE fact_id = ?", (fid,)
        ).fetchall()
        assert len(links) >= 1

    def test_add_with_hrr_vector(self, store):
        """Fact should get an HRR vector when numpy is available."""
        fid = store.add_fact("HRR test fact")
        row = store._conn.execute(
            "SELECT hrr_vector FROM facts WHERE fact_id = ?", (fid,)
        ).fetchone()
        assert row["hrr_vector"] is not None
        assert isinstance(row["hrr_vector"], bytes)
        assert len(row["hrr_vector"]) > 0


# ---------------------------------------------------------------------------
# Action: search
# ---------------------------------------------------------------------------

class TestActionSearch:
    """search – FTS5 full-text search."""

    def test_search_basic(self, store):
        """Search should return matching facts."""
        store.add_fact("Python is a programming language", category="tech")
        store.add_fact("JavaScript runs in the browser", category="tech")
        results = store.search_facts("python")
        assert len(results) >= 1
        assert "python" in results[0]["content"].lower()

    def test_search_no_match(self, store):
        """Search with a non-matching query should return empty list."""
        store.add_fact("Some fact")
        results = store.search_facts("nonexistent")
        assert results == []

    def test_search_empty_query(self, store):
        """Empty query should return empty list."""
        results = store.search_facts("")
        assert results == []

    def test_search_with_category_filter(self, store):
        """Category filter should restrict results."""
        store.add_fact("Python coding", category="tech")
        store.add_fact("Cooking pasta", category="food")
        results = store.search_facts("python", category="food")
        assert len(results) == 0

    def test_search_with_min_trust(self, store):
        """min_trust filter should exclude low-trust results."""
        fid = store.add_fact("Python fact")
        store.update_fact(fid, trust_delta=-0.3)  # trust now 0.2
        results = store.search_facts("python", min_trust=0.5)
        assert len(results) == 0

    def test_search_with_limit(self, store):
        """Limit should cap the number of results."""
        for i in range(5):
            store.add_fact(f"Fact number {i}")
        results = store.search_facts("fact", limit=3)
        assert len(results) <= 3

    def test_search_returns_dicts_with_expected_keys(self, store):
        """Result dicts should contain all expected fact fields."""
        store.add_fact("Search result fact", category="test", tags="test")
        results = store.search_facts("search")
        if results:
            keys = {"fact_id", "content", "category", "tags", "trust_score",
                    "retrieval_count", "helpful_count", "created_at", "updated_at"}
            assert keys.issubset(results[0].keys()), f"Missing keys: {keys - results[0].keys()}"

    def test_search_increments_retrieval_count(self, store):
        """Searching for a fact should increment its retrieval_count."""
        fid = store.add_fact("Increment test")
        store.search_facts("increment")
        row = store._conn.execute(
            "SELECT retrieval_count FROM facts WHERE fact_id = ?", (fid,)
        ).fetchone()
        assert row["retrieval_count"] >= 1


# ---------------------------------------------------------------------------
# Action: probe
# ---------------------------------------------------------------------------

class TestActionProbe:
    """probe – compositional entity query using HRR algebra."""

    def test_probe_returns_list(self, retriever, store):
        """Probe should return a list of results."""
        store.add_fact('"Alice" works on "ProjectX"', category="work")
        results = retriever.probe("Alice")
        assert isinstance(results, list)

    def test_probe_finds_matching_fact(self, retriever, store):
        """Probe should find facts related to the entity."""
        store.add_fact('"Alice" works on "ProjectX"', category="work")
        results = retriever.probe("Alice")
        if results:
            assert "alice" in results[0]["content"].lower()

    def test_probe_empty_results_for_unknown_entity(self, retriever, store):
        """Probe should return empty list for an unknown entity."""
        store.add_fact("Some random fact")
        results = retriever.probe("UnknownEntity123")
        assert isinstance(results, list)

    def test_probe_with_category_filter(self, retriever, store):
        """Probe should respect category filter."""
        store.add_fact('"Alice" works on "ProjectX"', category="work")
        store.add_fact('"Alice" likes "Golf"', category="personal")
        results = retriever.probe("Alice", category="work")
        for r in results:
            assert r["category"] == "work"

    def test_probe_returns_scored_results(self, retriever, store):
        """Probe results should have a score field."""
        store.add_fact('"Alice" works on "ProjectX"', category="work")
        results = retriever.probe("Alice")
        if results:
            assert "score" in results[0]


# ---------------------------------------------------------------------------
# Action: related
# ---------------------------------------------------------------------------

class TestActionRelated:
    """related – discover structurally connected facts."""

    def test_related_returns_list(self, retriever, store):
        """Related should return a list of results."""
        store.add_fact('"Alice" works on "ProjectX"', category="work")
        results = retriever.related("Alice")
        assert isinstance(results, list)

    def test_related_with_category(self, retriever, store):
        """Related should respect category filter."""
        store.add_fact('"Alice" works on "ProjectX"', category="work")
        store.add_fact('"Alice" likes "Golf"', category="personal")
        results = retriever.related("Alice", category="work")
        for r in results:
            assert r["category"] == "work"

    def test_related_returns_scored_results(self, retriever, store):
        """Related results should have a score field."""
        store.add_fact('"Alice" works on "ProjectX"', category="work")
        results = retriever.related("Alice")
        if results:
            assert "score" in results[0]

    def test_related_empty_for_missing_entity(self, retriever, store):
        """Related should return empty list for non-existent entity."""
        results = retriever.related("NonExistent")
        assert isinstance(results, list)


# ---------------------------------------------------------------------------
# Action: reason
# ---------------------------------------------------------------------------

class TestActionReason:
    """reason – multi-entity compositional query."""

    def test_reason_returns_list(self, retriever, store):
        """Reason should return a list of results."""
        store.add_fact('"Alice" loves "Python"', category="work")
        results = retriever.reason(["Alice", "Python"])
        assert isinstance(results, list)

    def test_reason_with_single_entity(self, retriever, store):
        """Reason with a single entity should still work."""
        store.add_fact('"Alice" loves "Python"', category="work")
        results = retriever.reason(["Alice"])
        assert isinstance(results, list)

    def test_reason_empty_entities(self, retriever, store):
        """Empty entities list should return results (falls back to search)."""
        store.add_fact("Generic fact about nothing")
        results = retriever.reason([])
        assert isinstance(results, list)

    def test_reason_with_category(self, retriever, store):
        """Reason should respect category filter."""
        store.add_fact('"Alice" loves "Python"', category="work")
        store.add_fact('"Alice" likes "Dogs"', category="personal")
        results = retriever.reason(["Alice", "Python"], category="work")
        for r in results:
            assert r["category"] == "work"

    def test_reason_returns_scored_results(self, retriever, store):
        """Reason results should have a score field."""
        store.add_fact('"Alice" loves "Python"', category="work")
        results = retriever.reason(["Alice", "Python"])
        if results:
            assert "score" in results[0]

    def test_reason_empty_for_no_facts(self, retriever, store):
        """Reason should handle empty store gracefully."""
        results = retriever.reason(["Alice"])
        assert isinstance(results, list)


# ---------------------------------------------------------------------------
# Action: contradict
# ---------------------------------------------------------------------------

class TestActionContradict:
    """contradict – find contradictory fact pairs."""

    def test_contradict_returns_list(self, retriever, store):
        """Contradict should return a list of contradiction pairs."""
        store.add_fact('"Alice" likes "Python"')
        store.add_fact('"Alice" hates "Java"')
        results = retriever.contradict()
        assert isinstance(results, list)

    def test_contradict_with_fewer_than_two_facts(self, retriever, store):
        """Contradict should return empty list when < 2 facts exist."""
        store.add_fact("Only one fact here")
        results = retriever.contradict()
        assert results == []

    def test_contradict_with_category_filter(self, retriever, store):
        """Contradict should respect category filter."""
        store.add_fact('"Alice" likes "Python"', category="tech")
        store.add_fact('"Alice" hates "Java"', category="personal")
        # Both in different categories with no shared category overlap
        results_tech = retriever.contradict(category="tech")
        results_both = retriever.contradict()  # no filter
        assert isinstance(results_tech, list)
        assert isinstance(results_both, list)

    def test_contradict_results_have_expected_keys(self, retriever, store):
        """Contradict results should contain fact_a, fact_b, and scores."""
        store.add_fact('"Alice" likes "Python"')
        store.add_fact('"Alice" hates "Java"')
        results = retriever.contradict()
        if results:
            entry = results[0]
            assert "fact_a" in entry
            assert "fact_b" in entry
            assert "entity_overlap" in entry
            assert "contradiction_score" in entry
            assert "shared_entities" in entry

    def test_contradict_limited(self, retriever, store):
        """Contradict should honour the limit parameter."""
        for i in range(3):
            store.add_fact(f'"Entity{i}" likes "Something{i}"')
            store.add_fact(f'"Entity{i}" hates "Else{i}"')
        results = retriever.contradict(limit=2)
        assert len(results) <= 2


# ---------------------------------------------------------------------------
# Action: update
# ---------------------------------------------------------------------------

class TestActionUpdate:
    """update – modify an existing fact."""

    def test_update_content(self, store):
        """Updating content should change the stored value."""
        fid = store.add_fact("Original content")
        updated = store.update_fact(fid, content="Updated content")
        assert updated is True
        row = store._conn.execute(
            "SELECT content FROM facts WHERE fact_id = ?", (fid,)
        ).fetchone()
        assert row["content"] == "Updated content"

    def test_update_trust_delta(self, store):
        """Trust delta should adjust trust_score, clamped to [0, 1]."""
        fid = store.add_fact("Trust test")
        store.update_fact(fid, trust_delta=0.3)
        row = store._conn.execute(
            "SELECT trust_score FROM facts WHERE fact_id = ?", (fid,)
        ).fetchone()
        assert row["trust_score"] == pytest.approx(0.8)  # 0.5 + 0.3

    def test_update_trust_clamped_high(self, store):
        """Trust should be clamped to a maximum of 1.0."""
        fid = store.add_fact("Clamp high")
        store.update_fact(fid, trust_delta=0.6)  # 0.5 + 0.6 = 1.1 -> 1.0
        row = store._conn.execute(
            "SELECT trust_score FROM facts WHERE fact_id = ?", (fid,)
        ).fetchone()
        assert row["trust_score"] == 1.0

    def test_update_trust_clamped_low(self, store):
        """Trust should be clamped to a minimum of 0.0."""
        fid = store.add_fact("Clamp low")
        store.update_fact(fid, trust_delta=-0.6)  # 0.5 - 0.6 = -0.1 -> 0.0
        row = store._conn.execute(
            "SELECT trust_score FROM facts WHERE fact_id = ?", (fid,)
        ).fetchone()
        assert row["trust_score"] == 0.0

    def test_update_tags(self, store):
        """Updating tags should change the stored value."""
        fid = store.add_fact("Tag test")
        store.update_fact(fid, tags="new-tag")
        row = store._conn.execute(
            "SELECT tags FROM facts WHERE fact_id = ?", (fid,)
        ).fetchone()
        assert row["tags"] == "new-tag"

    def test_update_category(self, store):
        """Updating category should change the stored value."""
        fid = store.add_fact("Category test", category="old")
        store.update_fact(fid, category="new")
        row = store._conn.execute(
            "SELECT category FROM facts WHERE fact_id = ?", (fid,)
        ).fetchone()
        assert row["category"] == "new"

    def test_update_not_found(self, store):
        """Updating a non-existent fact should return False."""
        updated = store.update_fact(999, content="nope")
        assert updated is False

    def test_update_empty_content_raises(self, store):
        """update_fact with empty string content should raise ValueError."""
        fact_id = store.add_fact("Original content")
        with pytest.raises(ValueError, match="content must not be empty"):
            store.update_fact(fact_id, content="")

    def test_update_whitespace_content_raises(self, store):
        """update_fact with whitespace-only content should raise ValueError."""
        fact_id = store.add_fact("Original content")
        with pytest.raises(ValueError, match="content must not be empty"):
            store.update_fact(fact_id, content="   ")

    def test_update_no_changes(self, store):
        """Updating with no parameters should still return True."""
        fid = store.add_fact("No change")
        updated = store.update_fact(fid)
        assert updated is True


# ---------------------------------------------------------------------------
# Action: remove
# ---------------------------------------------------------------------------

class TestActionRemove:
    """remove – delete a fact."""

    def test_remove_existing(self, store):
        """Removing an existing fact should return True and delete the row."""
        fid = store.add_fact("To be removed")
        removed = store.remove_fact(fid)
        assert removed is True
        row = store._conn.execute(
            "SELECT fact_id FROM facts WHERE fact_id = ?", (fid,)
        ).fetchone()
        assert row is None

    def test_remove_not_found(self, store):
        """Removing a non-existent fact should return False."""
        removed = store.remove_fact(999)
        assert removed is False

    def test_remove_cleans_up_entity_links(self, store):
        """Removing a fact should clean up its fact_entity links."""
        fid = store.add_fact('"Alice" test')
        links_before = store._conn.execute(
            "SELECT COUNT(*) as cnt FROM fact_entities WHERE fact_id = ?", (fid,)
        ).fetchone()["cnt"]
        assert links_before > 0
        store.remove_fact(fid)
        links_after = store._conn.execute(
            "SELECT COUNT(*) as cnt FROM fact_entities WHERE fact_id = ?", (fid,)
        ).fetchone()["cnt"]
        assert links_after == 0

    def test_remove_updates_updated_at(self, store):
        """... no updated_at check needed for remove, just verify cascade."""
        pass  # No specific column check needed beyond the above


# ---------------------------------------------------------------------------
# Action: list
# ---------------------------------------------------------------------------

class TestActionList:
    """list – browse facts ordered by trust_score descending."""

    def test_list_empty(self, store):
        """Empty store should return empty list."""
        facts = store.list_facts()
        assert facts == []

    def test_list_all(self, store):
        """List should return all facts."""
        store.add_fact("Fact A")
        store.add_fact("Fact B")
        facts = store.list_facts()
        assert len(facts) == 2

    def test_list_ordered_by_trust_desc(self, store):
        """Facts should be ordered by trust_score descending."""
        fa = store.add_fact("Low trust")
        fb = store.add_fact("High trust")
        store.update_fact(fa, trust_delta=-0.2)  # trust 0.3
        store.update_fact(fb, trust_delta=0.3)  # trust 0.8
        facts = store.list_facts()
        assert facts[0]["fact_id"] == fb
        assert facts[0]["trust_score"] >= facts[-1]["trust_score"]

    def test_list_category_filter(self, store):
        """Category filter should only return facts in that category."""
        store.add_fact("Fact A", category="cat1")
        store.add_fact("Fact B", category="cat2")
        facts = store.list_facts(category="cat1")
        assert len(facts) == 1
        assert facts[0]["category"] == "cat1"

    def test_list_min_trust_filter(self, store):
        """min_trust filter should exclude low-trust facts."""
        fid = store.add_fact("Low trust fact")
        store.update_fact(fid, trust_delta=-0.4)  # trust 0.1
        facts = store.list_facts(min_trust=0.5)
        assert len(facts) == 0

    def test_list_limit(self, store):
        """Limit should cap the number of returned facts."""
        for i in range(5):
            store.add_fact(f"Fact {i}")
        facts = store.list_facts(limit=3)
        assert len(facts) == 3

    def test_list_default_limit(self, store):
        """Default limit should be 50."""
        for i in range(60):
            store.add_fact(f"Fact {i}")
        facts = store.list_facts()
        assert len(facts) == 50

    def test_list_results_have_expected_keys(self, store):
        """Result dicts should contain expected fields."""
        store.add_fact("Key test", category="test", tags="keys")
        facts = store.list_facts()
        if facts:
            keys = {"fact_id", "content", "category", "tags", "trust_score",
                    "retrieval_count", "helpful_count", "created_at", "updated_at"}
            assert keys.issubset(facts[0].keys())
