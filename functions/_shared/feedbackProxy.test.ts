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
    appVersion: "v1.16",
  },
};

describe("feedback proxy", () => {
  beforeEach(() => {
    resetFeedbackRateLimitsForTest();
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

  it("sends a valid payload to Resend", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: "email_123" }), { status: 200 }));

    const response = await handleFeedbackRequest(buildRequest(validBody), { RESEND_API_KEY: "configured" }, { fetchImpl });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(payload.to).toEqual(["feedback@omair.uk"]);
    expect(payload.reply_to).toBe("student@example.com");
    expect(String(payload.subject)).toContain("Bug report");
    expect(JSON.stringify(payload)).not.toContain("configured");
  });

  it("returns a safe error when Resend fails", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { message: "Forbidden" } }), { status: 403 }));

    const response = await handleFeedbackRequest(buildRequest(validBody), { RESEND_API_KEY: "configured" }, { fetchImpl });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "Feedback could not be sent. Please try again.",
    });
  });
});
