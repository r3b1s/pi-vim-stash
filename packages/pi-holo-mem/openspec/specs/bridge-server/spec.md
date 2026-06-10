## ADDED Requirements

### Requirement: Bridge server exposes HTTP API for fact operations
The bridge server SHALL expose REST endpoints that mirror the fact_store and fact_feedback tool actions, proxying to the upstream Holographic store.

#### Scenario: Fact store endpoint
- **WHEN** the bridge receives `POST /fact-store` with a JSON body containing `action` and parameters
- **THEN** the bridge dispatches to the upstream MemoryStore/FactRetriever and returns the result as JSON

#### Scenario: Fact feedback endpoint
- **WHEN** the bridge receives `POST /fact-feedback` with a JSON body containing `action` and `fact_id`
- **THEN** the bridge adjusts the trust score and returns the result as JSON

#### Scenario: Health check endpoint
- **WHEN** the bridge receives `GET /health`
- **THEN** the bridge returns HTTP 200 with a JSON body indicating readiness (database loaded, store initialized)

### Requirement: Bridge auto-starts from the Pi extension
The Pi extension SHALL spawn the bridge server as a child process on first tool call if it is not already running.

#### Scenario: Bridge not running
- **WHEN** the extension loads and a tool calls the bridge, and `GET /health` fails
- **THEN** the extension spawns the bridge as a child process using the Python interpreter at `~/.pi/agent/pi-holo-mem/python/venv/bin/python`, waits for `/health` to return 200 (with timeout), then proceeds

#### Scenario: Bridge already running
- **WHEN** the extension loads and a tool calls the bridge, and `GET /health` returns 200
- **THEN** the extension connects to the existing bridge without spawning a new one

#### Scenario: Port conflict on concurrent session
- **WHEN** two Pi sessions start simultaneously and both attempt to spawn the bridge on the same port
- **THEN** the second spawn fails on port bind; the extension re-checks `/health` against the existing bridge (after confirming PID file) and connects instead of crashing. PID file with retry loop (max 3 attempts) handles the race without locking.

### Requirement: Bridge auto-restarts on crash
The extension SHALL detect bridge crashes and auto-restart with exponential backoff and a maximum retry limit.

#### Scenario: Bridge crashes mid-session
- **WHEN** the bridge process exits unexpectedly and a tool call fails
- **THEN** the extension restarts the bridge with exponential backoff (1s, 2s, 4s, ...) up to a maximum of 5 retries

#### Scenario: Maximum retries exceeded
- **WHEN** the bridge has crashed and restarted 5 times in succession
- **THEN** the extension stops retrying and surfaces an error to the user indicating the bridge is unavailable

### Requirement: Bridge shuts down cleanly on session end
The extension SHALL terminate the bridge process when the Pi session ends.

#### Scenario: Session shutdown
- **WHEN** the Pi session emits a `session_shutdown` event
- **THEN** the extension sends SIGTERM to the bridge process, waits up to 5 seconds, then sends SIGKILL if still running

### Requirement: Bridge manages SQLite connection lifecycle
The bridge SHALL open the SQLite database on startup and close it on shutdown, with WAL mode for concurrent safety.

#### Scenario: Bridge starts with existing database
- **WHEN** the bridge starts and `memory_store.db` already exists at `~/.pi/agent/pi-holo-mem/memory_store.db`
- **THEN** the bridge opens the existing database and enables WAL mode

#### Scenario: Bridge starts without existing database
- **WHEN** the bridge starts and `memory_store.db` does not exist
- **THEN** the bridge creates a new database with the Holographic schema (facts, entities, fact_entities, memory_banks, facts_fts)

### Requirement: Setup script provisions Python environment in user data directory
The setup script SHALL use mise to pin the Python version, create a venv in the externalized user data directory, and install bridge dependencies.

#### Scenario: Run setup.sh
- **WHEN** the user runs `scripts/setup.sh`
- **THEN** the script installs the pinned Python version via mise, creates a venv at `~/.pi/agent/pi-holo-mem/python/venv/`, and installs requirements from `python/requirements.txt`

#### Scenario: Extension detects missing venv
- **WHEN** the extension tries to start the bridge and the venv at `~/.pi/agent/pi-holo-mem/python/venv/` does not exist
- **THEN** the extension runs `scripts/setup.sh` automatically, then retries bridge startup

### Requirement: Runtime state fully externalized from package directory
All runtime artifacts (venv, database, PID file, log file) SHALL reside under `~/.pi/agent/pi-holo-mem/`. The package directory SHALL contain only source code and configuration.

#### Scenario: No runtime artifacts in package directory
- **WHEN** the extension has been used (bridge started, facts stored, sessions completed)
- **THEN** no `.db`, `.pid`, `.log`, or `venv/` files exist in the package directory — all reside under `~/.pi/agent/pi-holo-mem/`

#### Scenario: PID file location
- **WHEN** the bridge starts and writes its PID file
- **THEN** the PID file is written to `~/.pi/agent/pi-holo-mem/bridge.pid`

#### Scenario: Log file location
- **WHEN** the bridge writes stdout/stderr logs
- **THEN** logs are written to `~/.pi/agent/pi-holo-mem/bridge.log` (fallback) or `~/.pi/agent/pi-holo-mem/bridge.{PID}.log` (per-session)

### Requirement: Environment variable configuration
Both TypeScript and Python sides SHALL use a unified `PIHOLOMEM_*` prefix for configuration.

#### Scenario: Bridge reads configuration from env
- **WHEN** the bridge starts
- **THEN** it reads `PIHOLOMEM_BRIDGE_PORT` (port to listen on) and `PIHOLOMEM_DB_PATH` (fallback database path) from the environment

#### Scenario: Extension passes env vars to bridge
- **WHEN** the extension spawns the bridge
- **THEN** it sets `PIHOLOMEM_BRIDGE_PORT` and `PIHOLOMEM_DB_PATH` in the child process environment
