// ──────────────────────────────────────────────
// ResultProvider injection API
// ──────────────────────────────────────────────

/**
 * ResultProvider allows extensions (e.g. pi-tmux-sessionizer) to inject a
 * custom result lookup for get_subagent_result.
 *
 * The provider is called first by GetSubagentResultTool.execute(). If it
 * returns non-null, that result is used directly. If it returns null, PSD
 * falls back to its default SubagentsService-based behavior.
 *
 * This enables composition: PTS registers a provider wrapping its tracker,
 * so PSD's get_subagent_result returns PTS tracker results even when PSD
 * registered the tool first (first-writer-wins registry).
 *
 * Note: PSD no longer registers a get_subagent_result tool. This API is
 * preserved for downstream consumers (notably pi-tmux-sessionizer) that
 * import setResultProvider / getResultProvider / resetResultProvider and
 * the ResultProvider interface. The functions continue to accept calls
 * without error but have no consumer inside PSD.
 */
export interface ResultProvider {
  getResult(agentId: string): Promise<{
    content: { type: "text"; text: string }[];
    details: unknown;
  } | null>;
}

let _customResultProvider: ResultProvider | undefined;

/**
 * Inject a custom result provider for get_subagent_result.
 *
 * Call this during extension initialization to override how subagent
 * results are retrieved (e.g. pi-tmux-sessionizer's tracker-based lookup).
 * PSD's GetSubagentResultTool delegates to this provider first, falling
 * back to its SubagentsService-based behavior when the provider returns null.
 *
 * May be called multiple times — the most recent provider wins.
 */
export function setResultProvider(provider: ResultProvider): void {
  _customResultProvider = provider;
}

/**
 * Return the injected result provider, or undefined if none is set.
 */
export function getResultProvider(): ResultProvider | undefined {
  return _customResultProvider;
}

/**
 * Reset the custom result provider to unset state.
 *
 * Used by tests to isolate cases; not part of the public extension API.
 * External extensions should never call this mid-session.
 */
export function resetResultProvider(): void {
  _customResultProvider = undefined;
}
