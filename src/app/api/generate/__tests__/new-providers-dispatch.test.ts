import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Route-wiring tests for the BytePlus / OpenAI / ElevenLabs dispatch branches in
 * /api/generate. The actual input/output mapping lives in (and is unit-tested by)
 * @zerospacestudios/providers/node-banana, so here we mock the per-provider modules and
 * assert that route.ts: reads the BYOK header/env, builds the GenerationInput,
 * dispatches to the right binding, and serializes the output with buildMediaResponse.
 */

const { mockByteplus, mockOpenai, mockElevenlabs } = vi.hoisted(() => ({
  mockByteplus: vi.fn(),
  mockOpenai: vi.fn(),
  mockElevenlabs: vi.fn(),
}));

vi.mock("../providers/byteplus", () => ({ generateWithByteplus: mockByteplus }));
vi.mock("../providers/openai", () => ({ generateWithOpenAI: mockOpenai }));
vi.mock("../providers/elevenlabs", () => ({ generateWithElevenLabs: mockElevenlabs }));

// route.ts also imports the gemini provider (and, transitively, image utils);
// stub them so importing the route doesn't pull real SDKs into the test.
vi.mock("@google/genai", () => ({ GoogleGenAI: class {} }));
vi.mock("@/lib/images", () => ({
  uploadImageForUrl: vi.fn(),
  shouldUseImageUrl: vi.fn().mockReturnValue(false),
  deleteImages: vi.fn(),
}));

import { POST } from "../route";

const originalEnv = { ...process.env };

function createMockPostRequest(body: unknown, headers?: Record<string, string>): NextRequest {
  return {
    json: vi.fn().mockResolvedValue(body),
    headers: new Headers(headers),
  } as unknown as NextRequest;
}

describe("/api/generate dispatch for byteplus/openai/elevenlabs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.BYTEPLUS_API_KEY;
    delete process.env.ARK_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ELEVENLABS_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("byteplus (video)", () => {
    it("dispatches to generateWithByteplus and returns a video", async () => {
      mockByteplus.mockResolvedValueOnce({
        success: true,
        outputs: [{ type: "video", data: "", url: "https://cdn.example.com/v.mp4" }],
      });
      const request = createMockPostRequest(
        {
          prompt: "a cat surfing",
          mediaType: "video",
          selectedModel: { provider: "byteplus", modelId: "seedance-1-5-pro-251215", displayName: "Seedance 1.5 Pro" },
        },
        { "X-BytePlus-API-Key": "bp-key" }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(mockByteplus).toHaveBeenCalledTimes(1);
      const [, key, genInput] = mockByteplus.mock.calls[0];
      expect(key).toBe("bp-key");
      expect(genInput.model.id).toBe("seedance-1-5-pro-251215");
      expect(genInput.model.provider).toBe("byteplus");
      expect(genInput.prompt).toBe("a cat surfing");
      expect(data.success).toBe(true);
      expect(data.contentType).toBe("video");
      expect(data.videoUrl).toBe("https://cdn.example.com/v.mp4");
    });

    it("accepts ARK_API_KEY as an env fallback", async () => {
      process.env.ARK_API_KEY = "ark-key";
      mockByteplus.mockResolvedValueOnce({
        success: true,
        outputs: [{ type: "video", data: "", url: "https://cdn.example.com/v.mp4" }],
      });
      const request = createMockPostRequest({
        prompt: "a dog",
        mediaType: "video",
        selectedModel: { provider: "byteplus", modelId: "seedance-1-5-pro-251215", displayName: "Seedance 1.5 Pro" },
      });

      await POST(request);

      expect(mockByteplus).toHaveBeenCalledTimes(1);
      expect(mockByteplus.mock.calls[0][1]).toBe("ark-key");
    });

    it("returns 401 when no key is configured", async () => {
      const request = createMockPostRequest({
        prompt: "a dog",
        mediaType: "video",
        selectedModel: { provider: "byteplus", modelId: "seedance-1-5-pro-251215", displayName: "Seedance 1.5 Pro" },
      });

      const response = await POST(request);

      expect(response.status).toBe(401);
      expect(mockByteplus).not.toHaveBeenCalled();
    });
  });

  describe("openai (image)", () => {
    it("dispatches to generateWithOpenAI and returns an image", async () => {
      mockOpenai.mockResolvedValueOnce({
        success: true,
        outputs: [{ type: "image", data: "data:image/png;base64,AAAA" }],
      });
      const request = createMockPostRequest(
        {
          prompt: "a watercolor fox",
          selectedModel: { provider: "openai", modelId: "gpt-image-1", displayName: "GPT Image 1" },
        },
        { "X-OpenAI-API-Key": "oai-key" }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(mockOpenai).toHaveBeenCalledTimes(1);
      expect(mockOpenai.mock.calls[0][1]).toBe("oai-key");
      expect(mockOpenai.mock.calls[0][2].model.id).toBe("gpt-image-1");
      expect(data.success).toBe(true);
      expect(data.contentType).toBe("image");
      expect(data.image).toBe("data:image/png;base64,AAAA");
    });

    it("returns 401 when no key is configured", async () => {
      const request = createMockPostRequest({
        prompt: "a fox",
        selectedModel: { provider: "openai", modelId: "gpt-image-1", displayName: "GPT Image 1" },
      });

      const response = await POST(request);

      expect(response.status).toBe(401);
      expect(mockOpenai).not.toHaveBeenCalled();
    });

    it("propagates a provider failure as a 500", async () => {
      mockOpenai.mockResolvedValueOnce({ success: false, error: "content policy violation" });
      const request = createMockPostRequest(
        { prompt: "x", selectedModel: { provider: "openai", modelId: "gpt-image-1", displayName: "GPT Image 1" } },
        { "X-OpenAI-API-Key": "oai-key" }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("content policy violation");
    });
  });

  describe("elevenlabs (audio)", () => {
    it("dispatches to generateWithElevenLabs and returns audio", async () => {
      mockElevenlabs.mockResolvedValueOnce({
        success: true,
        outputs: [{ type: "audio", data: "data:audio/mpeg;base64,BBBB" }],
      });
      const request = createMockPostRequest(
        {
          prompt: "hello world",
          mediaType: "audio",
          selectedModel: { provider: "elevenlabs", modelId: "eleven_multilingual_v2", displayName: "Eleven Multilingual v2" },
        },
        { "X-ElevenLabs-API-Key": "el-key" }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(mockElevenlabs).toHaveBeenCalledTimes(1);
      expect(mockElevenlabs.mock.calls[0][1]).toBe("el-key");
      expect(mockElevenlabs.mock.calls[0][2].model.id).toBe("eleven_multilingual_v2");
      expect(data.success).toBe(true);
      expect(data.contentType).toBe("audio");
      expect(data.audio).toBe("data:audio/mpeg;base64,BBBB");
    });

    it("returns 401 when no key is configured", async () => {
      const request = createMockPostRequest({
        prompt: "hi",
        mediaType: "audio",
        selectedModel: { provider: "elevenlabs", modelId: "music_v1", displayName: "ElevenLabs Music" },
      });

      const response = await POST(request);

      expect(response.status).toBe(401);
      expect(mockElevenlabs).not.toHaveBeenCalled();
    });
  });
});
