/**
 * The **neutral zerogen engine contract**, sourced from the published
 * `@zerogeneration/engine-client` package (plan §4.3 — the playground's only
 * external surface, generated from `apps/server/src/schemas.ts`).
 *
 * The engine speaks typed generation requests over HTTP — the capability ports
 * serialized, plus a small project/workflow envelope. node-banana's
 * execution-adapter maps the canvas vocabulary onto these shapes and back.
 *
 * **Cutover (PRO-87):** this file used to *vendor* a hand-mirror of the engine
 * contract because the engine hadn't published it. Now that
 * `@zerogeneration/engine-client` is live, the engine wire/body types below are
 * **aliases over the package's generated contract** — there is no second copy to
 * drift. Only node-banana's own types stay declared here:
 *  1. **Neutral request types** — the port shapes (`TextRequest`, `ImageRequest`,
 *     …) the mappers in {@link ./map-input} produce. These are the adapter's
 *     intermediate representation, *not* the wire contract; {@link ./to-engine-request}
 *     serializes them into the package's request bodies.
 *  2. **node-banana view types** — `NbInput` / `NbOutput` / `GenerationOutput`,
 *     the canvas request/result shapes the executor consumes and produces.
 *
 * The **engine wire types** (`EngineJob`, `EngineAsset`, the `Engine*Body`
 * request bodies) are re-exported aliases of the package's `Job` / `components`
 * schemas / `GenerateBody<K>`, so they can never silently diverge from the engine.
 */
import type {
  GenerateBody,
  GenerateKind as EngineClientGenerateKind,
  Job,
} from "@zerogeneration/engine-client";

// ---------------------------------------------------------------------------
// Capability vocabulary (node-banana's routing vocab; mirrors @zerogen/providers' Capability union)
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
  /** Reference images for edit / image-to-image (carried by the engine `/image` contract). */
  images?: string[];
  size?: string;
  quality?: string;
  background?: string;
  outputFormat?: "png" | "jpeg" | "webp";
  n?: number;
  /** Provider-specific passthrough (carried by the engine `/image` contract). */
  extra?: Record<string, unknown>;
}

export interface VideoRequest {
  model: string;
  prompt?: string;
  /** Reference images for image-to-video (mutually exclusive with first/last frame). */
  images?: string[];
  /** First-frame image for first/last-frame video (Seedance); mutually exclusive with `images`. */
  firstFrame?: string;
  /** Last-frame image (requires `firstFrame`); the engine interpolates first → last. */
  lastFrame?: string;
  ratio?: string;
  durationSeconds?: number;
  generateAudio?: boolean;
  /** Provider-specific passthrough (carried by the engine `/video` contract; e.g. seed/resolution). */
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
// Engine wire types — aliases over the published @zerogeneration/engine-client
// contract (the engine's `Job` / asset / `JobResult` shapes the HTTP API returns).
// ---------------------------------------------------------------------------

/** The generation kinds the adapter emits (the engine's served kinds, minus `echo`). */
export type GenerateKind = Exclude<EngineClientGenerateKind, "echo">;

/** The async handle the engine wraps around a run (the package's `Job`). */
export type EngineJob = Job;

export type EngineJobStatus = Job["status"];

/** A finished job's payload (the engine `JobResult`). */
export type EngineJobResult = NonNullable<Job["result"]>;

/** A stored generation artifact (the engine `Asset`; the adapter reads id/assetType/mimeType/url). */
export type EngineAsset = EngineJobResult["assets"][number];

/** The scrubbed error a failed job carries (the engine `SafeError`). */
export type EngineSafeError = NonNullable<Job["error"]>;

// ---------------------------------------------------------------------------
// Engine request bodies — aliases over the package's `GenerateBody<K>` (the
// serialized port request + project/workflow envelope each endpoint accepts).
// ---------------------------------------------------------------------------

/** Run target every generate request carries (a structural subset of every `GenerateBody`). */
export interface EngineTarget {
  /** Project id or slug (must exist). */
  project: string;
  /** Optional workflow id; the engine auto-creates an `api-<kind>` workflow when omitted. */
  workflow?: string;
}

export type EngineImageBody = GenerateBody<"image">;
export type EngineVideoBody = GenerateBody<"video">;
export type EngineSpeechBody = GenerateBody<"speech">;
export type EngineMusicBody = GenerateBody<"music">;
export type EngineSoundEffectBody = GenerateBody<"soundEffect">;
export type EngineTextBody = GenerateBody<"text">;

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
