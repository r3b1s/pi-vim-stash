/**
 * Shared helpers for subagent tool implementations.
 */

/**
 * Build a text-only result payload for tool execute() return.
 * Both deterministic and manual tools use the same format.
 */
export function textResult(
  msg: string,
  details: unknown = {},
): {
  content: { type: "text"; text: string }[];
  details: unknown;
} {
  return { content: [{ type: "text" as const, text: msg }], details };
}
