import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const bundles = new Map<string, Promise<string>>();

/**
 * Bundles a web story module from OhMyGame's own source into one plain
 * script: the editor bridge the preview injects, or the story runtime a web
 * story project carries. Built once per daemon.
 */
export function storyWebBundle(entry: "editor-bridge" | "runtime"): Promise<string> {
  let bundle = bundles.get(entry);
  if (!bundle) {
    bundle = bundleEntry(entry);
    bundle.catch(() => bundles.delete(entry));
    bundles.set(entry, bundle);
  }
  return bundle;
}

async function bundleEntry(entry: "editor-bridge" | "runtime"): Promise<string> {
  // Source in development, the compiled module in a build.
  const candidates = [".ts", ".js"].map((extension) => fileURLToPath(new URL(`../story-web/${entry}${extension}`, import.meta.url)));
  let entryPoint: string | undefined;
  for (const candidate of candidates) {
    try {
      await access(candidate);
      entryPoint = candidate;
      break;
    } catch {}
  }
  if (!entryPoint) throw new Error(`The web story ${entry} is missing from this build.`);
  const result = await build({
    entryPoints: [entryPoint],
    bundle: true,
    // The bridge is injected as a classic script; the runtime is the page's module.
    format: entry === "editor-bridge" ? "iife" : "esm",
    target: "es2022",
    write: false,
    legalComments: "none",
  });
  return result.outputFiles[0]!.text;
}
