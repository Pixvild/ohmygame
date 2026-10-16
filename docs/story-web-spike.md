# Spike: Interactive Story as a web project

Status: spike on `chore/story-web-spike`, not for merging. It answers whether
Interactive Story can drop the platform-hosted, sandboxed Runtime and become
"a Web Game with `graph.json`, a story runtime inside the project, and editor
tools injected into the preview", without losing the editor tools authors
need.

## What was built

- **Project shape.** A converted project gains `index.html` and the story
  runtime under `story/` (12 readable ES modules, about 2,500 lines with
  comments, taken from OhMyGame's own Runtime source). Scenes, `graph.json`,
  `shared/`, and assets stay as they are. The project is a static site: no
  build step and no npm dependencies.
- **Story runtime** (`src/story-web/runtime.ts`). Reads `graph.json`, mounts
  Scenes from their own files in a normal page, and keeps saves, slots,
  settings, and what was seen in `localStorage`. Query parameters: `scene`,
  `ohmygame-policy=report` (editor preview), `ohmygame-new-game`,
  `ohmygame-forget-seen`, `ohmygame-save=none`, and `ohmygamePlaytest=1`
  (game_use bridge).
- **Editor bridge** (`src/story-web/editor-bridge.ts`). Injected by the
  preview proxy into Interactive Story pages only, never written to the
  project or a published game. It speaks the Playable sandbox messages, so
  the Workbench needed no changes beyond a `page` mode in `NodePlayer`.
- **Preview proxy.** Annotates Scene HTML the page fetches with source
  locations for picking and text editing.
- **Static preview.** Now answers byte ranges; without them no video could
  seek. This also affects Web Game projects today.
- **Playtest and game_use** open the project's page through the preview.
- **Conversion** (`scripts/story-web-spike.mjs`): adds the files above,
  rewrites `import x from "./a.txt"` to a fetch and adds `with { type: "json" }`
  to JSON imports, and copies Library assets into the workspace.

## Results

### Step 1: editor tools (go)

| Tool | Result |
|---|---|
| Flow canvas | Unchanged; reads and writes `graph.json`. |
| Picking and text editing | Works. Edits in the preview are written to the Scene's HTML, Chinese text included. |
| Video timeline and Mark | Works after adding byte ranges: duration, play, pause, seek, Mark. A 42 MB, 30 s Library video seeks without delay. |
| Story map | The Workbench preview shows the whole map. |
| Exit reports and errors | "Would open …" and runtime errors (with Fix) show as before. |

### Step 2: interactive film and visual novel together (14/14)

One project: Title, two Visual Novel chapters, a film Scene with a sound
video, a Choice, an Ending, and a Story map, played in the Playtest window:
music started in chapter 1; Settings set it to 50%; after a reload Continue
returned to the saved line with the setting kept; the film ducked the music
and moved on when its video ended; chapter 2 kept the same track playing;
Play again stopped the music; the Story map showed every Scene seen; loading
slot 1 returned to its line; Title went back; no page errors. Media now
streams from files instead of being copied into the sandbox.

### Step 3: features without platform changes

Done by editing project files only (as the Agent would; the in-app Agent was
not run because the spike environment has no model configured):

- **Skip read lines only**: 23 lines in `shared/vn/player.js`, using
  `localStorage` directly. Under the current architecture this needs a new
  Runtime primitive.
- **Changing the engine**: one line in `story/shared/playable-audio.js`
  (ducking to 50%); it took effect.
- After both, picking, text editing, and the timeline still worked.
- A script exit to an undeclared Signal showed in the Workbench as a runtime
  error with Fix, as it does today. Neither architecture catches it before
  the Scene runs.

### Step 4: migrating a real project and publishing

A copy of "门一直都在" (12 Scenes, 11 Exits, 12 assets, one in the Library):

- Conversion took under a second; it rewrote 2 files and copied the Library
  video.
- All 12 Scenes mount with no runtime errors, page errors, or failed
  requests, and look as before.
- A play path Cover → Title → Visual Novel → Three Doors → Forgotten Things
  works; Continue returns to the saved Scene.
- Picking and editing the Chinese title, and the Library video's timeline,
  work in the editor.
- Published as a static zip of only what plays (`index.html`, `story/`,
  `graph.json`, `nodes/`, `shared/`, and the 12 referenced assets): 48 MB,
  92 files. Embedded cross-site in an iframe the way itch.io embeds HTML
  games, it plays, keeps its save across a reload, has no failed requests,
  and loads nothing of the editor.

## Findings to act on in either case

- **Byte ranges in the static preview**: needed for any video seeking,
  Web Game included. Worth its own PR.
- **The project's own `dev` script wins.** "门一直都在" carries a
  `package.json` with a `dev` script from its recovered release; the preview
  would run it instead of serving the page. Conversion has to remove or
  ignore it, or the preview has to prefer `index.html` for web stories.
- **Publishing must filter assets by `graph.json`.** The project's
  `assets/` holds 622 MB, of which 49 MB is referenced.
- **"Passing the cover" overwrites the save.** The cover's Exit to the Title
  is a story step, so walking through it saves at the Title. The same
  happens today; the cover's Exit should be a navigation Exit.
- **Visual Novel lines are not yet editable in place**; they need to point
  at `script.txt` lines. Same work in either architecture.

## Gaps in the spike

- Scene thumbnails on the canvas still render through the sandbox, so web
  stories show none. They need to capture the page instead.
- Picking and moving code (about 24 KB) ships with the runtime because it
  lives in the surface host; it is inert in a published game but should be
  split out.
- The Workbench preview reloads the page on every revision.
- New projects, Templates, and publishing are not switched to the web shape;
  only converted projects are.
- Runtime upgrades for projects: the runtime is project code, so fixes reach
  a project only by an upgrade step (as with the Visual Novel player), or by
  the Agent.
- The in-app Agent was not exercised.

## Cost comparison

| | A: keep the hosted Runtime | B: web story |
|---|---|---|
| New kinds of feature (storage, cross-Scene) | Each needs a Runtime change and a release | Project code, by the Agent |
| Editor tools | Work | Work, through the injected bridge |
| Guarantees (save format, sandbox) | Enforced | Kept by the runtime's own code and validation; the Agent can change them |
| Media | Copied into the sandbox as blobs | Streamed from files |
| Same pipeline as Web Game | No | Preview, Playtest, game_use, static publishing |
| OhMyGame code | As today | About 1,000–1,400 lines of sandbox, protocol, compiled player, and publish code can go; about 470 added |
| Migration | None | A conversion step per project, automated in this spike |

## Recommendation

Adopt B. Every editor tool that was required works, the four steps passed,
and the real project converted automatically. The costs are known and small:
thumbnails, a runtime upgrade path, and switching new projects and
publishing to the web shape.
