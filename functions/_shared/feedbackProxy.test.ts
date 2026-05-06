import { beforeEach, describe, expect, it, vi } from "vitest";

import { handleFeedbackRequest, resetFeedbackRateLimitsForTest } from "./feedbackProxy";

function buildRequest(body: unknown, init?: Partial<RequestInit>) {
  return new Request("https://example.com/api/feedback", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cf-connecting-ip": "203.0.113.42",
      ...(init?.headers ?? {}),
    },
    body: JSON.stringify(body),
    ...init,
  });
}

const validBody = {
  type: "bug_report",
  email: "student@example.com",
  title: "Question numbering slipped",
  description: "Question 1.1 contains front cover text on the chemistry paper.",
  context: {
    path: "/#ready",
    userAgent: "Vitest",
    timestamp: "2026-05-06T09:30:00.000Z",
    appVersion: "v1.17",
  },
};

const validAttachment = {
  filename: "diagnostics.json",
  contentType: "application/json",
  sizeBytes: 11,
  contentBase64: "eyJvayI6dHJ1ZX0=",
};

describe("feedback proxy", () => {
  beforeEach(() => {
    resetFeedbackRateLimitsForTest();
    vi.restoreAllMocks();
  });

  it("rejects invalid methods", async () => {
    const response = await handleFeedbackRequest(new Request("https://example.com/api/feedback"), { RESEND_API_KEY: "configured" });
    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: "Method not allowed." });
  });

  it("rejects invalid payloads", async () => {
    const response = await handleFeedbackRequest(buildRequest({ ...validBody, email: "broken" }), { RESEND_API_KEY: "configured" });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false });
  });

  it("rejects attachments for non-bug feedback", async () => {
    const response = await handleFeedbackRequest(
      buildRequest({ ...validBody, type: "feature_request", attachments: [validAttachment] }),
      { RESEND_API_KEY: "configured" },
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false });
  });

  it("rejects unsupported attachment types server-side", async () => {
    const response = await handleFeedbackRequest(
      buildRequest({
        ...validBody,
        attachments: [{ ...validAttachment, filename: "script.exe", contentType: "application/octet-stream" }],
      }),
      { RESEND_API_KEY: "configured" },
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "Feedback could not be sent because the attachments are too large or unsupported.",
    });
  });

  it("sends valid attachments to Resend", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: "email_123" }), { status: 200 }));

    const response = await handleFeedbackRequest(
      buildRequest({ ...validBody, attachments: [validAttachment] }),
      { RESEND_API_KEY: "configured" },
      { fetchImpl },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(payload.to).toEqual(["feedback@omair.uk"]);
    expect(payload.reply_to).toBe("student@example.com");
    expect(payload.attachments).toEqual([{ filename: "diagnostics.json", content: "eyJvayI6dHJ1ZX0=" }]);
  });

  it("does not log attachment contents when Resend fails", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { message: "Forbidden" } }), { status: 403 }));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = await handleFeedbackRequest(
      buildRequest({ ...validBody, attachments: [validAttachment] }),
      { RESEND_API_KEY: "configured" },
      { fetchImpl },
    );

    expect(response.status).toBe(502);
    const logPayload = warnSpy.mock.calls[0]?.[1];
    expect(JSON.stringify(logPayload)).toContain("diagnostics.json");
    expect(JSON.stringify(logPayload)).not.toContain(validAttachment.contentBase64);
  });

  it("returns a safe attachment error when Resend rejects oversized or unsupported files", async () => {
    const fetchImpl = vi.fn(async () => new Response("Attachments are too large", { status: 413 }));

    const response = await handleFeedbackRequest(
      buildRequest({ ...validBody, attachments: [validAttachment] }),
      { RESEND_API_KEY: "configured" },
      { fetchImpl },
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "Feedback could not be sent because the attachments are too large or unsupported.",
    });
  });

  it("rejects too many attachments before calling Resend", async () => {
    const fetchImpl = vi.fn();

    const response = await handleFeedbackRequest(
      buildRequest({
        ...validBody,
        attachments: [validAttachment, { ...validAttachment, filename: "a.pdf", contentType: "application/pdf" }, { ...validAttachment, filename: "b.txt", contentType: "text/plain" }, { ...validAttachment, filename: "c.log", contentType: "text/plain" }],
      }),
      { RESEND_API_KEY: "configured" },
      { fetchImpl },
    );

    expect(response.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
