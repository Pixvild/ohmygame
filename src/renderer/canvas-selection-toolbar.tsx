import type { ReactNode } from "react";
import { Copy } from "./icons.js";
import { t } from "./i18n.js";
import {
  CANVAS_ALIGN_EDGES,
  CANVAS_DISTRIBUTE_AXES,
  type CanvasAlignEdge,
  type CanvasDistributeAxis,
} from "./canvas-selection-layout.js";

const ALIGN_LABELS = {
  left: "editorCanvas.alignLeft",
  center: "editorCanvas.alignCenter",
  right: "editorCanvas.alignRight",
  top: "editorCanvas.alignTop",
  middle: "editorCanvas.alignMiddle",
  bottom: "editorCanvas.alignBottom",
} as const;

const DISTRIBUTE_LABELS = {
  horizontal: "editorCanvas.distributeHorizontal",
  vertical: "editorCanvas.distributeVertical",
} as const;

/** Icon buttons for the multi-selection floating toolbar. */
export function CanvasSelectionToolbar({
  count,
  onAlign,
  onDistribute,
  onDuplicate,
}: {
  count: number;
  onAlign: (edge: CanvasAlignEdge) => void;
  onDistribute: (axis: CanvasDistributeAxis) => void;
  onDuplicate: () => void;
}) {
  return (
    <div
      className="story-canvas-selection-toolbar"
      role="toolbar"
      aria-label={t("editorCanvas.selection")}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {CANVAS_ALIGN_EDGES.map((edge) => (
        <button
          key={edge}
          type="button"
          title={t(ALIGN_LABELS[edge])}
          aria-label={t(ALIGN_LABELS[edge])}
          onClick={() => onAlign(edge)}
        >
          <ArrangeIcon kind={edge} />
        </button>
      ))}
      <span
        className="story-canvas-selection-toolbar-separator"
        role="separator"
      />
      {CANVAS_DISTRIBUTE_AXES.map((axis) => (
        <button
          key={axis}
          type="button"
          title={t(DISTRIBUTE_LABELS[axis])}
          aria-label={t(DISTRIBUTE_LABELS[axis])}
          disabled={count < 3}
          onClick={() => onDistribute(axis)}
        >
          <ArrangeIcon kind={axis} />
        </button>
      ))}
      <span
        className="story-canvas-selection-toolbar-separator"
        role="separator"
      />
      <button
        type="button"
        title={t("editorCanvas.duplicateSelection")}
        aria-label={t("editorCanvas.duplicateSelection")}
        onClick={onDuplicate}
      >
        <Copy size={16} />
      </button>
    </div>
  );
}

/** The same actions in the canvas context menu. The caller closes the menu. */
export function SelectionArrangeMenuItems({
  count,
  onAlign,
  onDistribute,
  onDuplicate,
}: {
  count: number;
  onAlign: (edge: CanvasAlignEdge) => void;
  onDistribute: (axis: CanvasDistributeAxis) => void;
  onDuplicate: () => void;
}) {
  return (
    <>
      <span className="story-canvas-context-menu-label">
        {t("editorCanvas.selection")}
      </span>
      {CANVAS_ALIGN_EDGES.map((edge) => (
        <MenuButton
          key={edge}
          icon={<ArrangeIcon kind={edge} size={15} />}
          label={t(ALIGN_LABELS[edge])}
          onClick={() => onAlign(edge)}
        />
      ))}
      {CANVAS_DISTRIBUTE_AXES.map((axis) => (
        <MenuButton
          key={axis}
          icon={<ArrangeIcon kind={axis} size={15} />}
          label={t(DISTRIBUTE_LABELS[axis])}
          disabled={count < 3}
          onClick={() => onDistribute(axis)}
        />
      ))}
      <MenuButton
        icon={<Copy size={15} />}
        label={t("editorCanvas.duplicateSelection")}
        onClick={onDuplicate}
      />
    </>
  );
}

function MenuButton({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function ArrangeIcon({
  kind,
  size = 16,
}: {
  kind: CanvasAlignEdge | CanvasDistributeAxis;
  size?: number;
}) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
  };
  if (kind === "horizontal" || kind === "vertical") {
    const bars =
      kind === "horizontal"
        ? [
            { x: 4, y: 7, width: 3.5, height: 10 },
            { x: 10.25, y: 7, width: 3.5, height: 10 },
            { x: 16.5, y: 7, width: 3.5, height: 10 },
          ]
        : [
            { x: 7, y: 4, width: 10, height: 3.5 },
            { x: 7, y: 10.25, width: 10, height: 3.5 },
            { x: 7, y: 16.5, width: 10, height: 3.5 },
          ];
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        {bars.map((bar) => (
          <rect
            key={`${bar.x}:${bar.y}`}
            {...bar}
            rx="0.6"
            fill="currentColor"
          />
        ))}
      </svg>
    );
  }
  const lines =
    kind === "left"
      ? ["M5 7h8", "M5 12h14", "M5 17h10"]
      : kind === "center"
        ? ["M8 7h8", "M5 12h14", "M7 17h10"]
        : kind === "right"
          ? ["M11 7h8", "M5 12h14", "M9 17h10"]
          : kind === "top"
            ? ["M7 5v8", "M12 5v14", "M17 5v10"]
            : kind === "middle"
              ? ["M7 8v8", "M12 5v14", "M17 7v10"]
              : ["M7 11v8", "M12 5v14", "M17 9v10"];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {lines.map((d) => (
        <path key={d} d={d} {...common} />
      ))}
    </svg>
  );
}
