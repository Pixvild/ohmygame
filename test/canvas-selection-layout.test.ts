import { describe, expect, it } from "vitest";
import {
  alignSelectionLayout,
  distributeSelectionLayout,
  selectionFrameFromMeasurements,
  type SelectionLayoutNode,
} from "../src/renderer/canvas-selection-layout.js";

function node(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  position: { x: number; y: number } = { x, y },
): SelectionLayoutNode {
  return { id, position: { ...position }, frame: { x, y, width, height } };
}

describe("selection alignment", () => {
  const nodes = [node("a", 0, 10, 100, 40), node("b", 180, 0, 40, 80)];

  it("aligns edges to the selection bounds and leaves the other axis", () => {
    expect(
      alignSelectionLayout(nodes, "left").map((item) => [
        item.id,
        item.position.x,
        item.position.y,
      ]),
    ).toEqual([
      ["a", 0, 10],
      ["b", 0, 0],
    ]);
    expect(
      alignSelectionLayout(nodes, "right").map(
        (item) => item.frame.x + item.frame.width,
      ),
    ).toEqual([220, 220]);
    expect(
      alignSelectionLayout(nodes, "center").map(
        (item) => item.frame.x + item.frame.width / 2,
      ),
    ).toEqual([110, 110]);
    expect(
      alignSelectionLayout(nodes, "top").map((item) => [
        item.id,
        item.position.x,
        item.frame.y,
      ]),
    ).toEqual([
      ["a", 0, 0],
      ["b", 180, 0],
    ]);
    expect(
      alignSelectionLayout(nodes, "bottom").map(
        (item) => item.frame.y + item.frame.height,
      ),
    ).toEqual([80, 80]);
    expect(
      alignSelectionLayout(nodes, "middle").map(
        (item) => item.frame.y + item.frame.height / 2,
      ),
    ).toEqual([40, 40]);
  });

  it("moves a node by its frame inset", () => {
    const inset = [
      {
        id: "a",
        position: { x: 0, y: 0 },
        frame: { x: 20, y: 30, width: 100, height: 40 },
      },
      {
        id: "b",
        position: { x: 200, y: 8 },
        frame: { x: 210, y: 10, width: 80, height: 20 },
      },
    ];
    const aligned = alignSelectionLayout(inset, "top");
    expect(aligned.find((item) => item.id === "a")).toMatchObject({
      position: { x: 0, y: -20 },
      frame: { y: 10 },
    });
    expect(aligned.find((item) => item.id === "b")!.position).toEqual({
      x: 200,
      y: 8,
    });
    expect(inset[0]!.position).toEqual({ x: 0, y: 0 });
  });

  it("leaves fewer than two usable frames unchanged", () => {
    const single = [node("a", 5, 5, 10, 10)];
    expect(alignSelectionLayout(single, "right")).toEqual(single);
    const broken = [
      node("a", 0, 0, 10, 10),
      {
        id: "b",
        position: { x: 30, y: 0 },
        frame: { x: 30, y: 0, width: 0, height: 10 },
      },
    ];
    expect(alignSelectionLayout(broken, "left")).toEqual(broken);
  });
});

describe("selection distribution", () => {
  it("needs three usable frames", () => {
    const nodes = [node("a", 0, 0, 10, 10), node("b", 40, 0, 10, 10)];
    expect(distributeSelectionLayout(nodes, "horizontal")).toEqual(nodes);
    expect(
      distributeSelectionLayout(
        [
          ...nodes,
          {
            id: "c",
            position: { x: 80, y: 0 },
            frame: { x: 80, y: 0, width: 10, height: 0 },
          },
        ],
        "vertical",
      ),
    ).toEqual([
      ...nodes,
      {
        id: "c",
        position: { x: 80, y: 0 },
        frame: { x: 80, y: 0, width: 10, height: 0 },
      },
    ]);
  });

  it("equalizes gaps and keeps the outer edges", () => {
    const nodes = [
      node("a", 0, 4, 100, 10),
      node("b", 120, 8, 100, 10),
      node("c", 400, 1, 100, 10),
    ];
    const next = distributeSelectionLayout(nodes, "horizontal");
    expect(next.map((item) => item.frame.x)).toEqual([0, 200, 400]);
    expect(next.map((item) => item.position.y)).toEqual([4, 8, 1]);
  });

  it("packs overlapping nodes apart from the start edge", () => {
    const nodes = [
      node("a", 0, 0, 100, 20),
      node("b", 10, 3, 100, 20),
      node("c", 20, 6, 100, 20),
    ];
    expect(
      distributeSelectionLayout(nodes, "horizontal").map((item) => [
        item.frame.x,
        item.position.y,
      ]),
    ).toEqual([
      [0, 0],
      [100, 3],
      [200, 6],
    ]);
  });

  it("distributes vertical gaps without moving x", () => {
    const nodes = [
      node("a", 5, 0, 10, 40),
      node("b", 9, 50, 10, 20),
      node("c", 1, 200, 10, 30),
    ];
    const next = distributeSelectionLayout(nodes, "vertical");
    expect(next.map((item) => item.frame.y)).toEqual([0, 110, 200]);
    expect(next.map((item) => item.position.x)).toEqual([5, 9, 1]);
  });

  it("orders equal starts by id and keeps frame insets", () => {
    const nodes = [
      {
        id: "b",
        position: { x: 0, y: 5 },
        frame: { x: 10, y: 15, width: 20, height: 10 },
      },
      {
        id: "a",
        position: { x: 4, y: 9 },
        frame: { x: 10, y: 19, width: 30, height: 10 },
      },
      {
        id: "c",
        position: { x: 300, y: 1 },
        frame: { x: 310, y: 11, width: 40, height: 10 },
      },
    ];
    const next = distributeSelectionLayout(nodes, "horizontal");
    expect(
      next.map((item) => [item.id, item.frame.x, item.position.y]),
    ).toEqual([
      ["b", 165, 5],
      ["a", 10, 9],
      ["c", 310, 1],
    ]);
  });
});

describe("selection frame measurement", () => {
  it("uses the visible frame inset and the canvas zoom", () => {
    expect(
      selectionFrameFromMeasurements(
        { x: 100, y: 80 },
        2,
        { left: 10, top: 20, width: 200, height: 100 },
        { left: 30, top: 44, width: 100, height: 40 },
      ),
    ).toEqual({ x: 110, y: 92, width: 50, height: 20 });
  });

  it("falls back to the stored node size when the screen rect is empty", () => {
    expect(
      selectionFrameFromMeasurements(
        { x: 12, y: 18 },
        1,
        { left: 0, top: 0, width: 0, height: 0 },
        undefined,
        { width: 80, height: 40 },
      ),
    ).toEqual({
      x: 12,
      y: 18,
      width: 80,
      height: 40,
    });
    expect(
      selectionFrameFromMeasurements({ x: 0, y: 0 }, 1, undefined, undefined, {
        width: 0,
        height: 10,
      }),
    ).toBeUndefined();
  });
});
