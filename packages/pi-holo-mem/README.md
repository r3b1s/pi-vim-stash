# pi-holo-mem

Holographic memory for Pi agents — structured fact storage with compositional reasoning via HRR (Holographic Reduced Representations) algebra.

## Overview

This Pi extension provides two tools for Pi agents:

- **`fact_store`** — 9-action structured fact storage with SQLite + FTS5, entity resolution, category tagging, trust scoring, and compositional queries (probe, related, reason, contradict)
- **`fact_feedback`** — Asymmetric trust scoring (helpful/unhelpful) that shapes retrieval priority

Facts are stored in a global SQLite database at `~/.pi/agent/pi-holo-mem/memory_store.db`.

## Architecture

```
Pi Extension (TypeScript)  →  Python Bridge Server (FastAPI)  →  Upstream Holographic Core
        src/index.ts                python/bridge/server.py          python/upstream/{holographic,store,retrieval}.py
```

The TypeScript extension auto-starts the Python bridge server as a child process on first tool call. The bridge wraps the upstream Holographic core (synced from [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)).

## Setup

```bash
# 1. Install npm dependencies
npm install

# 2. Install Python environment (externalized to ~/.pi/agent/pi-holo-mem/)
./scripts/setup.sh
```

The venv is created at `~/.pi/agent/pi-holo-mem/python/venv/` and the database at `~/.pi/agent/pi-holo-mem/memory_store.db`.

Runtime state (venv, database, PID file, logs) is externalized to `~/.pi/agent/pi-holo-mem/` so the package directory stays clean for version control.

## Usage

Load the extension in Pi:

```bash
pi -e src/index.ts
```

Or install as an npm package:

```bash
pi install npm:./
```

### fact_store actions

| Action     | Description | Required Params |
|------------|-------------|-----------------|
| `add`      | Store a fact | `content` |
| `search`   | Keyword search | `query` |
| `probe`    | All facts about an entity | `entity` |
| `related`  | Structurally adjacent entities | `entity` |
| `reason`   | Compositional multi-entity query | `entities` (array) |
| `contradict` | Find conflicting facts | _(none)_ |
| `update`   | Update a fact | `fact_id` |
| `remove`   | Delete a fact | `fact_id` |
| `list`     | Browse all facts | _(none)_ |

Optional params: `category` (user_pref, project, tool, general), `tags`, `limit`, `min_trust`, `threshold` (float, default 0.0; relevance cutoff for search/contradict)

### fact_feedback actions

| Action      | Description |
|-------------|-------------|
| `helpful`   | Increase trust score (+0.05) |
| `unhelpful` | Decrease trust score (-0.10) |

Both require `fact_id`.

## Upstream Sync

The `python/upstream/` directory contains 3 Python files synced from the Hermes repo:

```bash
./scripts/sync-upstream.sh
```

Review diffs before committing: `git diff python/upstream/`

## Project Structure

```
├── src/                  # TypeScript Pi extension
│   ├── index.ts          # Entry point (lifecycle, tool registration)
│   ├── config.ts         # Path resolution, bridge URL
│   ├── types.ts          # TypeScript interfaces
│   ├── client.ts         # HTTP client for bridge
│   └── tools/            # Tool definitions
│       ├── fact-store.ts
│       └── fact-feedback.ts
├── python/               # Python bridge and Holographic core
│   ├── bridge/           # FastAPI bridge server
│   │   └── server.py     # HTTP API
│   ├── upstream/         # Synced from Hermes (do not edit)
│   │   ├── holographic.py
│   │   ├── store.py
│   │   └── retrieval.py
│   ├── tests/            # Python tests
│   └── requirements.txt  # Python dependencies
├── scripts/
│   ├── setup.sh          # Environment provisioning (externalized venv)
│   └── sync-upstream.sh  # Upstream file sync
├── test/                 # TypeScript tests
├── types/                # TypeScript type stubs
└── openspec/             # OpenSpec specifications
```

## License

MIT
