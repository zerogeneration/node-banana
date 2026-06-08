/**
 * OpenAI image generation provider (gpt-image / dall-e).
 *
 * Thin binding over `@zerogen/providers/node-banana`: the input/output mapping
 * (including the base64 data-URL encoding) is implemented and unit-tested upstream
 * in that package. We only re-export the dispatch entry point so it matches
 * node-banana's per-provider layout (see route.ts).
 */
export { generateWithOpenAI } from "@zerogen/providers/node-banana";
