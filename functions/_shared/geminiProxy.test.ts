import { describe, expect, it } from "vitest";
import { hasUnredactedGoogleApiKey } from "../../src/ai/redaction";
import { handleAiProxyRequest } from "./geminiProxy";

function request(body: unknown) {
  return new Request("http://example.com/api/ai", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("handleAiProxyRequest", () => {
  it("rejects malformed requests before contacting Gemini", async () => {
    const response = await handleAiProxyRequest(request({ operation: "page_inventory" }), { GEMINI_API_KEY: "test-key" });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { type: "invalid_request" },
    });
  });

  it("maps quota errors from Gemini into normalized proxy failures", async () => {
    const response = await handleAiProxyRequest(
      request({
        operation: "suggestions",
        model: "gemini-2.5-flash-lite",
        prompt: "Give 3 suggestions.",
      }),
      { GEMINI_API_KEY: "test-key" },
      {
        fetchImpl: async () =>
          new Response(JSON.stringify({ error: { message: "Quota exceeded" } }), {
            status: 429,
            headers: { "content-type": "application/json" },
          }),
      },
    );
    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { type: "quota", retryable: true },
    });
  });

  it("maps Gemini safety blocks into explicit safety failures", async () => {
    const response = await handleAiProxyRequest(
      request({
        operation: "suggestions",
        model: "gemini-2.5-flash-lite",
        prompt: "Unsafe prompt",
      }),
      { GEMINI_API_KEY: "test-key" },
      {
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              candidates: [{ finishReason: "SAFETY", content: { parts: [] } }],
              promptFeedback: { blockReason: "SAFETY" },
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          ),
      },
    );
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { type: "safety", blockedReason: "SAFETY" },
    });
  });

  it("redacts fake secrets in diagnostics smoke output", async () => {
    const response = await handleAiProxyRequest(
      request({
        operation: "smoke_diagnostics",
        model: "gemini-2.5-flash-lite",
        prompt: "Check redaction",
      }),
      {},
    );
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.ok).toBe(true);
    expect(json.text).toContain("[REDACTED");
    expect(hasUnredactedGoogleApiKey(json.text)).toBe(false);
  });

  it("does not send a generated response schema for marking requests", async () => {
    let parsedBody: Record<string, unknown> | null = null;
    const response = await handleAiProxyRequest(
      request({
        operation: "paper_mark",
        model: "gemini-2.5-flash-lite",
        prompt: "Return a marking decision in JSON.",
      }),
      { GEMINI_API_KEY: "test-key" },
      {
        fetchImpl: async (_input, init) => {
          parsedBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
          return new Response(
            JSON.stringify({
              candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ awardedMarks: 1, maxMarks: 1, rationale: "Correct.", missingPoints: [], markSchemeEvidence: "B0", markSchemeReference: {}, confidence: 95 }) }] } }],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        },
      },
    );

    expect(response.status).toBe(200);
    expect(parsedBody).not.toBeNull();
    const generationConfig = ((parsedBody ?? {}) as Record<string, unknown>).generationConfig as Record<string, unknown>;
    expect(generationConfig.responseMimeType).toBe("application/json");
    expect(generationConfig).not.toHaveProperty("responseJsonSchema");
    expect(JSON.stringify(parsedBody)).not.toContain("$ref");
    expect(JSON.stringify(parsedBody)).not.toContain("$defs");
    expect(JSON.stringify(parsedBody)).not.toContain("definitions");
  });

  it("does not send a generated response schema for remark smoke-marking requests", async () => {
    let parsedBody: Record<string, unknown> | null = null;
    const response = await handleAiProxyRequest(
      request({
        operation: "smoke_marking",
        model: "gemini-2.5-flash-lite",
        prompt: "Return a marking decision in JSON.",
      }),
      { GEMINI_API_KEY: "test-key" },
      {
        fetchImpl: async (_input, init) => {
          parsedBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
          return new Response(
            JSON.stringify({
              candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ awardedMarks: 1, maxMarks: 1, rationale: "Correct.", missingPoints: [], markSchemeEvidence: "B0", markSchemeReference: {}, confidence: 95 }) }] } }],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        },
      },
    );

    expect(response.status).toBe(200);
    const generationConfig = ((parsedBody ?? {}) as Record<string, unknown>).generationConfig as Record<string, unknown>;
    expect(generationConfig.responseMimeType).toBe("application/json");
    expect(generationConfig).not.toHaveProperty("responseJsonSchema");
    expect(JSON.stringify(parsedBody)).not.toContain("$ref");
    expect(JSON.stringify(parsedBody)).not.toContain("$defs");
  });

  it("maps Gemini schema-reference rejections to an internal schema error message", async () => {
    const response = await handleAiProxyRequest(
      request({
        operation: "paper_mark",
        model: "gemini-2.5-flash-lite",
        prompt: "Return a marking decision in JSON.",
      }),
      { GEMINI_API_KEY: "test-key" },
      {
        fetchImpl: async () =>
          new Response(JSON.stringify({ error: { message: "reference to undefined schema at top-level" } }), {
            status: 400,
            headers: { "content-type": "application/json" },
          }),
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: {
        message: "Internal Gemini schema error. The marking request used an unsupported response schema.",
      },
    });
  });
});
