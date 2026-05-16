import { describe, expect, it } from "vitest";
import { hasUnredactedSecret } from "../../src/ai/redaction";
import { handleAiProxyRequest, resolveProxyProvider } from "./aiProxy";

function request(body: unknown) {
  return new Request("http://example.com/api/ai", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("resolveProxyProvider", () => {
  it("infers providers from model prefixes when provider is omitted", () => {
    expect(resolveProxyProvider({ model: "claude-sonnet-4-6" })).toBe("anthropic");
    expect(resolveProxyProvider({ model: "gemini-2.5-flash-lite" })).toBe("gemini");
  });
});

describe("handleAiProxyRequest", () => {
  it("routes Claude requests to /v1/messages and maps images to Anthropic image blocks", async () => {
    let url = "";
    let headers: Headers;
    let body: Record<string, unknown> = {};

    const response = await handleAiProxyRequest(
      request({
        operation: "suggestions",
        model: "claude-sonnet-4-6",
        prompt: "Read the image and reply ok.",
        media: [{ mimeType: "image/png", dataBase64: "AAAA" }],
      }),
      { ANTHROPIC_API_KEY: "sk-ant-test-key" },
      {
        fetchImpl: async (input, init) => {
          url = String(input);
          headers = new Headers(init?.headers);
          body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
          return new Response(
            JSON.stringify({
              content: [{ type: "text", text: "ok" }],
              stop_reason: "end_turn",
              usage: { input_tokens: 12, output_tokens: 1 },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        },
      },
    );

    expect(response.status).toBe(200);
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(headers!.get("anthropic-version")).toBe("2023-06-01");
    expect(headers!.get("x-api-key")).toBe("sk-ant-test-key");
    expect(body.model).toBe("claude-sonnet-4-6");
    expect(body.max_tokens).toBe(64000);
    const messages = body.messages as Array<{ content: Array<Record<string, unknown>> }>;
    expect(messages[0].content[0]).toMatchObject({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: "AAAA" },
    });
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      modelLabel: "Claude Sonnet 4.6",
      text: "ok",
    });
  });

  it("rejects unsupported Claude media types before contacting the provider", async () => {
    let calls = 0;
    const response = await handleAiProxyRequest(
      request({
        operation: "suggestions",
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        prompt: "Read this.",
        media: [{ mimeType: "application/pdf", dataBase64: "AAAA" }],
      }),
      { ANTHROPIC_API_KEY: "sk-ant-test-key" },
      {
        fetchImpl: async () => {
          calls += 1;
          return new Response("{}");
        },
      },
    );

    expect(calls).toBe(0);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      provider: "anthropic",
      error: { type: "invalid_request" },
    });
  });

  it("maps Anthropic 429 responses to retryable quota failures", async () => {
    const response = await handleAiProxyRequest(
      request({
        operation: "suggestions",
        model: "claude-sonnet-4-6",
        prompt: "Reply ok.",
      }),
      { ANTHROPIC_API_KEY: "sk-ant-test-key" },
      {
        fetchImpl: async () =>
          new Response(JSON.stringify({ error: { type: "rate_limit_error", message: "Too many requests" } }), {
            status: 429,
            headers: { "retry-after": "12", "content-type": "application/json" },
          }),
      },
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      provider: "anthropic",
      error: { type: "quota", retryable: true, retryAfterMs: 12000 },
    });
  });

  it("maps Anthropic auth failures to non-retryable provider errors without leaking keys", async () => {
    const response = await handleAiProxyRequest(
      request({
        operation: "suggestions",
        model: "claude-sonnet-4-6",
        prompt: "Reply ok.",
      }),
      { ANTHROPIC_API_KEY: "sk-ant-secret-value-that-should-not-leak" },
      {
        fetchImpl: async () =>
          new Response(JSON.stringify({ error: { type: "authentication_error", message: "invalid x-api-key sk-ant-secret-value-that-should-not-leak" } }), {
            status: 401,
            headers: { "content-type": "application/json" },
          }),
      },
    );

    expect(response.status).toBe(401);
    const json = await response.json();
    expect(json).toMatchObject({
      ok: false,
      provider: "anthropic",
      error: { type: "provider", retryable: false, statusCode: 401 },
    });
    expect(JSON.stringify(json)).not.toContain("sk-ant-secret-value-that-should-not-leak");
  });

  it("routes Gemini requests through the Gemini provider runner", async () => {
    const response = await handleAiProxyRequest(
      request({
        operation: "suggestions",
        provider: "gemini",
        model: "gemini-2.5-flash-lite",
        prompt: "Reply ok.",
      }),
      { GEMINI_API_KEY: "test-key" },
      {
        fetchImpl: async () =>
          new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "ok" }] } }] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      provider: "gemini",
      model: "gemini-2.5-flash-lite",
      text: "ok",
    });
  });

  it("redacts Anthropic and Gemini secrets in diagnostics smoke output", async () => {
    const response = await handleAiProxyRequest(
      request({
        operation: "smoke_diagnostics",
        model: "claude-sonnet-4-6",
        prompt: "Check redaction",
      }),
      {},
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.ok).toBe(true);
    expect(json.text).toContain("[REDACTED");
    expect(hasUnredactedSecret(json.text)).toBe(false);
  });
});
