/**
 * OpenAI image generation provider (gpt-image / dall-e).
 *
 * Runs through the fork's zerogen execution-adapter over the engine's HTTP
 * contract (see `./engine`): the input/output mapping lives in
 * `src/execution/zerogen-adapter` and the provider key is held server-side by the
 * engine (no BYOK). We re-export the dispatch entry point so it matches
 * node-banana's per-provider layout (see route.ts).
 */
export { generateWithOpenAI } from "./engine";
