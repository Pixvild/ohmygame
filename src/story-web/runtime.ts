/**
 * The story runtime a web story project carries under `story/`. The
 * project's `index.html` loads it; it reads `graph.json`, plays the Scenes
 * from their own files, and keeps saves, slots, settings, and what the player
 * has seen in the browser's storage.
 *
 * The page understands a few query parameters: `scene` starts at a Scene
 * instead of the Start; `ohmygame-policy=report` previews a Scene for the
 * editor, reporting Exits instead of following them and saving nothing;
 * `ohmygame-new-game=1` forgets the saved game first, `ohmygame-forget-seen=1`
 * what the player has seen, and `ohmygame-save=none` keeps this session's
 * games and settings in memory only, `ohmygame-silent=1` plays no music or
 * sounds (for thumbnails); and `ohmygamePlaytest=1`
 * exposes `window.__OHMYGAME_PLAYTEST__` for game_use.
 *
 * Editor tools find the runtime as `window.__OHMYGAME_STORY__`.
 */
import {
  MemoryPlayablePreferencesStore,
  MemoryPlayableSaveStore,
  MemoryPlayableSeenStore,
  MemoryPlayableSlotStore,
  NodeRuntime,
  type PlayablePreferencesStore,
  type PlayableSaveStore,
  type PlayableSeenStore,
  type PlayableSlotStore,
} from "../shared/playable-runtime.js";
import { DocumentPlayableAudio } from "../shared/playable-audio.js";
import { DocumentPlayableSurfaceHost } from "../shared/playable-sandbox.js";
import type { CompiledNodeGraph } from "../shared/playable-compiled.js";
import type { JsonObject, NodeGraph } from "../shared/playable-nodes.js";

export interface StoryWebHandle {
  runtime: NodeRuntime;
  host: DocumentPlayableSurfaceHost;
  graph: NodeGraph;
}

declare global {
  interface Window {
    __OHMYGAME_STORY__?: StoryWebHandle;
    __OHMYGAME_PLAYTEST__?: { snapshot?: () => unknown; reset?: () => void };
  }
}

/** Events the page dispatches on `window` for editor tools. */
export const STORY_READY_EVENT = "ohmygame:story-ready";
export const STORY_CHANGE_EVENT = "ohmygame:story-change";
export const STORY_ERROR_EVENT = "ohmygame:story-error";

void start().catch((cause: unknown) => {
  console.error(cause);
  window.dispatchEvent(new CustomEvent(STORY_ERROR_EVENT, { detail: { fatal: true, message: errorMessage(cause) } }));
  document.body.textContent = errorMessage(cause);
});

async function start(): Promise<void> {
  const base = new URL("./", document.baseURI);
  const params = new URLSearchParams(location.search);
  const graphText = await (await fetch(new URL("graph.json", base))).text();
  const graph = JSON.parse(graphText) as NodeGraph;
  const preview = params.get("ohmygame-policy") === "report";
  // A preview, or a Playtest from a chosen Scene, saves nothing, so it never touches the player's games.
  const transient = preview || params.get("ohmygame-save") === "none";
  const scene = params.get("scene") ?? undefined;

  // Each Scene plays from its own files; the page loads them as they are.
  const compiled: CompiledNodeGraph = {
    version: 1,
    nodes: Object.fromEntries(graph.nodes.map((node) => [node.id, {
      id: node.id,
      html: node.source.html,
      css: node.source.css,
      javascript: node.source.javascript,
      inputs: [],
    }])),
  };
  const assetUrls = Object.fromEntries(Object.entries(graph.assets)
    .filter(([, asset]) => asset.source.kind === "workspace")
    .map(([id, asset]) => [id, new URL((asset.source as { path: string }).path, base).href]));

  const key = `ohmygame:story:${base.pathname}`;
  if (params.get("ohmygame-new-game") === "1") localStorage.removeItem(key);
  if (params.get("ohmygame-forget-seen") === "1") localStorage.removeItem(`${key}:seen`);
  const audio = params.get("ohmygame-silent") === "1" ? undefined : new DocumentPlayableAudio(document);
  const host = new DocumentPlayableSurfaceHost(document, undefined, audio && ((root) => audio.watchNode(root)), { base });
  fitStage(graph.viewport);
  const runtime = new NodeRuntime({
    graph,
    compiled,
    graphSignature: await signature(graphText),
    surfaceHost: host,
    saveStore: transient ? new MemoryPlayableSaveStore() : stored<PlayableSaveStore>(key),
    slotStore: transient ? new MemoryPlayableSlotStore() : stored<PlayableSlotStore>(`${key}:slots`),
    seenStore: transient ? new MemoryPlayableSeenStore() : stored<PlayableSeenStore>(`${key}:seen`),
    preferencesStore: transient ? new MemoryPlayablePreferencesStore() : stored<PlayablePreferencesStore>(`${key}:preferences`),
    ...(audio ? { audio } : {}),
    assetUrls,
    ...(preview ? { policy: "report" as const } : {}),
    ...(scene ? { startNodeId: scene } : {}),
    onChange: () => window.dispatchEvent(new Event(STORY_CHANGE_EVENT)),
    onError: (error) => window.dispatchEvent(new CustomEvent(STORY_ERROR_EVENT, { detail: { message: errorMessage(error) } })),
  });
  window.__OHMYGAME_STORY__ = { runtime, host, graph };
  if (params.get("ohmygamePlaytest") === "1") {
    window.__OHMYGAME_PLAYTEST__ = {
      snapshot: () => runtime.snapshot(),
      reset: () => {
        localStorage.removeItem(key);
        location.reload();
      },
    };
  }
  // Errors thrown from Scene event handlers never pass through a Runtime call.
  window.addEventListener("error", (event) => runtime.recordError(event.error ?? event.message));
  window.addEventListener("unhandledrejection", (event) => runtime.recordError(event.reason));
  window.dispatchEvent(new Event(STORY_READY_EVENT));
  await runtime.start();
}

/** A store kept in localStorage under one key; one that cannot be read starts over. */
function stored<T>(key: string): T {
  return {
    load: async () => {
      try {
        const value = localStorage.getItem(key);
        return value === null ? undefined : JSON.parse(value) as unknown;
      } catch {
        return undefined;
      }
    },
    save: async (value: unknown) => {
      localStorage.setItem(key, JSON.stringify(value as JsonObject));
    },
  } as T;
}

/** The stage keeps the project's viewport and scales to fit the window, as the player does. */
function fitStage(viewport: { width: number; height: number }): void {
  const stage = document.querySelector<HTMLElement>("[data-playable-sandbox]")!;
  document.body.style.background = "#000";
  Object.assign(stage.style, {
    position: "absolute",
    left: "50%",
    top: "50%",
    width: `${viewport.width}px`,
    height: `${viewport.height}px`,
    transformOrigin: "center",
  });
  const fit = () => {
    const scale = Math.min(innerWidth / viewport.width, innerHeight / viewport.height);
    stage.style.transform = `translate(-50%, -50%) scale(${scale})`;
  };
  fit();
  addEventListener("resize", fit);
}

async function signature(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
