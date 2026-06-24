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
own types (`@/lib/providers/types`) and the published engine contract package
(`@zerospacestudios/engine-client`).

## Layout

| File | Role |
|---|---|
| `contract.ts` | The neutral engine contract: node-banana's own port-shaped *request* types + node-banana view types declared here; the engine *wire* types (`EngineJob`/`EngineAsset`/the `Engine*Body` bodies) are **aliases over `@zerospacestudios/engine-client`** (plan §4.3 — no vendored copy to drift). |
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

## Status: wired live (byteplus / openai / elevenlabs)

`src/app/api/generate/providers/{byteplus,openai,elevenlabs}.ts` now re-export
this adapter's bindings (via `providers/engine.ts`) instead of the in-process
`@zerospacestudios/providers/node-banana` library-embed. Those three providers run
through the engine over HTTP; **BYOK is gone** for them (the engine holds the
keys, and the route's per-provider 401 gates are removed). gemini / replicate /
fal / kie / wavespeed still run standalone. See `providers/engine.ts` for the
engine target (`ZEROGEN_ENGINE_URL` + `ZEROGEN_PROJECT`).

## Known engine coverage gaps

These are **engine-side** (playground/appliance work), not node-banana work. The
image gaps are **closed** (PRO-110): `/api/generate/image` now carries `images`
(edit / image-to-image), `extra`, `background`, and `n`, so BytePlus Seedream
image-to-image and OpenAI `background`/`n` survive the round trip. Remaining:

1. **No `extra` passthrough on video/speech/music/soundEffect** — only the `image`
   and `text` bodies carry `extra`. Provider-specific tuning params (e.g. a video
   `seed`) on those media requests are dropped. Surface them in
   `to-engine-request.ts` when the engine adds the fields.
2. **`/api/generate/video` carries no source-audio input** — an `audio-to-video`
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

## Cutover status (plan §4.4–§4.6)

Done:

- ✅ **Engine target decided** — `providers/engine.ts` reads `ZEROGEN_ENGINE_URL`
  (default loopback `http://127.0.0.1:4747`) + `ZEROGEN_PROJECT` (default
  `node-banana`), ensuring the dev project exists (`POST /api/projects`, 409 = ok).
- ✅ **Engine `/image` gap closed** (PRO-110) — reference images + `extra` +
  `background` + `n` now ride on the image body.
- ✅ **Bindings flipped** — the three provider files re-export
  `createNodeBananaBindings(ctx).generateWith*`, and the route's BYOK 401 gates are
  removed (the legacy `apiKey` arg is passed as `""`).
- ✅ **Vendored `contract.ts` retired** — the engine wire/body types are now
  aliases over `@zerospacestudios/engine-client`; the private
  `@zerospacestudios/providers` dependency is dropped.

Remaining:

- ✅ **Verified end-to-end (dev)** — exercised byteplus (Seedream image), openai
  (gpt-image-2), and elevenlabs (speech) through a running local engine via the
  opt-in `src/app/api/generate/__tests__/engine-e2e.test.ts` (`ZEROGEN_E2E=1`):
  real `POST /api/projects` → job submit → poll → inlined/url-only outputs.
- ⏳ **Cloud media auth.** On the cloud path (client `authToken` set), url-only
  video/audio/3d outputs are bare engine URLs the browser fetches without the
  bearer. Serve them as **signed URLs** or **proxy** them through the app, or
  protected media fails to load after a successful job. (Out of local-dev scope.)
- ⏳ **Text cutover** — the text executors can't be wired into `/api/generate`
  until the `GenerationOutput` union + `buildMediaResponse` gain a text path (see
  "Output-contract prerequisite" above). Text runs through `/api/llm` today.
- ⏳ **Playground retirement** (other repo) — delete the leftover doc references;
  the `@zerospacestudios/providers/node-banana` subpath is already gone.
