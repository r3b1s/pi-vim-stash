#!/usr/bin/env bash
# Setup script for pi-holo-mem.
# Provisions Python environment via mise and installs bridge dependencies.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
VENV_DIR="${HOME}/.pi/agent/pi-holo-mem/python/venv"

echo "=== pi-holo-mem setup ==="
echo ""

# Step 1: Install Python via mise
echo "Step 1: Ensuring Python version via mise..."
if command -v mise &>/dev/null; then
  mise install -y 2>/dev/null || echo "  (mise install skipped — version may already be active)"
  echo "  ✓ Python $(python3 --version 2>&1)"
else
  echo "  ⚠ mise not found. Using system Python."
  echo "  Python $(python3 --version 2>&1)"
fi

# Step 2: Create virtual environment
echo ""
echo "Step 2: Creating virtual environment..."
mkdir -p "$(dirname "$VENV_DIR")"
if [ -d "$VENV_DIR" ]; then
  echo "  ✓ venv already exists at ${VENV_DIR}"
else
  python3 -m venv "$VENV_DIR"
  echo "  ✓ Created venv at ${VENV_DIR}"
fi

# Step 3: Install dependencies
echo ""
echo "Step 3: Installing bridge dependencies..."
"${VENV_DIR}/bin/pip" install --quiet --upgrade pip
"${VENV_DIR}/bin/pip" install --quiet -r "${PROJECT_DIR}/python/requirements.txt"
echo "  ✓ Dependencies installed"

echo ""
echo "=== Setup complete ==="
echo ""
echo "To start the bridge manually:"
echo "  ${VENV_DIR}/bin/python ${PROJECT_DIR}/python/bridge/server.py"
echo ""
echo "Or just use the Pi extension — it auto-starts the bridge."
