import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createTrackedWriteTool,
  patchLineChanges,
} from "../src/daemon/file-line-changes.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("file tool line counts", () => {
  it("counts creation and rewrites against the file that actually existed", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "ohmygame-write-counts-"));
    roots.push(cwd);
    const tool = createTrackedWriteTool(cwd);
    const ctx = { cwd } as Parameters<typeof tool.execute>[4];
    const first = await tool.execute(
      "create",
      { path: "notes.txt", content: "keep\nold\n" },
      undefined,
      undefined,
      ctx,
    );
    expect(first.details).toEqual({ lineChanges: { added: 2, removed: 0 } });
    const rewrite = await tool.execute(
      "rewrite",
      { path: "notes.txt", content: "keep\nnew\nextra\n" },
      undefined,
      undefined,
      ctx,
    );
    expect(rewrite.details).toEqual({ lineChanges: { added: 2, removed: 1 } });
    const same = await tool.execute(
      "same",
      { path: "notes.txt", content: "keep\nnew\nextra\n" },
      undefined,
      undefined,
      ctx,
    );
    expect(same.details).toEqual({ lineChanges: { added: 0, removed: 0 } });
    expect(await readFile(path.join(cwd, "notes.txt"), "utf8")).toBe(
      "keep\nnew\nextra\n",
    );
  });

  it("omits unavailable counts and preserves writes and cancellation", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "ohmygame-write-counts-"));
    roots.push(cwd);
    const tool = createTrackedWriteTool(cwd);
    const ctx = { cwd } as Parameters<typeof tool.execute>[4];
    for (const content of ["\u0000binary", "x".repeat(300_000)]) {
      await writeFile(path.join(cwd, "notes.txt"), content);
      expect(
        (
          await tool.execute(
            "rewrite",
            { path: "notes.txt", content: "new\n" },
            undefined,
            undefined,
            ctx,
          )
        ).details,
      ).toBeUndefined();
    }
    const controller = new AbortController();
    controller.abort();
    await expect(
      tool.execute(
        "cancel",
        { path: "notes.txt", content: "cancelled" },
        controller.signal,
        undefined,
        ctx,
      ),
    ).rejects.toThrow("aborted");
    expect(await readFile(path.join(cwd, "notes.txt"), "utf8")).toBe("new\n");
  });

  it("counts patch content that resembles a header and excludes actual headers", () => {
    expect(
      patchLineChanges(
        "--- a/file.ts\n+++ b/file.ts\n@@ -1,2 +1,2 @@\n--- old\n+++ new\n unchanged\n",
      ),
    ).toEqual({ added: 1, removed: 1 });
  });
});
