/**
 * Vendored mirror of the **neutral zerogen engine contract**.
 *
 * The engine (`@zerogen/server`, `apps/server/src/schemas.ts`) speaks typed
 * generation requests over HTTP — the capability ports serialized, plus a small
 * project/workflow envelope. node-banana's execution-adapter maps the canvas
 * vocabulary onto these shapes and back.
 *
 * Why a hand-mirror? The engine has not yet published its contract as a
 * consumable package (plan §4.3 — `@zerogen/server` is still `private`). Until it
 * does, the fork pins a structural copy here. **This file is the single place to
 * realign** if the engine contract drifts; when the package ships, replace these
 * declarations with imports from it.
 *
 * Two layers live here:
 *  1. **Neutral request types** — the B2-stable port shapes (`TextRequest`,
 *     `ImageRequest`, …) the mappers in {@link ./map-input} produce. The engine's
 *     request bodies mirror these (a serialized port request + envelope).
 *  2. **Engine wire types** — the async job/asset shapes the engine returns
 *     (`EngineJob`, `EngineAsset`, …) that {@link ./map-output} consumes.
 */

// ---------------------------------------------------------------------------
// Capability vocabulary (mirrors @zerogen/providers' Capability union)
// ---------------------------------------------------------------------------

export type Capability = "image" | "video" | "speech" | "music" | "soundEffect" | "text";

// ---------------------------------------------------------------------------
// Neutral request types (the B2 ports — what the mappers produce)
// ---------------------------------------------------------------------------

/** One conversation turn. `content` is plain text; images ride on {@link TextRequest.images}. */
export interface TextMessage {
  role: "user" | "assistant";
  content: string;
}

/** Opt-in structured output (provider-portable JSON / JSON-Schema mode). */
export interface TextResponseFormat {
  type: "json";
  schema?: Record<string, unknown>;
  name?: string;
  strict?: boolean;
}

/** Reasoning effort level, normalized across providers. */
export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/** Normalized control over a model's internal "thinking" / reasoning trace. */
export interface TextThinking {
  enabled?: boolean;
  budgetTokens?: number;
  includeThoughts?: boolean;
}

/** Normalized text-generation request (mirrors the engine's `GenerateTextBody` minus the envelope). */
export interface TextRequest {
  model: string;
  prompt?: string;
  messages?: TextMessage[];
  system?: string;
  images?: string[];
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stop?: string[];
  responseFormat?: TextResponseFormat;
  reasoningEffort?: ReasoningEffort;
  thinking?: boolean | TextThinking;
  /** Escape hatch for provider-specific params (engine `text` accepts this; media kinds do not). */
  extra?: Record<string, unknown>;
}

export interface ImageRequest {
  model: string;
  prompt: string;
  /** Reference images for edit / image-to-image. NOT yet carried by the engine `/image` contract. */
  images?: string[];
  size?: string;
  quality?: string;
  background?: string;
  outputFormat?: "png" | "jpeg" | "webp";
  n?: number;
  /** Provider-specific passthrough. NOT yet carried by the engine `/image` contract. */
  extra?: Record<string, unknown>;
}

export interface VideoRequest {
  model: string;
  prompt?: string;
  /** Reference / first-frame images (data URLs or http URLs) — carried by the engine `/video` contract. */
  images?: string[];
  ratio?: string;
  durationSeconds?: number;
  generateAudio?: boolean;
  /** Provider-specific passthrough. NOT yet carried by the engine `/video` contract. */
  extra?: Record<string, unknown>;
}

export interface SpeechRequest {
  model: string;
  text: string;
  voiceId?: string;
  outputFormat?: string;
  extra?: Record<string, unknown>;
}

export interface MusicRequest {
  model: string;
  prompt: string;
  lengthMs?: number;
  outputFormat?: string;
  extra?: Record<string, unknown>;
}

export interface SoundEffectRequest {
  model: string;
  prompt: string;
  durationSeconds?: number;
  outputFormat?: string;
  extra?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// node-banana input view (a structural subset of the real GenerationInput)
// ---------------------------------------------------------------------------

/**
 * The fields the capability-routing helpers read off a model. Kept loose
 * (`capabilities?: string | string[]`) on purpose: node-banana's tag vocabulary
 * carries arbitrary strings and synonyms ("tts", "image-to-text", "sfx", …) that
 * the real {@link ../../lib/providers/types.ModelCapability} union does not list.
 * The real `ProviderModel` is structurally assignable to this.
 */
export interface CapabilityModel {
  id: string;
  capabilities?: string | string[];
}

/**
 * The structural view of a node-banana generation request the mappers consume.
 * The real {@link ../../lib/providers/types.GenerationInput} is assignable to it,
 * so the executor passes the real type straight through — this is a function
 * parameter contract, not a competing mirror of node-banana's request.
 */
export interface NbInput {
  model: CapabilityModel;
  prompt?: string;
  images?: string[];
  parameters?: Record<string, unknown>;
  dynamicInputs?: Record<string, string | string[]>;
}

// ---------------------------------------------------------------------------
// node-banana output shape (what the canvas renders)
// ---------------------------------------------------------------------------

export type NbOutputType = "image" | "video" | "audio" | "3d" | "text";

/**
 * A single node-banana output artifact. For media, `data` is a base64 **data URL**
 * (empty when delivered url-only); for `"text"`, `data` carries the generated text
 * verbatim.
 */
export interface NbOutput {
  type: NbOutputType;
  data: string;
  url?: string;
}

/** node-banana's per-generation result envelope (matches `@/lib/providers/types` GenerationOutput). */
export interface GenerationOutput {
  success: boolean;
  outputs?: NbOutput[];
  /** Scrubbed, human-readable failure message (never carries secrets). */
  error?: string;
}

// ---------------------------------------------------------------------------
// Engine wire types (what the HTTP API returns)
// ---------------------------------------------------------------------------

/** The generation kinds the engine serves (mirrors `JOB_KINDS`, minus `echo`). */
export type GenerateKind = "image" | "video" | "speech" | "music" | "soundEffect" | "text";

export type EngineJobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface EngineSafeError {
  name: string;
  message: string;
  retryable?: boolean;
}

/** A stored generation artifact (mirrors the engine `Asset`; only the fields the adapter needs). */
export interface EngineAsset {
  id: string;
  assetType: string;
  mimeType: string | null;
  /** Relative URL that serves the asset bytes (resolved against the engine base URL). */
  url: string;
}

/** A finished job's payload (mirrors the engine `JobResult`). */
export interface EngineJobResult {
  runId: string;
  assets: EngineAsset[];
  /** Generated text for a `text` job; null for media kinds. */
  text: string | null;
  finishReason: string | null;
}

/** The async handle the engine wraps around a run (mirrors the engine `Job`). */
export interface EngineJob {
  id: string;
  kind: GenerateKind | "echo";
  status: EngineJobStatus;
  runId: string | null;
  error: EngineSafeError | null;
  result: EngineJobResult | null;
  /** Relative URL of the job's SSE event stream. */
  eventsUrl: string;
}

// ---------------------------------------------------------------------------
// Engine request bodies (the neutral request + the project/workflow envelope)
// ---------------------------------------------------------------------------

/** Run target every generate request carries. */
export interface EngineTarget {
  /** Project id or slug (must exist). */
  project: string;
  /** Optional workflow id; the engine auto-creates an `api-<kind>` workflow when omitted. */
  workflow?: string;
}

interface EngineEnvelope extends EngineTarget {
  metadata?: Record<string, unknown>;
}

export interface EngineImageBody extends EngineEnvelope {
  prompt: string;
  provider: string;
  model?: string;
  size?: string;
  quality?: string;
  outputFormat?: "png" | "jpeg" | "webp";
}

export interface EngineVideoBody extends EngineEnvelope {
  prompt?: string;
  images?: string[];
  provider: string;
  model?: string;
  ratio?: string;
  durationSeconds?: number;
  generateAudio?: boolean;
  referenceMode?: "direct" | "trusted";
}

export interface EngineSpeechBody extends EngineEnvelope {
  text: string;
  provider: string;
  model?: string;
  voiceId?: string;
  outputFormat?: string;
}

export interface EngineMusicBody extends EngineEnvelope {
  prompt: string;
  provider: string;
  model?: string;
  lengthMs?: number;
  outputFormat?: string;
}

export interface EngineSoundEffectBody extends EngineEnvelope {
  prompt: string;
  provider: string;
  model?: string;
  durationSeconds?: number;
  outputFormat?: string;
}

export interface EngineTextBody extends EngineEnvelope {
  provider: string;
  model?: string;
  prompt?: string;
  messages?: TextMessage[];
  system?: string;
  images?: string[];
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stop?: string[];
  responseFormat?: TextResponseFormat;
  reasoningEffort?: ReasoningEffort;
  thinking?: boolean | TextThinking;
  extra?: Record<string, unknown>;
}

export type EngineBody =
  | EngineImageBody
  | EngineVideoBody
  | EngineSpeechBody
  | EngineMusicBody
  | EngineSoundEffectBody
  | EngineTextBody;

/** A fully-formed engine request: which kind, which endpoint, and the body to POST. */
export interface EngineRequest {
  kind: GenerateKind;
  /** Endpoint path relative to the engine base URL, e.g. "/api/generate/image". */
  endpoint: string;
  body: EngineBody;
}
