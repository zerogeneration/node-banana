// @vitest-environment node
import { describe, it, expect } from "vitest";
import type { GenerationInput } from "@/lib/providers/types";
import { generateWithByteplus, generateWithOpenAI, generateWithElevenLabs } from "../providers/engine";

/**
 * Live end-to-end of the PRO-87 cutover: node-banana's real engine bindings
 * (`providers/engine.ts` → `src/execution/zerogen-adapter` → the zerogen engine
 * over HTTP) against a RUNNING engine. Exercises the full path — project ensure
 * (`POST /api/projects`), capability routing, neutral-request mapping, async job
 * submit + poll to terminal, and result inlining — with real provider keys held
 * server-side by the engine (no BYOK).
 *
 * Opt-in: skipped unless ZEROGEN_E2E=1, since it needs a local engine + real
 * provider credits. Run with:
 *   ZEROGEN_E2E=1 npx vitest run src/app/api/generate/__tests__/engine-e2e.test.ts
 * Override the target with ZEROGEN_ENGINE_URL / ZEROGEN_PROJECT (defaults:
 * http://127.0.0.1:4747 + "node-banana").
 */
const RUN = process.env.ZEROGEN_E2E === "1";

function input(
  model: { id: string; provider: string; capabilities: string[] },
  prompt: string,
): GenerationInput {
  return {
    model: { id: model.id, name: model.id, provider: model.provider, capabilities: model.capabilities, description: null },
    prompt,
    images: [],
    parameters: {},
    dynamicInputs: undefined,
  } as unknown as GenerationInput;
}

describe.skipIf(!RUN)("live engine E2E (byteplus / openai / elevenlabs)", () => {
  it(
    "elevenlabs speech → audio output via the engine",
    async () => {
      const out = await generateWithElevenLabs(
        "e2e",
        "",
        input({ id: "eleven_multilingual_v2", provider: "elevenlabs", capabilities: ["text-to-audio"] }, "Engine end to end test."),
      );
      expect(out.success).toBe(true);
      expect(out.outputs?.[0]?.type).toBe("audio");
      // Large media stays url-only (resolved against the engine base URL).
      expect(out.outputs?.[0]?.url).toMatch(/\/api\/assets\/.+\/file$|\/api\/assets\//);
    },
    120_000,
  );

  it(
    "openai image → inlined image data URL via the engine",
    async () => {
      const out = await generateWithOpenAI(
        "e2e",
        "",
        input({ id: "gpt-image-2", provider: "openai", capabilities: ["text-to-image"] }, "a single solid red circle centered on a white background"),
      );
      expect(out.success).toBe(true);
      expect(out.outputs?.[0]?.type).toBe("image");
      expect(out.outputs?.[0]?.data).toMatch(/^data:image\//);
    },
    180_000,
  );

  it(
    "byteplus Seedream image → inlined image data URL via the engine",
    async () => {
      const out = await generateWithByteplus(
        "e2e",
        "",
        input({ id: "seedream-5-0-260128", provider: "byteplus", capabilities: ["text-to-image"] }, "a single solid blue square centered on a white background"),
      );
      expect(out.success).toBe(true);
      expect(out.outputs?.[0]?.type).toBe("image");
      expect(out.outputs?.[0]?.data).toMatch(/^data:image\//);
    },
    180_000,
  );
});
