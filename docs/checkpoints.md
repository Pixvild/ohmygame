# Turn file changes and Undo

Each consumed user message has a file checkpoint before model/tool execution
and another after the turn settles. Open **File changes** below that message to
list added, modified, and removed paths and compare their contents. Failed and
cancelled turns also capture their partial file changes. If either checkpoint
fails, the range is unavailable; a failed before checkpoint prevents inference
and tool execution.

**Edit message** changes the conversation branch and sends the replacement
prompt using the current workspace. It preserves files. **Undo files** is a
separate, explicit action that preserves the conversation. It saves the current
editor first, stops the preview, restores the selected turn's changed paths,
and reloads workspace editors. The model receives a persistent notice to inspect
the current files before continuing.

## Later edits and running work

Undo compares current files with the turn's after checkpoint. If a changed path
has later edits, the first attempt reports conflicts without writing any files.
The user can keep those paths and undo the others, or explicitly overwrite the
conflicts. A successfully undone turn cannot be undone again. Its original Diff
remains available.

Undo is unavailable while agents, generation jobs, or publishing are running in
the project. Agent turns in different conversations of one project run one at a
time. Queued and steering messages get their before checkpoint when consumed,
not when enqueued; the previous message's after checkpoint completes before the
next message starts.

Checkpoint boundaries drain daemon HTTP handlers and canvas generation callbacks,
including callbacks whose job already reports cancellation. They temporarily
stop preview processes and resume an existing active preview afterward. Explicit
Undo leaves the preview stopped until the user resumes it.

Daemon project requests use `x-workspace-version`. Undo changes this version and
emits `workspace.restored` with the version and changed paths. Editors remount and
read the restored files; delayed writes carry the version of the editor that
created them and receive `409 workspace_stale` after restoration. Unsaved canvas
recovery drafts use that version in their local storage keys, so an old draft
cannot silently reappear after Undo or a daemon restart. Generation instructions
and candidate history remain available for explicit adoption.

External editors and commands outside the daemon remain independent. Checkpoint
file signatures and content checks detect conflicting changes during restoration;
an operation rolls back when possible rather than silently overwriting them.

## Storage and file scope

The daemon stores Git-compatible objects in the project's storage directory at
`checkpoints/`, outside its workspace. The workspace does not need Git; its
`.git`, branches, index, and `.gitignore` are untouched. This is internal snapshot
storage rather than a user-facing Git workflow.

Snapshots include creative project files and workspace asset metadata. They
exclude `node_modules` and `.git` anywhere, and these paths at the workspace root:
`dist`, `build`, `out`, `.godot`, `.ohmygame`, `.ohmygame-install-pending`,
`.data/agent-attachments`, and `canvas/jobs.json`. The global asset Library,
generation history, and conversation session files are preserved. Snapshot
metadata is stored as `ohmygame-turn-checkpoint` custom entries in the Pi session;
live turn IDs and persisted user-message IDs both resolve to the same range.

The Diff lists binary and large files, but text preview is limited to UTF-8 files
without NUL bytes and at most 256 KiB per side. The limit is enforced while
decompressing stored blobs. File Undo still works for these files.

## Interrupted restoration

The store records the workspace state immediately before mutating files. If a
restore and its rollback cannot finish, it retains an unfinished-operation
marker. The project shows **Recover files** and refuses creative writes and
initializing canvas/playable/preview reads until recovery completes. Recovery
restores only the recorded pre-operation state and keeps the conversation.

The durable `workspace-restore-notice.txt` beside the checkpoint store is written
before mutation and updated after restoration. It preserves the workspace version
across daemon restarts and supplies model context even if recording a notice in
an individual conversation fails.

## Code and verification

- Storage: `src/daemon/checkpoints.ts`, `src/daemon/checkpoint-objects.ts`.
- Boundaries and persistence: `src/daemon/agent.ts`, `src/daemon/turn-checkpoints.ts`.
- HTTP coordination and recovery: `src/daemon/project-writes.ts`,
  `src/daemon/checkpoint-routes.ts`, `src/daemon/workspace-notice.ts`.
- UI: `src/renderer/turn-file-changes.tsx`, `src/renderer/project-shell.tsx`,
  `src/renderer/workspace-version.ts`.
- Tests: `test/checkpoints.test.ts`, `test/turn-checkpoints.test.ts`,
  `test/checkpoint-routes.test.ts`, and the canvas storage suites.
