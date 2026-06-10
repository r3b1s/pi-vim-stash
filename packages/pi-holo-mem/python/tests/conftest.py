"""pytest configuration for bridge tests.

Adds upstream/ and bridge/ directories to sys.path so tests can import
modules directly without triggering the root-level __init__.py
(which depends on Hermes-internal modules not available in tests).
"""

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent.parent

# Add python/bridge/ first so hermes_state stub is found (startup uses WAL fallback)
sys.path.insert(0, str(PROJECT_ROOT / "python" / "bridge"))
# Add python/upstream/ so store, retrieval, holographic modules are found
sys.path.insert(0, str(PROJECT_ROOT / "python" / "upstream"))
# Add project root so imports that use absolute paths resolve correctly
sys.path.insert(0, str(PROJECT_ROOT))
