/**
 * zerogen execution-adapter — node-banana's self-contained binding to the
 * zerogen generation **engine** over its neutral HTTP contract.
 *
 * Isolated on purpose (plan §2): upstream `shrimbly/node-banana` rebases never
 * touch this directory. The mapping (`map-input` / `map-output`) moved ~verbatim
 * from the playground's `@zerospacestudios/providers/node-banana`; the executor
 * (`generate`) is reshaped to talk to the engine via an injected HTTP client
 * (`engine-client`) instead of an in-process provider port.
 *
 * Status: **additive**. The working `@zerospacestudios/providers/node-banana`
 * library-embed in `src/app/api/generate/providers/*` is unchanged. See README.md
 * for the remaining live-cutover steps and the known engine coverage gaps.
 */
export * from "./contract";
export * from "./map-input";
export * from "./map-output";
export * from "./engine-client";
export * from "./to-engine-request";
export * from "./generate";
