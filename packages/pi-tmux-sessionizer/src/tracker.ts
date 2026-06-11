import type { SubagentRecord, SubagentStatus } from "#src/types";

/**
 * In-memory tracker for spawned subagents.
 *
 * Thread-safe for single-process usage (pi extensions run in the same
 * Node.js event loop). Provides CRUD operations and status transitions.
 */
export class SubagentTracker {
  private readonly agents = new Map<string, SubagentRecord>();

  /** Add a new subagent record. */
  add(record: SubagentRecord): void {
    this.agents.set(record.id, record);
  }

  /** Get a subagent record by ID. */
  get(id: string): SubagentRecord | undefined {
    return this.agents.get(id);
  }

  /** Update the status of a subagent. */
  updateStatus(id: string, status: SubagentStatus): boolean {
    const record = this.agents.get(id);
    if (!record) return false;
    record.status = status;
    if (status === "completed" || status === "stopped" || status === "error") {
      record.completedAt = Date.now();
    }
    return true;
  }

  /** Set the result text for a subagent. */
  setResult(id: string, result: string): boolean {
    const record = this.agents.get(id);
    if (!record) return false;
    record.result = result;
    return true;
  }

  /** Set the error message for a subagent. */
  setError(id: string, error: string): boolean {
    const record = this.agents.get(id);
    if (!record) return false;
    record.error = error;
    return true;
  }

  /** Set the session file path for a subagent. */
  setSessionFilePath(id: string, filePath: string): boolean {
    const record = this.agents.get(id);
    if (!record) return false;
    record.sessionFilePath = filePath;
    return true;
  }

  /** Remove a subagent record. */
  remove(id: string): boolean {
    return this.agents.delete(id);
  }

  /** Get all tracked agent IDs. */
  getAllIds(): string[] {
    return Array.from(this.agents.keys());
  }

  /** Get all records. */
  getAll(): SubagentRecord[] {
    return Array.from(this.agents.values());
  }

  /** Count tracked agents. */
  get size(): number {
    return this.agents.size;
  }

  /** Clear all records. */
  clear(): void {
    this.agents.clear();
  }
}
