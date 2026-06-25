/**
 * ElevenLabs audio generation provider (speech / music / sound-effect).
 *
 * Runs through the fork's zerogen execution-adapter over the engine's HTTP
 * contract (see `./engine`): the input/output mapping and the audio
 * sub-capability routing (speech vs music vs sound-effect, inferred from the
 * model id) live in `src/execution/zerogen-adapter`, and the provider key is held
 * server-side by the engine (no BYOK). We re-export the dispatch entry point so it
 * matches node-banana's per-provider layout (see route.ts).
 */
export { generateWithElevenLabs } from "./engine";
