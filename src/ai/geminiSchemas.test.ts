import { describe, expect, it } from "vitest";
import { assertGeminiSchemaCompatible } from "./geminiSchemas";

describe("assertGeminiSchemaCompatible", () => {
  it("throws when a schema contains unsupported Gemini keywords", () => {
    expect(() =>
      assertGeminiSchemaCompatible({
        type: "object",
        properties: {
          result: {
            $ref: "#/definitions/result",
          },
        },
      }),
    ).toThrow("unsupported keyword $ref");

    expect(() =>
      assertGeminiSchemaCompatible({
        type: "object",
        properties: {
          result: {
            anyOf: [{ type: "string" }, { type: "null" }],
          },
        },
      }),
    ).toThrow("unsupported keyword anyOf");
  });
});
