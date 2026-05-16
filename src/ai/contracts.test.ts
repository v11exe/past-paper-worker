import { describe, expect, it } from "vitest";
import { aiProxyRequestSchema } from "./contracts";
import { DEFAULT_AI_MODEL, resolveAIModelConfig, inferProviderFromModel } from "./providerTypes";

describe("aiProxyRequestSchema", () => {
  it("accepts page inventory requests with more than four media items", () => {
    const payload = aiProxyRequestSchema.parse({
      operation: "page_inventory",
      model: "gemini-2.5-flash-lite",
      prompt: "Inventory this paper.",
      media: Array.from({ length: 6 }, (_, index) => ({
        mimeType: "image/png",
        dataBase64: Buffer.from(`image-${index}`).toString("base64"),
      })),
    });

    expect(payload.media).toHaveLength(6);
  });
});

describe("AI provider resolution", () => {
  it("uses Claude Sonnet as the default model", () => {
    expect(DEFAULT_AI_MODEL).toBe("claude-sonnet-4-6");
    expect(resolveAIModelConfig(DEFAULT_AI_MODEL)).toMatchObject({
      provider: "anthropic",
      label: "Claude Sonnet 4.6",
    });
  });

  it("resolves Claude and Gemini model prefixes to the right providers", () => {
    expect(inferProviderFromModel("claude-sonnet-4-6")).toBe("anthropic");
    expect(inferProviderFromModel("gemini-2.5-flash-lite")).toBe("gemini");
    expect(resolveAIModelConfig("gemini-2.5-flash-lite")).toMatchObject({ provider: "gemini" });
  });
});
