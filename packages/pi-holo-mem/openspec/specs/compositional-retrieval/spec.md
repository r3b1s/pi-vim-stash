## ADDED Requirements

### Requirement: Probe entity for all associated facts
The system SHALL return all facts linked to a specific entity, providing entity-specific recall without keyword noise.

#### Scenario: Probe a known entity
- **WHEN** the user calls `fact_store` with `action: "probe"` and `entity: "authentication"`
- **THEN** the system returns all facts where "authentication" is a linked entity, regardless of keyword match

#### Scenario: Probe an unknown entity
- **WHEN** the user calls `fact_store` with `action: "probe"` and `entity: "nonexistent"`
- **THEN** the system returns an empty result set with no error

### Requirement: Find related facts via structural adjacency
The system SHALL return facts that share structural connections with the queried entity, using HRR algebra to detect any structural role the entity plays in each fact. Results are scored fact dicts (same shape as `probe` and `search`), ranked by structural similarity weighted by trust score.

#### Scenario: Find related facts
- **WHEN** the user calls `fact_store` with `action: "related"` and `entity: "authentication"`
- **THEN** the system returns fact dicts where "authentication" plays a structural role (entity or content), ranked by HRR similarity × trust score

#### Scenario: Related without numpy
- **WHEN** numpy is not installed and the user calls `action: "related"`
- **THEN** the system falls back to FTS5 keyword search on the entity name

### Requirement: Compositional reasoning across entities
The system SHALL support querying for facts linked to multiple entities simultaneously, using HRR algebra (bind/unbind/bundle) when numpy is available, falling back to intersection-based retrieval when it is not.

#### Scenario: Reason across two entities with HRR
- **WHEN** the user calls `fact_store` with `action: "reason"` and `entities: ["authentication", "rate-limiting"]` AND numpy is available
- **THEN** the system uses HRR bind to compose the entity vectors and returns facts similar to the composition

#### Scenario: Reason across two entities without HRR
- **WHEN** the user calls `fact_store` with `action: "reason"` and `entities: ["authentication", "rate-limiting"]` AND numpy is NOT available
- **THEN** the system falls back to intersection-based retrieval (facts linked to both entities) and returns results

#### Scenario: Reason across three or more entities
- **WHEN** the user calls `fact_store` with `action: "reason"` and `entities: ["auth", "jwt", "middleware"]`
- **THEN** the system composes all entity vectors and returns facts similar to the composition

### Requirement: Detect contradictions in stored facts
The system SHALL identify facts that make conflicting claims about the same topic. An optional `threshold` parameter controls sensitivity (default: 0.3, range: 0.0-1.0). Lower values return more potential contradictions; higher values are more selective.

#### Scenario: Find contradictions
- **WHEN** the user calls `fact_store` with `action: "contradict"`
- **THEN** the system scans stored facts and returns pairs of facts with conflicting content, if any exist

#### Scenario: Tune contradiction sensitivity
- **WHEN** the user calls `fact_store` with `action: "contradict"` and `threshold: 0.5`
- **THEN** the system uses the specified threshold to filter contradiction pairs (higher = stricter)

#### Scenario: No contradictions
- **WHEN** the user calls `fact_store` with `action: "contradict"` and no conflicting facts exist
- **THEN** the system returns an empty result set indicating no contradictions found

### Requirement: Hybrid retrieval pipeline
The system SHALL combine FTS5 full-text search, Jaccard token overlap, and HRR vector similarity (when available) into a single retrieval pipeline with configurable weights.

#### Scenario: Search uses hybrid pipeline
- **WHEN** the user calls `fact_store` with `action: "search"` and `query: "database migration"`
- **THEN** the system retrieves candidates via FTS5, reranks with Jaccard similarity and trust scores, and returns results sorted by composite score

#### Scenario: HRR unavailable gracefully degrades
- **WHEN** numpy is not installed and the user calls a search or reason action
- **THEN** the system redistributes HRR weight to FTS5 and Jaccard (0.6/0.4 split) and returns results without HRR scoring
