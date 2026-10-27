import { observeWorkspaceVersion, workspaceVersion } from "./workspace-version.js";
import { useEffect, useRef, useState } from "react";
import { playableThumbnailHash } from "../shared/playable-editor.js";
import type { NodePlayerDefinition, PlayablePreviewOptions } from "../shared/playable-player-protocol.js";
import type { NodeRuntimeSnapshot } from "../shared/playable-runtime.js";
import { ensureProjectPreview, getNodeRuntime, playableSandboxUrl, setPlayableThumbnail } from "./api.js";
import { captureElementImage } from "./page-capture.js";
import { createMemoryStorage, NodePlayer } from "./playable-player.js";
import { loadPlayableAssets } from "./playable-assets.js";

/** How long a Node runs before its thumbnail is taken, so entrances settle. */
const NODE_THUMBNAIL_DELAY_MS = 1_000;
/** Sharp on a high-density card, and small enough to cache for every Node. */
const NODE_THUMBNAIL_WIDTH = 1_280;

/**
 * The page of the hidden window that takes a Node's thumbnail for the canvas:
 * it runs the Node as the Workbench preview does, captures it once it has run
 * for a moment without errors, stores the image, and reports back.
 */
export function NodeThumbnailPage({
  projectId,
  nodeId,
}: {
  projectId: string;
  nodeId: string;
}) {
  const [playable, setPlayable] = useState<{
    definition: NodePlayerDefinition;
    assets: Record<string, Blob>;
    /** A web story's own page, which plays instead of the sandbox. */
    page?: string;
    hash: string;
    version: string;
  }>();
  const [runningHash, setRunningHash] = useState<string>();
  const [storage] = useState(createMemoryStorage);
  const stage = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  const timer = useRef<number | undefined>(undefined);

  /** Reports the capture once: stored, or the reason it was not. */
  function finish(error?: string): void {
    if (done.current) return;
    done.current = true;
    window.clearTimeout(timer.current);
    void window.ohMyGameDesktop?.finishNodeThumbnail?.(error === undefined, error);
  }

  useEffect(() => {
    const shared = window.ohMyGameDesktop?.nodeThumbnailSnapshot;
    const runtime = shared
      ? shared().then((snapshot) => snapshot ? { ...snapshot, available: true as const } : getNodeRuntime(projectId))
      : getNodeRuntime(projectId);
    void runtime.then(async (result) => {
      const hash = result.available ? playableThumbnailHash(result.definition, nodeId) : undefined;
      if (!result.available || !hash) return finish("The Scene is not in the current build.");
      const version = "version" in result && typeof result.version === "string" ? result.version : workspaceVersion(projectId);
      // The shared snapshot skips the read that would teach this new window
      // the workspace version, and once a restore changed it, a write from
      // version "0" is refused as stale.
      observeWorkspaceVersion(projectId, version);
      if (result.web) {
        const { url } = await ensureProjectPreview(projectId);
        setPlayable({ definition: result.definition, assets: {}, page: url, hash, version });
        return;
      }
      // Report policy stays on this Scene, so other Scenes' media is unused.
      const graph = result.definition.graph;
      const node = graph.nodes.find((candidate) => candidate.id === nodeId)!;
      const assets = await loadPlayableAssets(projectId, {
        ...graph,
        assets: Object.fromEntries(node.assets.map((id) => [id, graph.assets[id]!])),
      });
      setPlayable({ definition: result.definition, assets, hash, version });
    }).catch((cause: unknown) => finish(errorMessage(cause)));
  }, [projectId, nodeId]);

  useEffect(() => {
    if (!runningHash) return;
    let cancelled = false;
    timer.current = window.setTimeout(() => {
      void waitForPaint()
        .then(async () => {
          if (cancelled || done.current) return;
          const frame = stage.current?.querySelector(".playable-player-frame");
          const status = stage.current?.querySelector(
            ".playable-player-status",
          );
          if (!frame || status) return finish(status?.textContent?.trim() || "The player did not show the Scene.");
          const image = await captureElementImage(frame, NODE_THUMBNAIL_WIDTH);
          if (cancelled || done.current) return finish("The capture was cancelled.");
          if (!image) return finish("The screenshot could not be taken.");
          await setPlayableThumbnail(projectId, nodeId, runningHash, image, playable?.version);
          finish();
        })
        .catch((cause: unknown) => finish(errorMessage(cause)));
    }, NODE_THUMBNAIL_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer.current);
      timer.current = undefined;
    };
  }, [projectId, nodeId, runningHash]);

  function onSnapshot(snapshot: NodeRuntimeSnapshot): void {
    if (done.current || !playable) return;
    if (snapshot.errors.length || snapshot.status === "failed")
      return finish(snapshot.errors[0]?.message ?? "The Scene failed to start.");
    if (snapshot.status !== "running" || snapshot.currentNodeId !== nodeId)
      return;
    setRunningHash(playable.hash);
  }

  // A capture runs unseen, so it plays no music.
  const preview: PlayablePreviewOptions = { policy: "report", startNodeId: nodeId, silent: true };
  return <div ref={stage} className="playable-thumbnail-page">
    {playable ? <NodePlayer
      definition={playable.definition}
      frameUrl={playableSandboxUrl()}
      assets={playable.assets}
      {...(playable.page ? { page: playable.page } : {})}
      saveKey={`ohmygame:playable:thumbnail:${projectId}`}
      storage={storage}
      preview={preview}
      onSnapshot={onSnapshot}
      onDiagnostic={ignoreDiagnostic}
    /> : null}
  </div>;
}

/** Diagnostics are the Workbench's to show; the capture only needs a clean run. */
function ignoreDiagnostic(): void {}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Lets React remove its loading cover and Chromium present the ready frame. */
function waitForPaint(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}
