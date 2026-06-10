#!/usr/bin/env bash
# Sync upstream Holographic core files from NousResearch/hermes-agent.
# Downloads 3 Python files into upstream/ directory.
# Review diffs before committing.

set -euo pipefail

REPO="NousResearch/hermes-agent"
BRANCH="main"
BASE_URL="https://raw.githubusercontent.com/${REPO}/${BRANCH}"

# Paths relative to the Hermes repo root
FILES=(
  "plugins/hermes_memory_store/holographic.py"
  "plugins/hermes_memory_store/store.py"
  "plugins/hermes_memory_store/retrieval.py"
)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
UPSTREAM_DIR="${PROJECT_DIR}/python/upstream"

echo "Syncing upstream files from ${REPO}@${BRANCH}..."

for filepath in "${FILES[@]}"; do
  filename="$(basename "$filepath")"
  url="${BASE_URL}/${filepath}"
  dest="${UPSTREAM_DIR}/${filename}"

  echo "  Downloading ${filename}..."
  if curl -sfL "$url" -o "$dest"; then
    echo "    ✓ ${filename}"
  else
    echo "    ✗ Failed to download ${filename} from ${url}"
    exit 1
  fi
done

echo ""
echo "Sync complete. Review changes with:"
echo "  cd ${PROJECT_DIR} && git diff python/upstream/"
