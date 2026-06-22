/**
 * Engine HTTP transport — the "reshape" the extraction plan calls for: the
 * in-process `port.generate(req)` call becomes an **engine HTTP request**.
 *
 * The engine's generate API is async + job-based: `POST /api/generate/{kind}`
 * returns `202` with a {@link EngineJob}; the caller polls `GET /api/jobs/{id}`
 * until the job is terminal. This client hides that handshake behind a single
 * `generate(request)` that resolves only once the job has settled — matching the
 * adapter's synchronous `execute()` shape.
 *
 * **Host-agnostic by construction:** the base URL and the (optional) auth token
 * are injected, so the same client runs in node-banana (dev → local engine,
 * unauthenticated) and the web app (cloud → engine with a zerogen user token).
 * No provider key ever travels here — the engine holds them (BYOK is gone).
 */
import type { EngineJob, EngineRequest, EngineJobStatus } from "./contract";
import type { FetchedAsset } from "./map-output";

/** A failed engine call. `status` is the HTTP status when the failure was an HTTP error. */
export class EngineError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "EngineError";
    if (status !== undefined) this.status = status;
  }
}

export interface EngineClient {
  /** Engine base URL the relative asset URLs resolve against. */
  readonly baseUrl: string;
  /** Submit a generation request and resolve once its job is terminal (succeeded/failed/cancelled). */
  generate(request: EngineRequest): Promise<EngineJob>;
  /** Fetch an asset's bytes from an absolute (engine) URL — for inlining images. */
  fetchAsset(absoluteUrl: string): Promise<FetchedAsset>;
}

export interface EngineClientConfig {
  /** Engine base URL, e.g. "http://127.0.0.1:4747" (no trailing slash required). */
  baseUrl: string;
  /** Optional bearer token (cloud); omit in local dev (the engine is unauthenticated). */
  authToken?: string;
  /** Injected fetch (defaults to the global). Lets the host supply a custom transport / lets tests stub it. */
  fetch?: typeof fetch;
  /** Poll cadence while a job runs (ms). Default 1000. */
  pollIntervalMs?: number;
  /** Give up polling after this long (ms). Default 600_000 (10 min, matches the route's maxDuration). */
  jobTimeoutMs?: number;
}

const TERMINAL: ReadonlySet<EngineJobStatus> = new Set<EngineJobStatus>([
  "succeeded",
  "failed",
  "cancelled",
]);

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Pull a human-readable message out of the engine's `{ error }` body (or fall back to status text). */
async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body?.error === "string" && body.error) return body.error;
  } catch {
    // non-JSON body; fall through
  }
  return `${response.status} ${response.statusText}`.trim();
}

export function createEngineClient(config: EngineClientConfig): EngineClient {
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  const doFetch = config.fetch ?? globalThis.fetch;
  const pollIntervalMs = config.pollIntervalMs ?? 1000;
  const jobTimeoutMs = config.jobTimeoutMs ?? 600_000;
  if (!doFetch) throw new EngineError("No fetch implementation available for the engine client.");

  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(config.authToken ? { authorization: `Bearer ${config.authToken}` } : {}),
  };

  async function submit(request: EngineRequest): Promise<EngineJob> {
    const response = await doFetch(`${baseUrl}${request.endpoint}`, {
      method: "POST",
      headers,
      body: JSON.stringify(request.body),
    });
    if (response.status !== 202) {
      throw new EngineError(await errorMessage(response), response.status);
    }
    return (await response.json()) as EngineJob;
  }

  async function getJob(id: string): Promise<EngineJob> {
    const response = await doFetch(`${baseUrl}/api/jobs/${encodeURIComponent(id)}`, { headers });
    if (!response.ok) {
      throw new EngineError(await errorMessage(response), response.status);
    }
    return (await response.json()) as EngineJob;
  }

  async function awaitTerminal(job: EngineJob): Promise<EngineJob> {
    let current = job;
    const deadline = Date.now() + jobTimeoutMs;
    while (!TERMINAL.has(current.status)) {
      if (Date.now() > deadline) {
        throw new EngineError(`Engine job ${current.id} did not settle within ${jobTimeoutMs}ms.`);
      }
      await sleep(pollIntervalMs);
      current = await getJob(current.id);
    }
    return current;
  }

  return {
    baseUrl,
    async generate(request: EngineRequest): Promise<EngineJob> {
      const job = await submit(request);
      return TERMINAL.has(job.status) ? job : awaitTerminal(job);
    },
    async fetchAsset(absoluteUrl: string): Promise<FetchedAsset> {
      const response = await doFetch(absoluteUrl, { headers: config.authToken ? { authorization: headers.authorization! } : {} });
      if (!response.ok) {
        throw new EngineError(await errorMessage(response), response.status);
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      const contentType = response.headers.get("content-type") ?? undefined;
      return { bytes, ...(contentType ? { contentType } : {}) };
    },
  };
}
