import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { TurnCheckpoint } from "../shared/checkpoints.js";

export const TURN_CHECKPOINT_ENTRY = "ohmygame-turn-checkpoint";
export interface TurnCheckpointHooks {
  /** Awaited before the next consumed user message replaces the live turn. */
  end(): Promise<void>;
  /** Awaited after user message_start and before any model/tool execution. */
  begin(): Promise<void>;
}

export function sessionCheckpoints(
  entries: readonly SessionEntry[],
): Map<string, TurnCheckpoint> {
  const checkpoints = new Map<string, TurnCheckpoint>();
  const byId = new Map<string, TurnCheckpoint>();
  let pending: TurnCheckpoint | undefined;
  for (const entry of entries) {
    if (entry.type === "custom" && entry.customType === TURN_CHECKPOINT_ENTRY) {
      const data = entry.data as
        (Partial<TurnCheckpoint> & { version?: number }) | undefined;
      if (
        data?.version !== 1 ||
        typeof data.id !== "string" ||
        !/^[a-f0-9]{40}$/.test(data.before ?? "")
      )
        continue;
      const existing = byId.get(data.id);
      const checkpoint = existing ?? { id: data.id, before: data.before! };
      if (typeof data.after === "string" && /^[a-f0-9]{40}$/.test(data.after))
        checkpoint.after = data.after;
      if (typeof data.error === "string") checkpoint.error = data.error;
      if (
        data.undone &&
        typeof data.undone.previous === "string" &&
        Array.isArray(data.undone.changed) &&
        Array.isArray(data.undone.conflicts)
      )
        checkpoint.undone = data.undone;
      byId.set(data.id, checkpoint);
      checkpoints.set(data.id, checkpoint);
      if (!existing) pending = checkpoint;
    } else if (entry.type === "message" && entry.message.role === "user") {
      if (pending) checkpoints.set(entry.id, pending);
      pending = undefined;
    }
  }
  return checkpoints;
}
