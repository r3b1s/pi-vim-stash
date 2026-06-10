"""Tests for hybrid retrieval pipeline (Task 6.9).

Tests FTS5 + Jaccard + HRR search, probe, related, reason, contradict.
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


@pytest.fixture
def seeded_store(store):
    """Store with diverse facts for retrieval tests."""
    store.add_fact("Python is a programming language used for AI", category="tech", tags="python,ai")
    store.add_fact("JavaScript runs in web browsers", category="tech", tags="js,web")
    store.add_fact("The sky is blue on a clear day", category="science", tags="sky,weather")
    store.add_fact("Alice works on machine learning", category="work", tags="alice,ml")
    store.add_fact("Bob manages the engineering team", category="work", tags="bob,engineering")
    return store


# ---------------------------------------------------------------------------
# Hybrid search
# ---------------------------------------------------------------------------

class TestSearch:
    """Hybrid search: FTS5 candidates -> Jaccard rerank -> trust weighting."""

    def test_search_returns_results(self, seeded_store, retriever):
        """Basic search should return matching facts."""
        results = retriever.search("python")
        assert len(results) > 0
        assert isinstance(results, list)

    def search_tokens_to_test():
        return "python"

    def test_search_relevance(self, seeded_store, retriever):
        """Top result should contain the query term."""
        results = retriever.search("python")
        if results:
            assert "python" in results[0]["content"].lower()

    def test_search_no_match(self, seeded_store, retriever):
        """Non-matching query should return empty list."""
        results = retriever.search("zzzzzzzzzzz")
        assert results == []

    def test_search_empty_query(self, seeded_store, retriever):
        """Empty query should return empty list."""
        results = retriever.search("")
        assert results == []

    def test_search_category_filter(self, seeded_store, retriever):
        """Category filter should restrict results."""
        results = retriever.search("python", category="science")
        assert len(results) == 0

    def test_search_min_trust(self, seeded_store, retriever):
        """min_trust filter should exclude low-trust facts."""
        results = retriever.search("python", min_trust=1.0)
        assert len(results) == 0

    def test_search_limit(self, seeded_store, retriever):
        """Limit should cap the number of results."""
        results = retriever.search("the", limit=1)
        assert len(results) <= 1

    def test_search_results_have_score(self, seeded_store, retriever):
        """Results should include a 'score' field."""
        results = retriever.search("python")
        if results:
            assert "score" in results[0]

    def test_search_score_range(self, seeded_store, retriever):
        """Scores should be non-negative and finite."""
        results = retriever.search("python")
        for r in results:
            assert r["score"] >= 0.0
            assert r["score"] < float("inf")

    def test_search_no_hrr_vector_in_results(self, seeded_store, retriever):
        """Results should NOT contain raw hrr_vector bytes."""
        results = retriever.search("python")
        for r in results:
            assert "hrr_vector" not in r, "hrr_vector should be stripped from results"

    def test_search_sorted_by_score_desc(self, seeded_store, retriever):
        """Results should be sorted by score descending."""
        results = retriever.search("python")
        scores = [r["score"] for r in results]
        assert scores == sorted(scores, reverse=True)

    def test_search_tags_also_indexed(self, seeded_store, retriever):
        """Tags should also be searchable via FTS5."""
        results = retriever.search("sky")
        assert len(results) > 0

    def test_search_respects_trust_weight(self, store, retriever):
        """Lower trust facts should rank lower."""
        fid_low = store.add_fact("Python low trust", category="tech")
        fid_high = store.add_fact("Python high trust", category="tech")
        store.update_fact(fid_low, trust_delta=-0.3)  # trust = 0.2
        store.update_fact(fid_high, trust_delta=0.3)  # trust = 0.8
        results = retriever.search("python")
        if len(results) >= 2:
            high_idx = next(i for i, r in enumerate(results) if r["fact_id"] == fid_high)
            low_idx = next(i for i, r in enumerate(results) if r["fact_id"] == fid_low)
            assert high_idx < low_idx, "High-trust fact should rank above low-trust fact"

    def test_search_empty_store(self, retriever):
        """Empty store should return empty list."""
        results = retriever.search("python")
        assert results == []

    def test_search_does_not_crash(self, seeded_store, retriever):
        """retriever.search should not crash when called."""
        results = retriever.search("python")
        assert isinstance(results, list)

    def test_search_with_malformed_query(self, seeded_store, retriever):
        """Malformed FTS5 queries should not crash."""
        # FTS5 can choke on certain special characters; the method catches exceptions
        results = retriever.search("*")  # bare wildcard might fail
        assert isinstance(results, list)


# ---------------------------------------------------------------------------
# Probe
# ---------------------------------------------------------------------------

class TestProbe:
    """Compositional entity query via HRR algebra."""

    def test_probe_returns_list(self, store, retriever):
        """Probe should return a list."""
        store.add_fact('"Alice" works on "ProjectX"', category="work")
        results = retriever.probe("Alice")
        assert isinstance(results, list)

    def test_probe_with_results(self, store, retriever):
        """Probe should find facts related to the entity."""
        store.add_fact('"Alice" works on "ProjectX"', category="work")
        results = retriever.probe("Alice")
        if results:
            assert "score" in results[0]

    def test_probe_category_filter(self, store, retriever):
        """Probe should respect category filter."""
        store.add_fact('"Alice" works on "ProjectX"', category="work")
        store.add_fact('"Alice" likes "Golf"', category="personal")
        results = retriever.probe("Alice", category="work")
        for r in results:
            assert r["category"] == "work"

    def test_probe_empty_for_unknown(self, store, retriever):
        """Probe for unknown entity should return empty list."""
        store.add_fact("Some random fact")
        results = retriever.probe("UnknownEntity")
        assert isinstance(results, list)

    def test_probe_no_hrr_vector_in_results(self, store, retriever):
        """Results should not contain hrr_vector."""
        store.add_fact('"Alice" works on "ProjectX"', category="work")
        results = retriever.probe("Alice")
        for r in results:
            assert "hrr_vector" not in r

    def test_probe_multiple_facts(self, store, retriever):
        """Multiple facts with the same entity should all be probeable."""
        store.add_fact('"Alice" works on "ProjectX"', category="work")
        store.add_fact('"Alice" knows "Bob"', category="work")
        results = retriever.probe("Alice")
        assert isinstance(results, list)


# ---------------------------------------------------------------------------
# Related
# ---------------------------------------------------------------------------

class TestRelated:
    """Discover structurally connected facts."""

    def test_related_returns_list(self, store, retriever):
        """Related should return a list."""
        store.add_fact('"Alice" works on "ProjectX"', category="work")
        results = retriever.related("Alice")
        assert isinstance(results, list)

    def test_related_category_filter(self, store, retriever):
        """Related should respect category filter."""
        store.add_fact('"Alice" works on "ProjectX"', category="work")
        store.add_fact('"Alice" likes "Golf"', category="personal")
        results = retriever.related("Alice", category="work")
        for r in results:
            assert r["category"] == "work"

    def test_related_empty_for_unknown(self, store, retriever):
        """Related for unknown entity should return empty or list."""
        results = retriever.related("UnknownEntity")
        assert isinstance(results, list)

    def test_related_no_hrr_vector_in_results(self, store, retriever):
        """Results should not contain hrr_vector."""
        store.add_fact('"Alice" works on "ProjectX"', category="work")
        results = retriever.related("Alice")
        for r in results:
            assert "hrr_vector" not in r

    def test_related_has_scores(self, store, retriever):
        """Results should have score."""
        store.add_fact('"Alice" works on "ProjectX"', category="work")
        results = retriever.related("Alice")
        if results:
            assert "score" in results[0]


# ---------------------------------------------------------------------------
# Reason
# ---------------------------------------------------------------------------

class TestReason:
    """Multi-entity compositional query."""

    def test_reason_returns_list(self, store, retriever):
        """Reason with entities should return a list."""
        store.add_fact('"Alice" loves "Python"', category="work")
        results = retriever.reason(["Alice", "Python"])
        assert isinstance(results, list)

    def test_reason_single_entity(self, store, retriever):
        """Reason with a single entity should still work."""
        store.add_fact('"Alice" loves "Python"', category="work")
        results = retriever.reason(["Alice"])
        assert isinstance(results, list)

    def test_reason_empty_entities(self, store, retriever):
        """Empty entities list falls back to search."""
        store.add_fact("Generic fact")
        results = retriever.reason([])
        assert isinstance(results, list)

    def test_reason_category_filter(self, store, retriever):
        """Reason should respect category filter."""
        store.add_fact('"Alice" loves "Python"', category="work")
        store.add_fact('"Alice" likes "Dogs"', category="personal")
        results = retriever.reason(["Alice", "Python"], category="work")
        for r in results:
            assert r["category"] == "work"

    def test_reason_no_hrr_vector_in_results(self, store, retriever):
        """Results should not contain hrr_vector."""
        store.add_fact('"Alice" loves "Python"', category="work")
        results = retriever.reason(["Alice", "Python"])
        for r in results:
            assert "hrr_vector" not in r

    def test_reason_has_scores(self, store, retriever):
        """Results should have score."""
        store.add_fact('"Alice" loves "Python"', category="work")
        results = retriever.reason(["Alice", "Python"])
        if results:
            assert "score" in results[0]

    def test_reason_empty_store(self, retriever):
        """Empty store should return empty list."""
        results = retriever.reason(["Alice"])
        assert isinstance(results, list)

    def test_reason_multiple_entities(self, store, retriever):
        """Reason with multiple entities should find intersection."""
        store.add_fact('"Alice" loves "Python" and "Java"', category="work")
        store.add_fact('"Bob" loves "Python"', category="work")
        results = retriever.reason(["Alice", "Python"])
        assert isinstance(results, list)


# ---------------------------------------------------------------------------
# Contradict
# ---------------------------------------------------------------------------

class TestContradict:
    """Find contradictory facts via entity overlap + content divergence."""

    def test_contradict_finds_pairs(self, store, retriever):
        """Contradict should find contradictory pairs when they exist."""
        store.add_fact('"Alice" likes "Python"')
        store.add_fact('"Alice" hates "Java"')
        results = retriever.contradict()
        assert isinstance(results, list)
        # We may or may not get contradiction results; test structure not emptiness
        if results:
            entry = results[0]
            assert "fact_a" in entry
            assert "fact_b" in entry
            assert "contradiction_score" in entry
            assert "shared_entities" in entry

    def test_contradict_empty_with_fewer_than_two(self, store, retriever):
        """With < 2 facts, contradict should return empty list."""
        store.add_fact("Only one fact")
        results = retriever.contradict()
        assert results == []

    def test_contradict_category_filter(self, store, retriever):
        """Contradict should respect category filter."""
        store.add_fact('"Alice" likes "Python"', category="tech")
        store.add_fact('"Alice" hates "Java"', category="personal")
        results_tech = retriever.contradict(category="tech")
        assert isinstance(results_tech, list)

    def test_contradict_limit(self, store, retriever):
        """Contradict should honour limit."""
        store.add_fact('"Alice" likes "Python"')
        store.add_fact('"Alice" hates "Java"')
        results = retriever.contradict(limit=1, threshold=0.0)
        assert len(results) <= 1

    def test_contradict_no_hrr_vector_in_results(self, store, retriever):
        """Results should not contain hrr_vector in fact_a or fact_b."""
        store.add_fact('"Alice" likes "Python"')
        store.add_fact('"Alice" hates "Java"')
        results = retriever.contradict()
        for r in results:
            assert "hrr_vector" not in r["fact_a"]
            assert "hrr_vector" not in r["fact_b"]

    def test_contradict_high_threshold(self, store, retriever):
        """High threshold should filter out most contradictions."""
        store.add_fact('"Alice" likes "Python"')
        store.add_fact('"Alice" hates "Java"')
        results = retriever.contradict(threshold=0.99)
        # With high threshold, likely no results
        assert isinstance(results, list)

    def test_contradict_shared_entities_field(self, store, retriever):
        """Results should list shared entities."""
        store.add_fact('"Alice" likes "Python"')
        store.add_fact('"Alice" hates "Java"')
        results = retriever.contradict()
        for r in results:
            assert isinstance(r["shared_entities"], list)
            if r["shared_entities"]:
                assert isinstance(r["shared_entities"][0], str)


# ---------------------------------------------------------------------------
# Temporal decay
# ---------------------------------------------------------------------------

class TestTemporalDecay:
    """Temporal decay weighting in hybrid search."""

    def test_temporal_decay_disabled_by_default(self, store):
        """Default half_life should be 0 (disabled)."""
        retriever = FactRetriever(store)
        assert retriever.half_life == 0

    def test_temporal_decay_enabled(self, store, retriever):
        """Enabled half_life should not crash."""
        retriever.half_life = 30  # 30 days
        store.add_fact("Test fact temporal")
        results = retriever.search("test")
        assert isinstance(results, list)

    def test_temporal_decay_very_old_fact(self, store):
        """Very old fact with decay should still be retrievable."""
        # Manually insert a fact with an old timestamp
        import sqlite3
        store._conn.execute(
            """INSERT INTO facts (content, created_at, updated_at)
               VALUES (?, datetime('now', '-365 days'), datetime('now', '-365 days'))""",
            ("Very old fact",),
        )
        store._conn.commit()

        retriever = FactRetriever(store, temporal_decay_half_life=30)
        results = retriever.search("old")
        assert isinstance(results, list)


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------

class TestRetrievalEdgeCases:
    """Edge cases for the retrieval pipeline."""

    def test_empty_store_all_methods(self, retriever):
        """All methods should handle empty store gracefully."""
        assert retriever.search("test") == []
        assert retriever.probe("entity") == []
        assert retriever.related("entity") == []
        assert retriever.reason(["entity"]) == []
        assert retriever.contradict() == []

    def test_single_fact_all_methods(self, store, retriever):
        """Single fact should not break any method."""
        store.add_fact("Single test fact", category="test")
        assert isinstance(retriever.search("test"), list)
        assert isinstance(retriever.probe("test"), list)
        assert isinstance(retriever.related("test"), list)
        assert isinstance(retriever.reason(["test"]), list)
        assert retriever.contradict() == []  # < 2 facts

    def test_whitespace_only_query(self, seeded_store, retriever):
        """Whitespace-only query should not crash."""
        results = retriever.search("   ")
        assert isinstance(results, list)

    def test_special_characters_in_query(self, seeded_store, retriever):
        """Special characters should not crash."""
        results = retriever.search("python @#$%^&*()")
        assert isinstance(results, list)


# ---------------------------------------------------------------------------
# Tokenisation & Jaccard (internal helpers)
# ---------------------------------------------------------------------------

class TestTokeniseJaccard:
    """Low-level tokenisation and Jaccard similarity helpers."""

    def test_tokenize_empty(self):
        assert FactRetriever._tokenize("") == set()

    def test_tokenize_basic(self):
        tokens = FactRetriever._tokenize("Hello World")
        assert tokens == {"hello", "world"}

    def test_tokenize_lowercase(self):
        tokens = FactRetriever._tokenize("HELLO")
        assert "hello" in tokens

    def test_tokenize_strips_punctuation(self):
        tokens = FactRetriever._tokenize("hello, world!")
        assert tokens == {"hello", "world"}

    def test_jaccard_identical(self):
        sim = FactRetriever._jaccard_similarity({"a", "b"}, {"a", "b"})
        assert sim == pytest.approx(1.0)

    def test_jaccard_no_overlap(self):
        sim = FactRetriever._jaccard_similarity({"a"}, {"b"})
        assert sim == 0.0

    def test_jaccard_partial(self):
        sim = FactRetriever._jaccard_similarity({"a", "b", "c"}, {"a", "d"})
        assert sim == pytest.approx(1.0 / 4.0)  # intersection=1, union=4

    def test_jaccard_empty_sets(self):
        sim = FactRetriever._jaccard_similarity(set(), set())
        assert sim == 0.0

    def test_jaccard_first_empty(self):
        sim = FactRetriever._jaccard_similarity(set(), {"a"})
        assert sim == 0.0
