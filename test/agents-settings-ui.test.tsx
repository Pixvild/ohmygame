// @vitest-environment happy-dom
import path from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AgentRuntimeStatus } from "../src/shared/agent-runtimes.js";
import type { AgentModelCatalog } from "../src/shared/contracts.js";

const agent = (
  id: AgentRuntimeStatus["id"],
  name: string,
  enabled: boolean,
): AgentRuntimeStatus => ({
  id,
  name,
  enabled,
  installed: true,
  version: "1.0.0",
  auth: { status: "signed-in", billing: "subscription" },
  isolateUserConfig: true,
  commandSandbox: "os",
  diagnostics: [],
});
let catalog: AgentModelCatalog;
const api = {
  listModels: vi.fn(async () => catalog),
  waitForRuntime: vi.fn(async () => {}),
  listAgentRuntimes: vi.fn(async () => [
    agent("claude-code-cli", "Claude Code", true),
    agent("codex-cli", "Codex", false),
  ]),
};
vi.doMock(path.resolve("src/renderer/api.ts"), async () => ({
  ...(await vi.importActual(path.resolve("src/renderer/api.ts"))),
  ...api,
}));
const { AgentsSettings } = await import("../src/renderer/agents-settings.js");

const gpt = {
  provider: "openai",
  providerName: "OpenAI",
  id: "gpt-5",
  name: "GPT-5",
  reasoningLevels: [],
};
const sonnet = {
  provider: "claude-code-cli",
  providerName: "Claude Code",
  id: "sonnet",
  name: "Sonnet",
  reasoningLevels: [],
};

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function render(
  onViewChange = vi.fn(),
  onOpenProviders = vi.fn(),
): Promise<void> {
  await act(async () =>
    root.render(
      <AgentsSettings
        view={{ page: "agents" }}
        onViewChange={onViewChange}
        onOpenProviders={onOpenProviders}
      />,
    ),
  );
}
const row = (name: string) =>
  [...host.querySelectorAll(".settings-provider-row")].find(
    (item) =>
      item.querySelector(".settings-provider-name > span")?.textContent ===
      name,
  );

it("lists OhMyGame's own agent with its default model above the coding agent CLIs", async () => {
  catalog = {
    models: [gpt, sonnet],
    defaultModel: { provider: "openai", id: "gpt-5" },
    defaultReasoningLevel: "medium",
  };
  const onOpenProviders = vi.fn();
  await render(vi.fn(), onOpenProviders);
  const names = [
    ...host.querySelectorAll(".settings-provider-name > span"),
  ].map((item) => item.textContent);
  expect(names).toEqual(["OhMyGame", "Claude Code", "Codex"]);
  expect(
    row("OhMyGame")!.querySelector(".settings-provider-details"),
  ).toBeNull();
  expect(row("OhMyGame")!.querySelector("small")?.textContent).toBe("Default");
  expect(
    row("Claude Code")!.querySelector(".settings-provider-name small"),
  ).toBeNull();
  await act(async () =>
    row("OhMyGame")!
      .querySelector<HTMLButtonElement>('button[aria-label="Manage models"]')!
      .click(),
  );
  expect(onOpenProviders).toHaveBeenCalled();
});

it("marks the CLI new conversations start with and opens its settings", async () => {
  catalog = {
    models: [gpt, sonnet],
    defaultModel: { provider: "claude-code-cli", id: "sonnet" },
    defaultReasoningLevel: "medium",
  };
  const onViewChange = vi.fn();
  await render(onViewChange);
  expect(row("OhMyGame")!.querySelector("small")).toBeNull();
  expect(
    row("Claude Code")!.querySelector(".settings-provider-name small")
      ?.textContent,
  ).toBe("Default");
  await act(async () =>
    row("Codex")!
      .querySelector<HTMLButtonElement>('button[aria-label="Manage Codex"]')!
      .click(),
  );
  expect(onViewChange).toHaveBeenCalledWith({ page: "agent", id: "codex-cli" });
});

it("waits for a CLI still listing its models before marking OhMyGame as the default", async () => {
  catalog = {
    models: [gpt],
    loadingRuntimes: ["claude-code-cli"],
    defaultReasoningLevel: "medium",
  };
  await render();
  expect(row("OhMyGame")!.querySelector("small")).toBeNull();
});

it("asks for a provider when OhMyGame has no models", async () => {
  catalog = { models: [sonnet], defaultReasoningLevel: "medium" };
  await render();
  expect(row("OhMyGame")!.textContent).toContain(
    "No models yet. Connect a provider in Providers & Models.",
  );
});
