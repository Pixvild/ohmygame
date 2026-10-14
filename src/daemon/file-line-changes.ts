import { open, mkdir, writeFile } from "node:fs/promises";
import {
  createWriteToolDefinition,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { LineChanges } from "../shared/contracts.js";
import { countLineChanges } from "../shared/line-diff.js";

export const MAX_CHANGE_BYTES = 256 * 1024;

/** Unknown, binary and oversized content has no line count. */
export function changeText(bytes: Uint8Array | undefined): string | undefined {
  if (!bytes || bytes.length > MAX_CHANGE_BYTES || bytes.includes(0))
    return undefined;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

/** Headers precede the hunks; content that starts with ++ or -- is still a changed line. */
export function patchLineChanges(patch: string): LineChanges {
  const counts = { added: 0, removed: 0 };
  let inHunk = false;
  for (const line of patch.split("\n")) {
    if (line.startsWith("@@ ")) inHunk = true;
    else if (inHunk && line.startsWith("+")) counts.added += 1;
    else if (inHunk && line.startsWith("-")) counts.removed += 1;
  }
  return counts;
}

async function readBefore(filePath: string): Promise<string | undefined> {
  try {
    const handle = await open(filePath, "r");
    try {
      const bytes = Buffer.alloc(MAX_CHANGE_BYTES + 1);
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
      return changeText(bytes.subarray(0, bytesRead));
    } finally {
      await handle.close();
    }
  } catch (cause) {
    return (cause as NodeJS.ErrnoException).code === "ENOENT" ? "" : undefined;
  }
}

/** Adds display metadata inside Pi's file mutation queue, including complete rewrites. */
export function createTrackedWriteTool(
  cwd: string,
): ToolDefinition<
  ReturnType<typeof createWriteToolDefinition>["parameters"],
  { lineChanges: LineChanges } | undefined
> {
  const base = createWriteToolDefinition(cwd);
  const renderResult = base.renderResult;
  return {
    ...base,
    renderResult: renderResult
      ? (result, ...args) =>
          renderResult({ ...result, details: undefined }, ...args)
      : undefined,
    async execute(...args: Parameters<typeof base.execute>) {
      let lines: LineChanges | undefined;
      const tool = createWriteToolDefinition(cwd, {
        operations: {
          mkdir: async (dir) => {
            await mkdir(dir, { recursive: true });
          },
          writeFile: async (filePath, content) => {
            const before = await readBefore(filePath);
            await writeFile(filePath, content, "utf8");
            const after = changeText(new TextEncoder().encode(content));
            if (before !== undefined && after !== undefined)
              lines = countLineChanges(before, after);
          },
        },
      });
      const result = await tool.execute(...args);
      return { ...result, details: lines ? { lineChanges: lines } : undefined };
    },
  };
}
