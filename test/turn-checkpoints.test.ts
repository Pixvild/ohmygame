import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { request as httpRequest } from "node:http";
import Fastify from "fastify";
import {
  ModelRuntime,
  SessionManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEventStream,
} from "@earendil-works/pi-ai";
import { afterEach, expect, it, vi } from "vitest";
import {
  AgentManager,
  conversationItems,
  createPiSession,
} from "../src/daemon/agent.js";
import { CheckpointStore } from "../src/daemon/checkpoints.js";
import { CheckpointFileTooLargeError } from "../src/daemon/checkpoint-objects.js";
import { sessionCheckpoints } from "../src/daemon/turn-checkpoints.js";
import { ProjectWrites } from "../src/daemon/project-writes.js";
import { RuntimeEventBus } from "../src/shared/events.js";
import type { ProjectState } from "../src/shared/contracts.js";

const cleanups: Array<() => unknown | Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

function assistant(
  content: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"] = "stop",
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "anthropic-messages",
    provider: "anthropic",
    model: "test",
    stopReason,
    timestamp: Date.now(),
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
}
function stream(message: AssistantMessage): AssistantMessageEventStream {
  const result = createAssistantMessageEventStream();
  queueMicrotask(() => {
    if (message.stopReason === "error" || message.stopReason === "aborted")
      result.push({
        type: "error",
        reason: message.stopReason,
        error: message,
      });
    else
      result.push({
        type: "done",
        reason: message.stopReason === "pending" ? "stop" : message.stopReason,
        message,
      });
  });
  return result;
}
async function fixture(
  snapshotOverride?: (project: ProjectState) => Promise<string>,
  loading?: Promise<void>,
) {
  const directory = await mkdtemp(
    path.join(tmpdir(), "ohmygame-turn-checkpoints-"),
  );
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const project: ProjectState = {
    id: "project",
    name: "Project",
    type: "web-game",
    workspacePath: path.join(directory, "workspace"),
    storagePath: directory,
    updatedAt: new Date().toISOString(),
    preview: { status: "waiting" },
  };
  await mkdir(project.workspacePath);
  const agentDir = path.join(directory, "agent");
  await mkdir(agentDir);
  await writeFile(
    path.join(agentDir, "settings.json"),
    JSON.stringify({
      compaction: { enabled: false },
      retry: { enabled: false },
      cacheWarming: "off",
    }),
  );
  const runtime = await ModelRuntime.create({
    authPath: path.join(agentDir, "auth.json"),
    modelsPath: null,
    refreshOnCreate: false,
  });
  await runtime.setRuntimeApiKey("anthropic", "test");
  const model = runtime.getModels("anthropic")[0]!;
  const sessionManager = SessionManager.create(
    project.workspacePath,
    path.join(directory, "sessions"),
  );
  const session = (await createPiSession(
    project,
    sessionManager,
    [],
    runtime,
    model,
    agentDir,
  )) as AgentSession & {
    setCheckpointHooks: NonNullable<
      import("../src/daemon/agent.js").CodingSession["setCheckpointHooks"]
    >;
  };
  const store = new CheckpointStore();
  const snapshot = vi.fn(
    snapshotOverride ?? ((state: ProjectState) => store.snapshot(state)),
  );
  const events = new RuntimeEventBus();
  const manager = new AgentManager(events, {
    createSession: async () => {
      await loading;
      return session;
    },
    snapshot,
  });
  cleanups.push(() => manager.close());
  const conversation = {
    sessionPath: sessionManager.getSessionFile()!,
    summary: {
      id: sessionManager.getSessionId(),
      projectId: project.id,
      title: "Test",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messageCount: 0,
    },
  };
  return {
    directory,
    project,
    session,
    sessionManager,
    store,
    manager,
    conversation,
    snapshot,
    events,
    runtime,
  };
}

it("captures consumed follow-ups and steering at file boundaries, rather than enqueue time", async () => {
  const {
    project,
    session,
    sessionManager,
    store,
    manager,
    conversation,
    snapshot,
    runtime,
  } = await fixture();
  const firstRequest = deferred(),
    release = deferred();
  cleanups.push(() => release.resolve());
  let calls = 0;
  runtime.streamSimple = (_model, context) => {
    if (calls++ === 0) {
      firstRequest.resolve();
      const output = createAssistantMessageEventStream();
      void release.promise.then(() =>
        output.push({
          type: "done",
          reason: "toolUse",
          message: assistant(
            [
              {
                type: "toolCall",
                id: "write-first",
                name: "write",
                arguments: { path: "game.txt", content: "first" },
              },
            ],
            "toolUse",
          ),
        }),
      );
      return output;
    }
    const user = context.messages.findLast(
      (message) => message.role === "user",
    );
    const text = JSON.stringify(user?.content);
    if (context.messages.at(-1)?.role === "toolResult")
      return stream(assistant([{ type: "text", text: "Done" }]));
    return stream(
      assistant(
        [
          {
            type: "toolCall",
            id: `write-${calls}`,
            name: "write",
            arguments: {
              path: "game.txt",
              content: text.includes("Steer") ? "steered" : "followed",
            },
          },
        ],
        "toolUse",
      ),
    );
  };
  const first = manager.prompt(project, conversation, "First");
  await Promise.race([
    firstRequest.promise,
    first.result!.then(() => {
      throw new Error("Run settled before inference");
    }),
  ]);
  const follow = manager.prompt(project, conversation, "Follow");
  await follow.result;
  const steer = manager.prompt(project, conversation, "Steer");
  await steer.result;
  await manager.steerPending(project.id, conversation.summary.id, steer.turnId);
  expect(snapshot).toHaveBeenCalledTimes(1);
  release.resolve();
  await first.result;
  expect(snapshot).toHaveBeenCalledTimes(6);
  const checkpoints = sessionCheckpoints(sessionManager.getBranch());
  const firstRange = checkpoints.get(first.turnId)!;
  const steerRange = checkpoints.get(steer.turnId)!;
  const followRange = checkpoints.get(follow.turnId)!;
  expect(
    Buffer.from(
      (await store.read(project, firstRange.after!, "game.txt"))!,
    ).toString(),
  ).toBe("first");
  expect(
    Buffer.from(
      (await store.read(project, steerRange.before, "game.txt"))!,
    ).toString(),
  ).toBe("first");
  expect(
    Buffer.from(
      (await store.read(project, followRange.before, "game.txt"))!,
    ).toString(),
  ).toBe("steered");
  expect(
    await readFile(path.join(project.workspacePath, "game.txt"), "utf8"),
  ).toBe("followed");
  const restarted = SessionManager.open(
    sessionManager.getSessionFile()!,
  ).getBranch();
  const users = conversationItems(restarted, false).filter(
    (item) => item.type === "userMessage",
  );
  expect(users.map((item) => item.checkpoint?.id)).toEqual([
    first.turnId,
    steer.turnId,
    follow.turnId,
  ]);
});

it("fails closed before inference/tools when the before checkpoint fails", async () => {
  const { project, session, manager, conversation, runtime } = await fixture(
    async () => {
      throw new Error("snapshot disk failure");
    },
  );
  const inference = vi.fn(() =>
    stream(
      assistant(
        [
          {
            type: "toolCall",
            id: "write",
            name: "write",
            arguments: { path: "bad.txt", content: "bad" },
          },
        ],
        "toolUse",
      ),
    ),
  );
  runtime.streamSimple = inference;
  await expect(
    manager.prompt(project, conversation, "Write").result,
  ).rejects.toThrow("snapshot disk failure");
  expect(inference).not.toHaveBeenCalled();
  await expect(
    readFile(path.join(project.workspacePath, "bad.txt")),
  ).rejects.toMatchObject({ code: "ENOENT" });
});

it("records partial files on cancellation without rewinding the conversation", async () => {
  const {
    project,
    session,
    sessionManager,
    manager,
    conversation,
    snapshot,
    runtime,
  } = await fixture();
  const written = deferred();
  let calls = 0;
  runtime.streamSimple = (_model, _context, options) => {
    if (calls++ === 0)
      return stream(
        assistant(
          [
            {
              type: "toolCall",
              id: "write",
              name: "write",
              arguments: { path: "partial.txt", content: "partial" },
            },
          ],
          "toolUse",
        ),
      );
    const output = createAssistantMessageEventStream();
    written.resolve();
    options?.signal?.addEventListener(
      "abort",
      () =>
        output.push({
          type: "error",
          reason: "aborted",
          error: assistant([], "aborted"),
        }),
      { once: true },
    );
    return output;
  };
  const turn = manager.prompt(project, conversation, "Write then wait");
  await Promise.race([
    written.promise,
    turn.result!.then(() => {
      throw new Error("Run settled before write");
    }),
  ]);
  await manager.cancel(project.id, conversation.summary.id, turn.turnId);
  await expect(turn.result).resolves.toBe("cancelled");
  expect(snapshot).toHaveBeenCalledTimes(2);
  expect(
    sessionCheckpoints(sessionManager.getBranch()).get(turn.turnId)?.after,
  ).toBeDefined();
  expect(
    await readFile(path.join(project.workspacePath, "partial.txt"), "utf8"),
  ).toBe("partial");
  expect(
    conversationItems(sessionManager.getBranch()).some(
      (item) => item.type === "userMessage",
    ),
  ).toBe(true);
});

it("bounds preview reads of highly compressed files and validates readable blobs", async () => {
  const { project, store } = await fixture();
  await writeFile(
    path.join(project.workspacePath, "huge.txt"),
    "a".repeat(2 * 1024 * 1024),
  );
  await writeFile(path.join(project.workspacePath, "small.txt"), "small");
  const snapshot = await store.snapshot(project);
  await expect(
    store.read(project, snapshot, "huge.txt", 256 * 1024),
  ).rejects.toBeInstanceOf(CheckpointFileTooLargeError);
  expect(
    Buffer.from(
      (await store.read(project, snapshot, "small.txt", 256 * 1024))!,
    ).toString(),
  ).toBe("small");
});

it("keeps failed turn changes reviewable and closes the after checkpoint before reporting failure", async () => {
  const { project, manager, conversation, runtime, sessionManager } =
    await fixture();
  let calls = 0;
  runtime.streamSimple = () =>
    calls++ === 0
      ? stream(
          assistant(
            [
              {
                type: "toolCall",
                id: "write",
                name: "write",
                arguments: { path: "failed.txt", content: "partial failure" },
              },
            ],
            "toolUse",
          ),
        )
      : stream({ ...assistant([], "error"), errorMessage: "model failure" });
  const turn = manager.prompt(project, conversation, "Write");
  await expect(turn.result).rejects.toThrow("model failure");
  expect(
    sessionCheckpoints(sessionManager.getBranch()).get(turn.turnId)?.after,
  ).toBeDefined();
  expect(
    await readFile(path.join(project.workspacePath, "failed.txt"), "utf8"),
  ).toBe("partial failure");
});

it("marks a missing after snapshot unavailable instead of presenting a complete range", async () => {
  let calls = 0;
  const { project, manager, conversation, runtime, sessionManager, events } =
    await fixture(async () => {
      if (calls++ === 0) return "a".repeat(40);
      throw new Error("after snapshot failure");
    });
  runtime.streamSimple = () =>
    stream(assistant([{ type: "text", text: "Done" }]));
  const turn = manager.prompt(project, conversation, "Read");
  await expect(turn.result).rejects.toThrow("after snapshot failure");
  expect(
    sessionCheckpoints(sessionManager.getBranch()).get(turn.turnId),
  ).toEqual({
    id: turn.turnId,
    before: "a".repeat(40),
    error: "after snapshot failure",
  });
  expect(events.since(project.id).at(-1)?.type).toBe("agent.error");
});

it("adds the durable workspace notice to later model requests", async () => {
  const { project, manager, conversation, runtime } = await fixture();
  const { writeWorkspaceNotice } =
    await import("../src/daemon/workspace-notice.js");
  await writeWorkspaceNotice(
    project,
    "User undid the title change. Inspect current files.",
  );
  const inference = vi.fn((_model, context) => {
    expect(JSON.stringify(context)).toContain("User undid the title change");
    return stream(assistant([{ type: "text", text: "Done" }]));
  });
  runtime.streamSimple = inference;
  await manager.prompt(project, conversation, "Continue").result;
  expect(inference).toHaveBeenCalledOnce();
});

it("drains real writes, refuses new stale writes and lets other projects proceed", async () => {
  const writes = new ProjectWrites(),
    held = writes.enter("one"),
    restored = deferred();
  const operation = writes.exclusive("one", async () => {
    writes.changed("one");
    restored.resolve();
  });
  await Promise.resolve();
  expect(() => writes.enter("one")).toThrow("being checkpointed");
  const other = writes.enter("two");
  other();
  held();
  await operation;
  await restored.promise;
  expect(() => writes.enter("one", "0")).toThrow("was restored");
  const current = writes.enter("one", writes.version("one"));
  current();
  await expect(
    writes.exclusive("one", async () => {
      throw new Error("failed");
    }),
  ).rejects.toThrow("failed");
  const next = writes.enter("one", writes.version("one"));
  next();
});

it("waits for an HTTP write handler even after its client disconnects", async () => {
  const app = Fastify(),
    writes = new ProjectWrites();
  const entered = deferred(),
    release = deferred();
  const order: string[] = [];
  writes.install(app);
  app.addHook("preHandler", async (request) => {
    writes.track(request, writes.enter("one"));
  });
  app.post("/write", async () => {
    entered.resolve();
    await release.promise;
    order.push("write");
    return {};
  });
  cleanups.push(
    () => app.close(),
    () => release.resolve(),
  );
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const client = httpRequest(`${address}/write`, { method: "POST" });
  client.on("error", () => {});
  client.end();
  cleanups.push(() => client.destroy());
  await entered.promise;
  const restore = writes.exclusive("one", async () => {
    order.push("restore");
  });
  client.destroy();
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(order).toEqual([]);
  release.resolve();
  await restore;
  expect(order).toEqual(["write", "restore"]);
});

it("associates an initial consumed message correctly when a follow-up arrives during session loading", async () => {
  const loading = deferred();
  cleanups.push(() => loading.resolve());
  const { project, manager, conversation, runtime, sessionManager, snapshot } =
    await fixture(undefined, loading.promise);
  runtime.streamSimple = () =>
    stream(assistant([{ type: "text", text: "Done" }]));
  const first = manager.prompt(project, conversation, "First");
  const queued = manager.prompt(
    project,
    conversation,
    "Queued before first message",
  );
  expect(snapshot).not.toHaveBeenCalled();
  loading.resolve();
  await queued.result;
  await first.result;
  expect(snapshot).toHaveBeenCalledTimes(4);
  expect(
    conversationItems(sessionManager.getBranch())
      .filter((item) => item.type === "userMessage")
      .map((item) => item.checkpoint?.id),
  ).toEqual([first.turnId, queued.turnId]);
});

it("edits conversation history while preserving files and checkpoints the current files for the replacement", async () => {
  const { project, manager, conversation, runtime, sessionManager, store } =
    await fixture();
  runtime.streamSimple = () =>
    stream(assistant([{ type: "text", text: "Done" }]));
  const original = manager.prompt(project, conversation, "First");
  await original.result;
  await writeFile(
    path.join(project.workspacePath, "game.txt"),
    "Later manual edit",
  );
  const revised = await manager.reviseLast(
    project,
    conversation,
    "Replacement",
    async (reference) => reference,
  );
  await revised.result;
  const checkpoint = sessionCheckpoints(sessionManager.getBranch()).get(
    revised.turnId,
  )!;
  expect(
    Buffer.from(
      (await store.read(project, checkpoint.before, "game.txt"))!,
    ).toString(),
  ).toBe("Later manual edit");
  expect(
    await readFile(path.join(project.workspacePath, "game.txt"), "utf8"),
  ).toBe("Later manual edit");
  const users = conversationItems(
    SessionManager.open(sessionManager.getSessionFile()!).getBranch(),
  ).filter((item) => item.type === "userMessage");
  expect(users.map((item) => item.text)).toEqual(["Replacement"]);
});

it("keeps before-checkpoint events immutable when the after snapshot finishes", async () => {
  const { project, manager, conversation, runtime, events } = await fixture();
  runtime.streamSimple = () =>
    stream(assistant([{ type: "text", text: "Done" }]));
  await manager.prompt(project, conversation, "First").result;
  const updates = events
    .since(project.id)
    .flatMap((event) =>
      event.type === "item.updated" && event.data.item.type === "userMessage"
        ? [event.data.item]
        : [],
    );
  expect(updates).toHaveLength(2);
  expect(updates[0]!).toHaveProperty("checkpoint.before");
  expect(updates[0]!).not.toHaveProperty("checkpoint.after");
  expect(updates[1]!).toHaveProperty("checkpoint.after");
});

it("blocks inference if the durable workspace notice cannot be read", async () => {
  const { project, manager, conversation, runtime } = await fixture();
  await mkdir(path.join(project.storagePath!, "workspace-restore-notice.txt"));
  const inference = vi.fn(() =>
    stream(assistant([{ type: "text", text: "Done" }])),
  );
  runtime.streamSimple = inference;
  await expect(
    manager.prompt(project, conversation, "Continue").result,
  ).rejects.toThrow();
  expect(inference).not.toHaveBeenCalled();
});
