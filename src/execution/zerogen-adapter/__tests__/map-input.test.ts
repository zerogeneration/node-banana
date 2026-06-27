import { describe, expect, it } from "vitest";
import {
  normalizeCapabilities,
  toImageRequest,
  toSpeechRequest,
  toTextRequest,
  toVideoRequest,
} from "../map-input";

/**
 * Oracle tests for the moved node-banana → neutral-request mapping. Ported from the
 * playground's `node-banana.test.ts` / `node-banana-text.test.ts` (input-mapping
 * sections) — they assert the mapping's exact shape and subtle blank-input /
 * passthrough behavior survived the relocation into the fork adapter unchanged.
 */

describe("input mappers", () => {
  it("routes known image params to fields and the rest into extra", () => {
    const req = toImageRequest({
      model: { id: "gpt-image-2" },
      prompt: "a cat",
      parameters: { size: "1024x1024", output_format: "webp", n: "2", guidance: 7 },
    });
    expect(req).toEqual({
      model: "gpt-image-2",
      prompt: "a cat",
      size: "1024x1024",
      outputFormat: "webp",
      n: 2,
      extra: { guidance: 7 },
    });
  });

  it("collects images from input.images and dynamicInputs, de-duped", () => {
    const req = toImageRequest({
      model: { id: "fal-ai/flux/dev" },
      prompt: "edit",
      images: ["data:image/png;base64,AAA"],
      dynamicInputs: { image_url: "https://up/x.png", image: "data:image/png;base64,AAA" },
    });
    expect(req.images).toEqual(["data:image/png;base64,AAA", "https://up/x.png"]);
    expect(req.extra).toBeUndefined();
  });

  it("collects node-banana's schema-named image handles (first_frame, start_image, img, photo)", () => {
    const req = toImageRequest({
      model: { id: "m" },
      prompt: "x",
      parameters: { start_image: "https://a/1.png", img: "https://a/2.png", photo: "https://a/3.png" },
    });
    expect(req.images).toEqual(["https://a/1.png", "https://a/2.png", "https://a/3.png"]);
    expect(req.extra).toBeUndefined();
  });

  it("routes first/last-frame handles (first_frame, tail_image_url) to dedicated fields for image-to-video", () => {
    const req = toVideoRequest({
      model: { id: "seedance" },
      prompt: "animate",
      dynamicInputs: { first_frame: "data:image/png;base64,AAA", tail_image_url: "https://cdn/end.png" },
    });
    // First/last-frame mode: dedicated fields, mutually exclusive with reference images.
    expect(req.firstFrame).toBe("data:image/png;base64,AAA");
    expect(req.lastFrame).toBe("https://cdn/end.png");
    expect(req.images).toBeUndefined();
    expect(req.extra).toBeUndefined();
  });

  it("does not sweep non-image params that merely contain 'image' (image_strength) into the frame/images fields", () => {
    const req = toVideoRequest({
      model: { id: "m" },
      prompt: "x",
      parameters: { image_strength: 0.6, image_guidance: "high", first_frame: "https://a/f.png" },
    });
    expect(req.firstFrame).toBe("https://a/f.png");
    expect(req.images).toBeUndefined();
    // The numeric/enum *image* tuning params are not image refs, so they stay in extra.
    expect(req.extra).toEqual({ image_strength: 0.6, image_guidance: "high" });
  });

  it("routes an inpainting mask to the dedicated `mask` field, not into images or extra", () => {
    const req = toImageRequest({
      model: { id: "gpt-image-2" },
      prompt: "replace the sky",
      images: ["https://up/base.png"],
      parameters: { mask: "data:image/png;base64,MMM" },
    });
    expect(req.mask).toBe("data:image/png;base64,MMM");
    expect(req.images).toEqual(["https://up/base.png"]);
    expect(req.extra).toBeUndefined();
  });

  it("accepts mask aliases and never collects an `image_mask` spelling as a reference image", () => {
    const req = toImageRequest({
      model: { id: "gpt-image-2" },
      prompt: "edit",
      images: ["https://up/base.png"],
      dynamicInputs: { image_mask: "https://up/mask.png" },
    });
    expect(req.mask).toBe("https://up/mask.png");
    // The mask spelling contains "image" but is an edit overlay, not a ref image.
    expect(req.images).toEqual(["https://up/base.png"]);
    expect(req.extra).toBeUndefined();
  });

  it("drops a blank/unwired mask input instead of leaking it to extra", () => {
    const req = toImageRequest({
      model: { id: "gpt-image-2" },
      prompt: "a cat",
      parameters: { mask: "   " },
    });
    expect(req.mask).toBeUndefined();
    expect(req.extra).toBeUndefined();
  });

  it("maps video aliases (aspect_ratio, duration, generate_audio)", () => {
    const req = toVideoRequest({
      model: { id: "seedance" },
      prompt: "a robot",
      parameters: { aspect_ratio: "16:9", duration: 5, generate_audio: "true", seed: 99 },
    });
    expect(req).toEqual({
      model: "seedance",
      prompt: "a robot",
      ratio: "16:9",
      durationSeconds: 5,
      generateAudio: true,
      extra: { seed: 99 },
    });
  });

  it("falls back to input.prompt for speech text", () => {
    expect(toSpeechRequest({ model: { id: "eleven_multilingual_v2" }, prompt: "hello" })).toEqual({
      model: "eleven_multilingual_v2",
      text: "hello",
    });
  });

  it("resolves a connected prompt from dynamicInputs when the prompt field is empty", () => {
    // Prompt Constructor -> image node: node-banana sends prompt:"" + dynamicInputs.prompt
    const img = toImageRequest({
      model: { id: "gpt-image-2" },
      prompt: "",
      dynamicInputs: { prompt: "wired from upstream" },
    });
    expect(img.prompt).toBe("wired from upstream");
    expect(img.extra).toBeUndefined(); // prompt is consumed, not leaked into extra

    // array form (node-banana sometimes sends string[]) + speech text fallback
    const speech = toSpeechRequest({
      model: { id: "eleven_multilingual_v2" },
      prompt: "",
      dynamicInputs: { prompt: ["spoken text"] },
    });
    expect(speech.text).toBe("spoken text");
  });

  it("normalizes node-banana's capability vocabulary and synonyms", () => {
    // node-banana's real ModelCapability values
    expect(normalizeCapabilities({ id: "m", capabilities: ["text-to-image"] })).toEqual(["image"]);
    expect(normalizeCapabilities({ id: "m", capabilities: ["image-to-video"] })).toEqual(["video"]);
    expect(normalizeCapabilities({ id: "m", capabilities: "text-to-audio" })).toEqual(["speech"]);
    // short synonyms still work
    expect(normalizeCapabilities({ id: "m", capabilities: ["tts"] })).toEqual(["speech"]);
    expect(normalizeCapabilities({ id: "m", capabilities: "SFX" })).toEqual(["soundEffect"]);
    expect(normalizeCapabilities({ id: "m", capabilities: ["image", "bogus"] })).toEqual(["image"]);
  });
});

describe("toTextRequest", () => {
  it("coerces canonical params and routes the rest into extra", () => {
    const req = toTextRequest({
      model: { id: "claude-opus-4-8" },
      prompt: "hi",
      parameters: {
        system: "sys",
        max_tokens: "200",
        temperature: "0.7",
        top_p: 0.9,
        stop: ["END"],
        guidance: 3,
      },
    });
    expect(req).toEqual({
      model: "claude-opus-4-8",
      prompt: "hi",
      system: "sys",
      maxTokens: 200,
      temperature: 0.7,
      topP: 0.9,
      stop: ["END"],
      extra: { guidance: 3 },
    });
  });

  it("derives structured output from a jsonSchema param", () => {
    const req = toTextRequest({
      model: { id: "m" },
      prompt: "x",
      parameters: { jsonSchema: { type: "object" } },
    });
    expect(req.responseFormat).toEqual({ type: "json", schema: { type: "object" } });
  });

  it("derives plain JSON mode from a json flag (no schema)", () => {
    const req = toTextRequest({ model: { id: "m" }, prompt: "x", parameters: { json: true } });
    expect(req.responseFormat).toEqual({ type: "json" });
  });

  it("consumes a json:false opt-out instead of leaking it into extra", () => {
    const req = toTextRequest({ model: { id: "m" }, prompt: "x", parameters: { json: false } });
    expect(req.responseFormat).toBeUndefined();
    expect(req.extra).toBeUndefined();
  });

  it("falls back to a wired dynamicInputs.prompt when the top-level prompt is empty", () => {
    const req = toTextRequest({
      model: { id: "m" },
      prompt: "",
      dynamicInputs: { prompt: "wired text" },
    });
    expect(req.prompt).toBe("wired text");
  });

  it("falls back to a wired `text` input when prompt and dynamicInputs.prompt are empty", () => {
    const req = toTextRequest({
      model: { id: "m" },
      prompt: "",
      dynamicInputs: { text: "connected text" },
    });
    expect(req.prompt).toBe("connected text");
  });

  it("falls back to an array-valued wired `text` input", () => {
    const req = toTextRequest({
      model: { id: "m" },
      prompt: "",
      dynamicInputs: { text: ["connected text"] },
    });
    expect(req.prompt).toBe("connected text");
  });

  it("preserves a non-JSON responseMimeType in extra (Gemini enum mode)", () => {
    const req = toTextRequest({
      model: { id: "m" },
      prompt: "x",
      parameters: { responseMimeType: "text/x.enum" },
    });
    expect(req.responseFormat).toBeUndefined();
    expect(req.extra).toMatchObject({ responseMimeType: "text/x.enum" });
  });

  it("preserves a native enum responseSchema (mime + schema) in extra, not coerced to JSON", () => {
    const req = toTextRequest({
      model: { id: "m" },
      prompt: "x",
      parameters: { responseMimeType: "text/x.enum", responseSchema: { enum: ["A", "B"] } },
    });
    expect(req.responseFormat).toBeUndefined();
    expect(req.extra).toMatchObject({
      responseMimeType: "text/x.enum",
      responseSchema: { enum: ["A", "B"] },
    });
  });

  it("preserves an object-valued thinking param in extra (Anthropic native config)", () => {
    const req = toTextRequest({
      model: { id: "m" },
      prompt: "x",
      parameters: { thinking: { type: "adaptive" } },
    });
    expect(req.thinking).toBeUndefined();
    expect(req.extra).toMatchObject({ thinking: { type: "adaptive" } });
  });

  it("passes a provider-native response_format object through to extra (not coerced)", () => {
    const nativeFormat = { type: "json_schema", json_schema: { name: "X", schema: { type: "object" } } };
    const req = toTextRequest({
      model: { id: "gpt-5.5" },
      prompt: "x",
      parameters: { response_format: nativeFormat },
    });
    expect(req.responseFormat).toBeUndefined();
    expect(req.extra).toMatchObject({ response_format: nativeFormat });
  });

  it("drops a blank/non-coercible canonical param but preserves a provider-native passthrough", () => {
    const req = toTextRequest({
      model: { id: "m" },
      // temperature "" is an unwired node input → dropped (must not become temperature:""
      // on the provider body); topK is not a canonical field → preserved in extra.
      prompt: "x",
      parameters: { temperature: "", topK: 40 },
    });
    expect(req.temperature).toBeUndefined();
    expect(req.extra).toEqual({ topK: 40 });
  });

  it("consumes responseMimeType when it is application/json", () => {
    const req = toTextRequest({
      model: { id: "m" },
      prompt: "x",
      parameters: { responseMimeType: "application/json" },
    });
    expect(req.responseFormat).toEqual({ type: "json" });
    expect(req.extra).toBeUndefined();
  });

  it("preserves a native Gemini responseSchema in extra even in application/json mode (not coerced to JSON Schema)", () => {
    const req = toTextRequest({
      model: { id: "m" },
      prompt: "x",
      parameters: { responseMimeType: "application/json", responseSchema: { type: "OBJECT", properties: {} } },
    });
    expect(req.responseFormat).toEqual({ type: "json" });
    expect(req.responseFormat?.schema).toBeUndefined();
    expect(req.extra).toEqual({ responseSchema: { type: "OBJECT", properties: {} } });
  });

  it("still folds a generic `schema` object into the canonical responseFormat.schema", () => {
    const req = toTextRequest({
      model: { id: "m" },
      prompt: "x",
      parameters: { json: true, schema: { type: "object" } },
    });
    expect(req.responseFormat).toEqual({ type: "json", schema: { type: "object" } });
    expect(req.extra).toBeUndefined();
  });

  it("drops a blank schema / responseSchema alias instead of leaking it to extra", () => {
    for (const key of ["schema", "responseSchema"]) {
      const req = toTextRequest({
        model: { id: "m" },
        prompt: "x",
        parameters: { [key]: "  " },
      });
      expect(req.extra).toBeUndefined();
    }
  });

  it("drops a blank/unwired structured-output string control instead of leaking it to extra", () => {
    for (const key of ["responseMimeType", "responseFormat", "response_format"]) {
      const req = toTextRequest({
        model: { id: "m" },
        prompt: "x",
        parameters: { [key]: "  " },
      });
      expect(req.responseFormat).toBeUndefined();
      expect(req.extra).toBeUndefined();
    }
  });

  it("drops a blank structured-output control but still preserves a real native passthrough beside it", () => {
    const req = toTextRequest({
      model: { id: "m" },
      prompt: "x",
      parameters: { responseMimeType: "", topK: 40 },
    });
    expect(req.responseFormat).toBeUndefined();
    expect(req.extra).toEqual({ topK: 40 });
  });

  it("collects vision image inputs", () => {
    const req = toTextRequest({
      model: { id: "m" },
      prompt: "describe",
      images: ["https://x/a.png"],
      parameters: { image_url: "https://x/b.png" },
    });
    expect(req.images).toEqual(["https://x/a.png", "https://x/b.png"]);
  });

  it("drops blank/unwired image inputs so a text-only request isn't sent an empty image", () => {
    const req = toTextRequest({
      model: { id: "m" },
      prompt: "just text",
      dynamicInputs: { image: "" },
      parameters: { image_urls: ["", "  ", "https://x/real.png"] },
    });
    expect(req.images).toEqual(["https://x/real.png"]);
  });

  it("leaves images undefined when every image input is blank", () => {
    const req = toTextRequest({
      model: { id: "m" },
      prompt: "just text",
      parameters: { image: "", images: ["  "] },
    });
    expect(req.images).toBeUndefined();
  });

  it("coerces a single stop string into an array", () => {
    const req = toTextRequest({ model: { id: "m" }, prompt: "x", parameters: { stop: "STOP" } });
    expect(req.stop).toEqual(["STOP"]);
  });

  it("coerces reasoningEffort and a boolean thinking shorthand", () => {
    const req = toTextRequest({
      model: { id: "m" },
      prompt: "x",
      parameters: { reasoning_effort: "high", thinking: true },
    });
    expect(req.reasoningEffort).toBe("high");
    expect(req.thinking).toBe(true);
  });

  it("coerces a fine-grained thinking object (budget + includeThoughts)", () => {
    const req = toTextRequest({
      model: { id: "m" },
      prompt: "x",
      parameters: { thinkingBudget: 2048, includeThoughts: true },
    });
    expect(req.thinking).toEqual({ budgetTokens: 2048, includeThoughts: true });
  });

  it("leaves a non-coercible thinking spelling in extra (doesn't consume-and-drop it)", () => {
    const req = toTextRequest({
      model: { id: "m" },
      prompt: "x",
      parameters: { thinkingBudget: { dynamic: true } },
    });
    expect(req.thinking).toBeUndefined();
    expect(req.extra).toMatchObject({ thinkingBudget: { dynamic: true } });
  });

  it("drops a blank/unwired thinking alias instead of leaking it to extra", () => {
    for (const key of ["thinking", "thinkingBudget", "includeThoughts", "thinkingEnabled"]) {
      const req = toTextRequest({
        model: { id: "m" },
        prompt: "x",
        parameters: { [key]: "  " },
      });
      expect(req.thinking).toBeUndefined();
      expect(req.extra).toBeUndefined();
    }
  });

  it("drops a blank thinking alias but preserves a real native passthrough beside it", () => {
    const req = toTextRequest({
      model: { id: "m" },
      prompt: "x",
      parameters: { includeThoughts: "", topK: 40 },
    });
    expect(req.thinking).toBeUndefined();
    expect(req.extra).toEqual({ topK: 40 });
  });

  it('coerces a stringified boolean thinking alias ("false") rather than treating it as blank', () => {
    const req = toTextRequest({
      model: { id: "m" },
      prompt: "x",
      parameters: { includeThoughts: "false" },
    });
    expect(req.thinking).toEqual({ includeThoughts: false });
    expect(req.extra).toBeUndefined();
  });

  it("normalizes a wired chat history (parameters.messages) into messages", () => {
    const req = toTextRequest({
      model: { id: "m" },
      prompt: "",
      parameters: {
        messages: [
          { role: "user", content: "hi" },
          { role: "assistant", content: "yo" },
          { role: "user", content: "again" },
        ],
      },
    });
    expect(req.messages).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "yo" },
      { role: "user", content: "again" },
    ]);
    expect(req.extra).toBeUndefined();
  });

  it("consumes an empty/all-skipped messages history instead of leaking it to extra", () => {
    const req = toTextRequest({
      model: { id: "m" },
      prompt: "use the prompt",
      parameters: { messages: [{ role: "user", content: "   " }, { role: "assistant", content: "" }] },
    });
    expect(req.messages).toBeUndefined();
    expect(req.prompt).toBe("use the prompt");
    expect(req.extra).toBeUndefined();
  });

  it("consumes a blank/unwired string messages input (not a real history)", () => {
    const req = toTextRequest({
      model: { id: "m" },
      prompt: "use the prompt",
      parameters: { messages: "" },
    });
    expect(req.messages).toBeUndefined();
    expect(req.extra).toBeUndefined();
  });

  it("swallows an empty/whitespace/unwired system param instead of leaking it into extra", () => {
    for (const system of ["", "   ", "\n\t"]) {
      const req = toTextRequest({ model: { id: "m" }, prompt: "hi", parameters: { system } });
      expect(req.system).toBeUndefined();
      expect(req.extra).toBeUndefined();
    }
  });

  it("leaves a non-string native system param in extra for the adapter to merge", () => {
    const nativeSystem = [{ type: "text", text: "You are a bot.", cache_control: { type: "ephemeral" } }];
    const req = toTextRequest({ model: { id: "m" }, prompt: "hi", parameters: { system: nativeSystem } });
    expect(req.system).toBeUndefined();
    expect(req.extra).toMatchObject({ system: nativeSystem });
  });

  it("keeps a non-string native system even when a string alias (systemPrompt) is present", () => {
    const nativeSystem = [{ type: "text", text: "You are a bot." }];
    const req = toTextRequest({
      model: { id: "m" },
      prompt: "hi",
      parameters: { system: nativeSystem, systemPrompt: "Be brief." },
    });
    expect(req.system).toBe("Be brief."); // string alias becomes the canonical system
    expect(req.extra).toMatchObject({ system: nativeSystem }); // native preserved for the adapter merge
  });

  it("accepts an array-valued (string[]) system / systemPrompt dynamic input", () => {
    const fromSystem = toTextRequest({
      model: { id: "m" },
      prompt: "hi",
      dynamicInputs: { system: ["Be terse"] },
    });
    expect(fromSystem.system).toBe("Be terse");
    expect(fromSystem.extra).toBeUndefined();

    const fromAlias = toTextRequest({
      model: { id: "m" },
      prompt: "hi",
      dynamicInputs: { systemPrompt: ["Be terse"] },
    });
    expect(fromAlias.system).toBe("Be terse");
    expect(fromAlias.extra).toBeUndefined();
  });

  it("derives the prompt from parameters.prompt when top-level/dynamic prompts are empty", () => {
    const req = toTextRequest({ model: { id: "m" }, prompt: "", parameters: { prompt: "from params" } });
    expect(req.prompt).toBe("from params");
    expect(req.extra).toBeUndefined();
  });

  it("folds system/developer-role messages into the system prompt, not a user turn", () => {
    const req = toTextRequest({
      model: { id: "m" },
      prompt: "",
      parameters: {
        system: "Node config.",
        messages: [
          { role: "system", content: "You are a pirate." },
          { role: "developer", content: "Be concise." },
          { role: "user", content: "hi" },
          { role: "assistant", content: "arr" },
        ],
      },
    });
    expect(req.messages).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "arr" },
    ]);
    // history system/developer content joined, then the system param.
    expect(req.system).toBe("You are a pirate.\n\nBe concise.\n\nNode config.");
  });

  it("leaves a non-array messages value in extra", () => {
    const req = toTextRequest({
      model: { id: "m" },
      prompt: "hi",
      parameters: { messages: "not an array" },
    });
    expect(req.messages).toBeUndefined();
    expect(req.extra).toMatchObject({ messages: "not an array" });
  });

  it("appends a live wired prompt as the final turn alongside a messages history", () => {
    const req = toTextRequest({
      model: { id: "m" },
      prompt: "",
      dynamicInputs: { prompt: "newest question" },
      parameters: {
        messages: [
          { role: "user", content: "hi" },
          { role: "assistant", content: "yo" },
        ],
      },
    });
    expect(req.messages).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "yo" },
      { role: "user", content: "newest question" },
    ]);
  });

  it("falls back to the prompt when every wired message is empty", () => {
    const req = toTextRequest({
      model: { id: "m" },
      prompt: "answer this",
      parameters: { messages: [{ role: "user", content: "  " }] },
    });
    expect(req.messages).toBeUndefined();
    expect(req.prompt).toBe("answer this");
  });
});
