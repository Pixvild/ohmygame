// @vitest-environment happy-dom
import { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useComposerContextMenu } from "../src/renderer/composer-context-menu.js";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let promptTop = 240;

function Composer({
  prompt,
  agent = false,
}: {
  prompt: string;
  agent?: boolean;
}) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const menu = useComposerContextMenu({
    prompt,
    cursor: prompt.length,
    textarea,
    disabled: false,
    capabilities: { plugins: [], skills: [] },
    planning: false,
    canTogglePlanning: true,
    onFiles: vi.fn(),
    onTogglePlanning: vi.fn(),
    onMention: vi.fn(),
    onChange: vi.fn(),
    onSelectionChange: vi.fn(),
  });
  return (
    <div className="desktop-window-content">
      <div className={agent ? "agent-body" : "home-content"}>
        <div className="prompt-box">
          <textarea ref={textarea} />
          {menu.button}
          {menu.overlay}
        </div>
      </div>
    </div>
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  promptTop = 240;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const top = this.classList.contains("prompt-box")
        ? promptTop
        : this.classList.contains("desktop-window-content")
          ? 32
          : this.classList.contains("agent-body")
            ? 80
            : 0;
      return {
        top,
        bottom: top + 100,
        left: 0,
        right: 800,
        width: 800,
        height: 100,
        x: 0,
        y: top,
        toJSON() {},
      };
    },
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("composer menu viewport boundaries", () => {
  it.each(["@", "/", ""])(
    "keeps the %s menu below the Windows title bar",
    async (prompt) => {
      await act(async () => root.render(<Composer prompt={prompt} />));
      if (!prompt)
        await act(async () =>
          host
            .querySelector<HTMLButtonElement>(".composer-attach-button")!
            .click(),
        );
      expect(
        host.querySelector<HTMLElement>("[role=listbox]")!.style.maxHeight,
      ).toBe("196px");
      promptTop = 150;
      await act(async () =>
        host.querySelector(".home-content")!.dispatchEvent(new Event("scroll")),
      );
      expect(
        host.querySelector<HTMLElement>("[role=listbox]")!.style.maxHeight,
      ).toBe("106px");
    },
  );

  it("also respects the agent pane boundary and a shorter viewport", async () => {
    await act(async () => root.render(<Composer prompt="/" agent />));
    expect(
      host.querySelector<HTMLElement>("[role=listbox]")!.style.maxHeight,
    ).toBe("148px");
    promptTop = 100;
    await act(async () => window.dispatchEvent(new Event("resize")));
    expect(
      host.querySelector<HTMLElement>("[role=listbox]")!.style.maxHeight,
    ).toBe("8px");
  });
});
