# zerogen execution-adapter

node-banana's self-contained binding to the **zerogen generation engine** over
its neutral HTTP contract. This is the node-banana side of
[`docs/plans/node-banana-adapter-extraction.md`](../../../) (the plan lives in the
`zerogen-playground` repo) — the mapping that used to live in
`@zerospacestudios/providers/node-banana` moves **here**, into the fork, as an
isolated module.

## Why it's isolated

Everything lives under `src/execution/zerogen-adapter/` so upstream
`shrimbly/node-banana` rebases never touch it. It depends only on node-banana's
own types (`@/lib/providers/types`) and a vendored copy of the engine contract.

## Layout

| File | Role |
|---|---|
| `contract.ts` | Vendored mirror of the neutral engine HTTP contract: port-shaped request types + engine job/asset wire types. **Swap for the published `@zerogen` contract package when it ships** (plan §4.3). |
| `map-input.ts` | node-banana request → neutral request + capability routing. Moved ~verbatim from the playground; the ported oracle tests prove it survived unchanged. |
| `to-engine-request.ts` | Neutral request → engine HTTP body (`{ kind, endpoint, body }`). The serialization boundary; **fails closed** on capabilities the engine contract can't express. |
| `engine-client.ts` | Injected HTTP transport: `POST /api/generate/{kind}` → 202 job → poll `GET /api/jobs/{id}` until terminal; asset-byte fetch for inlining. Host-agnostic (base URL + auth injected). |
| `map-output.ts` | Terminal engine Job → node-banana outputs. Text inline; images fetched + inlined as data URLs; large media stays url-only. |
| `generate.ts` | Per-provider executor (`executeWith*` + `createNodeBananaBindings`). Capability routing unchanged; the call target is the engine, not an in-process port. |

## Data flow

```
GenerationInput ──map-input──▶ NeutralRequest ──to-engine-request──▶ EngineRequest
                                                                          │
                                                              engine-client.generate (HTTP)
                                                                          ▼
GenerationOutput ◀──map-output (fromEngineResult)──────────────── terminal EngineJob
```

## Status: additive (not yet wired live)

The working `@zerospacestudios/providers/node-banana` library-embed in
`src/app/api/generate/providers/{byteplus,openai,elevenlabs}.ts` is **unchanged**.
This module is built, typechecked, and unit-tested, but nothing imports it into
the request path yet. Flipping the live bindings is the final cutover step (below).

## Known engine coverage gaps (block parts of the cutover)

These are **engine-side** (playground/appliance work), not node-banana work:

1. **`/api/generate/image` has no `images` field** — it is text-to-image only.
   BytePlus Seedream **image-to-image fails closed** here
   (`EngineCoverageError`) rather than silently dropping the references. This is
   the marquee PR #2 capability, so the live byteplus-image cutover is blocked
   until the engine image contract carries reference images.
2. **No `extra` passthrough on image/video/speech/music/soundEffect** — only the
   `text` body carries `extra`. Provider-specific tuning params (e.g. a video
   `seed`) on a media request are dropped. Surface them in `to-engine-request.ts`
   when the engine adds the fields.
3. **`/api/generate/image` exposes only `prompt`/`size`/`quality`/`outputFormat`** —
   the canonical `background` and `n` image fields have no engine field and are
   dropped too (e.g. an OpenAI `background: "transparent"` request falls back to the
   provider default). Same pending engine change as (1)/(2).
4. **`/api/generate/video` carries no source-audio input** — an `audio-to-video`
   model can't deliver the audio that defines it (the video body has only `images`),
   so the executor **fails closed** rather than running video without the audio.
   Forward the audio from `videoRequest` and drop the guard once the engine video
   contract accepts audio.

### Output-contract prerequisite (text)

The text executors return `{ type: "text" }`, but node-banana's real
`GenerationOutput` union (`@/lib/providers/types`) is `image | video | 3d | audio`
and the generate route's `buildMediaResponse` falls unknown types through to the
**image** response. A text binding therefore **cannot** be wired into
`/api/generate` until that union and `buildMediaResponse` gain a text path — else
generated text is serialized as an image. (Text generation runs through `/api/llm`
today, so this only matters for a future text cutover.)

## Remaining live-cutover steps (plan §4.4–§4.6)

1. **Decide the engine target.** The engine is project-scoped; pick how
   node-banana provisions/derives a `project` (and base URL) — e.g. a
   `ZEROGEN_ENGINE_URL` + `ZEROGEN_PROJECT` env pair for dev, a per-user project
   in cloud.
2. **Close the engine `/image` gap** (reference images + `extra`) so byteplus
   image-to-image survives the cutover.
3. **Flip the bindings.** Replace the re-exports in
   `src/app/api/generate/providers/{byteplus,openai,elevenlabs}.ts` with
   `createNodeBananaBindings(ctx).generateWith*` (drop-in `(requestId, apiKey,
   input)` signature — `apiKey` is ignored; the engine holds keys). For any **text**
   binding, first extend the `GenerationOutput` union + `buildMediaResponse` with a
   text path (see "Output-contract prerequisite" above).
   - **Remove the route's BYOK 401 gates.** The `byteplus`/`openai`/`elevenlabs`
     branches in `src/app/api/generate/route.ts` return **401 unless a provider API
     key is present** before they call `generateWith*`. Since the engine holds the
     keys, those gates must be removed/rewritten as part of the flip, or
     engine/cloud-auth-only users are blocked from the engine path.
   - **Cloud media auth.** On the cloud path (client `authToken` set), url-only
     video/audio/3d outputs are bare engine URLs the browser fetches without the
     bearer. Serve them as **signed URLs** or **proxy** them through the app before
     the cutover, or protected media fails to load after a successful job.
4. **Verify end-to-end** (dev: node-banana → local engine; cloud: web app →
   engine), then remove the `@zerospacestudios/providers` dependency.
5. **Swap the vendored `contract.ts`** for the published `@zerogen` contract
   package once it exists.
