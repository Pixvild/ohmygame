/** A node positioned by its visible frame, which may be inset from `position`. */
export interface SelectionLayoutNode {
  id: string;
  position: { x: number; y: number };
  frame: { x: number; y: number; width: number; height: number };
}

export const CANVAS_ALIGN_EDGES = [
  "left",
  "center",
  "right",
  "top",
  "middle",
  "bottom",
] as const;
export type CanvasAlignEdge = (typeof CANVAS_ALIGN_EDGES)[number];
export const CANVAS_DISTRIBUTE_AXES = ["horizontal", "vertical"] as const;
export type CanvasDistributeAxis = (typeof CANVAS_DISTRIBUTE_AXES)[number];

interface SelectionBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
  centerX: number;
  centerY: number;
}

interface ScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface MeasurableSelectionNode {
  id: string;
  position: { x: number; y: number };
  width?: number;
  height?: number;
  measured?: { width?: number | null; height?: number | null };
}

/**
 * Aligns usable frames to the selection's bounding box. Fewer than two usable
 * frames leaves every node where it is. The other axis is unchanged.
 */
export function alignSelectionLayout(
  nodes: readonly SelectionLayoutNode[],
  edge: CanvasAlignEdge,
): SelectionLayoutNode[] {
  const group = nodes.filter(hasUsableFrame);
  if (group.length < 2) return [...nodes];
  const bounds = boundsOf(group);
  return nodes.map((node) => {
    if (!hasUsableFrame(node)) return node;
    const delta = alignDelta(node, bounds, edge);
    return moveNode(node, delta.x, delta.y);
  });
}

/**
 * Spaces usable frames with equal gaps along one axis. Fewer than three usable
 * frames leaves every node where it is. The outer edges stay put when the nodes
 * already have room between them; overlapping nodes are packed apart from the
 * start edge with no gap. The other axis is unchanged.
 */
export function distributeSelectionLayout(
  nodes: readonly SelectionLayoutNode[],
  axis: CanvasDistributeAxis,
): SelectionLayoutNode[] {
  const group = nodes.filter(hasUsableFrame);
  if (group.length < 3) return [...nodes];
  const horizontal = axis === "horizontal";
  const start = (node: SelectionLayoutNode) =>
    horizontal ? node.frame.x : node.frame.y;
  const size = (node: SelectionLayoutNode) =>
    horizontal ? node.frame.width : node.frame.height;
  const sorted = [...group].sort(
    (left, right) =>
      start(left) - start(right) || left.id.localeCompare(right.id),
  );
  const span = start(sorted.at(-1)!) + size(sorted.at(-1)!) - start(sorted[0]!);
  const total = sorted.reduce((sum, node) => sum + size(node), 0);
  const gap = Math.max(0, (span - total) / (sorted.length - 1));
  const deltas = new Map<string, number>();
  let cursor = start(sorted[0]!);
  for (const node of sorted) {
    deltas.set(node.id, cursor - start(node));
    cursor += size(node) + gap;
  }
  return nodes.map((node) => {
    const delta = deltas.get(node.id);
    if (delta === undefined) return node;
    return moveNode(node, horizontal ? delta : 0, horizontal ? 0 : delta);
  });
}

/** Flow-space frame from a measured node, preferring its visible alignment frame. */
export function selectionFrameFromMeasurements(
  position: { x: number; y: number },
  zoom: number,
  root: ScreenRect | undefined,
  frame: ScreenRect | undefined,
  fallback?: { width?: number; height?: number },
): SelectionLayoutNode["frame"] | undefined {
  const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const visual = positive(frame) ?? (root ? positive(root) : undefined);
  if (visual && root && positive(root)) {
    return {
      x: position.x + (visual.left - root.left) / scale,
      y: position.y + (visual.top - root.top) / scale,
      width: visual.width / scale,
      height: visual.height / scale,
    };
  }
  const width = finiteSize(fallback?.width);
  const height = finiteSize(fallback?.height);
  if (width === undefined || height === undefined) return undefined;
  return { x: position.x, y: position.y, width, height };
}

/** Reads selection frames from the canvas DOM, then from each node's stored size. */
export function measureSelectionLayoutNodes(
  nodes: readonly MeasurableSelectionNode[],
  root: ParentNode = document,
): SelectionLayoutNode[] {
  const zoom = readViewportZoom(root);
  return nodes.flatMap((node) => {
    const element = root.querySelector<HTMLElement>(
      `.react-flow__node[data-id="${cssEscape(node.id)}"]`,
    );
    const frameElement = element?.querySelector<HTMLElement>(
      "[data-alignment-frame]",
    );
    const frame = selectionFrameFromMeasurements(
      node.position,
      zoom,
      element ? screenRect(element) : undefined,
      frameElement ? screenRect(frameElement) : undefined,
      {
        width: finiteSize(node.width) ?? finiteSize(node.measured?.width),
        height: finiteSize(node.height) ?? finiteSize(node.measured?.height),
      },
    );
    return frame
      ? [
          {
            id: node.id,
            position: { x: node.position.x, y: node.position.y },
            frame,
          },
        ]
      : [];
  });
}

function alignDelta(
  node: SelectionLayoutNode,
  bounds: SelectionBounds,
  edge: CanvasAlignEdge,
): { x: number; y: number } {
  const { frame } = node;
  switch (edge) {
    case "left":
      return { x: bounds.left - frame.x, y: 0 };
    case "center":
      return { x: bounds.centerX - (frame.x + frame.width / 2), y: 0 };
    case "right":
      return { x: bounds.right - (frame.x + frame.width), y: 0 };
    case "top":
      return { x: 0, y: bounds.top - frame.y };
    case "middle":
      return { x: 0, y: bounds.centerY - (frame.y + frame.height / 2) };
    case "bottom":
      return { x: 0, y: bounds.bottom - (frame.y + frame.height) };
  }
}

function boundsOf(nodes: readonly SelectionLayoutNode[]): SelectionBounds {
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const node of nodes) {
    left = Math.min(left, node.frame.x);
    right = Math.max(right, node.frame.x + node.frame.width);
    top = Math.min(top, node.frame.y);
    bottom = Math.max(bottom, node.frame.y + node.frame.height);
  }
  return {
    left,
    right,
    top,
    bottom,
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2,
  };
}

function moveNode(
  node: SelectionLayoutNode,
  dx: number,
  dy: number,
): SelectionLayoutNode {
  if (dx === 0 && dy === 0) return node;
  return {
    id: node.id,
    position: { x: node.position.x + dx, y: node.position.y + dy },
    frame: {
      x: node.frame.x + dx,
      y: node.frame.y + dy,
      width: node.frame.width,
      height: node.frame.height,
    },
  };
}

function hasUsableFrame(node: SelectionLayoutNode): boolean {
  const { x, y, width, height } = node.frame;
  return (
    [x, y, width, height].every((value) => Number.isFinite(value)) &&
    width > 0 &&
    height > 0
  );
}

function positive(rect: ScreenRect | undefined): ScreenRect | undefined {
  if (
    !rect ||
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height) ||
    rect.width <= 0 ||
    rect.height <= 0
  )
    return undefined;
  return rect;
}

function finiteSize(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function screenRect(element: Element): ScreenRect | undefined {
  const rect = element.getBoundingClientRect();
  return positive({
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  });
}

function readViewportZoom(root: ParentNode): number {
  const viewport = root.querySelector?.(".react-flow__viewport");
  if (!(viewport instanceof HTMLElement)) return 1;
  const transform = getComputedStyle(viewport).transform;
  if (!transform || transform === "none") return 1;
  try {
    const zoom = new DOMMatrixReadOnly(transform).a;
    return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  } catch {
    return 1;
  }
}

function cssEscape(value: string): string {
  return typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(value)
    : value.replace(/["\\]/g, "\\$&");
}
