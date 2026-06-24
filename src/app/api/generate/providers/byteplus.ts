/**
 * BytePlus (Seedream image / Seedance video) generation provider.
 *
 * Runs through the fork's zerogen execution-adapter over the engine's HTTP
 * contract (see `./engine`): the input/output mapping and capability routing live
 * in `src/execution/zerogen-adapter` and the provider key is held server-side by
 * the engine (no BYOK). We re-export the dispatch entry point so it matches
 * node-banana's per-provider layout (see route.ts).
 */
export { generateWithByteplus } from "./engine";
