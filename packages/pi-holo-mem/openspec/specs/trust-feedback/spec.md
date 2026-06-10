## ADDED Requirements

### Requirement: Rate facts as helpful
The system SHALL increase a fact's trust score when rated as helpful, with asymmetric weighting.

#### Scenario: Rate a fact as helpful
- **WHEN** the user calls `fact_feedback` with `action: "helpful"` and `fact_id: 5`
- **THEN** the system increases fact 5's trust score by 0.05 (clamped to 1.0 maximum) and increments its helpful_count

### Requirement: Rate facts as unhelpful
The system SHALL decrease a fact's trust score when rated as unhelpful, with a larger penalty than the helpful reward.

#### Scenario: Rate a fact as unhelpful
- **WHEN** the user calls `fact_feedback` with `action: "unhelpful"` and `fact_id: 5`
- **THEN** the system decreases fact 5's trust score by 0.10 (clamped to 0.0 minimum)

### Requirement: Trust score influences retrieval ranking
The system SHALL incorporate trust scores into the retrieval scoring pipeline, so higher-trust facts surface higher in search results.

#### Scenario: High-trust fact ranks above low-trust
- **WHEN** two facts match a search query with similar relevance scores
- **THEN** the fact with the higher trust score appears first in the results

#### Scenario: Trust decay over time (optional)
- **WHEN** temporal decay is enabled and a fact has not been retrieved or rated recently
- **THEN** its effective retrieval score is reduced by a time-decay function (half-life configurable, default: disabled)
