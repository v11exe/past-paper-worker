import { afterEach, describe, expect, it, vi } from "vitest";
import { pageInventoryOutputSchema } from "./schemas";
import { ensurePuterReadyForUserAction, puterStructuredJson } from "./puterAI";

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

describe("ensurePuterReadyForUserAction", () => {
  it("opens the embedded Puter auth flow when the user is signed out", async () => {
    let signedIn = false;
    const authenticateWithPuter = vi.fn(async () => {
      signedIn = true;
    });
    window.__PUTER_TEST_MOCK__ = {
      ai: {
        chat: async () => "ok",
      },
      auth: {
        isSignedIn: () => signedIn,
      },
      ui: {
        authenticateWithPuter,
      },
    };

    await expect(ensurePuterReadyForUserAction()).resolves.toBe(window.__PUTER_TEST_MOCK__);
    expect(authenticateWithPuter).toHaveBeenCalledTimes(1);
  });

  it("returns a friendly error when the Puter sign-in flow is dismissed", async () => {
    window.__PUTER_TEST_MOCK__ = {
      ai: {
        chat: async () => "ok",
      },
      auth: {
        isSignedIn: () => false,
      },
      ui: {
        authenticateWithPuter: async () => {
          throw { error: "auth_window_closed", message: "Authentication window was closed by the user without completing the process." };
        },
      },
    };

    await expect(ensurePuterReadyForUserAction()).rejects.toThrow(
      "Puter sign-in was closed before it finished. Reopen the AI action and complete the sign-in step.",
    );
  });
});
