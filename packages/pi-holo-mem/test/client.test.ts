import { beforeEach, describe, expect, it, vi } from "vitest";
import { BridgeClient } from "#src/client.ts";

// Mock config
vi.mock("#src/config.ts", () => ({
  BRIDGE_URL: "http://localhost:18731",
}));

describe("BridgeClient", () => {
  let client: BridgeClient;

  beforeEach(() => {
    client = new BridgeClient("http://localhost:18731");
  });

  describe("health", () => {
    it("returns health status when bridge is ready", async () => {
      const mockResponse = { status: "ok", ready: true };
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await client.health();
      expect(result).toEqual(mockResponse);
      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:18731/health",
      );
    });

    it("throws on non-ok response", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
      });

      await expect(client.health()).rejects.toThrow("Health check failed: 503");
    });
  });

  describe("factStore", () => {
    it("sends POST request to /fact-store", async () => {
      const params = { action: "list" as const };
      const mockResult = { status: "ok", data: [] };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResult),
      });

      const result = await client.factStore(params);
      expect(result).toEqual(mockResult);
      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:18731/fact-store",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params),
        },
      );
    });
  });

  describe("factFeedback", () => {
    it("sends POST request to /fact-feedback", async () => {
      const params = { action: "helpful" as const, fact_id: 1 };
      const mockResult = { status: "ok" };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResult),
      });

      const result = await client.factFeedback(params);
      expect(result).toEqual(mockResult);
      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:18731/fact-feedback",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params),
        },
      );
    });
  });

  describe("retry logic", () => {
    it("retries on failure with exponential backoff", async () => {
      global.fetch = vi
        .fn()
        .mockRejectedValueOnce(new Error("Network error"))
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ status: "ok" }),
        });

      const result = await client.factStore({ action: "list" });
      expect(result).toEqual({ status: "ok" });
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });

    it("throws after exhausting retries", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

      await expect(client.factStore({ action: "list" })).rejects.toThrow(
        "Request failed after 3 attempts: Network error",
      );
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });
  });
});
