/**
 * OpenAI image generation provider (gpt-image / dall-e).
 *
 * Engine-backed (local-dev cutover): the input/output mapping runs through the
 * fork's execution-adapter against the zerogen engine over HTTP — see `./engine`.
 * Provider keys live server-side in the engine.
 */
import { engineBinding } from "./engine";

export const generateWithOpenAI = engineBinding("openai");
