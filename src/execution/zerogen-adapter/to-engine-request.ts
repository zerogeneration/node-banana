/**
 * Neutral request → engine HTTP request (`{ kind, endpoint, body }`). This is the
 * serialization boundary between the moved mapping (port-shaped neutral requests)
 * and the engine's typed generate contract (the published
 * `@zerospacestudios/engine-client` `GenerateBody<K>` shapes).
 *
 * ## Engine coverage notes (current contract)
 *
 * The image body carries the full canonical surface — reference `images` (edit /
 * image-to-image), `background`, `n`, and the `extra` escape hatch (PRO-110). The
 * video body now also carries `firstFrame`/`lastFrame` (Seedance first/last-frame)
 * and `extra` (provider params like `seed`/`resolution` survive the round trip).
 * The remaining narrowings are media-side:
 *  - **No `extra` passthrough on speech/music/soundEffect** — only the `image`,
 *    `video`, and `text` bodies carry `extra`. Provider-specific tuning params on
 *    those audio requests are dropped here; surface them below once the engine
 *    adds the fields.
 *  - **`/api/generate/video` carries no source-audio input** (only image/frame
 *    inputs). An `audio-to-video` model can't deliver the audio that defines it,
 *    so the executor **fails closed** (`declaresAudioToVideo` → reject) rather than
 *    running video without the audio. Forward the audio from {@link videoRequest}
 *    and drop the guard once the engine video contract accepts an audio input.
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
  // The engine image body carries the full canonical surface: reference images
  // (edit / image-to-image), background, n, and the `extra` escape hatch. The
  // engine enforces per-provider capability (e.g. it rejects reference images for
  // a text-to-image-only provider like OpenAI), so the adapter forwards rather
  // than failing closed.
  const body: EngineImageBody = {
    ...envelope(ctx),
    provider: ctx.provider,
    model: req.model,
    prompt: req.prompt,
    ...(req.images !== undefined ? { images: req.images } : {}),
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
    ...(req.firstFrame !== undefined ? { firstFrame: req.firstFrame } : {}),
    ...(req.lastFrame !== undefined ? { lastFrame: req.lastFrame } : {}),
    ...(req.ratio !== undefined ? { ratio: req.ratio } : {}),
    ...(req.durationSeconds !== undefined ? { durationSeconds: req.durationSeconds } : {}),
    ...(req.generateAudio !== undefined ? { generateAudio: req.generateAudio } : {}),
    ...(req.extra !== undefined ? { extra: req.extra } : {}),
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
