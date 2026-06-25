/**
 * Shared zerogen-engine target + reachability helpers.
 *
 * The engine-backed providers (byteplus / openai / elevenlabs) run through the
 * zerogen engine over HTTP (it holds their provider keys). Both the generation
 * bindings (`src/app/api/generate/providers/engine.ts`) and model discovery
 * (`src/app/api/models/route.ts`) need the same engine target and a way to tell
 * whether the engine is up — those models are only available when the engine is.
 *
 * Local-dev scope (PRO-87): a loopback, unauthenticated engine by default.
 *   ZEROGEN_ENGINE_URL   engine base URL        (default http://127.0.0.1:4747)
 *   ZEROGEN_AUTH_TOKEN   optional bearer token  (cloud / fronting auth gateway)
 */
const DEFAULT_ENGINE_URL = "http://127.0.0.1:4747";

/** Resolved engine base URL (trailing slashes stripped). */
export function engineBaseUrl(): string {
  return (process.env.ZEROGEN_ENGINE_URL?.trim() || DEFAULT_ENGINE_URL).replace(/\/+$/, "");
}

/** Optional bearer token for a fronting auth gateway (cloud); undefined in local dev. */
export function engineAuthToken(): string | undefined {
  return process.env.ZEROGEN_AUTH_TOKEN?.trim() || undefined;
}

// Short-TTL memo so model discovery (a hot endpoint) doesn't probe the engine on
// every request. A loopback engine answers in ~ms whether up (200) or down
// (connection refused), so the cache mostly caps latency for a remote/unreachable
// ZEROGEN_ENGINE_URL (where the probe waits out the timeout).
let cache: { expires: number; value: boolean } | null = null;
let inflight: Promise<boolean> | null = null;

/**
 * Whether the zerogen engine is reachable. Probes `GET /api/providers` (a cheap,
 * in-memory engine endpoint) with a short timeout; returns false on any error.
 * Result is memoized for `ttlMs`. Pass `{ force: true }` to bypass the cache.
 */
export async function isEngineReachable(
  opts: { timeoutMs?: number; ttlMs?: number; force?: boolean } = {},
): Promise<boolean> {
  const { timeoutMs = 2000, ttlMs = 10_000, force = false } = opts;
  const now = Date.now();
  if (!force && cache && cache.expires > now) return cache.value;
  if (!force && inflight) return inflight;

  const run = (async (): Promise<boolean> => {
    const token = engineAuthToken();
    let ok = false;
    try {
      const res = await fetch(`${engineBaseUrl()}/api/providers`, {
        method: "GET",
        headers: token ? { authorization: `Bearer ${token}` } : {},
        signal: AbortSignal.timeout(timeoutMs),
      });
      ok = res.ok;
    } catch {
      ok = false;
    }
    cache = { expires: Date.now() + ttlMs, value: ok };
    inflight = null;
    return ok;
  })();

  if (!force) inflight = run;
  return run;
}

/** Test/maintenance hook: clear the memoized reachability result. */
export function resetEngineReachabilityCache(): void {
  cache = null;
  inflight = null;
}
