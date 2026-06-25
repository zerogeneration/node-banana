import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// Use vi.hoisted to define mocks that work with hoisted vi.mock
const { mockGetCachedModels, mockSetCachedModels, mockGetCacheKey, mockIsEngineReachable } = vi.hoisted(() => ({
  mockGetCachedModels: vi.fn().mockReturnValue(null), // Default to cache miss
  mockSetCachedModels: vi.fn(),
  mockGetCacheKey: vi.fn((provider: string, search?: string) =>
    search ? `${provider}:search:${search}` : `${provider}:models`
  ),
  mockIsEngineReachable: vi.fn().mockResolvedValue(true), // Default: engine up
}));

vi.mock("@/lib/providers/cache", () => ({
  getCachedModels: mockGetCachedModels,
  setCachedModels: mockSetCachedModels,
  getCacheKey: mockGetCacheKey,
}));

vi.mock("@/lib/engine", () => ({
  isEngineReachable: mockIsEngineReachable,
  engineBaseUrl: () => "http://127.0.0.1:4747",
  engineAuthToken: () => undefined,
  resetEngineReachabilityCache: vi.fn(),
}));

import { GET } from "../route";

// Store original env and fetch
const originalEnv = { ...process.env };
const originalFetch = global.fetch;

// Mock fetch for provider API calls
const mockFetch = vi.fn();

// Helper to create mock NextRequest for GET
function createMockGetRequest(
  params: Record<string, string> = {},
  headers?: Record<string, string>
): NextRequest {
  const url = new URL("http://localhost:3000/api/models");
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  return {
    nextUrl: url,
    headers: new Headers(headers),
  } as unknown as NextRequest;
}

// Helper to create Replicate API response
function createReplicateResponse(models: Array<{ owner: string; name: string; description: string | null }>, next: string | null = null) {
  return {
    ok: true,
    json: () => Promise.resolve({
      results: models.map(m => ({
        owner: m.owner,
        name: m.name,
        description: m.description,
        visibility: "public",
        run_count: 1000,
      })),
      next,
      previous: null,
    }),
  };
}

// Helper to create fal.ai API response
function createFalResponse(models: Array<{ id: string; name: string; category: string; description?: string }>, hasMore = false, cursor: string | null = null) {
  return {
    ok: true,
    json: () => Promise.resolve({
      models: models.map(m => ({
        endpoint_id: m.id,
        metadata: {
          display_name: m.name,
          category: m.category,
          description: m.description || "",
          status: "active",
          tags: [],
          updated_at: "2024-01-01",
          is_favorited: null,
          thumbnail_url: "",
          model_url: "",
          date: "2024-01-01",
          highlighted: false,
          pinned: false,
        },
      })),
      has_more: hasMore,
      next_cursor: cursor,
    }),
  };
}

describe("/api/models route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset fetch mock fully (clears mockResolvedValueOnce queue to prevent leaks)
    mockFetch.mockReset();
    // Reset env to original
    process.env = { ...originalEnv };
    // Clear API keys
    delete process.env.REPLICATE_API_KEY;
    delete process.env.FAL_API_KEY;
    // Set up mock fetch
    global.fetch = mockFetch;
    // Reset cache mock to default (miss)
    mockGetCachedModels.mockReturnValue(null);
    // Default: the zerogen engine is reachable (engine-backed providers available).
    mockIsEngineReachable.mockResolvedValue(true);
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  describe("basic functionality", () => {
    it("GET: should return models from fal.ai when no Replicate key", async () => {
      process.env.FAL_API_KEY = "test-fal-key";
      mockFetch.mockResolvedValueOnce(
        createFalResponse([
          { id: "fal-ai/flux", name: "Flux", category: "text-to-image" },
          { id: "fal-ai/flux-pro", name: "Flux Pro", category: "text-to-image" },
        ])
      );

      const request = createMockGetRequest();
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.providers.fal.success).toBe(true);
      expect(data.providers.fal.count).toBe(2);
      expect(data.providers.gemini.success).toBe(true);
      expect(data.providers.gemini.count).toBe(7);
      // Engine-backed providers are always available (no BYOK key needed).
      expect(data.providers.openai.success).toBe(true);
      expect(data.providers.byteplus.success).toBe(true);
      expect(data.providers.elevenlabs.success).toBe(true);
      // Total = fal + gemini + the engine-backed (openai/byteplus/elevenlabs) lists.
      const total =
        data.providers.fal.count +
        data.providers.gemini.count +
        data.providers.openai.count +
        data.providers.byteplus.count +
        data.providers.elevenlabs.count;
      expect(data.models).toHaveLength(total);
    });

    it("GET: should return models from both providers when both keys present", async () => {
      process.env.REPLICATE_API_KEY = "test-replicate-key";
      process.env.FAL_API_KEY = "test-fal-key";

      // Replicate response
      mockFetch.mockResolvedValueOnce(
        createReplicateResponse([
          { owner: "stability-ai", name: "sdxl", description: "SDXL model" },
        ])
      );

      // fal.ai response
      mockFetch.mockResolvedValueOnce(
        createFalResponse([
          { id: "fal-ai/flux", name: "Flux", category: "text-to-image" },
        ])
      );

      const request = createMockGetRequest();
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.providers.replicate.success).toBe(true);
      expect(data.providers.fal.success).toBe(true);
      expect(data.providers.gemini.success).toBe(true);
      // Engine-backed providers are always included alongside the key-gated ones.
      expect(data.providers.openai.success).toBe(true);
      expect(data.providers.byteplus.success).toBe(true);
      expect(data.providers.elevenlabs.success).toBe(true);
    });

    it("GET: surfaces engine-backed providers (openai/byteplus/elevenlabs) without a BYOK key when the engine is up", async () => {
      // No OPENAI/BYTEPLUS/ELEVENLABS keys set: these run through the zerogen engine,
      // so a provider filter must NOT 400 and must return their (hardcoded) models.
      for (const provider of ["openai", "byteplus", "elevenlabs"]) {
        const response = await GET(createMockGetRequest({ provider }));
        const data = await response.json();
        expect(response.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.models.length).toBeGreaterThan(0);
        expect(data.models.every((m: { provider: string }) => m.provider === provider)).toBe(true);
      }
    });

    it("GET: hides engine-backed providers when the engine is unreachable", async () => {
      mockIsEngineReachable.mockResolvedValue(false);

      // No filter: gemini still returns, but openai/byteplus/elevenlabs are absent.
      const all = await (await GET(createMockGetRequest())).json();
      expect(all.success).toBe(true);
      expect(all.providers.openai).toBeUndefined();
      expect(all.providers.byteplus).toBeUndefined();
      expect(all.providers.elevenlabs).toBeUndefined();
      expect(all.models.every((m: { provider: string }) => m.provider !== "openai" && m.provider !== "byteplus" && m.provider !== "elevenlabs")).toBe(true);

      // Explicitly requesting one returns 503 (engine down), not a BYOK-key error.
      const response = await GET(createMockGetRequest({ provider: "byteplus" }));
      expect(response.status).toBe(503);
      expect((await response.json()).error).toMatch(/engine is unreachable/i);
    });

    it("GET: should return 400 when provider filter is replicate but no key", async () => {
      // No Replicate key set, and explicitly requesting replicate only
      const request = createMockGetRequest({ provider: "replicate" });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain("No providers available");
    });

    it("GET: should filter by provider query param", async () => {
      process.env.REPLICATE_API_KEY = "test-replicate-key";

      // Only Replicate should be called when filtered
      mockFetch.mockResolvedValueOnce(
        createReplicateResponse([
          { owner: "stability-ai", name: "sdxl", description: "SDXL model" },
        ])
      );

      const request = createMockGetRequest({ provider: "replicate" });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.models).toHaveLength(1);
      expect(data.models[0].provider).toBe("replicate");
      // fal.ai should not be in providers
      expect(data.providers.fal).toBeUndefined();
    });

    it("GET: should filter by capabilities query param", async () => {
      process.env.REPLICATE_API_KEY = "test-replicate-key";

      // Replicate models - one image, one video
      mockFetch.mockResolvedValueOnce(
        createReplicateResponse([
          { owner: "stability-ai", name: "sdxl", description: "Image generation" },
          { owner: "luma", name: "ray", description: "Video generation" },
        ])
      );

      // fal.ai models - different categories
      mockFetch.mockResolvedValueOnce(
        createFalResponse([
          { id: "fal-ai/flux", name: "Flux", category: "text-to-image" },
          { id: "fal-ai/luma-ray", name: "Luma Ray", category: "text-to-video" },
        ])
      );

      const request = createMockGetRequest({ capabilities: "text-to-video" });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      // Every returned model must declare the requested capability (multi-capability
      // models — e.g. an engine-backed image-to-video — are kept, so assert `includes`).
      expect(data.models.length).toBeGreaterThan(0);
      expect(
        data.models.every((m: { capabilities: string[] }) => m.capabilities.includes("text-to-video")),
      ).toBe(true);
    });

    it("GET: should search by query param", async () => {
      process.env.REPLICATE_API_KEY = "test-replicate-key";

      // Replicate caches full list, filters client-side
      mockFetch.mockResolvedValueOnce(
        createReplicateResponse([
          { owner: "stability-ai", name: "sdxl", description: "SDXL model" },
          { owner: "black-forest", name: "flux", description: "Flux model" },
        ])
      );

      // fal.ai searches server-side
      mockFetch.mockResolvedValueOnce(
        createFalResponse([
          { id: "fal-ai/flux", name: "Flux", category: "text-to-image" },
        ])
      );

      const request = createMockGetRequest({ search: "flux" });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      // Should only return flux-related models
      expect(data.models.every((m: { name: string; id: string }) =>
        m.name.toLowerCase().includes("flux") || m.id.toLowerCase().includes("flux")
      )).toBe(true);
    });

    it("GET: should return cached=true when all from cache", async () => {
      process.env.REPLICATE_API_KEY = "test-replicate-key";
      process.env.FAL_API_KEY = "test-fal-key";

      // Set up cache hits for both providers
      mockGetCachedModels.mockImplementation((key: string) => {
        if (key === "replicate:models") {
          return [{ id: "stability-ai/sdxl", name: "sdxl", provider: "replicate", capabilities: ["text-to-image"], description: null }];
        }
        if (key === "fal:models") {
          return [{ id: "fal-ai/flux", name: "Flux", provider: "fal", capabilities: ["text-to-image"], description: "" }];
        }
        return null;
      });

      const request = createMockGetRequest();
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.cached).toBe(true);
      expect(data.providers.replicate.cached).toBe(true);
      expect(data.providers.fal.cached).toBe(true);
      // Fetch should not have been called
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("GET: should return cached=false when fresh fetch", async () => {
      process.env.FAL_API_KEY = "test-fal-key";
      // No cache hits
      mockGetCachedModels.mockReturnValue(null);

      mockFetch.mockResolvedValueOnce(
        createFalResponse([
          { id: "fal-ai/flux", name: "Flux", category: "text-to-image" },
        ])
      );

      const request = createMockGetRequest();
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.cached).toBe(false);
      expect(data.providers.fal.cached).toBe(false);
    });

    it("GET: should use API key from header over env var", async () => {
      process.env.REPLICATE_API_KEY = "env-key";

      mockFetch.mockResolvedValueOnce(
        createReplicateResponse([
          { owner: "stability-ai", name: "sdxl", description: "SDXL" },
        ])
      );

      // fal.ai response (always included unless filtered)
      mockFetch.mockResolvedValueOnce(
        createFalResponse([
          { id: "fal-ai/flux", name: "Flux", category: "text-to-image" },
        ])
      );

      const request = createMockGetRequest({}, { "X-Replicate-Key": "header-key" });
      const response = await GET(request);

      expect(response.status).toBe(200);
      // Check that fetch was called with header key
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("api.replicate.com"),
        expect.objectContaining({
          headers: { Authorization: "Bearer header-key" },
        })
      );
    });
  });

  describe("caching behavior", () => {
    it("GET: should return cached models when available (no fetch)", async () => {
      process.env.REPLICATE_API_KEY = "test-key";

      // Cache hit for Replicate
      mockGetCachedModels.mockImplementation((key: string) => {
        if (key === "replicate:models") {
          return [{ id: "stability-ai/sdxl", name: "sdxl", provider: "replicate", capabilities: ["text-to-image"], description: null }];
        }
        if (key === "fal:models") {
          return [{ id: "fal-ai/flux", name: "Flux", provider: "fal", capabilities: ["text-to-image"], description: "" }];
        }
        return null;
      });

      const request = createMockGetRequest();
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.cached).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("GET: should bypass cache when refresh=true", async () => {
      process.env.REPLICATE_API_KEY = "test-key";

      // Even with cache available, refresh should fetch fresh
      mockGetCachedModels.mockReturnValue([
        { id: "old-model", name: "Old", provider: "replicate", capabilities: ["text-to-image"], description: null },
      ]);

      mockFetch.mockResolvedValueOnce(
        createReplicateResponse([
          { owner: "stability-ai", name: "new-sdxl", description: "New SDXL" },
        ])
      );

      mockFetch.mockResolvedValueOnce(
        createFalResponse([
          { id: "fal-ai/flux-new", name: "Flux New", category: "text-to-image" },
        ])
      );

      const request = createMockGetRequest({ refresh: "true" });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.cached).toBe(false);
      expect(mockFetch).toHaveBeenCalled();
      // Should have fresh models, not cached
      expect(data.models.some((m: { id: string }) => m.id === "stability-ai/new-sdxl")).toBe(true);
    });

    it("GET: should client-side filter Replicate models (caches full list, filters on read)", async () => {
      process.env.REPLICATE_API_KEY = "test-key";

      // Cache has full list
      const fullList = [
        { id: "stability-ai/sdxl", name: "sdxl", provider: "replicate", capabilities: ["text-to-image"] as const, description: "SDXL model" },
        { id: "black-forest/flux", name: "flux", provider: "replicate", capabilities: ["text-to-image"] as const, description: "Flux model" },
      ];
      mockGetCachedModels.mockImplementation((key: string) => {
        if (key === "replicate:models") return fullList;
        if (key.startsWith("fal:")) return [];
        return null;
      });

      const request = createMockGetRequest({ search: "flux", provider: "replicate" });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      // Should filter to just flux
      expect(data.models).toHaveLength(1);
      expect(data.models[0].name).toBe("flux");
      // Cache key should be base key, not search-specific
      expect(mockGetCachedModels).toHaveBeenCalledWith("replicate:models");
    });
  });

  describe("error handling", () => {
    it("GET: should handle partial provider failures gracefully", async () => {
      process.env.REPLICATE_API_KEY = "test-key";
      process.env.FAL_API_KEY = "test-fal-key";

      // Mock fetch to handle both providers
      mockFetch.mockImplementation((url: string) => {
        if (url.includes("replicate.com")) {
          // Replicate fails
          return Promise.resolve({ ok: false, status: 401 });
        }
        if (url.includes("fal.ai")) {
          // fal.ai succeeds
          return Promise.resolve(
            createFalResponse([
              { id: "fal-ai/flux", name: "Flux", category: "text-to-image" },
            ])
          );
        }
        return Promise.reject(new Error("Unknown URL"));
      });

      const request = createMockGetRequest();
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      // fal + gemini + the always-included engine-backed providers; replicate failed.
      const total =
        data.providers.fal.count +
        data.providers.gemini.count +
        data.providers.openai.count +
        data.providers.byteplus.count +
        data.providers.elevenlabs.count;
      expect(data.models).toHaveLength(total);
      expect(data.providers.replicate.success).toBe(false);
      expect(data.providers.fal.success).toBe(true);
      expect(data.providers.gemini.success).toBe(true);
      expect(data.errors).toContain("replicate: Replicate API error: 401");
    });

    it("GET: should return 500 when all requested providers fail", async () => {
      process.env.FAL_API_KEY = "test-fal-key";
      // Filter to only fal provider (exclude gemini which is always available)
      // When fal fails and it's the only provider requested, should get 500
      mockFetch.mockImplementation((url: string) => {
        if (url.includes("fal.ai")) {
          return Promise.resolve({ ok: false, status: 503 });
        }
        return Promise.reject(new Error("Unknown URL"));
      });

      // Request only fal provider so gemini is not included
      const request = createMockGetRequest({ provider: "fal" });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error).toContain("All providers failed");
    });
  });

  describe("pagination", () => {
    it("GET: should paginate through Replicate results (max 15 pages)", async () => {
      process.env.REPLICATE_API_KEY = "test-key";
      process.env.FAL_API_KEY = "test-fal-key";

      // Track Replicate page fetches
      let replicatePageCount = 0;

      // Mock fetch with URL-based routing
      mockFetch.mockImplementation((url: string) => {
        if (url.includes("replicate.com")) {
          replicatePageCount++;
          if (replicatePageCount === 1) {
            return Promise.resolve(
              createReplicateResponse(
                [{ owner: "owner1", name: "model1", description: null }],
                "https://api.replicate.com/v1/models?cursor=page2"
              )
            );
          } else if (replicatePageCount === 2) {
            return Promise.resolve(
              createReplicateResponse(
                [{ owner: "owner2", name: "model2", description: null }],
                "https://api.replicate.com/v1/models?cursor=page3"
              )
            );
          } else {
            return Promise.resolve(
              createReplicateResponse(
                [{ owner: "owner3", name: "model3", description: null }],
                null // Last page
              )
            );
          }
        }
        if (url.includes("fal.ai")) {
          return Promise.resolve(
            createFalResponse([{ id: "fal-ai/flux", name: "Flux", category: "text-to-image" }])
          );
        }
        return Promise.reject(new Error("Unknown URL"));
      });

      const request = createMockGetRequest();
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      // Should have all 3 Replicate models + 1 fal.ai model
      expect(data.providers.replicate.count).toBe(3);
      expect(data.providers.fal.count).toBe(1);
      expect(replicatePageCount).toBe(3);
    });

    it("GET: should paginate through fal.ai results (max 15 pages)", async () => {
      process.env.FAL_API_KEY = "test-fal-key";
      let falPageCount = 0;

      mockFetch.mockImplementation((url: string) => {
        if (url.includes("fal.ai")) {
          falPageCount++;
          if (falPageCount === 1) {
            return Promise.resolve(
              createFalResponse(
                [{ id: "fal-ai/model1", name: "Model 1", category: "text-to-image" }],
                true, // has_more
                "cursor1"
              )
            );
          } else if (falPageCount === 2) {
            return Promise.resolve(
              createFalResponse(
                [{ id: "fal-ai/model2", name: "Model 2", category: "text-to-image" }],
                true,
                "cursor2"
              )
            );
          } else {
            return Promise.resolve(
              createFalResponse(
                [{ id: "fal-ai/model3", name: "Model 3", category: "text-to-image" }],
                false, // Last page
                null
              )
            );
          }
        }
        return Promise.reject(new Error("Unknown URL"));
      });

      const request = createMockGetRequest();
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.providers.fal.count).toBe(3);
      expect(falPageCount).toBe(3);
    });
  });

  describe("capability inference", () => {
    it("GET: should infer text-to-video from video keywords", async () => {
      process.env.REPLICATE_API_KEY = "test-key";

      mockFetch.mockImplementation((url: string) => {
        if (url.includes("replicate.com")) {
          return Promise.resolve(
            createReplicateResponse([
              { owner: "luma", name: "ray", description: "Video generation model" },
              { owner: "kling", name: "v1", description: "Motion generation" },
              { owner: "minimax", name: "video", description: "Animate images" },
            ])
          );
        }
        if (url.includes("fal.ai")) {
          return Promise.resolve(createFalResponse([]));
        }
        return Promise.reject(new Error("Unknown URL"));
      });

      const request = createMockGetRequest();
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      const replicateModels = data.models.filter((m: { provider: string }) => m.provider === "replicate");
      expect(replicateModels.every((m: { capabilities: string[] }) => m.capabilities.includes("text-to-video"))).toBe(true);
    });

    it("GET: should infer image-to-video from i2v keywords", async () => {
      process.env.REPLICATE_API_KEY = "test-key";

      // The model needs to have a video keyword AND i2v keyword to be classified as image-to-video
      // The route first checks for video keywords (video, animate, motion, etc.)
      // Then if it's a video model, it checks for i2v/img2vid to distinguish image-to-video vs text-to-video
      mockFetch.mockImplementation((url: string) => {
        if (url.includes("replicate.com")) {
          return Promise.resolve(
            createReplicateResponse([
              { owner: "company", name: "img2vid", description: "Video from image img2vid" },
              { owner: "another", name: "i2v-video", description: "image-to-video generation" },
            ])
          );
        }
        if (url.includes("fal.ai")) {
          return Promise.resolve(createFalResponse([]));
        }
        return Promise.reject(new Error("Unknown URL"));
      });

      const request = createMockGetRequest();
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      const replicateModels = data.models.filter((m: { provider: string }) => m.provider === "replicate");
      expect(replicateModels.every((m: { capabilities: string[] }) => m.capabilities.includes("image-to-video"))).toBe(true);
    });

    it("GET: should infer text-to-image as default for image models", async () => {
      process.env.REPLICATE_API_KEY = "test-key";

      mockFetch.mockImplementation((url: string) => {
        if (url.includes("replicate.com")) {
          return Promise.resolve(
            createReplicateResponse([
              { owner: "stability-ai", name: "sdxl", description: "Generate images from text" },
            ])
          );
        }
        if (url.includes("fal.ai")) {
          return Promise.resolve(createFalResponse([]));
        }
        return Promise.reject(new Error("Unknown URL"));
      });

      const request = createMockGetRequest();
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      // Find the replicate model
      const replicateModel = data.models.find((m: { provider: string }) => m.provider === "replicate");
      expect(replicateModel?.capabilities).toContain("text-to-image");
    });
  });

  describe("fal.ai category mapping", () => {
    it("GET: should map fal.ai categories to ModelCapability", async () => {
      process.env.FAL_API_KEY = "test-fal-key";
      mockFetch.mockImplementation((url: string) => {
        if (url.includes("fal.ai")) {
          return Promise.resolve(
            createFalResponse([
              { id: "fal-ai/flux", name: "Flux", category: "text-to-image" },
              { id: "fal-ai/img2img", name: "Img2Img", category: "image-to-image" },
              { id: "fal-ai/t2v", name: "T2V", category: "text-to-video" },
              { id: "fal-ai/i2v", name: "I2V", category: "image-to-video" },
            ])
          );
        }
        return Promise.reject(new Error("Unknown URL"));
      });

      // Isolate to fal so the engine-backed providers don't inflate the list.
      const request = createMockGetRequest({ provider: "fal" });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.models).toHaveLength(4);
      expect(data.models.find((m: { id: string }) => m.id === "fal-ai/flux")?.capabilities).toEqual(["text-to-image"]);
      expect(data.models.find((m: { id: string }) => m.id === "fal-ai/img2img")?.capabilities).toEqual(["image-to-image"]);
      expect(data.models.find((m: { id: string }) => m.id === "fal-ai/t2v")?.capabilities).toEqual(["text-to-video"]);
      expect(data.models.find((m: { id: string }) => m.id === "fal-ai/i2v")?.capabilities).toEqual(["image-to-video"]);
    });

    it("GET: should filter out non-relevant fal.ai categories", async () => {
      process.env.FAL_API_KEY = "test-fal-key";
      mockFetch.mockImplementation((url: string) => {
        if (url.includes("fal.ai")) {
          return Promise.resolve(
            createFalResponse([
              { id: "fal-ai/flux", name: "Flux", category: "text-to-image" },
              { id: "fal-ai/whisper", name: "Whisper", category: "speech-to-text" },
              { id: "fal-ai/tts", name: "TTS", category: "text-to-speech" },
            ])
          );
        }
        return Promise.reject(new Error("Unknown URL"));
      });

      // Isolate to fal so the engine-backed providers don't inflate the list.
      const request = createMockGetRequest({ provider: "fal" });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      // text-to-image kept + text-to-speech→text-to-audio kept; speech-to-text dropped.
      expect(data.models).toHaveLength(2);
      expect(data.models.find((m: { id: string }) => m.id === "fal-ai/flux")).toBeDefined();
      expect(data.models.find((m: { id: string }) => m.id === "fal-ai/tts")?.capabilities).toEqual(["text-to-audio"]);
    });
  });

  describe("sorting", () => {
    it("GET: should sort models by provider, then by name", async () => {
      process.env.REPLICATE_API_KEY = "test-key";
      process.env.FAL_API_KEY = "test-fal-key";

      mockFetch.mockImplementation((url: string) => {
        if (url.includes("replicate.com")) {
          return Promise.resolve(
            createReplicateResponse([
              { owner: "z-org", name: "zebra", description: null },
              { owner: "a-org", name: "alpha", description: null },
            ])
          );
        }
        if (url.includes("fal.ai")) {
          return Promise.resolve(
            createFalResponse([
              { id: "fal-ai/zebra", name: "Zebra", category: "text-to-image" },
              { id: "fal-ai/alpha", name: "Alpha", category: "text-to-image" },
            ])
          );
        }
        return Promise.reject(new Error("Unknown URL"));
      });

      const request = createMockGetRequest();
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      // Sorted by provider, then by name. Engine-backed providers (byteplus/elevenlabs/
      // openai) are now interleaved alphabetically, so assert the ordering *property* and
      // the relative order of the providers under test rather than absolute indices.
      const key = (m: { provider: string; name: string }) => `${m.provider} ${m.name}`;
      // Mirror the route's comparator (provider then name, via localeCompare).
      const sorted = [...data.models].sort(
        (a: { provider: string; name: string }, b: { provider: string; name: string }) =>
          a.provider === b.provider ? a.name.localeCompare(b.name) : a.provider.localeCompare(b.provider),
      );
      expect(data.models.map(key)).toEqual(sorted.map(key));
      const at = (provider: string, name: string) =>
        data.models.findIndex((m: { provider: string; name: string }) => m.provider === provider && m.name === name);
      // Within-provider name sort.
      expect(at("fal", "Alpha")).toBeLessThan(at("fal", "Zebra"));
      expect(at("replicate", "alpha")).toBeLessThan(at("replicate", "zebra"));
      // Cross-provider grouping (provider alphabetical): fal < gemini < replicate.
      expect(at("fal", "Zebra")).toBeLessThan(at("gemini", "Nano Banana"));
      expect(at("gemini", "Veo 3.1 I2V")).toBeLessThan(at("replicate", "alpha"));
    });
  });
});
