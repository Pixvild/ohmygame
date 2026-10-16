#!/usr/bin/env node
/**
 * Spike: turns an Interactive Story workspace into a web story in place. It
 * adds index.html and story/runtime.js, and rewrites the two imports a
 * browser cannot load on its own: text files become fetches and JSON imports
 * get an import attribute. Library assets are copied into the workspace when
 * the library directory is given.
 *
 *   node --import tsx scripts/story-web-spike.mjs <workspace> [<library-directory>]
 */
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { storyWebBundle } from "../src/daemon/story-web-bundle.ts";

const [workspace, library] = process.argv.slice(2);
if (!workspace) throw new Error("Usage: story-web-spike.mjs <workspace> [<library-directory>]");

const graphPath = path.join(workspace, "graph.json");
const graph = JSON.parse(await readFile(graphPath, "utf8"));
const report = { rewritten: [], copiedAssets: [], missingAssets: [] };

for (const [id, asset] of Object.entries(graph.assets)) {
  if (asset.source.kind !== "library") continue;
  const found = library ? await findLibraryFile(library, asset.source.assetId) : undefined;
  if (!found) {
    report.missingAssets.push(id);
    continue;
  }
  const relative = `assets/library/${id}${path.extname(found)}`;
  await mkdir(path.join(workspace, "assets/library"), { recursive: true });
  await copyFile(found, path.join(workspace, relative));
  asset.source = { kind: "workspace", path: relative };
  report.copiedAssets.push(id);
}
await writeFile(graphPath, `${JSON.stringify(graph, null, 2)}\n`);

for (const file of await sourceFiles(workspace)) {
  const before = await readFile(file, "utf8");
  const after = before
    .replace(/^import\s+(\w+)\s+from\s+"(\.[^"]+\.txt)";$/gm, (_, name, specifier) =>
      `const ${name} = await (await fetch(new URL(${JSON.stringify(specifier)}, import.meta.url))).text();`)
    .replace(/^import\s+(\w+)\s+from\s+"(\.[^"]+\.json)";$/gm, (_, name, specifier) =>
      `import ${name} from ${JSON.stringify(specifier)} with { type: "json" };`);
  if (after !== before) {
    await writeFile(file, after);
    report.rewritten.push(path.relative(workspace, file));
  }
}

await mkdir(path.join(workspace, "story"), { recursive: true });
await writeFile(path.join(workspace, "story/runtime.js"), await storyWebBundle("runtime"));
await writeFile(path.join(workspace, "index.html"), `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(graph.title)}</title>
  </head>
  <body>
    <script type="module" src="story/runtime.js"></script>
  </body>
</html>
`);
console.log(JSON.stringify(report, null, 2));

async function sourceFiles(root) {
  const files = [];
  for (const directory of ["nodes", "shared"]) {
    const walk = async (current) => {
      for (const entry of await readdir(current, { withFileTypes: true }).catch(() => [])) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (entry.name.endsWith(".js")) files.push(full);
      }
    };
    await walk(path.join(root, directory));
  }
  return files;
}

async function findLibraryFile(directory, assetId) {
  for (const entry of await readdir(directory, { recursive: true })) {
    if (path.basename(entry).startsWith(assetId) && (await stat(path.join(directory, entry))).isFile()) return path.join(directory, entry);
  }
  return undefined;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]);
}
