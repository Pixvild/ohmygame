// @vitest-environment happy-dom
import path from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Node } from "@xyflow/react";
import type { EditorCanvas } from "../src/renderer/editor-canvas.js";
import type { CanvasBoardStorage } from "../src/renderer/canvas-board-storage.js";
import type { CanvasDocuments } from "../src/renderer/canvas-document-node.js";
import type {
  AssetCanvasDocument,
  ProjectState,
} from "../src/shared/contracts.js";
import { createAssetCanvasDocument } from "../src/shared/asset-canvas.js";

type CanvasProps = Parameters<typeof EditorCanvas<Node>>[0];
const captured = { props: undefined as CanvasProps | undefined };
vi.doMock(path.resolve("src/renderer/editor-canvas.tsx"), async (original) => ({
  ...(await original<typeof import("../src/renderer/editor-canvas.js")>()),
  EditorCanvas: (props: CanvasProps) => {
    captured.props = props;
    return (
      <div>
        {props.children}
        {props.nodes.map((node) => (
          <div
            key={node.id}
            className="react-flow__node"
            data-id={node.id}
            tabIndex={0}
          />
        ))}
      </div>
    );
  },
}));
vi.doMock(
  path.resolve("src/renderer/model-selector.tsx"),
  async (original) => ({
    ...(await original<typeof import("../src/renderer/model-selector.js")>()),
    useAgentModels: () => ({ models: [], status: "ready" }),
  }),
);
vi.doMock(path.resolve("src/renderer/api.ts"), async (original) => ({
  ...(await original<typeof import("../src/renderer/api.js")>()),
  listImageModelCatalog: async () => ({ models: [], providers: [] }),
  listVideoModelCatalog: async () => ({ models: [], providers: [] }),
  listAudioModelCatalog: async () => ({ models: [], providers: [] }),
  listModel3DCatalog: async () => ({ models: [], providers: [] }),
  listModel3DOperations: async () => [],
}));
vi.doMock(path.resolve("src/renderer/library-assets.ts"), async (original) => ({
  ...(await original<typeof import("../src/renderer/library-assets.js")>()),
  loadLibraryAssets: async () => [],
}));

const { CanvasBoardEditor } =
  await import("../src/renderer/asset-canvas-workspace.js");
const { CanvasTableStorage } =
  await import("../src/renderer/canvas-table-storage.js");

function board(): AssetCanvasDocument {
  const canvas = createAssetCanvasDocument();
  canvas.nodes = [
    {
      id: "a",
      type: "text",
      position: { x: 0, y: 10 },
      data: { text: "A", instruction: "" },
    },
    {
      id: "b",
      type: "text",
      position: { x: 180, y: 0 },
      data: { text: "B", instruction: "" },
    },
    {
      id: "c",
      type: "text",
      position: { x: 400, y: 40 },
      data: { text: "C", instruction: "" },
    },
  ];
  canvas.editorLayout.nodes = Object.fromEntries(
    canvas.nodes.map((node) => [node.id, node.position]),
  );
  return canvas;
}

const save = vi.fn(async (value: AssetCanvasDocument) => value);
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
async function mount() {
  captured.props = undefined;
  const storage: CanvasBoardStorage = {
    key: "p:b",
    boardId: "b",
    load: async () => structuredClone(board()),
    save,
    refresh: async () => undefined,
    reconcile: (_submitted, current) => current,
    resolveConflict: async (_version, value) => value,
    jobs: async () => [],
    generate: vi.fn(),
    cancel: vi.fn(),
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <CanvasBoardEditor
        project={{ id: "p", type: "asset-canvas" } as ProjectState}
        storage={storage}
        documents={{ documents: [] } as unknown as CanvasDocuments}
        tables={{
          storage: new CanvasTableStorage("p"),
          open: vi.fn(),
          add: vi.fn(),
        }}
        assets={[]}
      />,
    );
  });
  await settle();
  save.mockClear();
}
const settle = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(1_000);
  });
const flowNode = (id: string) =>
  captured.props!.nodes.find((node) => node.id === id)!;
async function change(
  changes: Parameters<NonNullable<CanvasProps["onNodesChange"]>>[0],
) {
  await act(async () => {
    captured.props!.onNodesChange!(changes);
  });
}
async function select(ids: string[]) {
  await change(ids.map((id) => ({ type: "select", id, selected: true })));
}
async function sizeNodes() {
  await change([
    { type: "dimensions", id: "a", dimensions: { width: 100, height: 40 } },
    { type: "dimensions", id: "b", dimensions: { width: 40, height: 80 } },
    { type: "dimensions", id: "c", dimensions: { width: 120, height: 60 } },
  ]);
}
function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find(
    (candidate) =>
      candidate.getAttribute("aria-label") === label ||
      candidate.textContent === label,
  );
  if (!found) throw new Error(`Missing ${label}`);
  return found as HTMLButtonElement;
}
async function click(label: string) {
  await act(async () => {
    button(label).click();
  });
}
function menuButton(label: string): HTMLButtonElement {
  const menu = document.querySelector("[role=menu]");
  const found = [...(menu?.querySelectorAll("button") ?? [])].find(
    (candidate) => candidate.textContent === label,
  );
  if (!found) throw new Error(`Missing menu ${label}`);
  return found as HTMLButtonElement;
}
async function openNodeMenu(id: string) {
  await act(async () => {
    captured.props!.onNodeContextMenu!(
      { preventDefault() {} } as never,
      flowNode(id),
    );
    captured.props!.onOpenMenu!({
      kind: "node",
      nodeId: id,
      screenPosition: { x: 20, y: 20 },
      flowPosition: { x: 20, y: 20 },
    });
  });
}
async function openPaneMenu() {
  await act(async () => {
    captured.props!.onOpenMenu!({
      kind: "pane",
      screenPosition: { x: 20, y: 20 },
      flowPosition: { x: 20, y: 20 },
    });
  });
}
async function undo() {
  const target = container.querySelector<HTMLElement>(".react-flow__node")!;
  await act(async () => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true }),
    );
  });
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  save.mockReset().mockImplementation(async (value) => value);
  await mount();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("canvas multi-select arrange", () => {
  it("aligns from the toolbar and keeps each action as its own undo step", async () => {
    await change([{ type: "position", id: "b", position: { x: 180, y: 50 } }]);
    await settle();
    await select(["a", "b", "c"]);
    await sizeNodes();
    expect(button("Distribute horizontally").disabled).toBe(false);
    await click("Align left");
    expect(flowNode("a").position).toEqual({ x: 0, y: 10 });
    expect(flowNode("b").position).toEqual({ x: 0, y: 50 });
    expect(flowNode("c").position).toEqual({ x: 0, y: 40 });
    await click("Align top");
    expect(flowNode("b").position).toEqual({ x: 0, y: 10 });
    expect(flowNode("c").position).toEqual({ x: 0, y: 10 });

    await undo();
    expect(flowNode("b").position).toEqual({ x: 0, y: 50 });
    expect(flowNode("c").position).toEqual({ x: 0, y: 40 });
    await undo();
    expect(flowNode("b").position).toEqual({ x: 180, y: 50 });
    expect(flowNode("c").position).toEqual({ x: 400, y: 40 });
    await undo();
    expect(flowNode("b").position).toEqual({ x: 180, y: 0 });
  });

  it("distributes three nodes and duplicates the selection as one undo step", async () => {
    await select(["a", "b"]);
    await sizeNodes();
    expect(button("Distribute horizontally").disabled).toBe(true);
    await select(["c"]);
    expect(button("Distribute vertically").disabled).toBe(false);
    await click("Distribute horizontally");
    expect(flowNode("a").position).toEqual({ x: 0, y: 10 });
    expect(flowNode("b").position).toEqual({ x: 230, y: 0 });
    expect(flowNode("c").position).toEqual({ x: 400, y: 40 });

    await click("Duplicate selection");
    expect(captured.props!.nodes).toHaveLength(6);
    await undo();
    expect(captured.props!.nodes.map((node) => node.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(flowNode("b").position).toEqual({ x: 230, y: 0 });
    await undo();
    expect(flowNode("b").position).toEqual({ x: 180, y: 0 });
  });

  it("offers arrange actions from the canvas menu and still focuses a right-clicked node", async () => {
    await select(["a", "b", "c"]);
    await sizeNodes();
    await openPaneMenu();
    expect(flowNode("a").selected).toBe(true);
    expect(flowNode("c").selected).toBe(true);
    expect(menuButton("Duplicate selection").textContent).toBe(
      "Duplicate selection",
    );
    await act(async () => {
      menuButton("Align right").click();
    });
    expect(flowNode("a").position.x).toBe(420);
    expect(flowNode("b").position.x).toBe(480);
    expect(flowNode("c").position.x).toBe(400);
    expect(flowNode("a").selected).toBe(true);
    expect(document.querySelector("[role=menu]")).toBeNull();

    await openNodeMenu("b");
    expect(flowNode("a").selected).toBe(false);
    expect(flowNode("b").selected).toBe(true);
    expect(
      [...document.querySelectorAll("button")].some(
        (item) => item.textContent === "Duplicate selection",
      ),
    ).toBe(false);
    expect(
      [...document.querySelectorAll("button")].some(
        (item) => item.textContent === "Duplicate",
      ),
    ).toBe(true);
  });
});
