/**
 * Neutral engine result → node-banana output mapping (the "fromEngineResult"
 * output side). Reshaped from the playground's `map-output.ts`: instead of a
 * single in-process `GenAsset`, the input is now the engine's async **Job** —
 * text comes back inline (`result.text`), media comes back as stored **assets**
 * the engine serves over HTTP.
 *
 * node-banana renders `data` directly, so an image must be a base64 **data URL**;
 * the engine serves raw bytes at a relative URL, so an image asset is fetched and
 * inlined here. Large media (video / audio / 3d) stays `{ data: "", url }` —
 * node-banana fetches it lazily, so we never pull a multi-hundred-MB video into
 * the response. Unlike the playground's url-only-image path (which inlined
 * arbitrary provider CDNs and needed SSRF hardening), the asset URL here is the
 * **engine's own** base URL — trusted, injected by the host — so a plain fetch is
 * appropriate.
 */
import type { EngineAsset, EngineJob, NbOutput, NbOutputType } from "./contract";

/** Bytes fetched for an asset, plus the server-reported content type. */
export interface FetchedAsset {
  bytes: Uint8Array;
  contentType?: string;
}

/** Fetches an asset's bytes from an absolute (engine) URL. Injected so it stays host-agnostic + testable. */
export type AssetFetcher = (absoluteUrl: string) => Promise<FetchedAsset>;

export interface FromEngineResultOptions {
  /** Engine base URL the relative asset URLs resolve against (e.g. "http://127.0.0.1:4747"). */
  baseUrl: string;
  /** Fetches image bytes for inlining; only called for image assets. */
  fetchAsset: AssetFetcher;
}

/** Map an asset's mime/type hints to node-banana's output type ("3d" for 3D models). */
function nbTypeForAsset(asset: EngineAsset): NbOutputType {
  const mime = (asset.mimeType ?? "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("model/") || mime.includes("gltf") || mime.includes("glb")) return "3d";
  // Fall back to the engine's declared assetType when the mime is missing/opaque.
  const type = asset.assetType.toLowerCase();
  if (type.includes("video")) return "video";
  if (type.includes("audio")) return "audio";
  if (type.includes("3d") || type.includes("model")) return "3d";
  return "image";
}

/** Resolve the engine's relative asset URL against the base URL. */
function absoluteUrl(asset: EngineAsset, baseUrl: string): string {
  return new URL(asset.url, baseUrl).toString();
}

/**
 * Convert one engine {@link EngineAsset} into node-banana's output shape. Images are
 * fetched and inlined as a data URL (node-banana ignores `url` for images); other
 * media stays url-only `{ data: "", url }` for lazy fetching.
 */
export async function assetToNbOutput(asset: EngineAsset, opts: FromEngineResultOptions): Promise<NbOutput> {
  const type = nbTypeForAsset(asset);
  const url = absoluteUrl(asset, opts.baseUrl);
  if (type !== "image") {
    return { type, data: "", url };
  }
  const { bytes, contentType } = await opts.fetchAsset(url);
  const mimeType = contentType ?? asset.mimeType ?? "image/png";
  const base64 = Buffer.from(bytes).toString("base64");
  return { type, data: `data:${mimeType};base64,${base64}`, url };
}

/**
 * Convert a terminal engine {@link EngineJob} into node-banana outputs. A `text`
 * job carries its result inline (`result.text`) under `type: "text"`; every other
 * kind maps its stored assets via {@link assetToNbOutput} (images fetched together).
 *
 * Assumes a succeeded job — the executor maps a failed/cancelled job to a scrubbed
 * error envelope before calling this. Throws if a succeeded job has no result
 * payload (a contract violation), so it surfaces rather than yielding empty output.
 */
export async function fromEngineResult(job: EngineJob, opts: FromEngineResultOptions): Promise<NbOutput[]> {
  const result = job.result;
  if (!result) {
    throw new Error(`Engine job ${job.id} (${job.kind}) succeeded without a result payload.`);
  }
  if (job.kind === "text") {
    // CUTOVER PREREQUISITE: node-banana's real GenerationOutput union
    // (@/lib/providers/types) is image|video|3d|audio — it has no "text" — and
    // `buildMediaResponse` in the generate route falls unknown types through to the
    // image response. So a text binding MUST NOT be wired into /api/generate until
    // that union and `buildMediaResponse` gain a text path, or generated text gets
    // serialized as an image. node-banana's text generation runs through /api/llm
    // today, so this path is exercised only by a future text cutover. See README.
    return [{ type: "text", data: result.text ?? "" }];
  }
  return Promise.all(result.assets.map((asset) => assetToNbOutput(asset, opts)));
}
