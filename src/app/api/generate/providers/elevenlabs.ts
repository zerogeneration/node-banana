/**
 * ElevenLabs audio generation provider (speech / music / sound-effect).
 *
 * Thin binding over `@zerogen/providers/node-banana`: the input/output mapping and
 * the audio sub-capability routing (speech vs music vs sound-effect, inferred from
 * the model id) are implemented and unit-tested upstream in that package. We only
 * re-export the dispatch entry point so it matches node-banana's per-provider
 * layout (see route.ts).
 */
export { generateWithElevenLabs } from "@zerogen/providers/node-banana";
