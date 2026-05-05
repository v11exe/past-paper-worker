import { describe, expect, it } from "vitest";
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

function stubGeminiFetch(): typeof fetch {
  return (async (_input: URL | RequestInfo, init?: RequestInit) => {
    const parsedBody = init?.body ? JSON.parse(String(init.body)) : {};
    const prompt = JSON.stringify(parsedBody);
    if (prompt.includes("Reply with exactly: ok")) {
      return new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "ok" }] } }] }), { status: 200 });
    }
    if (prompt.includes("Return a marking decision")) {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              finishReason: "STOP",
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      awardedMarks: 1,
                      maxMarks: 1,
                      rationale: "Correct.",
                      missingPoints: [],
                      markSchemeEvidence: "SMTP 1 mark",
                      markSchemeReference: { row: 1 },
                      confidence: 90,
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      );
    }
    return new Response(
      JSON.stringify({
        candidates: [
          {
            finishReason: "STOP",
            content: {
              parts: [
                {
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
                },
              ],
            },
          },
        ],
      }),
      { status: 200 },
    );
  }) as typeof fetch;
}

describe("Gemini smoke suite", () => {
  it("verifies ping, text, extraction, marking, and redaction paths through the proxy", async () => {
    const env = { GEMINI_API_KEY: "test-key" };
    const fetchImpl = stubGeminiFetch();

    const ping = await handleAiProxyRequest(request({ operation: "smoke_ping", model: "gemini-2.5-flash-lite", prompt: "ping" }), env, { fetchImpl });
    const text = await handleAiProxyRequest(request({ operation: "smoke_text", model: "gemini-2.5-flash-lite", prompt: "Reply with exactly: ok" }), env, {
      fetchImpl,
    });
    const extraction = await handleAiProxyRequest(
      request({ operation: "smoke_extraction", model: "gemini-2.5-flash-lite", prompt: "Return one extracted question in the required schema." }),
      env,
      { fetchImpl },
    );
    const marking = await handleAiProxyRequest(
      request({ operation: "smoke_marking", model: "gemini-2.5-flash-lite", prompt: "Return a marking decision in the required schema." }),
      env,
      { fetchImpl },
    );
    const diagnostics = await handleAiProxyRequest(
      request({ operation: "smoke_diagnostics", model: "gemini-2.5-flash-lite", prompt: "Check diagnostics redaction" }),
      env,
      { fetchImpl },
    );

    await expect(ping.json()).resolves.toMatchObject({ ok: true });
    await expect(text.json()).resolves.toMatchObject({ ok: true });
    await expect(extraction.json()).resolves.toMatchObject({ ok: true });
    await expect(marking.json()).resolves.toMatchObject({ ok: true });
    const diagnosticsJson = await diagnostics.json();
    expect(diagnosticsJson.ok).toBe(true);
    expect(diagnosticsJson.text).toContain("[REDACTED");
  });
});
