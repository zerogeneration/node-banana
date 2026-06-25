/**
 * node-banana request → neutral engine request mapping (the "toEngineRequest"
 * input side). Moved ~verbatim from the playground's
 * `@zerospacestudios/providers/node-banana` so the mapping — and its subtle
 * blank-input / passthrough behavior — survives the relocation unchanged; the
 * ported tests are the oracle that it did. The only edits vs. the original are
 * the import retargets: neutral request types come from {@link ./contract}
 * instead of the engine's internal ports, and the node-banana input is the real
 * canvas type (a structural {@link NbInput} view here).
 */
import type {
  Capability,
  CapabilityModel,
  ImageRequest,
  MusicRequest,
  NbInput,
  SoundEffectRequest,
  SpeechRequest,
  TextMessage,
  TextRequest,
  VideoRequest,
} from "./contract";

// --- Capability routing -----------------------------------------------------

/**
 * node-banana capability tags (and common synonyms) → our {@link Capability}.
 *
 * node-banana's real `ModelCapability` vocabulary is task-shaped
 * ("text-to-image", "image-to-video", …); those are the values actually sent, so
 * they map first. `text-to-audio` is generic audio → defaults to `speech`;
 * elevenlabs sub-routing (speech vs music vs soundEffect) is decided by model id
 * in {@link generate.ts}, since node-banana can't express it via capability.
 * `text-to-3d` / `image-to-3d` are intentionally unmapped (no 3d capability).
 */
const CAPABILITY_ALIASES: Record<string, Capability> = {
  // node-banana ModelCapability values
  "text-to-image": "image",
  "image-to-image": "image",
  "text-to-video": "video",
  "image-to-video": "video",
  "audio-to-video": "video",
  "text-to-audio": "speech",
  // short synonyms / other consumers
  image: "image",
  video: "video",
  speech: "speech",
  tts: "speech",
  "text-to-speech": "speech",
  music: "music",
  soundeffect: "soundEffect",
  "sound-effect": "soundEffect",
  sound_effect: "soundEffect",
  sfx: "soundEffect",
  // text generation (LLM) — providers route image vs text by these tags
  text: "text",
  "text-to-text": "text",
  "text-generation": "text",
  "image-to-text": "text", // vision → text (e.g. captioning); routes to the text adapter, which accepts images
  chat: "text",
  completion: "text",
  llm: "text",
};

/** Normalize a model's capability hint(s) to our capability vocabulary. */
export function normalizeCapabilities(model: CapabilityModel): Capability[] {
  const raw = model.capabilities;
  const tags = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const out: Capability[] = [];
  for (const tag of tags) {
    const cap = CAPABILITY_ALIASES[tag.toLowerCase().trim()];
    if (cap && !out.includes(cap)) out.push(cap);
  }
  return out;
}

/**
 * Choose which capability to run: the first of the model's declared
 * capabilities that this provider supports, else `fallback`. Single-capability
 * providers pass a one-element `supported` and never really branch.
 */
export function pickCapability(
  model: CapabilityModel,
  supported: Capability[],
  fallback: Capability,
): Capability {
  return normalizeCapabilities(model).find((c) => supported.includes(c)) ?? fallback;
}

/**
 * True when the model declares a 3D capability (`text-to-3d` / `image-to-3d`).
 * We have no 3D port, and {@link normalizeCapabilities} drops those tags — so a
 * 3D model would otherwise fall through to the image fallback and return a bogus
 * image. Callers use this to fail closed instead.
 */
export function declaresThreeD(model: CapabilityModel): boolean {
  const raw = model.capabilities;
  const tags = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return tags.some((tag) => tag.toLowerCase().includes("3d"));
}

/**
 * True when the model declares `audio-to-video` (audio-conditioned video). The
 * capability alias routes it to the video path — a *supported* capability, so
 * {@link unsupportedCapability} does NOT catch it — but the engine
 * `/api/generate/video` body has no source-audio input field, so the audio that
 * defines the request would be silently dropped. Callers fail closed instead.
 */
export function declaresAudioToVideo(model: CapabilityModel): boolean {
  const raw = model.capabilities;
  const tags = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return tags.some((tag) => tag.toLowerCase().trim().replace(/_/g, "-") === "audio-to-video");
}

/**
 * True when a model declares a capability that `supported` doesn't cover (or any 3D
 * tag). A model with no declared capability is allowed (back-compat fallback). Used
 * by single-/dual-capability bindings to fail closed on unsupported modalities
 * (video, audio/speech, 3D, …) instead of silently routing them to a wrong adapter.
 */
export function unsupportedCapability(model: CapabilityModel, supported: Capability[]): boolean {
  const raw = model.capabilities;
  const rawTags = Array.isArray(raw) ? raw : raw ? [raw] : [];
  // A genuinely untagged model is allowed (back-compat fallback). But a model that
  // DID declare tags none of which map to a supported capability — including tags
  // dropped as unrecognized (e.g. `audio-to-text`, `text-to-music`) — fails closed,
  // rather than slipping through because normalizeCapabilities returned [].
  if (!rawTags.some((tag) => tag.trim() !== "")) return false;
  if (declaresThreeD(model)) return true;
  return !normalizeCapabilities(model).some((c) => supported.includes(c));
}

// --- Value coercion ---------------------------------------------------------
// `parameters` are typed `unknown` and `dynamicInputs` are `string | string[]`,
// so canonical fields are coerced defensively before reaching a typed request.

function strOpt(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** First non-empty string from a `string | string[]` value (node-banana's array form). */
function firstString(v: unknown): string | undefined {
  if (typeof v === "string") return v.length > 0 ? v : undefined;
  if (Array.isArray(v)) {
    const first = v.find((item): item is string => typeof item === "string" && item.length > 0);
    return first;
  }
  return undefined;
}

/**
 * True when a `system` value is a provider-native shape to PRESERVE (an object, or an
 * array containing non-strings — e.g. Anthropic TextBlockParam[]). A string or a plain
 * `string[]` (node-banana's dynamic-input form) is NOT native — it's coerced to a
 * canonical string via {@link firstString}.
 */
function isNativeSystem(value: unknown): boolean {
  if (typeof value === "string") return false;
  if (Array.isArray(value)) return value.some((element) => typeof element !== "string");
  return value != null;
}

function numOpt(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

function boolOpt(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return undefined;
}

function secondsToMs(seconds: number | undefined): number | undefined {
  return seconds == null ? undefined : Math.round(seconds * 1000);
}

// --- Param / image collection ----------------------------------------------

/** Merge static parameters with live dynamicInputs (dynamic wins on conflict). */
function mergedParams(input: NbInput): Record<string, unknown> {
  return { ...(input.parameters ?? {}), ...(input.dynamicInputs ?? {}) };
}

/**
 * Param keys that carry input images, so they route to `images`, not `extra`.
 * Mirrors node-banana's own image input patterns (`INPUT_PATTERNS.image` in
 * `src/app/api/generate/schemaUtils.ts`) plus camelCase / frame variants, so a
 * handle wired under any of these schema names (e.g. a Seedance `first_frame`) is
 * collected instead of left in `extra` — which the engine media bodies drop,
 * silently degrading image-to-video to text-to-video.
 */
const IMAGE_INPUT_KEYS = [
  "image",
  "images",
  "image_url",
  "image_urls",
  "referenceImages",
  "reference_images",
  "reference_image",
  "first_frame",
  "last_frame",
  "start_image",
  "init_image",
  "input_image",
  "image_input",
  "source_image",
  "tail_image_url",
  "img",
  "photo",
];

/**
 * A schema-named image/frame handle NOT in {@link IMAGE_INPUT_KEYS}. node-banana
 * derives handle names from each model's OpenAPI schema, so an image input can
 * arrive under an unanticipated key. Match the generate route's own detection
 * (the key contains "image" or "frame"); to avoid sweeping in numeric tuning
 * params like `image_strength`, only image-like *values* are collected from these
 * keys (see {@link looksLikeImageRef}).
 */
function isSchemaImageKey(key: string): boolean {
  if (IMAGE_INPUT_KEYS.includes(key)) return false;
  const k = key.toLowerCase();
  return k.includes("image") || k.includes("frame");
}

/** True for a string that looks like an image source (data URL, http(s), asset:, blob:). */
function looksLikeImageRef(v: unknown): v is string {
  return typeof v === "string" && /^\s*(data:|https?:|asset:|blob:)/i.test(v);
}

/**
 * Gather input images from `input.images`, the canonical {@link IMAGE_INPUT_KEYS},
 * and any schema-named image/frame handle. Returns the collected images plus the
 * schema-named keys consumed, so callers keep those out of `extra`.
 *
 * Skips blank/whitespace entries: an unwired node-banana image input arrives as ""
 * (or an array with blanks), which would otherwise become an empty image URL on the
 * request or a downloadToBuffer("") downstream and fail an otherwise valid request.
 */
function collectImages(input: NbInput): { images?: string[]; schemaKeys: string[] } {
  const out: string[] = [];
  const schemaKeys: string[] = [];
  const push = (v: unknown): boolean => {
    if (typeof v === "string" && v.trim() !== "") {
      out.push(v);
      return true;
    }
    return false;
  };
  if (input.images) for (const src of input.images) push(src);
  const bag = mergedParams(input);
  for (const [key, value] of Object.entries(bag)) {
    if (IMAGE_INPUT_KEYS.includes(key)) {
      if (Array.isArray(value)) for (const item of value) push(item);
      else push(value);
    } else if (isSchemaImageKey(key)) {
      let consumed = false;
      if (Array.isArray(value)) {
        for (const item of value) if (looksLikeImageRef(item) && push(item)) consumed = true;
      } else if (looksLikeImageRef(value)) {
        consumed = push(value);
      }
      if (consumed) schemaKeys.push(key);
    }
  }
  const seen = new Set<string>();
  const deduped = out.filter((u) => (seen.has(u) ? false : (seen.add(u), true)));
  return { ...(deduped.length > 0 ? { images: deduped } : {}), schemaKeys };
}

/** Everything in `params` except the consumed `keys`, for the `extra` escape hatch. */
function leftover(params: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) if (!keys.includes(k)) rest[k] = v;
  return rest;
}

/** node-banana's model.id is the model; an explicit `model` param may override. */
function modelId(input: NbInput, params: Record<string, unknown>): string {
  return strOpt(params.model) ?? strOpt(params.modelId) ?? input.model.id;
}

/**
 * Resolve the effective prompt. node-banana sends `prompt: ""` and the real text
 * via `dynamicInputs.prompt` when a Prompt Constructor node is wired in, so fall
 * back to the dynamic value (string or first array element) when the top-level
 * prompt is empty. Without this the canonical (empty) prompt would win and the
 * connected text would be lost.
 */
function resolvePrompt(input: NbInput): string {
  if (input.prompt) return input.prompt;
  const dynamic = input.dynamicInputs?.prompt;
  if (typeof dynamic === "string") return dynamic;
  if (Array.isArray(dynamic) && typeof dynamic[0] === "string") return dynamic[0];
  return input.prompt ?? "";
}

// --- Per-capability mappers -------------------------------------------------

const IMAGE_KEYS = [
  "prompt",
  "size",
  "quality",
  "background",
  "outputFormat",
  "output_format",
  "n",
  "model",
  "modelId",
  ...IMAGE_INPUT_KEYS,
];

function imageOutputFormat(params: Record<string, unknown>): ImageRequest["outputFormat"] {
  const v = strOpt(params.outputFormat) ?? strOpt(params.output_format);
  return v === "png" || v === "jpeg" || v === "webp" ? v : undefined;
}

export function toImageRequest(input: NbInput): ImageRequest {
  const params = mergedParams(input);
  const { images, schemaKeys } = collectImages(input);
  const rest = leftover(params, [...IMAGE_KEYS, ...schemaKeys]);
  const format = imageOutputFormat(params);
  return {
    model: modelId(input, params),
    prompt: resolvePrompt(input),
    ...(images ? { images } : {}),
    ...(strOpt(params.size) ? { size: strOpt(params.size) } : {}),
    ...(strOpt(params.quality) ? { quality: strOpt(params.quality) } : {}),
    ...(strOpt(params.background) ? { background: strOpt(params.background) } : {}),
    ...(format ? { outputFormat: format } : {}),
    ...(numOpt(params.n) != null ? { n: numOpt(params.n) } : {}),
    ...(Object.keys(rest).length > 0 ? { extra: rest } : {}),
  };
}

// NOTE: the in-process `toFalImageRequest` (which relocated `outputFormat` into
// `extra.output_format` for `FalImageGenerator`) is intentionally NOT carried over.
// On the engine path the engine owns fal's field-name translation, and its image body
// accepts the canonical `outputFormat` — so the fal executor uses {@link toImageRequest}
// directly, keeping `outputFormat` rather than burying it in `extra` (which the engine
// image body drops).

// First/last-frame inputs (Seedance) ride on dedicated `firstFrame`/`lastFrame`
// fields, mutually exclusive with reference `images`. node-banana wires them as
// `first_frame_url`/`last_frame_url`; the canonical/camelCase spellings are also
// accepted.
const FIRST_FRAME_KEYS = ["first_frame_url", "first_frame", "firstFrame"];
const LAST_FRAME_KEYS = ["last_frame_url", "last_frame", "lastFrame", "tail_image_url"];

const VIDEO_KEYS = [
  "prompt",
  "ratio",
  "aspect_ratio",
  "aspectRatio",
  "duration",
  "durationSeconds",
  "duration_seconds",
  "generateAudio",
  "generate_audio",
  "model",
  "modelId",
  ...IMAGE_INPUT_KEYS,
];

/** First non-blank image-like value across the given keys (string or first array element). */
function pickFrame(params: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const v = firstString(params[key]);
    if (v && v.trim() !== "") return v;
  }
  return undefined;
}

export function toVideoRequest(input: NbInput): VideoRequest {
  const params = mergedParams(input);
  const firstFrame = pickFrame(params, FIRST_FRAME_KEYS);
  const lastFrame = pickFrame(params, LAST_FRAME_KEYS);
  const { images: collected, schemaKeys } = collectImages(input);
  // Frame keys never leak into `extra` (they have dedicated fields).
  const rest = leftover(params, [...VIDEO_KEYS, ...FIRST_FRAME_KEYS, ...LAST_FRAME_KEYS, ...schemaKeys]);
  // First/last-frame mode wins: it's mutually exclusive with `images` on the engine,
  // so drop reference images (and the frame values themselves) when a first frame is set.
  const frameValues = new Set([firstFrame, lastFrame].filter((v): v is string => Boolean(v)));
  const refImages = collected?.filter((u) => !frameValues.has(u));
  const useFrames = firstFrame !== undefined;
  const images = useFrames ? undefined : refImages && refImages.length > 0 ? refImages : undefined;
  const prompt = resolvePrompt(input);
  const ratio = strOpt(params.ratio) ?? strOpt(params.aspect_ratio) ?? strOpt(params.aspectRatio);
  const duration =
    numOpt(params.durationSeconds) ?? numOpt(params.duration_seconds) ?? numOpt(params.duration);
  const generateAudio = boolOpt(params.generateAudio) ?? boolOpt(params.generate_audio);
  return {
    model: modelId(input, params),
    ...(prompt ? { prompt } : {}),
    ...(useFrames ? { firstFrame } : {}),
    ...(useFrames && lastFrame ? { lastFrame } : {}),
    ...(images ? { images } : {}),
    ...(ratio ? { ratio } : {}),
    ...(duration != null ? { durationSeconds: duration } : {}),
    ...(generateAudio != null ? { generateAudio } : {}),
    ...(Object.keys(rest).length > 0 ? { extra: rest } : {}),
  };
}

const SPEECH_KEYS = [
  "voiceId",
  "voice_id",
  "voice",
  "outputFormat",
  "output_format",
  "model",
  "modelId",
  "text",
  "prompt",
];

export function toSpeechRequest(input: NbInput): SpeechRequest {
  const params = mergedParams(input);
  const rest = leftover(params, SPEECH_KEYS);
  const voiceId = strOpt(params.voiceId) ?? strOpt(params.voice_id) ?? strOpt(params.voice);
  const outputFormat = strOpt(params.outputFormat) ?? strOpt(params.output_format);
  return {
    model: modelId(input, params),
    text: strOpt(params.text) ?? resolvePrompt(input),
    ...(voiceId ? { voiceId } : {}),
    ...(outputFormat ? { outputFormat } : {}),
    ...(Object.keys(rest).length > 0 ? { extra: rest } : {}),
  };
}

const MUSIC_KEYS = [
  "prompt",
  "lengthMs",
  "length_ms",
  "durationMs",
  "duration",
  "durationSeconds",
  "duration_seconds",
  "outputFormat",
  "output_format",
  "model",
  "modelId",
];

export function toMusicRequest(input: NbInput): MusicRequest {
  const params = mergedParams(input);
  const rest = leftover(params, MUSIC_KEYS);
  const lengthMs =
    numOpt(params.lengthMs) ??
    numOpt(params.length_ms) ??
    numOpt(params.durationMs) ??
    secondsToMs(numOpt(params.durationSeconds) ?? numOpt(params.duration_seconds) ?? numOpt(params.duration));
  const outputFormat = strOpt(params.outputFormat) ?? strOpt(params.output_format);
  return {
    model: modelId(input, params),
    prompt: resolvePrompt(input),
    ...(lengthMs != null ? { lengthMs } : {}),
    ...(outputFormat ? { outputFormat } : {}),
    ...(Object.keys(rest).length > 0 ? { extra: rest } : {}),
  };
}

const SFX_KEYS = [
  "prompt",
  "durationSeconds",
  "duration_seconds",
  "duration",
  "outputFormat",
  "output_format",
  "model",
  "modelId",
];

export function toSoundEffectRequest(input: NbInput): SoundEffectRequest {
  const params = mergedParams(input);
  const rest = leftover(params, SFX_KEYS);
  const durationSeconds =
    numOpt(params.durationSeconds) ?? numOpt(params.duration_seconds) ?? numOpt(params.duration);
  const outputFormat = strOpt(params.outputFormat) ?? strOpt(params.output_format);
  return {
    model: modelId(input, params),
    prompt: resolvePrompt(input),
    ...(durationSeconds != null ? { durationSeconds } : {}),
    ...(outputFormat ? { outputFormat } : {}),
    ...(Object.keys(rest).length > 0 ? { extra: rest } : {}),
  };
}

/** Coerce a stop value (string or string[]) into a non-empty string[]. */
function stopOpt(v: unknown): string[] | undefined {
  if (typeof v === "string" && v.length > 0) return [v];
  if (Array.isArray(v)) {
    const out = v.filter((s): s is string => typeof s === "string" && s.length > 0);
    if (out.length > 0) return out;
  }
  return undefined;
}

/**
 * Param bag that records which keys are consumed into canonical {@link TextRequest}
 * fields; whatever is left becomes `extra`. This inverts the old fixed blocklist: a
 * key is stripped from `extra` only when the binding actually used its value, so any
 * provider-native field the binding doesn't normalize — a non-JSON `responseMimeType`,
 * a `thinking` object, an OpenAI `response_format` object, an unknown sampling knob —
 * survives in `extra` for verbatim passthrough instead of being silently dropped.
 */
class TextParams {
  private readonly bag: Record<string, unknown>;
  private readonly used = new Set<string>();

  constructor(input: NbInput) {
    this.bag = mergedParams(input);
  }

  /** Raw value for a key (does not mark it consumed). */
  at(key: string): unknown {
    return this.bag[key];
  }

  /** Mark keys consumed so they won't appear in `extra` (for bespoke extractors). */
  consume(...keys: string[]): void {
    for (const key of keys) this.used.add(key);
  }

  /**
   * Coerce the first recognized value across a pure-canonical alias group (temperature,
   * maxTokens, …). The whole group is consumed whenever ANY spelling is present — even
   * if it's blank/non-coercible (an unwired node-banana input sends `""`) — so a junk
   * value is dropped rather than leaked into `extra` and spread onto the provider body.
   * Provider-native escape-hatch keys are handled by the bespoke extractors, not here.
   */
  pick<T>(coerce: (v: unknown) => T | undefined, keys: string[]): T | undefined {
    let result: T | undefined;
    let present = false;
    for (const key of keys) {
      if (this.bag[key] !== undefined) present = true;
      const value = coerce(this.bag[key]);
      if (value !== undefined && result === undefined) result = value;
    }
    if (present) this.consume(...keys);
    return result;
  }

  /** The params not consumed into a canonical field. */
  extra(): Record<string, unknown> | undefined {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(this.bag)) {
      if (!this.used.has(key)) out[key] = value;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }
}

/**
 * Consume any of `keys` whose value is a blank/whitespace STRING — an unwired node-banana
 * input sends `""` for a default-valued control. Dropping it here keeps it out of `extra`
 * (and so off the provider body, where an empty sampling/format/thinking field 400s). A
 * non-string native value (object/array) is left untouched for verbatim passthrough.
 */
function consumeBlankStrings(p: TextParams, keys: string[]): void {
  for (const key of keys) {
    const v = p.at(key);
    if (typeof v === "string" && v.trim() === "") p.consume(key);
  }
}

/**
 * Derive an optional structured-output request, consuming only the keys it actually
 * uses. A native (non-JSON) `responseMimeType` (e.g. Gemini "text/x.enum") returns
 * early without consuming, so it — and any `responseSchema` beside it — passes
 * through `extra`. `responseSchema` (Gemini's own OpenAPI-dialect field) is NEVER
 * folded into the canonical (JSON Schema) `schema` even in `application/json` mode, so
 * it reaches the SDK under the field the caller named instead of being rewritten to
 * `responseJsonSchema`. Likewise an OpenAI `response_format` *object* isn't recognized
 * as the string "json", so it survives in `extra` too.
 */
function extractResponseFormat(p: TextParams): TextRequest["responseFormat"] {
  // Pure binding vocab (never provider-native body fields): consume whenever present
  // so an explicit opt-out like { json: false } doesn't leak into `extra`.
  for (const key of ["json", "jsonSchema", "json_schema", "schemaName", "responseName", "strict"]) {
    if (p.at(key) !== undefined) p.consume(key);
  }
  // A blank/whitespace structured-output STRING control (an unwired node-banana default
  // sends "") must not leak into `extra` and get spread onto the body — an empty
  // `responseMimeType` / `response_format:""` / `schema:""` breaks Gemini/OpenAI. A real
  // value (a non-JSON mime, an object `response_format`/`responseSchema`) is left untouched.
  consumeBlankStrings(p, ["responseMimeType", "responseFormat", "response_format", "schema", "responseSchema"]);
  const explicitMime = strOpt(p.at("responseMimeType"));
  if (explicitMime && explicitMime.toLowerCase() !== "application/json") return undefined;

  // `responseSchema` is intentionally excluded: it's Gemini's native (OpenAPI-dialect)
  // schema field, preserved verbatim in `extra` rather than coerced into the canonical
  // JSON-Schema `schema`. Generic callers use `schema`/`jsonSchema`/`json_schema`.
  const schemaKey = ["jsonSchema", "json_schema", "schema"].find(
    (key) => p.at(key) != null && typeof p.at(key) === "object",
  );
  const schema = schemaKey ? (p.at(schemaKey) as Record<string, unknown>) : undefined;
  const formatIsJson = (key: string): boolean => strOpt(p.at(key))?.toLowerCase() === "json";
  const wantsJson =
    boolOpt(p.at("json")) === true ||
    formatIsJson("responseFormat") ||
    formatIsJson("response_format") ||
    explicitMime?.toLowerCase() === "application/json" ||
    schema != null;
  if (!wantsJson) return undefined;

  // Consume exactly the keys that produced this JSON request.
  if (p.at("json") != null) p.consume("json");
  if (p.at("responseMimeType") != null) p.consume("responseMimeType");
  if (formatIsJson("responseFormat")) p.consume("responseFormat");
  if (formatIsJson("response_format")) p.consume("response_format");
  if (schemaKey) p.consume(schemaKey);
  const name = strOpt(p.at("schemaName")) ?? strOpt(p.at("responseName"));
  if (p.at("schemaName") != null) p.consume("schemaName");
  if (p.at("responseName") != null) p.consume("responseName");
  const strict = boolOpt(p.at("strict"));
  if (p.at("strict") != null) p.consume("strict");

  return {
    type: "json",
    ...(schema ? { schema } : {}),
    ...(name ? { name } : {}),
    ...(strict != null ? { strict } : {}),
  };
}

/**
 * Derive the optional `thinking` control. Our normalized spellings are always
 * consumed; a bare `thinking` is consumed only when it's a recognized scalar, so a
 * provider-native `thinking` object (e.g. Anthropic's { type: "adaptive" }) survives
 * in `extra`.
 */
function extractThinking(p: TextParams): TextRequest["thinking"] {
  const enabled =
    boolOpt(p.at("thinking")) ?? boolOpt(p.at("thinkingEnabled")) ?? boolOpt(p.at("thinking_enabled"));
  const budgetTokens =
    numOpt(p.at("thinkingBudget")) ?? numOpt(p.at("thinking_budget")) ?? numOpt(p.at("budgetTokens"));
  const includeThoughts = boolOpt(p.at("includeThoughts")) ?? boolOpt(p.at("include_thoughts"));
  // Consume each spelling only when it actually coerced, so a non-coercible
  // provider-native value (e.g. a Gemini thinkingConfig object) survives in `extra`.
  if (boolOpt(p.at("thinking")) !== undefined) p.consume("thinking");
  if (boolOpt(p.at("thinkingEnabled")) !== undefined) p.consume("thinkingEnabled");
  if (boolOpt(p.at("thinking_enabled")) !== undefined) p.consume("thinking_enabled");
  if (numOpt(p.at("thinkingBudget")) !== undefined) p.consume("thinkingBudget");
  if (numOpt(p.at("thinking_budget")) !== undefined) p.consume("thinking_budget");
  if (numOpt(p.at("budgetTokens")) !== undefined) p.consume("budgetTokens");
  if (boolOpt(p.at("includeThoughts")) !== undefined) p.consume("includeThoughts");
  if (boolOpt(p.at("include_thoughts")) !== undefined) p.consume("include_thoughts");
  // A blank/whitespace alias (e.g. an unwired `includeThoughts: ""` or `thinkingBudget: ""`)
  // coerces to undefined above, so it would otherwise leak into `extra` and be spread onto
  // the provider config as a stray field — drop it. A native object value still survives.
  consumeBlankStrings(p, [
    "thinking",
    "thinkingEnabled",
    "thinking_enabled",
    "thinkingBudget",
    "thinking_budget",
    "budgetTokens",
    "includeThoughts",
    "include_thoughts",
  ]);

  if (enabled == null && budgetTokens == null && includeThoughts == null) return undefined;
  // Bare boolean → shorthand form; otherwise the fine-grained object.
  if (enabled != null && budgetTokens == null && includeThoughts == null) return enabled;
  return {
    ...(enabled != null ? { enabled } : {}),
    ...(budgetTokens != null ? { budgetTokens } : {}),
    ...(includeThoughts != null ? { includeThoughts } : {}),
  };
}

/**
 * Normalize a wired chat history (`parameters.messages`) into {@link TextMessage}s
 * plus any `system`/`developer`-role content (folded into the canonical system
 * prompt instead of becoming a user turn). The `messages` key is binding vocab, so it's
 * consumed whenever present in its expected array (or blank-string) form — even when the
 * history is empty/all-skipped — so it never leaks into `extra`. A non-array, non-blank
 * value is left untouched for verbatim passthrough.
 */
function extractMessages(p: TextParams): { messages?: TextMessage[]; system?: string } {
  const raw = p.at("messages");
  // A blank/unwired string `messages` input is dropped (never a real history).
  if (typeof raw === "string" && raw.trim() === "") {
    p.consume("messages");
    return {};
  }
  if (!Array.isArray(raw)) return {};
  // `messages` is binding vocab (the wired chat history), never a provider-native body
  // field — consume it up front so an empty or all-skipped history still doesn't leak
  // into `extra` (the Gemini adapter would otherwise spread a stray `messages` onto its
  // GenerateContentConfig and 400 a prompt-only request that fell back to `prompt`).
  p.consume("messages");
  const messages: TextMessage[] = [];
  const systemParts: string[] = [];
  for (const entry of raw) {
    const content = (entry as { content?: unknown } | null)?.content;
    // Skip non-string and empty/whitespace content so an all-empty history falls back
    // to the prompt path rather than producing an empty turn that providers reject.
    if (!(entry && typeof entry === "object" && typeof content === "string" && content.trim() !== "")) {
      continue;
    }
    const role = (entry as { role?: unknown }).role;
    if (role === "system" || role === "developer") {
      systemParts.push(content);
    } else {
      messages.push({ role: role === "assistant" ? "assistant" : "user", content });
    }
  }
  if (messages.length === 0 && systemParts.length === 0) return {};
  return {
    ...(messages.length > 0 ? { messages } : {}),
    ...(systemParts.length > 0 ? { system: systemParts.join("\n\n") } : {}),
  };
}

/**
 * Map a node-banana request to our normalized {@link TextRequest}. Canonical fields
 * are coerced from their common spellings; `prompt` falls back to a wired
 * `dynamicInputs.prompt` (see {@link resolvePrompt}) and then a generic `text` input;
 * image-bearing params become vision inputs. Anything not consumed into a canonical
 * field lands in `extra` for provider-specific passthrough (see {@link TextParams}).
 */
export function toTextRequest(input: NbInput): TextRequest {
  const p = new TextParams(input);
  const { images, schemaKeys } = collectImages(input);
  p.consume(...IMAGE_INPUT_KEYS, ...schemaKeys);

  const model = strOpt(p.at("model")) ?? strOpt(p.at("modelId")) ?? input.model.id;
  p.consume("model", "modelId");

  // `system` is BOTH a canonical alias AND the Anthropic native escape hatch: a string
  // or string[] value is coerced (and consumed), but a NON-string native value (e.g. a
  // TextBlockParam[] cache block) is left in `extra` for the adapter to merge — even
  // when a string alias like `systemPrompt` is also present. `systemPrompt`/
  // `system_prompt` are pure aliases (not native body fields), so always consume them
  // when present, and accept their string[] dynamic-input form via firstString.
  const rawSystem = p.at("system");
  const systemIsNative = isNativeSystem(rawSystem);
  if (rawSystem !== undefined && !systemIsNative) p.consume("system");
  for (const key of ["systemPrompt", "system_prompt"]) {
    if (p.at(key) !== undefined) p.consume(key);
  }
  const rawParamSystem =
    (systemIsNative ? undefined : firstString(rawSystem)) ??
    firstString(p.at("systemPrompt")) ??
    firstString(p.at("system_prompt"));
  // A whitespace-only system param is treated as unset (don't surface "   ").
  const paramSystem = rawParamSystem && rawParamSystem.trim() !== "" ? rawParamSystem : undefined;
  const maxTokens = p.pick(numOpt, ["maxTokens", "max_tokens", "maxOutputTokens", "max_output_tokens"]);
  const temperature = p.pick(numOpt, ["temperature"]);
  const topP = p.pick(numOpt, ["topP", "top_p"]);
  const stop = p.pick(stopOpt, ["stop", "stopSequences", "stop_sequences"]);
  const reasoningEffort = p.pick(strOpt, ["reasoningEffort", "reasoning_effort", "effort"]);
  const responseFormat = extractResponseFormat(p);
  const thinking = extractThinking(p);
  const chat = extractMessages(p);
  // A `system`/`developer` message inside the history becomes the canonical system
  // prompt (joined with any `system` param) rather than a user turn.
  const system = [chat.system, paramSystem].filter((s): s is string => Boolean(s)).join("\n\n") || undefined;

  // Prompt resolution: top-level/dynamicInputs prompt (resolvePrompt), then a
  // `parameters.prompt`, then a generic `text` input — so a prompt wired under any of
  // these isn't dropped (and `prompt`/`text` are consumed, not leaked to `extra`).
  const prompt = resolvePrompt(input) || firstString(p.at("prompt")) || firstString(p.at("text")) || "";
  p.consume("prompt", "text");
  // When a chat history (messages) and a live wired prompt are BOTH present, append the
  // live prompt as the final user turn so it isn't dropped by the "messages win" rule.
  const finalMessages =
    chat.messages && prompt.trim() !== ""
      ? [...chat.messages, { role: "user" as const, content: prompt }]
      : chat.messages;

  const extra = p.extra();
  return {
    model,
    prompt,
    ...(finalMessages ? { messages: finalMessages } : {}),
    ...(images ? { images } : {}),
    ...(system ? { system } : {}),
    ...(maxTokens != null ? { maxTokens } : {}),
    ...(temperature != null ? { temperature } : {}),
    ...(topP != null ? { topP } : {}),
    ...(stop ? { stop } : {}),
    ...(responseFormat ? { responseFormat } : {}),
    ...(reasoningEffort ? { reasoningEffort: reasoningEffort as TextRequest["reasoningEffort"] } : {}),
    ...(thinking != null ? { thinking } : {}),
    ...(extra ? { extra } : {}),
  };
}
