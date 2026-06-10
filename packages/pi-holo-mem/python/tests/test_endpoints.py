"""Tests for bridge HTTP endpoints (Task 6.4).

Uses FastAPI TestClient with injected MemoryStore / FactRetriever instances.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "python"))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "python" / "bridge"))

import pytest
from fastapi.testclient import TestClient

from upstream.store import MemoryStore
from upstream.retrieval import FactRetriever

# Import the app module so we can inject globals
from bridge import server


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


@pytest.fixture(autouse=True)
def inject_store_retriever(store, retriever):
    """Inject test store and retriever into the bridge server module.

    This avoids triggering the real startup event which would try to use
    the default database path.
    """
    server.store = store
    server.retriever = retriever
    yield
    # Restore defaults after each test
    server.store = None
    server.retriever = None


@pytest.fixture
def client():
    """Return a FastAPI TestClient without triggering lifecycle events."""
    return TestClient(server.app)


# ---------------------------------------------------------------------------
# Health endpoint
# ---------------------------------------------------------------------------

class TestHealth:
    """GET /health"""

    def test_health_returns_200(self, client):
        """Health endpoint should return 200 OK."""
        response = client.get("/health")
        assert response.status_code == 200

    def test_health_returns_ok_status(self, client):
        """Health response should have status 'ok'."""
        response = client.get("/health")
        data = response.json()
        assert data["status"] == "ok"

    def test_health_ready_flag(self, client):
        """Health response should indicate readiness when store is injected."""
        response = client.get("/health")
        data = response.json()
        assert data["ready"] is True

    def test_health_when_not_ready(self):
        """When globals are None, ready should be False."""
        server.store = None
        server.retriever = None
        client = TestClient(server.app)
        response = client.get("/health")
        data = response.json()
        assert data["ready"] is False

    def test_health_content_type(self, client):
        """Health endpoint should return JSON."""
        response = client.get("/health")
        assert response.headers["content-type"] == "application/json"


# ---------------------------------------------------------------------------
# Fact-store endpoint: add
# ---------------------------------------------------------------------------

class TestEndpointAdd:
    """POST /fact-store with action=add"""

    def test_add_basic(self, client):
        """Adding a basic fact should return fact_id and status."""
        response = client.post("/fact-store", json={
            "action": "add",
            "content": "Endpoint test fact",
        })
        assert response.status_code == 200
        data = response.json()
        assert "fact_id" in data
        assert data["fact_id"] > 0
        assert data["status"] == "added"

    def test_add_with_category_tags(self, client):
        """Adding with category and tags should succeed."""
        response = client.post("/fact-store", json={
            "action": "add",
            "content": "Categorized fact",
            "category": "testing",
            "tags": "test,ci",
        })
        assert response.status_code == 200
        assert response.json()["fact_id"] > 0

    def test_add_missing_content(self, client):
        """Missing content should return 400."""
        response = client.post("/fact-store", json={
            "action": "add",
        })
        assert response.status_code == 400

    def test_add_empty_content(self, client):
        """Empty content string should return 400 (server validation catches it)."""
        response = client.post("/fact-store", json={
            "action": "add",
            "content": "",
        })
        assert response.status_code == 400

    def test_add_duplicate(self, client):
        """Adding duplicate content should succeed (returns existing id)."""
        r1 = client.post("/fact-store", json={
            "action": "add",
            "content": "Dup content",
        })
        r2 = client.post("/fact-store", json={
            "action": "add",
            "content": "Dup content",
        })
        assert r1.json()["fact_id"] == r2.json()["fact_id"]


# ---------------------------------------------------------------------------
# Fact-store endpoint: search
# ---------------------------------------------------------------------------

class TestEndpointSearch:
    """POST /fact-store with action=search"""

    @pytest.fixture(autouse=True)
    def seed_facts(self, store):
        store.add_fact("Python is a programming language", category="tech")
        store.add_fact("JavaScript runs in the browser", category="tech")

    def test_search_basic(self, client):
        """Search should return matching results."""
        response = client.post("/fact-store", json={
            "action": "search",
            "query": "python",
        })
        assert response.status_code == 200
        data = response.json()
        assert data["count"] >= 1

    def test_search_no_match(self, client):
        """Non-matching query should return empty results."""
        response = client.post("/fact-store", json={
            "action": "search",
            "query": "zzzzzzzz",
        })
        assert response.status_code == 200
        assert response.json()["count"] == 0

    def test_search_missing_query(self, client):
        """Missing query should return 400."""
        response = client.post("/fact-store", json={
            "action": "search",
        })
        assert response.status_code == 400

    def test_search_with_category(self, client):
        """Search with category filter should work."""
        response = client.post("/fact-store", json={
            "action": "search",
            "query": "python",
            "category": "tech",
        })
        assert response.status_code == 200

    def test_search_with_limit(self, client):
        """Search with limit should cap results."""
        response = client.post("/fact-store", json={
            "action": "search",
            "query": "a",
            "limit": 1,
        })
        assert response.status_code == 200
        assert response.json()["count"] <= 1


# ---------------------------------------------------------------------------
# Fact-store endpoint: update
# ---------------------------------------------------------------------------

class TestEndpointUpdate:
    """POST /fact-store with action=update"""

    @pytest.fixture(autouse=True)
    def seed_fact(self, store):
        self.fid = store.add_fact("Original content")

    def test_update_content(self, client):
        """Updating fact content should succeed."""
        response = client.post("/fact-store", json={
            "action": "update",
            "fact_id": self.fid,
            "content": "Updated content",
        })
        assert response.status_code == 200
        assert response.json()["updated"] is True

    def test_update_missing_fact_id(self, client):
        """Missing fact_id should return 400."""
        response = client.post("/fact-store", json={
            "action": "update",
            "content": "nope",
        })
        assert response.status_code == 400

    def test_update_with_trust_delta(self, client):
        """Trust delta should be applied."""
        response = client.post("/fact-store", json={
            "action": "update",
            "fact_id": self.fid,
            "trust_delta": 0.2,
        })
        assert response.status_code == 200

    def test_update_empty_content_returns_400(self, client):
        """Updating a fact with empty content should return HTTP 400."""
        resp = client.post("/fact-store", json={
            "action": "update",
            "fact_id": self.fid,
            "content": "",
        })
        assert resp.status_code == 400
        assert "must not be empty" in resp.json()["detail"]

    def test_update_whitespace_content_returns_400(self, client):
        """Updating a fact with whitespace-only content should return HTTP 400."""
        resp = client.post("/fact-store", json={
            "action": "update",
            "fact_id": self.fid,
            "content": "   ",
        })
        assert resp.status_code == 400

    def test_add_whitespace_content_returns_400(self, client):
        """Adding a fact with whitespace-only content should return HTTP 400."""
        resp = client.post("/fact-store", json={
            "action": "add",
            "content": "   ",
        })
        assert resp.status_code == 400

    def test_update_not_found(self, client):
        """Non-existent fact_id should return updated=False."""
        response = client.post("/fact-store", json={
            "action": "update",
            "fact_id": 9999,
            "content": "nope",
        })
        assert response.status_code == 200
        assert response.json()["updated"] is False


# ---------------------------------------------------------------------------
# Fact-store endpoint: remove
# ---------------------------------------------------------------------------

class TestEndpointRemove:
    """POST /fact-store with action=remove"""

    @pytest.fixture(autouse=True)
    def seed_fact(self, store):
        self.fid = store.add_fact("To be removed")

    def test_remove(self, client):
        """Removing a fact should return removed=True."""
        response = client.post("/fact-store", json={
            "action": "remove",
            "fact_id": self.fid,
        })
        assert response.status_code == 200
        assert response.json()["removed"] is True

    def test_remove_missing_fact_id(self, client):
        """Missing fact_id should return 400."""
        response = client.post("/fact-store", json={
            "action": "remove",
        })
        assert response.status_code == 400

    def test_remove_not_found(self, client):
        """Non-existent fact_id should return removed=False."""
        response = client.post("/fact-store", json={
            "action": "remove",
            "fact_id": 9999,
        })
        assert response.status_code == 200
        assert response.json()["removed"] is False


# ---------------------------------------------------------------------------
# Fact-store endpoint: list
# ---------------------------------------------------------------------------

class TestEndpointList:
    """POST /fact-store with action=list"""

    @pytest.fixture(autouse=True)
    def seed_facts(self, store):
        store.add_fact("Fact A", category="cat1")
        store.add_fact("Fact B", category="cat2")

    def test_list_all(self, client):
        """Listing should return all facts."""
        response = client.post("/fact-store", json={
            "action": "list",
        })
        assert response.status_code == 200
        data = response.json()
        assert data["count"] == 2
        assert len(data["facts"]) == 2

    def test_list_with_category(self, client):
        """Listing with a category filter should work."""
        response = client.post("/fact-store", json={
            "action": "list",
            "category": "cat1",
        })
        assert response.status_code == 200
        assert response.json()["count"] == 1

    def test_list_with_limit(self, client):
        """Listing with a limit should cap results."""
        response = client.post("/fact-store", json={
            "action": "list",
            "limit": 1,
        })
        assert response.status_code == 200
        assert response.json()["count"] == 1


# ---------------------------------------------------------------------------
# Fact-store endpoint: probe, related, reason, contradict
# ---------------------------------------------------------------------------

class TestEndpointRetrievalActions:
    """POST /fact-store with HRR retrieval actions."""

    @pytest.fixture(autouse=True)
    def seed_facts(self, store):
        store.add_fact('"Alice" works on "ProjectX"', category="work")
        store.add_fact('"Alice" likes "Golf"', category="personal")

    def test_probe(self, client):
        """Probe with an entity should return results."""
        response = client.post("/fact-store", json={
            "action": "probe",
            "entity": "Alice",
        })
        assert response.status_code == 200
        data = response.json()
        assert "results" in data
        assert isinstance(data["results"], list)

    def test_probe_missing_entity(self, client):
        """Missing entity should return 400."""
        response = client.post("/fact-store", json={
            "action": "probe",
        })
        assert response.status_code == 400

    def test_related(self, client):
        """Related with an entity should return results."""
        response = client.post("/fact-store", json={
            "action": "related",
            "entity": "Alice",
        })
        assert response.status_code == 200
        assert "results" in response.json()

    def test_related_missing_entity(self, client):
        """Missing entity should return 400."""
        response = client.post("/fact-store", json={
            "action": "related",
        })
        assert response.status_code == 400

    def test_reason(self, client):
        """Reason with entities should return results."""
        response = client.post("/fact-store", json={
            "action": "reason",
            "entities": ["Alice", "ProjectX"],
        })
        assert response.status_code == 200
        assert "results" in response.json()

    def test_reason_missing_entities(self, client):
        """Missing entities should return 400."""
        response = client.post("/fact-store", json={
            "action": "reason",
        })
        assert response.status_code == 400

    def test_contradict(self, client):
        """Contradict should return results."""
        response = client.post("/fact-store", json={
            "action": "contradict",
        })
        assert response.status_code == 200
        assert "results" in response.json()

    def test_contradict_with_category(self, client):
        """Contradict with category filter."""
        response = client.post("/fact-store", json={
            "action": "contradict",
            "category": "work",
        })
        assert response.status_code == 200


# ---------------------------------------------------------------------------
# Fact-store endpoint: unknown action
# ---------------------------------------------------------------------------

class TestEndpointUnknownAction:
    """POST /fact-store with an unknown action."""

    def test_unknown_action(self, client):
        """Unknown action should return 400."""
        response = client.post("/fact-store", json={
            "action": "nonexistent_action",
        })
        assert response.status_code == 400
        assert "unknown" in response.json()["detail"].lower()


# ---------------------------------------------------------------------------
# Fact-feedback endpoint
# ---------------------------------------------------------------------------

class TestFactFeedback:
    """POST /fact-feedback"""

    @pytest.fixture(autouse=True)
    def seed_fact(self, store):
        self.fid = store.add_fact("Feedback test fact")

    def test_helpful(self, client):
        """Helpful feedback should return trust adjustment."""
        response = client.post("/fact-feedback", json={
            "action": "helpful",
            "fact_id": self.fid,
        })
        assert response.status_code == 200
        data = response.json()
        assert data["new_trust"] > data["old_trust"]
        assert data["fact_id"] == self.fid

    def test_unhelpful(self, client):
        """Unhelpful feedback should return trust adjustment."""
        response = client.post("/fact-feedback", json={
            "action": "unhelpful",
            "fact_id": self.fid,
        })
        assert response.status_code == 200
        data = response.json()
        assert data["new_trust"] < data["old_trust"]

    def test_unknown_feedback_action(self, client):
        """Unknown feedback action should return 400."""
        response = client.post("/fact-feedback", json={
            "action": "unknown",
            "fact_id": self.fid,
        })
        assert response.status_code == 400

    def test_feedback_non_existent_fact(self, client):
        """Non-existent fact_id should return 404 (KeyError caught)."""
        response = client.post("/fact-feedback", json={
            "action": "helpful",
            "fact_id": 9999,
        })
        assert response.status_code == 404
        assert response.json()["detail"] == "Fact not found"

    def test_feedback_missing_fact_id(self, client):
        """Missing fact_id should return 422 (pydantic validation)."""
        response = client.post("/fact-feedback", json={
            "action": "helpful",
        })
        assert response.status_code == 422
