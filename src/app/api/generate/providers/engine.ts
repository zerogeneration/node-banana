/**
 * Engine-backed node-banana provider bindings — the local-dev cutover.
 *
 * Replaces the in-process `@zerospacestudios/providers/node-banana` library-embed:
 * byteplus / openai / elevenlabs now run through the **zerogen engine** over HTTP,
 * via the fork's execution-adapter (`@/execution/zerogen-adapter`). Provider keys
 * live server-side in the engine (BYOK is gone), so no key travels from here.
 *
 * Local-dev scoped: points at a loopback engine and a single dev project, both
 * overridable by env:
 *   ZEROGEN_ENGINE_URL  (default http://127.0.0.1:4747)
 *   ZEROGEN_PROJECT     (default "node-banana")
 * The dev project is ensured (created if missing) once per process on first use.
 */
import {
  createEngineClient,
  createNodeBananaBindings,
  type GenerationOutput,
  type NodeBananaProvider,
  type ZerogenExecutorContext,
} from "@/execution/zerogen-adapter";
import type { GenerationInput } from "@/lib/providers/types";

const ENGINE_URL = (process.env.ZEROGEN_ENGINE_URL ?? "http://127.0.0.1:4747").replace(/\/+$/, "");
const PROJECT = process.env.ZEROGEN_PROJECT ?? "node-banana";

type Bindings = ReturnType<typeof createNodeBananaBindings>;

let bindingsPromise: Promise<Bindings> | null = null;

/**
 * Ensure the dev project exists. Idempotent: the engine returns 409 when the slug
 * already exists, which we treat as success. Any other non-OK status is an error.
 */
async function ensureProject(): Promise<void> {
  const response = await fetch(`${ENGINE_URL}/api/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: PROJECT, slug: PROJECT }),
  });
  if (response.ok || response.status === 409) return;
  const detail = await response.text().catch(() => "");
  throw new Error(`engine project ensure failed (${response.status}) at ${ENGINE_URL}: ${detail.slice(0, 200)}`);
}

/** Build the adapter bindings once (project ensured, client constructed); memoized per process. */
function getBindings(): Promise<Bindings> {
  if (!bindingsPromise) {
    bindingsPromise = (async () => {
      await ensureProject();
      const ctx: ZerogenExecutorContext = {
        client: createEngineClient({ baseUrl: ENGINE_URL }),
        target: { project: PROJECT },
      };
      return createNodeBananaBindings(ctx);
    })().catch((error) => {
      // Don't cache a failed init (e.g. the engine isn't running) — let the next call retry.
      bindingsPromise = null;
      throw error;
    });
  }
  return bindingsPromise;
}

/**
 * An engine-backed `generateWith*` for one provider, matching node-banana's dispatch
 * signature `(requestId, apiKey, input) => Promise<GenerationOutput>`. `apiKey` is
 * accepted for drop-in compatibility and **ignored** (the engine holds provider keys).
 * A connection/init failure (engine down, project ensure failed) returns a scrubbed
 * failure envelope rather than throwing, matching the binding contract.
 */
export function engineBinding(
  provider: NodeBananaProvider,
): (requestId: string, apiKey: string, input: GenerationInput) => Promise<GenerationOutput> {
  return async (requestId, _apiKey, input) => {
    try {
      const bindings = await getBindings();
      return await bindings.nodeBananaProviders[provider](requestId, _apiKey, input);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `[${provider}] engine request failed: ${message} (is the zerogen engine running at ${ENGINE_URL}?)`,
      };
    }
  };
}
