/**
 * Neutral request → engine HTTP request (`{ kind, endpoint, body }`). This is the
 * serialization boundary between the moved mapping (port-shaped neutral requests)
 * and the engine's typed generate contract.
 *
 * ## Engine coverage gaps (today's contract)
 *
 * The `image` and `text` bodies carry the full neutral request (incl. `images` +
 * `extra`); the remaining media bodies are still narrower:
 *  - **No `extra` passthrough on video/speech/music/soundEffect** — only `image`
 *    and `text` carry `extra`. Provider tuning params (a `seed`, etc.) on those
 *    media requests are dropped here, pending an engine change; surface them below
 *    when the engine adds the fields.
 *  - **`/api/generate/video` carries no source-audio input** (only `images`). An
 *    `audio-to-video` model can't deliver the audio that defines it, so the executor
 *    **fails closed** (`declaresAudioToVideo` → reject) rather than running video
 *    without the audio. Forward the audio from {@link videoRequest} and drop the
 *    guard once the engine video contract accepts an audio input.
 *
 * Image inputs ARE carried now: `imageRequest` forwards `images`/`extra`/`background`/`n`.
 * The engine enforces per-provider support — it rejects reference images for
 * text-to-image-only providers (OpenAI) and rejects credential/batch/image-input
 * keys inside image `extra` — so the adapter forwards rather than second-guessing.
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
  // The engine image body carries the full neutral image request now. Reference images
  // are forwarded as-is; the engine rejects them for text-to-image-only providers
  // (OpenAI) and validates image `extra` (no credential/batch/image-input keys), so the
  // adapter forwards rather than second-guessing per-provider support.
  const body: EngineImageBody = {
    ...envelope(ctx),
    provider: ctx.provider,
    model: req.model,
    prompt: req.prompt,
    ...(req.images && req.images.length > 0 ? { images: req.images } : {}),
    ...(req.size !== undefined ? { size: req.size } : {}),
    ...(req.quality !== undefined ? { quality: req.quality } : {}),
    ...(req.background !== undefined ? { background: req.background } : {}),
    ...(req.n !== undefined ? { n: req.n } : {}),
    ...(req.outputFormat !== undefined ? { outputFormat: req.outputFormat } : {}),
    ...(req.extra !== undefined ? { extra: req.extra } : {}),
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
