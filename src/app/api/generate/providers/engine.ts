/**
 * zerogen engine binding — the live wiring for node-banana's three engine-backed
 * providers (byteplus / openai / elevenlabs).
 *
 * This is the route cutover seam: instead of the in-process library-embed that
 * used to live in `@zerogeneration/providers/node-banana`, these providers now
 * run through the fork's execution-adapter (`src/execution/zerogen-adapter`),
 * which maps node-banana's canvas requests onto the **zerogen engine**'s neutral
 * HTTP contract (the published `@zerogeneration/engine-client`) and back.
 *
 * **BYOK is gone for these three.** The engine holds the provider keys
 * server-side, so node-banana sends none — the route's per-provider API-key gates
 * are removed and the legacy `apiKey` arg is ignored.
 *
 * **Local-dev scope (PRO-87).** The cutover targets a loopback, unauthenticated
 * engine: a single dev project on a base URL from the environment. Cloud concerns
 * (per-user projects, asset-URL signing/proxying, engine auth) are deferred.
 *
 *   ZEROGEN_ENGINE_URL   engine base URL          (default http://127.0.0.1:4747)
 *   ZEROGEN_PROJECT      project id/slug to use   (default "node-banana")
 *   ZEROGEN_AUTH_TOKEN   optional bearer token    (cloud / fronting auth gateway)
 *
 * gemini / replicate / fal / kie / wavespeed still run standalone (their route
 * branches are unchanged); only byteplus / openai / elevenlabs talk to the engine.
 */
import { createEngineClient, createNodeBananaBindings } from "@/execution/zerogen-adapter";
import { engineAuthToken, engineBaseUrl } from "@/lib/engine";

const DEFAULT_PROJECT = "node-banana";

/**
 * Drop-in dispatch signature matching node-banana's per-provider bindings —
 * `(requestId, apiKey, input) => Promise<GenerationOutput>`. Derived from the
 * adapter so the GenerationInput/Output types stay in lockstep with it (apiKey is
 * accepted for compatibility and ignored; the engine holds the keys).
 */
type GenerateBinding = ReturnType<typeof createNodeBananaBindings>["generateWithByteplus"];

interface EngineEnv {
  baseUrl: string;
  project: string;
  authToken?: string;
}

function resolveEnv(): EngineEnv {
  const project = process.env.ZEROGEN_PROJECT?.trim() || DEFAULT_PROJECT;
  const authToken = engineAuthToken();
  return { baseUrl: engineBaseUrl(), project, ...(authToken ? { authToken } : {}) };
}

// Build the client + bindings once per process, lazily, so importing this module
// never touches the network and the env is read at first use (not at import).
let envCache: EngineEnv | null = null;
let bindingsCache: ReturnType<typeof createNodeBananaBindings> | null = null;
let projectReady: Promise<void> | null = null;

function env(): EngineEnv {
  return (envCache ??= resolveEnv());
}

function bindings(): ReturnType<typeof createNodeBananaBindings> {
  if (!bindingsCache) {
    const { baseUrl, project, authToken } = env();
    const client = createEngineClient({ baseUrl, ...(authToken ? { authToken } : {}) });
    bindingsCache = createNodeBananaBindings({ client, target: { project } });
  }
  return bindingsCache;
}

/**
 * Ensure the configured dev project exists before the first generation. The engine
 * 404s a generate against an unknown project, so we create it up front; a 409 means
 * it already exists (idempotent). Memoized to run once; a failure resets the latch
 * so the next request retries instead of being permanently poisoned.
 */
async function ensureProject(): Promise<void> {
  if (!projectReady) {
    projectReady = (async () => {
      const { baseUrl, project, authToken } = env();
      const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/projects`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(authToken ? { authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ name: project, slug: project }),
      });
      // 2xx = created; 409 = already exists. Anything else is a real failure.
      if (!res.ok && res.status !== 409) {
        const detail = (await res.text().catch(() => "")).slice(0, 500);
        throw new Error(
          `Could not reach the zerogen engine to ensure project '${project}' at ${baseUrl} ` +
            `(HTTP ${res.status}). Is the engine running? ${detail}`.trim(),
        );
      }
    })().catch((error: unknown) => {
      projectReady = null; // let the next request retry a transient failure
      throw error;
    });
  }
  return projectReady;
}

/** Wrap an adapter binding so the dev project is ensured before dispatch; engine-down → failure envelope. */
function withEngine(pick: (b: ReturnType<typeof createNodeBananaBindings>) => GenerateBinding): GenerateBinding {
  return async (requestId, apiKey, input) => {
    try {
      await ensureProject();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: `[engine] ${message}` };
    }
    return pick(bindings())(requestId, apiKey, input);
  };
}

export const generateWithByteplus = withEngine((b) => b.generateWithByteplus);
export const generateWithOpenAI = withEngine((b) => b.generateWithOpenAI);
export const generateWithElevenLabs = withEngine((b) => b.generateWithElevenLabs);
