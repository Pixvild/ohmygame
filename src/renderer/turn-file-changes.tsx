import { useEffect, useState } from "react";
import type {
  TurnCheckpoint,
  TurnFileChange,
  TurnFileDiff,
} from "../shared/checkpoints.js";
import { ApiError, getTurnChanges, getTurnFileDiff } from "./api.js";
import { FilePenLine, LoaderCircle } from "./icons.js";

export function TurnFileChanges({
  projectId,
  conversationId,
  checkpoint,
  disabled,
  onUndo,
}: {
  projectId: string;
  conversationId: string;
  checkpoint: TurnCheckpoint;
  disabled?: boolean;
  onUndo?: (turnId: string, conflicts?: "keep" | "overwrite") => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [changes, setChanges] = useState<TurnFileChange[]>();
  const [selected, setSelected] = useState<string>();
  const [diff, setDiff] = useState<TurnFileDiff>();
  const [error, setError] = useState<string>();
  const [confirm, setConfirm] = useState(false);
  const [conflicts, setConflicts] = useState<string[]>();
  const [undoing, setUndoing] = useState(false);
  const keptConflicts =
    checkpoint.undone?.conflicts.filter(
      (filePath) => !checkpoint.undone!.changed.includes(filePath),
    ).length ?? 0;
  useEffect(() => {
    if (!open || !checkpoint.after) return;
    let disposed = false;
    setError(undefined);
    void getTurnChanges(projectId, conversationId, checkpoint.id)
      .then((result) => {
        if (!disposed) {
          setChanges(result.changes);
          setSelected(result.changes[0]?.path);
        }
      })
      .catch((cause: unknown) => {
        if (!disposed) setError(message(cause));
      });
    return () => {
      disposed = true;
    };
  }, [open, projectId, conversationId, checkpoint.id, checkpoint.after]);
  useEffect(() => {
    setDiff(undefined);
    if (!open || !selected) return;
    let disposed = false;
    void getTurnFileDiff(projectId, conversationId, checkpoint.id, selected)
      .then((result) => {
        if (!disposed) setDiff(result);
      })
      .catch((cause: unknown) => {
        if (!disposed) setError(message(cause));
      });
    return () => {
      disposed = true;
    };
  }, [open, selected, projectId, conversationId, checkpoint.id]);
  async function undo(policy?: "keep" | "overwrite") {
    if (!onUndo || disabled || undoing) return;
    setUndoing(true);
    setError(undefined);
    try {
      await onUndo(checkpoint.id, policy);
      setConfirm(false);
      setConflicts(undefined);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "checkpoint_conflict")
        setConflicts(cause.conflicts);
      else setError(message(cause));
    } finally {
      setUndoing(false);
    }
  }
  return (
    <section className="turn-file-changes" aria-label="Turn file changes">
      <button
        type="button"
        className="turn-changes-toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <FilePenLine size={13} /> File changes
        {checkpoint.undone ? " · Undone" : ""}
      </button>
      {open ? (
        <div className="turn-changes-panel">
          {checkpoint.error || !checkpoint.after ? (
            <p role="status">
              This turn has no complete file checkpoint. {checkpoint.error}
            </p>
          ) : (
            <>
              {!changes && !error ? (
                <LoaderCircle
                  size={16}
                  className="spin"
                  aria-label="Loading file changes"
                />
              ) : null}
              {changes?.length === 0 ? (
                <p>No file changes in this turn.</p>
              ) : null}
              {changes?.length ? (
                <>
                  <label className="turn-change-select">
                    Changed file
                    <select
                      value={selected ?? ""}
                      onChange={(event) => setSelected(event.target.value)}
                    >
                      {changes.map((change) => (
                        <option key={change.path} value={change.path}>
                          {change.kind} · {change.path}
                        </option>
                      ))}
                    </select>
                  </label>
                  {diff ? (
                    diff.unavailable ? (
                      <p>
                        {diff.unavailable === "binary"
                          ? "Binary file. Text preview is unavailable."
                          : "File exceeds the 256 KiB text preview limit."}{" "}
                        File undo is available.
                      </p>
                    ) : (
                      <div
                        className="turn-diff"
                        aria-label={`File diff for ${diff.path}`}
                      >
                        <div>
                          <h4>Before</h4>
                          <pre className="turn-diff-before">
                            {diff.before ?? "File did not exist"}
                          </pre>
                        </div>
                        <div>
                          <h4>After</h4>
                          <pre className="turn-diff-after">
                            {diff.after ?? "File removed"}
                          </pre>
                        </div>
                      </div>
                    )
                  ) : (
                    <LoaderCircle
                      size={16}
                      className="spin"
                      aria-label="Loading file diff"
                    />
                  )}
                  {checkpoint.undone ? (
                    <p role="status">
                      Undid {checkpoint.undone.changed.length} files.{" "}
                      {keptConflicts
                        ? `Kept ${keptConflicts} conflicting files.`
                        : ""}{" "}
                      Conversation preserved.
                    </p>
                  ) : onUndo ? (
                    <div className="turn-undo-actions">
                      {confirm ? (
                        <>
                          <p>
                            Undo the file changes from this turn? Current editor
                            changes will be saved first. The conversation is
                            preserved and the workspace reloads.
                          </p>
                          {conflicts?.length ? (
                            <>
                              <p role="alert">
                                These files have later changes:
                              </p>
                              <ul>
                                {conflicts.map((filePath) => (
                                  <li key={filePath}>{filePath}</li>
                                ))}
                              </ul>
                              <button
                                type="button"
                                disabled={disabled || undoing}
                                onClick={() => void undo("keep")}
                              >
                                Keep conflicts, undo other files
                              </button>
                              <button
                                type="button"
                                disabled={disabled || undoing}
                                onClick={() => void undo("overwrite")}
                              >
                                Overwrite conflicts
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              disabled={disabled || undoing}
                              onClick={() => void undo()}
                            >
                              Undo files
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={undoing}
                            onClick={() => {
                              setConfirm(false);
                              setConflicts(undefined);
                            }}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          disabled={disabled || undoing}
                          onClick={() => setConfirm(true)}
                        >
                          Undo files…
                        </button>
                      )}
                    </div>
                  ) : null}
                </>
              ) : null}
            </>
          )}
          {error ? <p role="alert">{error}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
const message = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);
