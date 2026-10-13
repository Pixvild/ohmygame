import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it } from "vitest";
import { createApp } from "../src/daemon/app.js";
import {
  CheckpointStore,
  checkpointDirectory,
} from "../src/daemon/checkpoints.js";
import { TURN_CHECKPOINT_ENTRY } from "../src/daemon/turn-checkpoints.js";
import type { ProjectState } from "../src/shared/contracts.js";
import { readWorkspaceVersion } from "../src/daemon/workspace-notice.js";

const cleanup: Array<() => unknown | Promise<unknown>> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
async function fixture() {
  const directory = await mkdtemp(
    path.join(tmpdir(), "ohmygame-checkpoint-routes-"),
  );
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const app = createApp({ dataDirectory: directory });
  cleanup.push(() => app.close());
  const project = (
    await app.inject({
      method: "POST",
      url: "/projects",
      payload: { name: "Checkpoint" },
    })
  ).json<ProjectState>();
  const store = new CheckpointStore();
  await writeFile(path.join(project.workspacePath, "game.txt"), "before");
  const before = await store.snapshot(project);
  const session = SessionManager.create(
    project.workspacePath,
    path.join(project.storagePath!, "session"),
  );
  session.appendCustomEntry(TURN_CHECKPOINT_ENTRY, {
    version: 1,
    id: "live-turn",
    before,
  });
  const userId = session.appendMessage({
    role: "user",
    content: [{ type: "text", text: "Change files" }],
    timestamp: Date.now(),
  });
  await writeFile(path.join(project.workspacePath, "game.txt"), "after");
  await writeFile(path.join(project.workspacePath, "created.txt"), "new");
  await mkdir(path.join(project.workspacePath, "canvas"));
  await writeFile(
    path.join(project.workspacePath, "canvas", "jobs.json"),
    "history",
  );
  const after = await store.snapshot(project);
  session.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "Changed" }],
    api: "openai-completions",
    provider: "openai",
    model: "test",
    stopReason: "stop",
    timestamp: Date.now(),
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  });
  session.appendCustomEntry(TURN_CHECKPOINT_ENTRY, {
    version: 1,
    id: "live-turn",
    before,
    after,
  });
  const base = `/projects/${project.id}/conversations/${session.getSessionId()}/turns`;
  return {
    directory,
    app,
    project,
    store,
    session,
    userId,
    base,
    before,
    after,
  };
}

it("serves persisted and live turn diffs, undoes only files, and rejects old editor writes", async () => {
  const { app, project, session, userId, base } = await fixture();
  for (const id of ["live-turn", userId]) {
    const changes = await app.inject({
      method: "GET",
      url: `${base}/${id}/changes`,
    });
    expect(changes.statusCode, changes.body).toBe(200);
    expect(changes.json().changes).toEqual([
      { path: "created.txt", kind: "added" },
      { path: "game.txt", kind: "modified" },
    ]);
  }
  expect(
    (
      await app.inject({
        method: "GET",
        url: `${base}/live-turn/changes?path=game.txt`,
      })
    ).json(),
  ).toEqual({ path: "game.txt", before: "before", after: "after" });
  expect(
    (
      await app.inject({
        method: "GET",
        url: `${base}/live-turn/changes?path=../secret`,
      })
    ).statusCode,
  ).toBe(404);
  const undo = await app.inject({
    method: "POST",
    url: `${base}/live-turn/undo`,
    payload: {},
  });
  expect(undo.statusCode, undo.body).toBe(200);
  expect(
    await readFile(path.join(project.workspacePath, "game.txt"), "utf8"),
  ).toBe("before");
  await expect(
    readFile(path.join(project.workspacePath, "created.txt")),
  ).rejects.toMatchObject({ code: "ENOENT" });
  expect(
    await readFile(
      path.join(project.workspacePath, "canvas/jobs.json"),
      "utf8",
    ),
  ).toBe("history");
  const restored = SessionManager.open(session.getSessionFile()!);
  expect(
    restored.getBranch().filter((entry) => entry.type === "message"),
  ).toHaveLength(2);
  expect(
    restored
      .getBranch()
      .some(
        (entry) =>
          entry.type === "custom_message" &&
          entry.customType === "ohmygame-workspace-undo",
      ),
  ).toBe(true);
  const stale = await app.inject({
    method: "POST",
    url: `/projects/${project.id}/files`,
    headers: { "x-workspace-version": "0" },
    payload: { name: "stale.txt", kind: "file" },
  });
  expect(stale.statusCode).toBe(409);
  expect(stale.json().code).toBe("workspace_stale");
  const fresh = await app.inject({
    method: "POST",
    url: `/projects/${project.id}/files`,
    headers: { "x-workspace-version": undo.json().version },
    payload: { name: "fresh.txt", kind: "file" },
  });
  expect(fresh.statusCode, fresh.body).toBe(201);
  expect(
    (
      await app.inject({
        method: "POST",
        url: `${base}/live-turn/undo`,
        payload: {},
      })
    ).statusCode,
  ).toBe(409);
});

it.each(["keep", "overwrite"] as const)(
  "returns no-write conflicts and honors explicit %s",
  async (policy) => {
    const { app, project, base } = await fixture();
    await writeFile(path.join(project.workspacePath, "game.txt"), "later edit");
    const refused = await app.inject({
      method: "POST",
      url: `${base}/live-turn/undo`,
      payload: {},
    });
    expect(refused.statusCode, refused.body).toBe(409);
    expect(await readWorkspaceVersion(project)).toBe("0");
    expect(refused.json()).toMatchObject({
      code: "checkpoint_conflict",
      conflicts: ["game.txt"],
    });
    expect(
      await readFile(path.join(project.workspacePath, "created.txt"), "utf8"),
    ).toBe("new");
    const accepted = await app.inject({
      method: "POST",
      url: `${base}/live-turn/undo`,
      payload: { conflicts: policy },
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(
      await readFile(path.join(project.workspacePath, "game.txt"), "utf8"),
    ).toBe(policy === "keep" ? "later edit" : "before");
  },
);

it("recovers the recorded interrupted operation and blocks creative writes until recovery", async () => {
  const { app, project, before } = await fixture();
  await writeFile(
    path.join(checkpointDirectory(project), "ohmygame-unfinished.json"),
    JSON.stringify({ previous: before }),
  );
  expect(
    (
      await app.inject({
        method: "GET",
        url: `/projects/${project.id}/checkpoint-recovery`,
      })
    ).json(),
  ).toEqual({ pending: true });
  const blocked = await app.inject({
    method: "POST",
    url: `/projects/${project.id}/files`,
    payload: { name: "blocked.txt", kind: "file" },
  });
  expect(blocked.statusCode).toBe(409);
  expect(blocked.json().code).toBe("workspace_recovery");
  for (const route of ["canvas/workspace", "playable"]) {
    const read = await app.inject({
      method: "GET",
      url: `/projects/${project.id}/${route}`,
    });
    expect(read.statusCode, read.body).toBe(409);
  }
  const result = await app.inject({
    method: "POST",
    url: `/projects/${project.id}/checkpoint-recovery`,
  });
  expect(result.statusCode, result.body).toBe(200);
  expect(
    await readFile(path.join(project.workspacePath, "game.txt"), "utf8"),
  ).toBe("before");
  expect(
    (
      await app.inject({
        method: "GET",
        url: `/projects/${project.id}/checkpoint-recovery`,
      })
    ).json(),
  ).toEqual({ pending: false });
});

it("preserves the restored workspace version across daemon restart", async () => {
  const { app, directory, project, base } = await fixture();
  const undo = await app.inject({
    method: "POST",
    url: `${base}/live-turn/undo`,
    payload: {},
  });
  expect(undo.statusCode, undo.body).toBe(200);
  await app.close();
  const restarted = createApp({ dataDirectory: directory });
  cleanup.push(() => restarted.close());
  const read = await restarted.inject({
    method: "GET",
    url: `/projects/${project.id}`,
  });
  expect(read.headers["x-workspace-version"]).toBe(undo.json().version);
  const stale = await restarted.inject({
    method: "POST",
    url: `/projects/${project.id}/files`,
    payload: { name: "stale.txt", kind: "file" },
  });
  expect(stale.statusCode).toBe(409);
  expect(stale.json().code).toBe("workspace_stale");
});

it("shows binary and oversized files without unbounded text reads", async () => {
  const { app, project, store, session, base, before } = await fixture();
  await writeFile(
    path.join(project.workspacePath, "binary.bin"),
    Buffer.from([0, 1, 255]),
  );
  await writeFile(
    path.join(project.workspacePath, "large.txt"),
    "x".repeat(300 * 1024),
  );
  const after = await store.snapshot(project);
  session.appendCustomEntry(TURN_CHECKPOINT_ENTRY, {
    version: 1,
    id: "live-turn",
    before,
    after,
  });
  for (const [filePath, unavailable] of [
    ["binary.bin", "binary"],
    ["large.txt", "too_large"],
  ]) {
    const diff = await app.inject({
      method: "GET",
      url: `${base}/live-turn/changes?path=${filePath}`,
    });
    expect(diff.statusCode, diff.body).toBe(200);
    expect(diff.json()).toEqual({ path: filePath, unavailable });
  }
});
