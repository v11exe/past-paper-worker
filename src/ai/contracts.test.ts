import { describe, expect, it } from "vitest";
import { aiProxyRequestSchema } from "./contracts";

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
