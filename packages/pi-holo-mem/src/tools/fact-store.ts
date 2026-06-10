/**
 * fact_store tool definition.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { BridgeClient } from "../client.ts";
import type { FactStoreParams } from "../types.ts";

export function registerFactStoreTool(
  pi: ExtensionAPI,
  client: BridgeClient,
  registerFn?: (tool: any) => void,
): void {
  const register = registerFn || pi.registerTool.bind(pi);
  register({
    name: "fact_store",
    label: "Fact Store",
    description:
      "Deep structured memory with algebraic reasoning. ACTIONS: add, search, probe, related, reason, contradict, update, remove, list",
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("add"),
        Type.Literal("search"),
        Type.Literal("probe"),
        Type.Literal("related"),
        Type.Literal("reason"),
        Type.Literal("contradict"),
        Type.Literal("update"),
        Type.Literal("remove"),
        Type.Literal("list"),
      ]),
      content: Type.Optional(Type.String()),
      query: Type.Optional(Type.String()),
      entity: Type.Optional(Type.String()),
      entities: Type.Optional(Type.Array(Type.String())),
      fact_id: Type.Optional(Type.Integer()),
      category: Type.Optional(Type.String()),
      tags: Type.Optional(Type.String()),
      trust_delta: Type.Optional(Type.Number()),
      min_trust: Type.Optional(Type.Number()),
      limit: Type.Optional(Type.Integer()),
      threshold: Type.Optional(Type.Number()),
    }),
    execute: async (
      _toolCallId: string,
      params: FactStoreParams,
      _signal: AbortSignal,
      _onUpdate: any,
      _ctx: any,
    ) => {
      const result = await client.factStore(params);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        details: {},
      };
    },
  });
}
