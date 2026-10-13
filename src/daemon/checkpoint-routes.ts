import { isUtf8 } from "node:buffer";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { ProjectState } from "../shared/contracts.js";
import type { TurnFileDiff } from "../shared/checkpoints.js";
import type { RuntimeEventBus } from "../shared/events.js";
import type { AgentManager } from "./agent.js";
import type { ConversationManager } from "./conversations.js";
import type { ProjectManager } from "./projects.js";
import type { PreviewManager } from "./preview.js";
import {
  CheckpointConflictError,
  CheckpointIncompleteError,
  CheckpointStore,
} from "./checkpoints.js";
import { CheckpointFileTooLargeError } from "./checkpoint-objects.js";
import { ProjectWriteError, ProjectWrites } from "./project-writes.js";
import {
  sessionCheckpoints,
  TURN_CHECKPOINT_ENTRY,
} from "./turn-checkpoints.js";
import {
  readWorkspaceNotice,
  writeWorkspaceNotice,
} from "./workspace-notice.js";

export function registerCheckpointRoutes(
  app: FastifyInstance,
  options: {
    store: CheckpointStore;
    writes: ProjectWrites;
    projects: ProjectManager;
    conversations: ConversationManager;
    agents: AgentManager;
    previews: PreviewManager;
    events: RuntimeEventBus;
    busy: (id: string) => boolean;
  },
) {
  const { store, writes, projects, conversations, agents, previews, events } =
    options;
  // Cancel remains available while a boundary waits for generation to settle.
  const exempt = (url: string) =>
    /\/(?:events|checkpoint-recovery)(?:\?|$)/.test(url) ||
    /\/turns\/[^/]+\/(?:changes|undo)(?:\?|$)/.test(url) ||
    /\/cancel(?:\?|$)/.test(url);
  app.addHook("preHandler", async (request, reply) => {
    const id = (request.params as { projectId?: string }).projectId;
    if (!id) return;
    reply.header("x-workspace-version", writes.version(id));
    if (exempt(request.url)) return;
    try {
      const project = projects.get(id);
      if (
        project &&
        (request.method !== "GET" ||
          /\/(?:canvas|playable|preview)(?:\/|\?|$)/.test(request.url)) &&
        (await store.unfinished(project))
      ) {
        return reply.code(409).send({
          error:
            "Recover the interrupted file restore before changing this workspace.",
          code: "workspace_recovery",
        });
      }
      writes.track(
        request,
        writes.enter(
          id,
          request.method === "GET"
            ? writes.version(id)
            : (request.headers["x-workspace-version"] as string | undefined),
        ),
      );
    } catch (cause) {
      return failure(cause, reply);
    }
  });

  async function target(
    projectId: string,
    conversationId: string,
    turnId: string,
  ) {
    const project = projects.get(projectId);
    if (!project)
      throw Object.assign(new Error("Project not found"), { statusCode: 404 });
    const conversation = await conversations.get(project, conversationId);
    if (!conversation)
      throw Object.assign(new Error("Conversation not found"), {
        statusCode: 404,
      });
    const checkpoint = sessionCheckpoints(
      (await conversations.view(project, conversation)).getBranch(),
    ).get(turnId);
    if (!checkpoint)
      throw Object.assign(new Error("This turn has no file checkpoint"), {
        statusCode: 404,
      });
    if (!checkpoint.after || checkpoint.error)
      throw new ProjectWriteError(
        "This turn has no complete file checkpoint.",
        "workspace_busy",
      );
    return {
      project,
      conversation,
      checkpoint,
      range: { before: checkpoint.before, after: checkpoint.after },
    };
  }

  const base =
    "/projects/:projectId/conversations/:conversationId/turns/:turnId";
  type Params = { projectId: string; conversationId: string; turnId: string };
  app.get<{ Params: Params; Querystring: { path?: string } }>(
    `${base}/changes`,
    async (request, reply) => {
      try {
        const { project, range } = await target(
          request.params.projectId,
          request.params.conversationId,
          request.params.turnId,
        );
        const changes = await store.diff(project, range.before, range.after);
        if (request.query.path === undefined) return { changes };
        const filePath = request.query.path;
        if (!changes.some((change) => change.path === filePath))
          return reply.code(404).send({ error: "Changed file not found" });
        const result: TurnFileDiff = { path: filePath };
        try {
          const [before, after] = await Promise.all([
            store.read(project, range.before, filePath, 256 * 1024),
            store.read(project, range.after, filePath, 256 * 1024),
          ]);
          if (
            [before, after].some(
              (data) =>
                data && (!isUtf8(Buffer.from(data)) || data.includes(0)),
            )
          )
            result.unavailable = "binary";
          else {
            if (before) result.before = Buffer.from(before).toString("utf8");
            if (after) result.after = Buffer.from(after).toString("utf8");
          }
        } catch (cause) {
          if (cause instanceof CheckpointFileTooLargeError)
            result.unavailable = "too_large";
          else throw cause;
        }
        return result;
      } catch (cause) {
        return failure(cause, reply);
      }
    },
  );

  async function announce(
    project: ProjectState,
    changed: string[],
    recovery = false,
  ) {
    const version = writes.changed(project.id);
    // Persist a model-visible notice in every conversation, including ones
    // whose model session is not currently loaded. Conversation history stays.
    const content = `The user ${recovery ? "recovered an interrupted file restore" : "undid file changes from an earlier turn"}. The conversation was preserved. Inspect the current files before continuing. Changed workspace paths: ${JSON.stringify(changed)}.`;
    try {
      await writeWorkspaceNotice(project, content, version);
      for (const summary of await conversations.list(project)) {
        const stored = await conversations.get(project, summary.id);
        if (
          stored &&
          !(await agents.notifyWorkspaceChange(project.id, summary.id, content))
        ) {
          conversations
            .open(project, stored)
            .appendCustomMessageEntry(
              "ohmygame-workspace-undo",
              content,
              false,
            );
        }
      }
    } finally {
      // Even a session I/O error must invalidate editors after file mutation.
      events.publish(project.id, "workspace.restored", {
        version,
        changed,
        ...(recovery ? { recovery } : {}),
      });
    }
    return version;
  }
  const assertIdle = (id: string) => {
    if (agents.isProjectBusy(id) || options.busy(id))
      throw new ProjectWriteError(
        "Wait for agents, generation jobs and publishing to finish before undoing files.",
        "workspace_busy",
      );
  };

  app.post<{ Params: Params; Body: { conflicts?: "keep" | "overwrite" } }>(
    `${base}/undo`,
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: { conflicts: { enum: ["keep", "overwrite"] } },
        },
      },
    },
    async (request, reply) => {
      try {
        return await writes.exclusive(request.params.projectId, async () => {
          assertIdle(request.params.projectId);
          const { project, conversation, checkpoint, range } = await target(
            request.params.projectId,
            request.params.conversationId,
            request.params.turnId,
          );
          if (checkpoint.undone)
            throw new ProjectWriteError(
              "This turn has already been undone.",
              "workspace_busy",
            );
          await previews.stop(project);
          const previousNotice = await readWorkspaceNotice(project);
          await writeWorkspaceNotice(
            project,
            `A file undo was requested for checkpoint ${checkpoint.id}. The workspace may have changed while the conversation was preserved. Inspect current files before continuing.`,
          );
          let result;
          try {
            result = await store.undo(project, range, request.body ?? {});
          } catch (cause) {
            if (cause instanceof CheckpointIncompleteError)
              await announce(project, [], true);
            else
              await writeWorkspaceNotice(
                project,
                previousNotice ??
                  "A file undo was refused or rolled back. The workspace and conversation were preserved.",
                writes.version(project.id),
              );
            throw cause;
          }
          let version: string;
          try {
            conversations
              .open(project, conversation)
              .appendCustomEntry(TURN_CHECKPOINT_ENTRY, {
                version: 1,
                ...checkpoint,
                undone: result,
              });
          } finally {
            // Reopen loaded trees after metadata was externally appended.
            agents.invalidateProjectSessions(project.id);
            version = await announce(project, result.changed);
          }
          return { ...result, version };
        });
      } catch (cause) {
        return failure(cause, reply);
      }
    },
  );

  app.get<{ Params: { projectId: string } }>(
    "/projects/:projectId/checkpoint-recovery",
    async (request, reply) => {
      const project = projects.get(request.params.projectId);
      if (!project) return reply.code(404).send({ error: "Project not found" });
      try {
        return { pending: Boolean(await store.unfinished(project)) };
      } catch (cause) {
        return failure(cause, reply);
      }
    },
  );
  app.post<{ Params: { projectId: string } }>(
    "/projects/:projectId/checkpoint-recovery",
    async (request, reply) => {
      try {
        return await writes.exclusive(request.params.projectId, async () => {
          assertIdle(request.params.projectId);
          const project = projects.get(request.params.projectId);
          if (!project)
            return reply.code(404).send({ error: "Project not found" });
          const pending = await store.unfinished(project);
          if (!pending)
            return reply
              .code(409)
              .send({ error: "There is no interrupted restore to recover" });
          await previews.stop(project);
          await writeWorkspaceNotice(
            project,
            "Recovery of an interrupted file restore was requested. The workspace may have changed while the conversation was preserved. Inspect current files before continuing.",
          );
          const result = await store.restore(project, pending);
          return {
            ...result,
            version: await announce(project, result.changed, true),
          };
        });
      } catch (cause) {
        return failure(cause, reply);
      }
    },
  );
}

function failure(cause: unknown, reply: FastifyReply) {
  if (cause instanceof CheckpointConflictError)
    return reply.code(409).send({
      error: cause.message,
      code: "checkpoint_conflict",
      conflicts: cause.conflicts,
    });
  if (cause instanceof CheckpointIncompleteError)
    return reply.code(409).send({
      error:
        "File restore was interrupted. Recover the workspace before continuing.",
      code: "workspace_recovery",
    });
  const error = cause as { statusCode?: number; code?: string };
  return reply.code(error.statusCode ?? 500).send({
    error: cause instanceof Error ? cause.message : String(cause),
    ...(error.code ? { code: error.code } : {}),
  });
}
