## ADDED Requirements

### Requirement: Add facts to the store
The system SHALL accept fact content, optional category, and optional tags, and persist the fact to the SQLite database with a unique fact_id.

#### Scenario: Add a basic fact
- **WHEN** the user calls `fact_store` with `action: "add"` and `content: "User prefers TypeScript over JavaScript"`
- **THEN** the system stores the fact and returns a success response with the assigned `fact_id`

#### Scenario: Add a fact with category and tags
- **WHEN** the user calls `fact_store` with `action: "add"`, `content: "Auth uses JWT tokens"`, `category: "project"`, `tags: "auth,jwt"`
- **THEN** the system stores the fact with the specified category and tags, and returns a success response with the assigned `fact_id`

#### Scenario: Duplicate content returns existing ID (idempotent)
- **WHEN** the user calls `fact_store` with `action: "add"` and content that already exists in the store
- **THEN** the system returns the existing `fact_id` without modifying the row, with the same response shape as a new insert (`{"fact_id": N, "status": "added"}`)

### Requirement: Search facts by keyword
The system SHALL perform FTS5 full-text search across stored facts and return matching results ranked by relevance. An optional `threshold` parameter (float, default `0.0`) controls the minimum relevance score for results.

#### Scenario: Search with a keyword query
- **WHEN** the user calls `fact_store` with `action: "search"` and `query: "auth"`
- **THEN** the system returns facts containing "auth" or related terms, ranked by FTS5 relevance

#### Scenario: Search with category filter
- **WHEN** the user calls `fact_store` with `action: "search"`, `query: "deploy"`, `category: "project"`
- **THEN** the system returns only facts in the "project" category that match "deploy"

#### Scenario: Search with limit
- **WHEN** the user calls `fact_store` with `action: "search"`, `query: "config"`, `limit: 3`
- **THEN** the system returns at most 3 results

#### Scenario: Search with relevance threshold
- **WHEN** the user calls `fact_store` with `action: "search"`, `query: "config"`, `threshold: 0.5`
- **THEN** the system returns only results with a composite relevance score >= 0.5

### Requirement: Update existing facts
The system SHALL allow updating the content, category, tags, or trust score of an existing fact by fact_id.

#### Scenario: Update fact content
- **WHEN** the user calls `fact_store` with `action: "update"`, `fact_id: 5`, `content: "Auth uses OAuth2 tokens"`
- **THEN** the system updates the content of fact 5 and returns a success response

#### Scenario: Adjust trust score
- **WHEN** the user calls `fact_store` with `action: "update"`, `fact_id: 5`, `trust_delta: 0.1`
- **THEN** the system increases the trust score of fact 5 by 0.1 (clamped to 0.0-1.0)

### Requirement: Remove facts
The system SHALL allow deleting a fact by fact_id.

#### Scenario: Remove a fact
- **WHEN** the user calls `fact_store` with `action: "remove"` and `fact_id: 5`
- **THEN** the system deletes fact 5 and its entity associations, and returns a success response

### Requirement: List all facts
The system SHALL return all stored facts, optionally filtered by category, with pagination support.

#### Scenario: List all facts
- **WHEN** the user calls `fact_store` with `action: "list"`
- **THEN** the system returns all facts sorted by trust score descending

#### Scenario: List with category filter
- **WHEN** the user calls `fact_store` with `action: "list"` and `category: "user_pref"`
- **THEN** the system returns only facts in the "user_pref" category

#### Scenario: List with limit
- **WHEN** the user calls `fact_store` with `action: "list"` and `limit: 10`
- **THEN** the system returns at most 10 facts
