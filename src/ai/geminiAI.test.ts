import { afterEach, describe, expect, it } from "vitest";
import { pageInventoryOutputSchema } from "./schemas";
import { aiChat, aiStructuredJson, ensureAIReadyForUserAction, runAISmokeTest } from "./geminiAI";

afterEach(() => {
  window.__AI_TEST_MOCK__ = undefined;
});

describe("ensureAIReadyForUserAction", () => {
  it("accepts the test mock as a valid provider target", async () => {
    window.__AI_TEST_MOCK__ = {
      respond: async (request) => ({ ok: true, operation: request.operation, model: request.model, text: "ok" }),
    };

    await expect(ensureAIReadyForUserAction()).resolves.toBe("__AI_TEST_MOCK__");
  });
});

describe("aiStructuredJson", () => {
  it("surfaces proxy failure objects before schema validation", async () => {
    window.__AI_TEST_MOCK__ = {
      respond: async (request) => ({
        ok: false,
        operation: request.operation,
        model: request.model,
        error: {
          type: "quota",
          message: "Quota exceeded",
          retryable: true,
          statusCode: 429,
        },
      }),
    };

    await expect(
      aiStructuredJson("inventory", pageInventoryOutputSchema, { operation: "page_inventory", debugLabel: "Page inventory" }),
    ).rejects.toThrow("Quota exceeded");
  });

  it("parses structured JSON returned through the proxy", async () => {
    window.__AI_TEST_MOCK__ = {
      respond: async (request) => ({
        ok: true,
        operation: request.operation,
        model: request.model,
        text: JSON.stringify({
          title: "Mock Paper",
          year: 2025,
          series: "June",
          paperCode: "MOCK-1",
          totalMarks: 2,
          durationMinutes: 60,
          pages: [{ pageNumber: 1, role: "questions", questionHints: ["1"], visualContent: [], textSummary: "One question", needsImage: false }],
        }),
      }),
    };

    const result = await aiStructuredJson("inventory", pageInventoryOutputSchema, { operation: "page_inventory", debugLabel: "Page inventory" });
    expect(result.pages).toHaveLength(1);
    expect(result.totalMarks).toBe(2);
  });

  it("fails clearly on malformed JSON output", async () => {
    window.__AI_TEST_MOCK__ = {
      respond: async (request) => ({
        ok: true,
        operation: request.operation,
        model: request.model,
        text: "not-json",
      }),
    };

    await expect(
      aiStructuredJson("inventory", pageInventoryOutputSchema, { operation: "page_inventory", debugLabel: "Page inventory" }),
    ).rejects.toThrow("AI returned invalid JSON");
  });
});

describe("aiChat", () => {
  it("marks long-running proxy requests as timeouts", async () => {
    window.__AI_TEST_MOCK__ = {
      respond: async (request) => {
        await new Promise((resolve) => window.setTimeout(resolve, 1_200));
        return { ok: true, operation: request.operation, model: request.model, text: "ok" };
      },
    };

    await expect(
      aiChat("Reply with ok", { operation: "smoke_text", timeoutMs: 1_000, model: "gemini-2.5-flash-lite", requestLabel: "Timeout test" }),
    ).rejects.toThrow("timed out");
  });
});

describe("runAISmokeTest", () => {
  it("records successful proxy, extraction, marking, and diagnostics checks", async () => {
    window.__AI_TEST_MOCK__ = {
      respond: async (request) => {
        if (request.operation === "smoke_ping") {
          return { ok: true, operation: request.operation, model: request.model, text: "{\"provider\":\"gemini\",\"keyConfigured\":true}" };
        }
        if (request.operation === "smoke_diagnostics") {
          return { ok: true, operation: request.operation, model: request.model, text: "{\"example\":\"[REDACTED_GOOGLE_API_KEY]\"}" };
        }
        if (request.operation === "smoke_text") {
          return { ok: true, operation: request.operation, model: request.model, text: "ok" };
        }
        if (request.operation === "smoke_marking") {
          return {
            ok: true,
            operation: request.operation,
            model: request.model,
            text: JSON.stringify({
              awardedMarks: 1,
              maxMarks: 1,
              rationale: "Correct.",
              missingPoints: [],
              markSchemeEvidence: "SMTP 1 mark",
              markSchemeReference: { row: 1 },
              confidence: 90,
            }),
          };
        }
        return {
          ok: true,
          operation: request.operation,
          model: request.model,
          text: JSON.stringify({
            questions: [
              {
                questionNumber: "1(a)",
                parentQuestionNumber: "1",
                numberingPath: ["1", "1(a)"],
                promptText: "Describe one benefit of encryption.",
                maxMarks: 2,
                responseType: "short_text",
                originalFormat: "text",
                convertedFormat: null,
                originalContent: { evidenceSnippet: "Describe one benefit of encryption." },
                convertedContent: {},
                options: [],
                pageReferences: [1],
                mediaRefs: [],
                markSchemeRef: null,
                markSchemeData: null,
              },
            ],
          }),
        };
      },
    };

    const result = await runAISmokeTest("gemini-2.5-flash-lite");
    expect(result.proxyCheck.success).toBe(true);
    expect(result.textCall.success).toBe(true);
    expect(result.extractionCall.success).toBe(true);
    expect(result.markingCall.success).toBe(true);
    expect(result.diagnosticsRedactionCheck.redacted).toBe(true);
  });
});
