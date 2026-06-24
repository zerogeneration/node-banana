/**
 * zerogen execution-adapter — node-banana's self-contained binding to the
 * zerogen generation **engine** over its neutral HTTP contract.
 *
 * Isolated on purpose (plan §2): upstream `shrimbly/node-banana` rebases never
 * touch this directory. The mapping (`map-input` / `map-output`) moved ~verbatim
 * from the playground's `@zerospacestudios/providers/node-banana`; the executor
 * (`generate`) is reshaped to talk to the engine via an injected HTTP client
 * (`engine-client`) instead of an in-process provider port. The engine contract
 * types come from the published `@zerospacestudios/engine-client` (see `contract`).
 *
 * Status: **wired live** for byteplus / openai / elevenlabs — `src/app/api/generate/
 * providers/{byteplus,openai,elevenlabs}.ts` re-export these bindings via
 * `providers/engine.ts`. See README.md for the cutover status and the remaining
 * engine coverage gaps.
 */
export * from "./contract";
export * from "./map-input";
export * from "./map-output";
export * from "./engine-client";
export * from "./to-engine-request";
export * from "./generate";
