import { afterEach, describe, expect, it } from "vitest";
import { pageInventoryOutputSchema } from "./schemas";
import { puterStructuredJson } from "./puterAI";

afterEach(() => {
  window.__PUTER_TEST_MOCK__ = undefined;
});

describe("puterStructuredJson", () => {
  it("reports Puter API error objects before schema validation", async () => {
    window.__PUTER_TEST_MOCK__ = {
      ai: {
        chat: async () =>
          ({
          error: "Authentication required",
          message: "Authentication required",
          code: "token_required",
          }) as never,
      },
    };

    await expect(puterStructuredJson("inventory", pageInventoryOutputSchema, { debugLabel: "Page inventory" })).rejects.toThrow("Puter returned an API error: Authentication required (token_required)");
  });
});
