/**
 * Build a text-only tool result payload.
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
