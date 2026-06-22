import { describe, expect, it, vi } from "vitest";
import { fromEngineResult, type FromEngineResultOptions } from "../map-output";
import type { EngineAsset, EngineJob, EngineJobResult } from "../contract";

const BASE_URL = "http://127.0.0.1:4747";

function asset(partial: Partial<EngineAsset>): EngineAsset {
  return {
    id: "a1",
    assetType: "image",
    mimeType: "image/png",
    url: "/api/assets/a1/bytes",
    ...partial,
  };
}

function job(kind: EngineJob["kind"], result: Partial<EngineJobResult> | null): EngineJob {
  return {
    id: "job1",
    kind,
    status: "succeeded",
    runId: "run1",
    error: null,
    result: result === null ? null : { runId: "run1", assets: [], text: null, finishReason: null, ...result },
    eventsUrl: "/api/jobs/job1/events",
  };
}

/** A fetchAsset that records calls and returns canned bytes. */
function fakeFetcher(bytes: Uint8Array, contentType?: string): FromEngineResultOptions["fetchAsset"] {
  return vi.fn(async () => ({ bytes, ...(contentType ? { contentType } : {}) }));
}

describe("fromEngineResult", () => {
  it("maps a text job to a single text output, inline, with no fetch", async () => {
    const fetchAsset = fakeFetcher(new Uint8Array());
    const out = await fromEngineResult(job("text", { text: "Hello!" }), { baseUrl: BASE_URL, fetchAsset });
    expect(out).toEqual([{ type: "text", data: "Hello!" }]);
    expect(fetchAsset).not.toHaveBeenCalled();
  });

  it("treats a null text result as an empty string", async () => {
    const fetchAsset = fakeFetcher(new Uint8Array());
    const out = await fromEngineResult(job("text", { text: null }), { baseUrl: BASE_URL, fetchAsset });
    expect(out).toEqual([{ type: "text", data: "" }]);
  });

  it("fetches and inlines an image asset as a data URL (absolutizing the engine url)", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const fetchAsset = fakeFetcher(bytes, "image/webp");
    const out = await fromEngineResult(job("image", { assets: [asset({})] }), { baseUrl: BASE_URL, fetchAsset });
    expect(out).toEqual([
      {
        type: "image",
        data: `data:image/webp;base64,${Buffer.from(bytes).toString("base64")}`,
        url: `${BASE_URL}/api/assets/a1/bytes`,
      },
    ]);
    expect(fetchAsset).toHaveBeenCalledWith(`${BASE_URL}/api/assets/a1/bytes`);
  });

  it("falls back to the asset mimeType when the fetch reports no content type", async () => {
    const bytes = new Uint8Array([9]);
    const fetchAsset = fakeFetcher(bytes);
    const out = await fromEngineResult(
      job("image", { assets: [asset({ mimeType: "image/jpeg" })] }),
      { baseUrl: BASE_URL, fetchAsset },
    );
    expect(out[0]!.data).toBe(`data:image/jpeg;base64,${Buffer.from(bytes).toString("base64")}`);
  });

  it("keeps a video asset url-only without fetching", async () => {
    const fetchAsset = fakeFetcher(new Uint8Array());
    const out = await fromEngineResult(
      job("video", { assets: [asset({ assetType: "video", mimeType: "video/mp4", url: "/api/assets/v/bytes" })] }),
      { baseUrl: BASE_URL, fetchAsset },
    );
    expect(out).toEqual([{ type: "video", data: "", url: `${BASE_URL}/api/assets/v/bytes` }]);
    expect(fetchAsset).not.toHaveBeenCalled();
  });

  it("keeps an audio asset url-only", async () => {
    const fetchAsset = fakeFetcher(new Uint8Array());
    const out = await fromEngineResult(
      job("speech", { assets: [asset({ assetType: "audio", mimeType: "audio/mpeg", url: "/api/assets/s/bytes" })] }),
      { baseUrl: BASE_URL, fetchAsset },
    );
    expect(out).toEqual([{ type: "audio", data: "", url: `${BASE_URL}/api/assets/s/bytes` }]);
  });

  it("maps a model asset to a url-only 3d output", async () => {
    const fetchAsset = fakeFetcher(new Uint8Array());
    const out = await fromEngineResult(
      job("image", { assets: [asset({ assetType: "model3d", mimeType: "model/gltf-binary", url: "/api/assets/m/bytes" })] }),
      { baseUrl: BASE_URL, fetchAsset },
    );
    expect(out).toEqual([{ type: "3d", data: "", url: `${BASE_URL}/api/assets/m/bytes` }]);
  });

  it("maps multiple image assets together", async () => {
    const bytes = new Uint8Array([7]);
    const fetchAsset = fakeFetcher(bytes, "image/png");
    const out = await fromEngineResult(
      job("image", { assets: [asset({ id: "a1", url: "/api/assets/a1/bytes" }), asset({ id: "a2", url: "/api/assets/a2/bytes" })] }),
      { baseUrl: BASE_URL, fetchAsset },
    );
    expect(out).toHaveLength(2);
    expect(out.every((o) => o.type === "image" && o.data.startsWith("data:image/png;base64,"))).toBe(true);
    expect(fetchAsset).toHaveBeenCalledTimes(2);
  });

  it("throws when a succeeded job carries no result payload", async () => {
    const fetchAsset = fakeFetcher(new Uint8Array());
    await expect(fromEngineResult(job("image", null), { baseUrl: BASE_URL, fetchAsset })).rejects.toThrow(
      /without a result payload/i,
    );
  });
});
