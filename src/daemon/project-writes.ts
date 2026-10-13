import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";

export class ProjectWriteError extends Error {
  readonly statusCode = 409;
  constructor(
    message: string,
    readonly code: "workspace_busy" | "workspace_stale",
  ) {
    super(message);
  }
}

/** HTTP writes already in flight drain before an exclusive workspace operation.
 * New requests are refused, rather than queued with stale editor content. */
export class ProjectWrites {
  #requests = new WeakMap<FastifyRequest, () => void>();
  track(request: FastifyRequest, release: () => void): void {
    this.#requests.set(request, release);
  }
  release(request: FastifyRequest): void {
    this.#requests.get(request)?.();
    this.#requests.delete(request);
  }
  install(app: FastifyInstance): void {
    const writes = this;
    // A disconnected client does not cancel its handler. Drain the actual
    // operation before restoring, rather than releasing on socket abort.
    app.addHook("onRoute", (route) => {
      const handler = route.handler;
      route.handler = async function (request, reply) {
        try {
          return await handler.call(this, request, reply);
        } finally {
          writes.release(request);
        }
      };
    });
    app.addHook("onResponse", async (request) => {
      writes.release(request);
    });
    app.addHook("onError", async (request) => {
      writes.release(request);
    });
  }
  #states = new Map<
    string,
    { version: string; active: number; locked: boolean; drained?: () => void }
  >();
  #state(id: string) {
    let state = this.#states.get(id);
    if (!state) {
      state = { version: "0", active: 0, locked: false };
      this.#states.set(id, state);
    }
    return state;
  }
  version(id: string): string {
    return this.#state(id).version;
  }
  initialize(id: string, version: string): void {
    this.#state(id).version = version;
  }
  changed(id: string): string {
    return (this.#state(id).version = randomUUID());
  }
  enter(id: string, version?: string): () => void {
    const state = this.#state(id);
    if (state.locked)
      throw new ProjectWriteError(
        "The workspace is being checkpointed or restored. Try again when it finishes.",
        "workspace_busy",
      );
    if (
      (version !== undefined && version !== state.version) ||
      (version === undefined && state.version !== "0")
    ) {
      throw new ProjectWriteError(
        "The workspace was restored. Reload it before saving changes.",
        "workspace_stale",
      );
    }
    state.active++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--state.active === 0) state.drained?.();
    };
  }
  async exclusive<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const state = this.#state(id);
    if (state.locked)
      throw new ProjectWriteError(
        "Another workspace operation is running.",
        "workspace_busy",
      );
    state.locked = true;
    try {
      if (state.active)
        await new Promise<void>((resolve) => {
          state.drained = resolve;
        });
      return await operation();
    } finally {
      state.drained = undefined;
      state.locked = false;
    }
  }
}
