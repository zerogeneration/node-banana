/**
 * node-banana provider executor over the **zerogen engine** (the reshaped
 * `generateWith*`). Each executor mirrors node-banana's per-provider dispatch:
 * it routes the model's capability, maps node-banana's request to a neutral
 * engine request, runs it to a terminal result over HTTP (async video/audio jobs
 * settle server-side, so this resolves only once the media is ready), and maps
 * the result back. Errors return a scrubbed `{ success: false, error }` envelope
 * rather than throwing — matching node-banana's contract.
 *
 * What changed vs. the in-process binding: the call target is the engine
 * (`engineClient.generate`), not a local adapter, and **BYOK is gone** — the
 * engine holds provider keys, so no `apiKey` rides on the request. Capability
 * routing (the tag vocabulary) stays here; it's node-banana's, not the engine's.
 *
 * Engine path is wired for **byteplus / openai / elevenlabs** today (the
 * providers node-banana currently library-embeds). fal / anthropic / gemini
 * executors exist for parity with the moved module and future wiring; the engine
 * 400s a provider it doesn't serve, surfacing as a normal failure envelope.
 */
import type { GenerationInput } from "@/lib/providers/types";
import type { CapabilityModel, EngineRequest, EngineTarget, GenerationOutput } from "./contract";
import type { EngineClient } from "./engine-client";
import { EngineError } from "./engine-client";
import { fromEngineResult } from "./map-output";
import {
  declaresAudioToVideo,
  declaresThreeD,
  normalizeCapabilities,
  pickCapability,
  toImageRequest,
  toMusicRequest,
  toSoundEffectRequest,
  toSpeechRequest,
  toTextRequest,
  toVideoRequest,
  unsupportedCapability,
} from "./map-input";
import {
  imageRequest,
  musicRequest,
  soundEffectRequest,
  speechRequest,
  textRequest,
  videoRequest,
  type EngineCallContext,
} from "./to-engine-request";

/** Host context for an execution: the engine transport + the run target + optional run metadata. */
export interface ZerogenExecutorContext {
  client: EngineClient;
  target: EngineTarget;
  metadata?: Record<string, unknown>;
}

export type NodeBananaProvider = "openai" | "byteplus" | "fal" | "elevenlabs" | "anthropic" | "gemini";

/** Scrub any error into node-banana's `{ success:false, error }` envelope (never leaks a secret-bearing cause). */
function fail(provider: string, error: unknown): GenerationOutput {
  const message = error instanceof Error ? error.message : String(error);
  // The engine already scrubs its SafeError messages; prefix with the provider
  // unless the message is already bracketed (avoids `[p] [p] …`).
  return { success: false, error: message.startsWith("[") ? message : `[${provider}] ${message}` };
}

function callContext(provider: string, ctx: ZerogenExecutorContext): EngineCallContext {
  return { provider, target: ctx.target, ...(ctx.metadata ? { metadata: ctx.metadata } : {}) };
}

/**
 * Fail closed before routing to the video path when the model declares
 * `audio-to-video`: the engine `/api/generate/video` body has no source-audio input,
 * so the audio that defines the request would be silently dropped. Reject until the
 * engine video contract can carry audio (see `to-engine-request.ts`).
 */
function assertVideoExpressible(input: GenerationInput): void {
  if (declaresAudioToVideo(input.model)) {
    throw new EngineError(
      "audio-to-video isn't supported by this binding yet: the engine /api/generate/video contract has no " +
        "source-audio input field, so the audio that defines the request would be dropped. Wait for the engine " +
        "video contract to accept audio.",
    );
  }
}

/** Submit one engine request, await its terminal job, and map the result to node-banana outputs. */
async function run(request: EngineRequest, ctx: ZerogenExecutorContext): Promise<GenerationOutput> {
  const job = await ctx.client.generate(request);
  if (job.status !== "succeeded") {
    throw new EngineError(job.error?.message ?? `Engine job ${job.status} (no error detail).`);
  }
  const outputs = await fromEngineResult(job, {
    baseUrl: ctx.client.baseUrl,
    fetchAsset: (url) => ctx.client.fetchAsset(url),
  });
  return { success: true, outputs };
}

/**
 * OpenAI serves image (text-to-image) and text (chat). A model tagged for any
 * other modality fails closed; route by the declared capability, defaulting to
 * image for back-compat.
 */
export async function executeWithOpenAI(
  input: GenerationInput,
  ctx: ZerogenExecutorContext,
): Promise<GenerationOutput> {
  try {
    if (unsupportedCapability(input.model, ["image", "text"])) {
      throw new EngineError(
        "This OpenAI binding supports only text and image generation; the declared capability isn't wired up.",
      );
    }
    if (pickCapability(input.model, ["image", "text"], "image") === "text") {
      return await run(textRequest(toTextRequest(input), callContext("openai", ctx)), ctx);
    }
    // Reference images (if any) are forwarded to the engine image body; the engine
    // rejects them for OpenAI (text-to-image only), surfacing as a normal failure.
    return await run(imageRequest(toImageRequest(input), callContext("openai", ctx)), ctx);
  } catch (error) {
    return fail("openai", error);
  }
}

/**
 * BytePlus is dual-capability: Seedream (image) and Seedance (video). Route by
 * declared capability; when none is recognized, fall back by model id
 * ("seedream" → image) so a sparsely-tagged Seedream still reaches the image
 * port, defaulting to video otherwise.
 *
 * Seedream **image-to-image** (a request carrying reference images) is forwarded
 * to the engine image body, which now carries `images` (PRO-110); the engine owns
 * per-provider capability enforcement.
 */
function byteplusFallback(model: CapabilityModel): "image" | "video" {
  return model.id.toLowerCase().includes("seedream") ? "image" : "video";
}

export async function executeWithByteplus(
  input: GenerationInput,
  ctx: ZerogenExecutorContext,
): Promise<GenerationOutput> {
  try {
    // Fail closed on a declared capability outside image/video (e.g. a `text-to-audio`
    // model id reaching the byteplus branch) rather than letting byteplusFallback default
    // it to video and return the wrong modality.
    if (unsupportedCapability(input.model, ["image", "video"])) {
      throw new EngineError(
        "This BytePlus binding supports only image and video generation; the declared capability isn't wired up.",
      );
    }
    const capability = pickCapability(input.model, ["image", "video"], byteplusFallback(input.model));
    if (capability === "image") {
      return await run(imageRequest(toImageRequest(input), callContext("byteplus", ctx)), ctx);
    }
    assertVideoExpressible(input);
    return await run(videoRequest(toVideoRequest(input), callContext("byteplus", ctx)), ctx);
  } catch (error) {
    return fail("byteplus", error);
  }
}

export async function executeWithFal(
  input: GenerationInput,
  ctx: ZerogenExecutorContext,
): Promise<GenerationOutput> {
  try {
    if (declaresThreeD(input.model)) {
      throw new EngineError(
        "3D generation isn't supported by this binding (no 3D port). Use an image or video model.",
      );
    }
    // fal serves image + video; fail closed on a declared audio/text/other capability
    // instead of letting the "image" fallback post it to /api/generate/image.
    if (unsupportedCapability(input.model, ["image", "video"])) {
      throw new EngineError(
        "This fal binding supports only image and video generation; the declared capability isn't wired up.",
      );
    }
    const capability = pickCapability(input.model, ["image", "video"], "image");
    if (capability === "video") {
      assertVideoExpressible(input);
      return await run(videoRequest(toVideoRequest(input), callContext("fal", ctx)), ctx);
    }
    // Plain toImageRequest (not the in-process fal variant): the engine image body
    // accepts the canonical `outputFormat`, and the engine owns fal's field naming.
    return await run(imageRequest(toImageRequest(input), callContext("fal", ctx)), ctx);
  } catch (error) {
    return fail("fal", error);
  }
}

/**
 * Decide ElevenLabs' audio sub-capability. node-banana tags every audio model
 * `text-to-audio`, so capability alone can't tell speech from music from sfx — we
 * infer from the model id first, then an explicit capability hint, then default to
 * speech.
 */
function elevenLabsCapability(input: GenerationInput): "speech" | "music" | "soundEffect" {
  const id = input.model.id.toLowerCase();
  if (id.includes("music")) return "music";
  if (id.includes("sound") || id.includes("sfx")) return "soundEffect";
  const hinted = normalizeCapabilities(input.model);
  if (hinted.includes("music")) return "music";
  if (hinted.includes("soundEffect")) return "soundEffect";
  return "speech";
}

export async function executeWithElevenLabs(
  input: GenerationInput,
  ctx: ZerogenExecutorContext,
): Promise<GenerationOutput> {
  try {
    // Fail closed on a declared non-audio capability (e.g. an image/video/3D tag)
    // rather than letting the model-id inference fall through to speech and submit an
    // unsupported model to /api/generate/speech.
    if (unsupportedCapability(input.model, ["speech", "music", "soundEffect"])) {
      throw new EngineError(
        "This ElevenLabs binding supports only audio generation (speech / music / sound effect); the declared capability isn't wired up.",
      );
    }
    const capability = elevenLabsCapability(input);
    if (capability === "music") {
      return await run(musicRequest(toMusicRequest(input), callContext("elevenlabs", ctx)), ctx);
    }
    if (capability === "soundEffect") {
      return await run(soundEffectRequest(toSoundEffectRequest(input), callContext("elevenlabs", ctx)), ctx);
    }
    return await run(speechRequest(toSpeechRequest(input), callContext("elevenlabs", ctx)), ctx);
  } catch (error) {
    return fail("elevenlabs", error);
  }
}

/** Anthropic (Claude) — text only. Non-text models fail closed; vision (image-to-text) routes to text. */
export async function executeWithAnthropic(
  input: GenerationInput,
  ctx: ZerogenExecutorContext,
): Promise<GenerationOutput> {
  try {
    if (unsupportedCapability(input.model, ["text"])) {
      throw new EngineError(
        "This Anthropic binding only supports text generation; image/video/audio/3D models aren't wired up.",
      );
    }
    return await run(textRequest(toTextRequest(input), callContext("anthropic", ctx)), ctx);
  } catch (error) {
    return fail("anthropic", error);
  }
}

/** Gemini — text only (the engine registers a text generator for Gemini). Non-text models fail closed. */
export async function executeWithGemini(
  input: GenerationInput,
  ctx: ZerogenExecutorContext,
): Promise<GenerationOutput> {
  try {
    if (unsupportedCapability(input.model, ["text"])) {
      throw new EngineError(
        "This Gemini binding only supports text generation; image/video/audio/3D models aren't wired up.",
      );
    }
    return await run(textRequest(toTextRequest(input), callContext("gemini", ctx)), ctx);
  } catch (error) {
    return fail("gemini", error);
  }
}

const EXECUTORS: Record<
  NodeBananaProvider,
  (input: GenerationInput, ctx: ZerogenExecutorContext) => Promise<GenerationOutput>
> = {
  openai: executeWithOpenAI,
  byteplus: executeWithByteplus,
  fal: executeWithFal,
  elevenlabs: executeWithElevenLabs,
  anthropic: executeWithAnthropic,
  gemini: executeWithGemini,
};

/** Dispatch by provider name; unknown providers return a failure envelope (never throw). */
export async function executeWithProvider(
  provider: string,
  input: GenerationInput,
  ctx: ZerogenExecutorContext,
): Promise<GenerationOutput> {
  const executor = EXECUTORS[provider as NodeBananaProvider];
  if (!executor) return { success: false, error: `Unknown provider '${provider}'.` };
  return executor(input, ctx);
}

/**
 * Drop-in `generateWith*` bindings matching node-banana's per-provider dispatch
 * signature `(requestId, apiKey, input) => Promise<GenerationOutput>`, bound to a
 * fixed engine context. This is the seam for the eventual route cutover: a
 * binding file (e.g. `src/app/api/generate/providers/byteplus.ts`) re-exports
 * `createNodeBananaBindings(ctx).generateWithByteplus` instead of importing from
 * `@zerogeneration/providers/node-banana`.
 *
 * `requestId`/`apiKey` are accepted for signature compatibility and ignored:
 * `requestId` is node-banana's own correlation id (the engine mints its own), and
 * BYOK is gone (the engine holds provider keys; cloud auth is the client's token).
 */
export function createNodeBananaBindings(ctx: ZerogenExecutorContext) {
  const bind =
    (executor: (input: GenerationInput, c: ZerogenExecutorContext) => Promise<GenerationOutput>) =>
    (_requestId: string, _apiKey: string, input: GenerationInput): Promise<GenerationOutput> =>
      executor(input, ctx);

  const nodeBananaProviders: Record<
    NodeBananaProvider,
    (requestId: string, apiKey: string, input: GenerationInput) => Promise<GenerationOutput>
  > = {
    openai: bind(executeWithOpenAI),
    byteplus: bind(executeWithByteplus),
    fal: bind(executeWithFal),
    elevenlabs: bind(executeWithElevenLabs),
    anthropic: bind(executeWithAnthropic),
    gemini: bind(executeWithGemini),
  };

  return {
    ...nodeBananaProviders,
    generateWithOpenAI: nodeBananaProviders.openai,
    generateWithByteplus: nodeBananaProviders.byteplus,
    generateWithFal: nodeBananaProviders.fal,
    generateWithElevenLabs: nodeBananaProviders.elevenlabs,
    generateWithAnthropic: nodeBananaProviders.anthropic,
    generateWithGemini: nodeBananaProviders.gemini,
    nodeBananaProviders,
    generateWith: (
      provider: string,
      _requestId: string,
      _apiKey: string,
      input: GenerationInput,
    ): Promise<GenerationOutput> => executeWithProvider(provider, input, ctx),
  };
}
