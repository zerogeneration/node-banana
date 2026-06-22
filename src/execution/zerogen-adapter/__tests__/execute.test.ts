import { describe, expect, it, vi } from "vitest";
import type { GenerationInput } from "@/lib/providers/types";
import type { EngineAsset, EngineJob, EngineRequest, GenerationOutput } from "../contract";
import type { EngineClient } from "../engine-client";
import {
  createNodeBananaBindings,
  executeWithAnthropic,
  executeWithByteplus,
  executeWithElevenLabs,
  executeWithFal,
  executeWithGemini,
  executeWithOpenAI,
  executeWithProvider,
} from "../generate";

/**
 * Executor dispatch tests. Reshaped from the playground's `generateWith*` tests:
 * instead of mocking the in-process registry, we inject a fake {@link EngineClient}
 * and assert the executor (a) routes the capability, (b) POSTs the right engine
 * endpoint + body, and (c) maps the terminal job back to node-banana outputs —
 * including failing closed where the engine contract can't carry the request.
 */

// --- fakes ------------------------------------------------------------------

function imageAsset(): EngineAsset {
  return { id: "a1", assetType: "image", mimeType: "image/png", url: "/api/assets/a1/bytes" };
}
function videoAsset(): EngineAsset {
  return { id: "v1", assetType: "video", mimeType: "video/mp4", url: "/api/assets/v1/bytes" };
}
function audioAsset(): EngineAsset {
  return { id: "s1", assetType: "audio", mimeType: "audio/mpeg", url: "/api/assets/s1/bytes" };
}

/** A succeeded job whose result fits the request kind. */
function succeededJob(request: EngineRequest): EngineJob {
  const assetsByKind: Record<string, EngineAsset[]> = {
    image: [imageAsset()],
    video: [videoAsset()],
    speech: [audioAsset()],
    music: [audioAsset()],
    soundEffect: [audioAsset()],
    text: [],
  };
  return {
    id: "job1",
    kind: request.kind,
    status: "succeeded",
    runId: "run1",
    error: null,
    result: {
      runId: "run1",
      assets: assetsByKind[request.kind] ?? [],
      text: request.kind === "text" ? "generated text" : null,
      finishReason: request.kind === "text" ? "stop" : null,
    },
    eventsUrl: "/api/jobs/job1/events",
  };
}

interface FakeClient extends EngineClient {
  calls: EngineRequest[];
}

function fakeClient(makeJob: (req: EngineRequest) => EngineJob = succeededJob): FakeClient {
  const calls: EngineRequest[] = [];
  return {
    baseUrl: "http://engine",
    generate: vi.fn(async (request: EngineRequest) => {
      calls.push(request);
      return makeJob(request);
    }),
    fetchAsset: vi.fn(async () => ({ bytes: new Uint8Array([1, 2, 3]), contentType: "image/png" })),
    calls,
  };
}

function ctxWith(client: EngineClient) {
  return { client, target: { project: "p1" } };
}

/** Build a node-banana GenerationInput; capabilities accept node-banana's loose tag vocabulary. */
function mkInput(
  model: { id: string; provider?: string; capabilities?: string | string[] },
  rest: Partial<GenerationInput> = {},
): GenerationInput {
  const capabilities =
    model.capabilities === undefined
      ? []
      : Array.isArray(model.capabilities)
        ? model.capabilities
        : [model.capabilities];
  return {
    prompt: "a prompt",
    ...rest,
    model: {
      id: model.id,
      name: model.id,
      description: null,
      provider: model.provider ?? "openai",
      capabilities,
    },
  } as unknown as GenerationInput;
}

// --- tests ------------------------------------------------------------------

describe("executeWithOpenAI", () => {
  it("posts a text-to-image request and inlines the result image", async () => {
    const client = fakeClient();
    const out = await executeWithOpenAI(mkInput({ id: "gpt-image-2", provider: "openai" }, { prompt: "a cat" }), ctxWith(client));
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]!.endpoint).toBe("/api/generate/image");
    expect(client.calls[0]!.body).toMatchObject({ project: "p1", provider: "openai", model: "gpt-image-2", prompt: "a cat" });
    expect(out).toEqual({
      success: true,
      outputs: [
        {
          type: "image",
          data: `data:image/png;base64,${Buffer.from([1, 2, 3]).toString("base64")}`,
          url: "http://engine/api/assets/a1/bytes",
        },
      ],
    });
  });

  it("routes to /generate/text when the model declares a text capability", async () => {
    const client = fakeClient();
    const out = await executeWithOpenAI(mkInput({ id: "gpt-5.5", capabilities: "text" }), ctxWith(client));
    expect(client.calls[0]!.endpoint).toBe("/api/generate/text");
    expect(out).toEqual({ success: true, outputs: [{ type: "text", data: "generated text" }] });
  });

  it("fails closed (no engine call) when a text-to-image request carries reference images", async () => {
    const client = fakeClient();
    const out = await executeWithOpenAI(
      mkInput({ id: "gpt-image-2" }, { prompt: "x", images: ["data:image/png;base64,AAA"] }),
      ctxWith(client),
    );
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/\[openai\].*reference/i);
    expect(client.generate).not.toHaveBeenCalled();
  });

  it("fails closed for an unsupported modality (video)", async () => {
    const client = fakeClient();
    const out = await executeWithOpenAI(mkInput({ id: "m", capabilities: "text-to-video" }), ctxWith(client));
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/only text and image/i);
    expect(client.generate).not.toHaveBeenCalled();
  });
});

describe("executeWithByteplus", () => {
  it("routes to /generate/video by default (Seedance)", async () => {
    const client = fakeClient();
    const out = await executeWithByteplus(mkInput({ id: "seedance", provider: "byteplus" }, { prompt: "go" }), ctxWith(client));
    expect(client.calls[0]!.endpoint).toBe("/api/generate/video");
    expect(out.outputs).toEqual([{ type: "video", data: "", url: "http://engine/api/assets/v1/bytes" }]);
  });

  it("routes a Seedream text-to-image request to /generate/image", async () => {
    const client = fakeClient();
    const out = await executeWithByteplus(
      mkInput({ id: "seedream-5-0-lite", provider: "byteplus", capabilities: "text-to-image" }, { prompt: "a teapot" }),
      ctxWith(client),
    );
    expect(client.calls[0]!.endpoint).toBe("/api/generate/image");
    expect(out.outputs?.[0]?.type).toBe("image");
  });

  it("fails closed on a declared capability outside image/video (audio) instead of defaulting to video", async () => {
    const client = fakeClient();
    const out = await executeWithByteplus(
      mkInput({ id: "seedance", provider: "byteplus", capabilities: "text-to-audio" }, { prompt: "x" }),
      ctxWith(client),
    );
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/only image and video/i);
    expect(client.generate).not.toHaveBeenCalled();
  });

  it("fails closed on audio-to-video (engine /video has no source-audio input)", async () => {
    const client = fakeClient();
    const out = await executeWithByteplus(
      mkInput({ id: "seedance", provider: "byteplus", capabilities: "audio-to-video" }, { prompt: "x" }),
      ctxWith(client),
    );
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/audio-to-video/i);
    expect(client.generate).not.toHaveBeenCalled();
  });

  it("fails closed on Seedream image-to-image (engine /image has no images field)", async () => {
    const client = fakeClient();
    const out = await executeWithByteplus(
      mkInput({ id: "seedream-5-0-lite", provider: "byteplus", capabilities: "image-to-image" }, {
        prompt: "restyle",
        images: ["data:image/png;base64,AAA"],
      }),
      ctxWith(client),
    );
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/\[byteplus\].*image/i);
    expect(client.generate).not.toHaveBeenCalled();
  });
});

describe("executeWithFal", () => {
  it("fails closed on 3D models (no 3D port)", async () => {
    const client = fakeClient();
    const out = await executeWithFal(mkInput({ id: "fal-ai/triposr", provider: "fal", capabilities: "image-to-3d" }), ctxWith(client));
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/3D/i);
    expect(client.generate).not.toHaveBeenCalled();
  });

  it("fails closed on a declared audio capability instead of falling back to image", async () => {
    const client = fakeClient();
    const out = await executeWithFal(
      mkInput({ id: "fal-ai/some-tts", provider: "fal", capabilities: "text-to-audio" }, { prompt: "x" }),
      ctxWith(client),
    );
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/only image and video/i);
    expect(client.generate).not.toHaveBeenCalled();
  });

  it("fails closed on audio-to-video (engine /video has no source-audio input)", async () => {
    const client = fakeClient();
    const out = await executeWithFal(
      mkInput({ id: "fal-ai/some-a2v", provider: "fal", capabilities: "audio-to-video" }, {
        prompt: "x",
        parameters: { audio_url: "https://a/clip.mp3" },
      }),
      ctxWith(client),
    );
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/audio-to-video/i);
    expect(client.generate).not.toHaveBeenCalled();
  });

  it("forwards the canonical image outputFormat to the engine body (not buried in extra)", async () => {
    const client = fakeClient();
    await executeWithFal(
      mkInput({ id: "fal-ai/flux", provider: "fal" }, { prompt: "x", parameters: { output_format: "jpeg" } }),
      ctxWith(client),
    );
    expect(client.calls[0]!.endpoint).toBe("/api/generate/image");
    expect(client.calls[0]!.body).toMatchObject({ outputFormat: "jpeg" });
  });
});

describe("executeWithElevenLabs", () => {
  it("routes a music model id to /generate/music", async () => {
    const client = fakeClient();
    const out = await executeWithElevenLabs(
      mkInput({ id: "music_v1", provider: "elevenlabs", capabilities: "text-to-audio" }, { prompt: "lofi" }),
      ctxWith(client),
    );
    expect(client.calls[0]!.endpoint).toBe("/api/generate/music");
    expect(out.outputs?.[0]?.type).toBe("audio");
  });

  it("routes a speech model id to /generate/speech", async () => {
    const client = fakeClient();
    await executeWithElevenLabs(
      mkInput({ id: "eleven_multilingual_v2", provider: "elevenlabs", capabilities: "text-to-audio" }, { prompt: "hello" }),
      ctxWith(client),
    );
    expect(client.calls[0]!.endpoint).toBe("/api/generate/speech");
    expect(client.calls[0]!.body).toMatchObject({ text: "hello", provider: "elevenlabs" });
  });

  it("fails closed on a declared non-audio capability (video) instead of falling through to speech", async () => {
    const client = fakeClient();
    const out = await executeWithElevenLabs(
      mkInput({ id: "eleven_multilingual_v2", provider: "elevenlabs", capabilities: "text-to-video" }, { prompt: "x" }),
      ctxWith(client),
    );
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/only audio/i);
    expect(client.generate).not.toHaveBeenCalled();
  });
});

describe("text executors", () => {
  it("maps an Anthropic text generation end-to-end", async () => {
    const client = fakeClient();
    const out = await executeWithAnthropic(
      mkInput({ id: "claude-opus-4-8", provider: "anthropic" }, { prompt: "hi", parameters: { maxTokens: 100 } }),
      ctxWith(client),
    );
    expect(client.calls[0]!.endpoint).toBe("/api/generate/text");
    expect(client.calls[0]!.body).toMatchObject({ provider: "anthropic", model: "claude-opus-4-8", prompt: "hi", maxTokens: 100 });
    expect(out).toEqual({ success: true, outputs: [{ type: "text", data: "generated text" }] });
  });

  it("fails closed when Gemini declares a non-text capability", async () => {
    const client = fakeClient();
    const out = await executeWithGemini(mkInput({ id: "gemini-image", provider: "gemini", capabilities: "text-to-image" }), ctxWith(client));
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/only supports text/i);
    expect(client.generate).not.toHaveBeenCalled();
  });
});

describe("failure + dispatch", () => {
  it("returns a scrubbed failure envelope when the engine job fails", async () => {
    const client = fakeClient((req) => ({
      ...succeededJob(req),
      status: "failed",
      result: null,
      error: { name: "ProviderError", message: "content policy violation" },
    }));
    const out = await executeWithOpenAI(mkInput({ id: "gpt-image-2" }, { prompt: "x" }), ctxWith(client));
    expect(out).toEqual({ success: false, error: "[openai] content policy violation" });
  });

  it("dispatches by provider name and fails closed on unknown providers", async () => {
    const client = fakeClient();
    const ok = await executeWithProvider("byteplus", mkInput({ id: "seedance", provider: "byteplus" }, { prompt: "x" }), ctxWith(client));
    expect(ok.success).toBe(true);
    const bad = await executeWithProvider("nope", mkInput({ id: "m" }), ctxWith(client));
    expect(bad).toEqual({ success: false, error: "Unknown provider 'nope'." });
  });
});

describe("createNodeBananaBindings", () => {
  it("exposes drop-in generateWith* bindings that ignore the legacy requestId/apiKey args", async () => {
    const client = fakeClient();
    const bindings = createNodeBananaBindings(ctxWith(client));
    const out: GenerationOutput = await bindings.generateWithByteplus(
      "req-123",
      "ignored-byok-key",
      mkInput({ id: "seedance", provider: "byteplus" }, { prompt: "x" }),
    );
    expect(out.success).toBe(true);
    expect(client.calls[0]!.endpoint).toBe("/api/generate/video");
  });
});
