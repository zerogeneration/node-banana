import { describe, expect, it, vi } from "vitest";
import { createEngineClient, EngineError } from "../engine-client";
import type { EngineJob, EngineRequest } from "../contract";

/** Minimal Response-like for a fake fetch (the client only touches these members). */
function mkResponse(opts: {
  status?: number;
  json?: unknown;
  bytes?: Uint8Array;
  contentType?: string;
  statusText?: string;
}): Response {
  const status = opts.status ?? 200;
  return {
    status,
    ok: status >= 200 && status < 300,
    statusText: opts.statusText ?? "",
    headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? opts.contentType ?? null : null) },
    json: async () => opts.json,
    arrayBuffer: async () => (opts.bytes ?? new Uint8Array()).buffer,
  } as unknown as Response;
}

const imageReq: EngineRequest = {
  kind: "image",
  endpoint: "/api/generate/image",
  body: { project: "p1", provider: "openai", model: "gpt-image-2", prompt: "a cat" },
};

function job(status: EngineJob["status"]): EngineJob {
  const terminal = status === "succeeded" || status === "failed" || status === "cancelled";
  return {
    id: "j1",
    kind: "image",
    projectId: "p1",
    workflowId: "w1",
    status,
    runId: status === "queued" ? null : "run1",
    createdAt: "2026-01-01T00:00:00.000Z",
    startedAt: status === "queued" ? null : "2026-01-01T00:00:01.000Z",
    completedAt: terminal ? "2026-01-01T00:00:02.000Z" : null,
    error: status === "failed" ? { name: "E", message: "boom" } : null,
    result:
      status === "succeeded"
        ? { runId: "run1", chunkId: null, assets: [], usage: null, text: null, finishReason: null }
        : null,
    eventsUrl: "/api/jobs/j1/events",
  };
}

describe("createEngineClient.generate", () => {
  it("submits (202), polls the job, and resolves once it succeeds", async () => {
    const responses = [
      mkResponse({ status: 202, json: job("queued") }), // POST submit
      mkResponse({ json: job("running") }), // GET poll #1
      mkResponse({ json: job("succeeded") }), // GET poll #2
    ];
    const fetch = vi.fn(async (_input: string, _init?: RequestInit) => responses.shift()!);
    const client = createEngineClient({ baseUrl: "http://engine/", fetch: fetch as unknown as typeof globalThis.fetch, pollIntervalMs: 0 });

    const settled = await client.generate(imageReq);
    expect(settled.status).toBe("succeeded");
    expect(fetch).toHaveBeenCalledTimes(3);
    // POST to the engine base URL + endpoint, with the JSON body.
    expect(fetch.mock.calls[0]![0]).toBe("http://engine/api/generate/image");
    expect(fetch.mock.calls[0]![1]).toMatchObject({ method: "POST" });
    // Polls the job endpoint.
    expect(fetch.mock.calls[1]![0]).toBe("http://engine/api/jobs/j1");
  });

  it("resolves immediately when the submit returns an already-terminal job", async () => {
    const fetch = vi.fn(async () => mkResponse({ status: 202, json: job("succeeded") }));
    const client = createEngineClient({ baseUrl: "http://engine", fetch: fetch as unknown as typeof globalThis.fetch, pollIntervalMs: 0 });
    const settled = await client.generate(imageReq);
    expect(settled.status).toBe("succeeded");
    expect(fetch).toHaveBeenCalledTimes(1); // no poll
  });

  it("throws an EngineError with the engine's error message on a non-202 submit", async () => {
    const fetch = vi.fn(async () => mkResponse({ status: 400, json: { error: "prompt: too short" } }));
    const client = createEngineClient({ baseUrl: "http://engine", fetch: fetch as unknown as typeof globalThis.fetch });
    await expect(client.generate(imageReq)).rejects.toThrowError(EngineError);
    await expect(client.generate(imageReq)).rejects.toThrow(/too short/);
  });

  it("gives up with a clear error once the job timeout elapses", async () => {
    const fetch = vi.fn(async (input: string) =>
      input.includes("/api/jobs/") ? mkResponse({ json: job("running") }) : mkResponse({ status: 202, json: job("queued") }),
    );
    const client = createEngineClient({ baseUrl: "http://engine", fetch: fetch as unknown as typeof globalThis.fetch, pollIntervalMs: 0, jobTimeoutMs: 0 });
    await expect(client.generate(imageReq)).rejects.toThrow(/did not settle/i);
  });
});

describe("createEngineClient.fetchAsset", () => {
  it("returns the asset bytes and content type", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const fetch = vi.fn(async () => mkResponse({ bytes, contentType: "image/webp" }));
    const client = createEngineClient({ baseUrl: "http://engine", fetch: fetch as unknown as typeof globalThis.fetch });
    const result = await client.fetchAsset("http://engine/api/assets/a1/bytes");
    expect(Array.from(result.bytes)).toEqual([1, 2, 3]);
    expect(result.contentType).toBe("image/webp");
  });

  it("throws an EngineError when the asset fetch fails", async () => {
    const fetch = vi.fn(async () => mkResponse({ status: 404, json: { error: "no asset" } }));
    const client = createEngineClient({ baseUrl: "http://engine", fetch: fetch as unknown as typeof globalThis.fetch });
    await expect(client.fetchAsset("http://engine/api/assets/x/bytes")).rejects.toThrow(/no asset/);
  });
});
