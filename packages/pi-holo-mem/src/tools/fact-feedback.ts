/**
 * fact_feedback tool definition.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { BridgeClient } from "../client.ts";
import type { FactFeedbackParams } from "../types.ts";

export function registerFactFeedbackTool(
  pi: ExtensionAPI,
  client: BridgeClient,
  registerFn?: (tool: any) => void,
): void {
  const register = registerFn || pi.registerTool.bind(pi);
  register({
    name: "fact_feedback",
    label: "Fact Feedback",
    description: "Rate a fact as helpful or unhelpful to train trust scores",
    parameters: Type.Object({
      action: Type.Union([Type.Literal("helpful"), Type.Literal("unhelpful")]),
      fact_id: Type.Integer(),
    }),
    execute: async (
      _toolCallId: string,
      params: FactFeedbackParams,
      _signal: AbortSignal,
      _onUpdate: any,
      _ctx: any,
    ) => {
      const result = await client.factFeedback(params);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        details: {},
      };
    },
  });
}
