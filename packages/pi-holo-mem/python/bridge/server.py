"""FastAPI bridge server for pi-holo-mem.

Wraps upstream Python memory store code and exposes it via HTTP endpoints.
"""

import logging
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

# Add python/ to sys.path so upstream packages can be found
sys.path.insert(0, str(Path(__file__).parent.parent))

# Add bridge directory to sys.path so hermes_state can be imported
sys.path.insert(0, str(Path(__file__).parent))

from upstream.store import MemoryStore
from upstream.retrieval import FactRetriever

# Configure logging
log_level = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(level=log_level, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

# Global instances
store: Optional[MemoryStore] = None
retriever: Optional[FactRetriever] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize MemoryStore and FactRetriever on startup, close on shutdown."""
    global store, retriever

    ms = None
    try:
        db_path = os.getenv(
            "PIHOLOMEM_DB_PATH",
            str(Path.home() / ".pi" / "agent" / "pi-holo-mem" / "memory_store.db")
        )
        logger.info(f"Initializing MemoryStore with db_path: {db_path}")
        ms = MemoryStore(db_path=db_path)
        retriever = FactRetriever(ms)
        store = ms
        logger.info("MemoryStore and FactRetriever initialized successfully")
    except Exception as e:
        logger.error(f"Failed to initialize MemoryStore: {e}")
        if ms is not None:
            ms.close()
        store = None
        retriever = None

    yield

    if store:
        store.close()


app = FastAPI(title="Pi Holographic Memory Bridge", lifespan=lifespan)


class FactStoreRequest(BaseModel):
    """Request body for /fact-store endpoint."""
    action: str = Field(..., description="Action to perform: add, search, probe, related, reason, contradict, update, remove, list")
    
    # For add action
    content: Optional[str] = None
    category: Optional[str] = None
    tags: Optional[str] = ""
    
    # For search/probe/related actions
    query: Optional[str] = None
    entity: Optional[str] = None
    
    # For reason action
    entities: Optional[list[str]] = None
    
    # For search/list actions
    min_trust: Optional[float] = 0.3
    limit: Optional[int] = 10
    
    # For update action
    fact_id: Optional[int] = None
    trust_delta: Optional[float] = None
    
    # For contradict action
    threshold: Optional[float] = 0.3


class FactFeedbackRequest(BaseModel):
    """Request body for /fact-feedback endpoint."""
    action: str = Field(..., description="Feedback action: helpful or unhelpful")
    fact_id: int = Field(..., description="ID of the fact to provide feedback on")


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {
        "status": "ok",
        "ready": store is not None and retriever is not None
    }


@app.post("/fact-store")
async def fact_store(request: FactStoreRequest):
    """Main fact store endpoint - dispatches to appropriate action."""
    if store is None or retriever is None:
        raise HTTPException(status_code=500, detail="MemoryStore not initialized")
    
    try:
        action = request.action
        
        if action == "add":
            if not request.content:
                raise HTTPException(status_code=400, detail="content is required for add action")
            fact_id = store.add_fact(
                content=request.content,
                category=request.category or "general",
                tags=request.tags or ""
            )
            return {"fact_id": fact_id, "status": "added"}
        
        elif action == "search":
            if not request.query:
                raise HTTPException(status_code=400, detail="query is required for search action")
            results = retriever.search(
                query=request.query,
                category=request.category,
                min_trust=request.min_trust if request.min_trust is not None else 0.3,
                limit=request.limit if request.limit is not None else 10
            )
            return {"results": results, "count": len(results)}
        
        elif action == "probe":
            if not request.entity:
                raise HTTPException(status_code=400, detail="entity is required for probe action")
            results = retriever.probe(
                entity=request.entity,
                category=request.category,
                limit=request.limit if request.limit is not None else 10
            )
            return {"results": results, "count": len(results)}
        
        elif action == "related":
            if not request.entity:
                raise HTTPException(status_code=400, detail="entity is required for related action")
            results = retriever.related(
                entity=request.entity,
                category=request.category,
                limit=request.limit if request.limit is not None else 10
            )
            return {"results": results, "count": len(results)}
        
        elif action == "reason":
            if not request.entities:
                raise HTTPException(status_code=400, detail="entities is required for reason action")
            results = retriever.reason(
                entities=request.entities,
                category=request.category,
                limit=request.limit if request.limit is not None else 10
            )
            return {"results": results, "count": len(results)}
        
        elif action == "contradict":
            results = retriever.contradict(
                category=request.category,
                threshold=request.threshold if request.threshold is not None else 0.3,
                limit=request.limit if request.limit is not None else 10
            )
            return {"results": results, "count": len(results)}
        
        elif action == "update":
            if request.fact_id is None:
                raise HTTPException(status_code=400, detail="fact_id is required for update action")
            updated = store.update_fact(
                fact_id=request.fact_id,
                content=request.content,
                trust_delta=request.trust_delta,
                tags=request.tags,
                category=request.category
            )
            return {"updated": updated}
        
        elif action == "remove":
            if request.fact_id is None:
                raise HTTPException(status_code=400, detail="fact_id is required for remove action")
            removed = store.remove_fact(request.fact_id)
            return {"removed": removed}
        
        elif action == "list":
            facts = store.list_facts(
                category=request.category,
                min_trust=request.min_trust if request.min_trust is not None else 0.0,
                limit=request.limit if request.limit is not None else 50
            )
            return {"facts": facts, "count": len(facts)}
        
        else:
            raise HTTPException(status_code=400, detail=f"Unknown action: {action}")
    
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error in fact_store endpoint: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@app.post("/fact-feedback")
async def fact_feedback(request: FactFeedbackRequest):
    """Feedback endpoint for recording helpful/unhelpful feedback."""
    if store is None:
        raise HTTPException(status_code=500, detail="MemoryStore not initialized")
    
    try:
        action = request.action
        
        if action == "helpful":
            result = store.record_feedback(request.fact_id, helpful=True)
            return result
        elif action == "unhelpful":
            result = store.record_feedback(request.fact_id, helpful=False)
            return result
        else:
            raise HTTPException(status_code=400, detail=f"Unknown feedback action: {action}")
    
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except KeyError as e:
        logger.error(f"Fact not found: {e}")
        raise HTTPException(status_code=404, detail="Fact not found")
    except Exception as e:
        logger.error(f"Error in fact_feedback endpoint: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


if __name__ == "__main__":
    import uvicorn
    
    port = int(os.getenv("PIHOLOMEM_BRIDGE_PORT", "18731"))
    uvicorn.run(app, host="127.0.0.1", port=port)
