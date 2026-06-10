/**
 * BytePlus (Seedance) video generation provider.
 *
 * Thin binding over `@zerogen/providers/node-banana`: the input/output mapping,
 * capability routing, and base64 data-URL encoding are implemented and unit-tested
 * upstream in that package. We only re-export the dispatch entry point so it matches
 * node-banana's per-provider layout (see route.ts).
 */
export { generateWithByteplus } from "@zerogen/providers/node-banana";
