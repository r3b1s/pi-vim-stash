/**
 * HTTP client for bridge server communication.
 */

import { BRIDGE_URL } from "./config.ts";
import type { FactFeedbackParams, FactStoreParams } from "./types.ts";

export class BridgeClient {
  private baseUrl: string;
  private maxRetries: number = 3;

  constructor(baseUrl: string = BRIDGE_URL) {
    this.baseUrl = baseUrl;
  }

  /**
   * Check bridge health.
   */
  async health(): Promise<{ status: string; ready: boolean }> {
    const response = await fetch(`${this.baseUrl}/health`);
    if (!response.ok) {
      throw new Error(`Health check failed: ${response.status}`);
    }
    return response.json() as Promise<{ status: string; ready: boolean }>;
  }

  /**
   * Call fact-store endpoint.
   */
  async factStore(params: FactStoreParams): Promise<any> {
    return this.postWithRetry("/fact-store", params);
  }

  /**
   * Call fact-feedback endpoint.
   */
  async factFeedback(params: FactFeedbackParams): Promise<any> {
    return this.postWithRetry("/fact-feedback", params);
  }

  /**
   * POST with retry and exponential backoff.
   */
  private async postWithRetry(path: string, body: any): Promise<any> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const response = await fetch(`${this.baseUrl}${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const errorText = await response.text();
          const error: Error & { status?: number } = new Error(
            `HTTP ${response.status}: ${errorText}`,
          );
          error.status = response.status;
          throw error;
        }

        return response.json();
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        // Don't retry on 4xx client errors — only retry on 5xx or network errors
        const status = (lastError as Error & { status?: number }).status;
        if (status && status < 500) {
          throw lastError;
        }

        // If this is not the last attempt, wait before retry
        if (attempt < this.maxRetries - 1) {
          const delay = 2 ** attempt * 1000; // 1s, 2s, 4s
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw new Error(
      `Request failed after ${this.maxRetries} attempts: ${lastError?.message}`,
    );
  }
}
