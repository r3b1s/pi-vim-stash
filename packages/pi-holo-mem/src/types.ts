/**
 * TypeScript interfaces for pi-holo-mem extension.
 */

/**
 * Parameters for fact_store tool.
 */
export interface FactStoreParams {
  action:
    | "add"
    | "search"
    | "probe"
    | "related"
    | "reason"
    | "contradict"
    | "update"
    | "remove"
    | "list";
  content?: string;
  query?: string;
  entity?: string;
  entities?: string[];
  fact_id?: number;
  category?: string;
  tags?: string;
  trust_delta?: number;
  min_trust?: number;
  limit?: number;
  threshold?: number;
}

/**
 * Parameters for fact_feedback tool.
 */
export interface FactFeedbackParams {
  action: "helpful" | "unhelpful";
  fact_id: number;
}

/**
 * Generic bridge response shape.
 */
export interface BridgeResponse {
  status: string;
  data?: any;
  error?: string;
}

/**
 * Fact record from the database.
 */
export interface Fact {
  fact_id: number;
  content: string;
  category: string | null;
  tags: string | null;
  trust_score: number;
  retrieval_count: number;
  helpful_count: number;
  created_at: string;
  updated_at: string;
}
