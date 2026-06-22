/**
 * Neutral request → engine HTTP request (`{ kind, endpoint, body }`). This is the
 * serialization boundary between the moved mapping (port-shaped neutral requests)
 * and the engine's typed generate contract.
 *
 * ## Engine coverage gaps (today's contract)
 *
 * The engine's media generate bodies are narrower than the neutral requests:
 *  - **`/api/generate/image` has no `images` field** — it is text-to-image only.
 *    A request carrying reference images (e.g. BytePlus Seedream image-to-image)
 *    **cannot** be expressed, so we fail closed ({@link EngineCoverageError})
 *    rather than silently dropping the references and returning a wrong (txt2img)
 *    result.
 *  - **No `extra` passthrough on image/video/speech/music/soundEffect** — only the
 *    `text` body carries `extra`. Provider-specific tuning params (a `seed`, etc.)
 *    on a media request are dropped here. This is a known gap pending an engine
 *    change (plan §4.1 "serve every capability"); when the engine adds these
 *    fields, surface them below.
 *  - **`/api/generate/image` exposes only `prompt`/`size`/`quality`/`outputFormat`.**
 *    The canonical `background` and `n` fields of an {@link ImageRequest} have no
 *    engine field, so they are dropped too (e.g. an OpenAI `background:"transparent"`
 *    request falls back to the provider default). Same pending engine change —
 *    forward them from {@link imageRequest} once `/image` accepts them.
 *  - **`/api/generate/video` carries no source-audio input** (only `images`). An
 *    `audio-to-video` model that depends on a connected `audio`/`audio_url` handle
 *    can't be expressed — the audio is dropped. Routes here via the `audio-to-video`
 *    capability alias; forward the audio from {@link videoRequest} once the engine
 *    video contract accepts an audio input.
 */
import type {
  EngineImageBody,
  EngineMusicBody,
  EngineRequest,
  EngineSoundEffectBody,
  EngineSpeechBody,
  EngineTarget,
  EngineTextBody,
  EngineVideoBody,
  ImageRequest,
  MusicRequest,
  SoundEffectRequest,
  SpeechRequest,
  TextRequest,
  VideoRequest,
} from "./contract";

/** Raised when a neutral request needs a capability the engine contract can't yet express. */
export class EngineCoverageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngineCoverageError";
  }
}

/** Host context folded into every engine request: which provider, which run target, optional metadata. */
export interface EngineCallContext {
  provider: string;
  target: EngineTarget;
  metadata?: Record<string, unknown>;
}

function envelope(ctx: EngineCallContext): EngineTarget & { metadata?: Record<string, unknown> } {
  return {
    project: ctx.target.project,
    ...(ctx.target.workflow ? { workflow: ctx.target.workflow } : {}),
    ...(ctx.metadata ? { metadata: ctx.metadata } : {}),
  };
}

const endpoint = (kind: EngineRequest["kind"]): string => `/api/generate/${kind}`;

export function imageRequest(req: ImageRequest, ctx: EngineCallContext): EngineRequest {
  if (req.images && req.images.length > 0) {
    throw new EngineCoverageError(
      "Reference / input images aren't supported by the engine image API yet (text-to-image only): " +
        "POST /api/generate/image has no `images` field. Use an image-to-video model, or wait for the " +
        "engine image contract to add image support.",
    );
  }
  // NOTE: req.background and req.n have no field on the engine image contract
  // (it exposes only size/quality/outputFormat), and /image has no `extra` escape
  // hatch — so those canonical fields are dropped. See the coverage-gap note above.
  const body: EngineImageBody = {
    ...envelope(ctx),
    provider: ctx.provider,
    model: req.model,
    prompt: req.prompt,
    ...(req.size !== undefined ? { size: req.size } : {}),
    ...(req.quality !== undefined ? { quality: req.quality } : {}),
    ...(req.outputFormat !== undefined ? { outputFormat: req.outputFormat } : {}),
  };
  return { kind: "image", endpoint: endpoint("image"), body };
}

export function videoRequest(req: VideoRequest, ctx: EngineCallContext): EngineRequest {
  const body: EngineVideoBody = {
    ...envelope(ctx),
    provider: ctx.provider,
    model: req.model,
    ...(req.prompt !== undefined ? { prompt: req.prompt } : {}),
    ...(req.images !== undefined ? { images: req.images } : {}),
    ...(req.ratio !== undefined ? { ratio: req.ratio } : {}),
    ...(req.durationSeconds !== undefined ? { durationSeconds: req.durationSeconds } : {}),
    ...(req.generateAudio !== undefined ? { generateAudio: req.generateAudio } : {}),
  };
  return { kind: "video", endpoint: endpoint("video"), body };
}

export function speechRequest(req: SpeechRequest, ctx: EngineCallContext): EngineRequest {
  const body: EngineSpeechBody = {
    ...envelope(ctx),
    provider: ctx.provider,
    model: req.model,
    text: req.text,
    ...(req.voiceId !== undefined ? { voiceId: req.voiceId } : {}),
    ...(req.outputFormat !== undefined ? { outputFormat: req.outputFormat } : {}),
  };
  return { kind: "speech", endpoint: endpoint("speech"), body };
}

export function musicRequest(req: MusicRequest, ctx: EngineCallContext): EngineRequest {
  const body: EngineMusicBody = {
    ...envelope(ctx),
    provider: ctx.provider,
    model: req.model,
    prompt: req.prompt,
    ...(req.lengthMs !== undefined ? { lengthMs: req.lengthMs } : {}),
    ...(req.outputFormat !== undefined ? { outputFormat: req.outputFormat } : {}),
  };
  return { kind: "music", endpoint: endpoint("music"), body };
}

export function soundEffectRequest(req: SoundEffectRequest, ctx: EngineCallContext): EngineRequest {
  const body: EngineSoundEffectBody = {
    ...envelope(ctx),
    provider: ctx.provider,
    model: req.model,
    prompt: req.prompt,
    ...(req.durationSeconds !== undefined ? { durationSeconds: req.durationSeconds } : {}),
    ...(req.outputFormat !== undefined ? { outputFormat: req.outputFormat } : {}),
  };
  return { kind: "soundEffect", endpoint: endpoint("soundEffect"), body };
}

export function textRequest(req: TextRequest, ctx: EngineCallContext): EngineRequest {
  const body: EngineTextBody = {
    ...envelope(ctx),
    provider: ctx.provider,
    model: req.model,
    ...(req.prompt !== undefined ? { prompt: req.prompt } : {}),
    ...(req.messages !== undefined ? { messages: req.messages } : {}),
    ...(req.system !== undefined ? { system: req.system } : {}),
    ...(req.images !== undefined ? { images: req.images } : {}),
    ...(req.maxTokens !== undefined ? { maxTokens: req.maxTokens } : {}),
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    ...(req.topP !== undefined ? { topP: req.topP } : {}),
    ...(req.stop !== undefined ? { stop: req.stop } : {}),
    ...(req.responseFormat !== undefined ? { responseFormat: req.responseFormat } : {}),
    ...(req.reasoningEffort !== undefined ? { reasoningEffort: req.reasoningEffort } : {}),
    ...(req.thinking !== undefined ? { thinking: req.thinking } : {}),
    ...(req.extra !== undefined ? { extra: req.extra } : {}),
  };
  return { kind: "text", endpoint: endpoint("text"), body };
}
