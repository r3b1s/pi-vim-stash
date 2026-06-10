# Known Issues

## Resolved

### 1. `threshold` parameter not exposed in TypeScript tool schema ~~[Resolved]~~
- **Priority:** warning
- **Location:** `src/types.ts`, `src/tools/fact-store.ts`
- **Description:** The Python bridge accepts `threshold` for the `contradict` action, and the spec documents a "Tune contradiction sensitivity" scenario. However, the TypeScript `FactStoreParams` interface and TypeBox schema don't include `threshold`, so LLMs cannot discover or pass this parameter through the tool interface. Default behavior (0.3) works correctly.
- **Fix:** Added `threshold?: number` to `FactStoreParams` and `threshold: Type.Optional(Type.Number())` to the TypeBox schema in `fact-store.ts`.
- **Status:** Resolved — `threshold` is now exposed in the TypeScript types and TypeBox schema.

### 2. Client retries on 4xx responses ~~[Resolved]~~
- **Priority:** nit
- **Location:** `src/client.ts`
- **Description:** `postWithRetry` retries on all non-ok HTTP responses including 4xx (400, 404). These are deterministic client errors that will fail identically on retry, wasting time. Should only retry on network errors and 5xx responses.
- **Fix:** Changed retry logic to only retry on `response.status >= 500` and network errors; 4xx responses propagate immediately.
- **Status:** Resolved — retry logic now excludes 4xx responses.
