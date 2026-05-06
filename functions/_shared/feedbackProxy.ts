import { z } from "zod";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const MAX_REQUEST_BYTES = 24 * 1024;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 5;
const DUPLICATE_SUBMISSION_WINDOW_MS = 60 * 1000;
const DEFAULT_FEEDBACK_TO = "feedback@omair.uk";
const DEFAULT_FEEDBACK_FROM = "Revision Feedback <onboarding@resend.dev>";

const feedbackTypeLabels = {
  feature_request: "Feature request",
  feature_tweak: "Change to an existing feature",
  bug_report: "Bug report",
} as const;

const requestSchema = z.object({
  type: z.enum(["feature_request", "feature_tweak", "bug_report"]),
  email: z.string(),
  title: z.string(),
  description: z.string(),
  website: z.string().optional(),
  context: z
    .object({
      path: z.string(),
      userAgent: z.string(),
      timestamp: z.string(),
      appVersion: z.string().optional(),
    })
    .optional(),
});

type FeedbackEnv = {
  RESEND_API_KEY?: string;
  FEEDBACK_TO_EMAIL?: string;
  FEEDBACK_FROM_EMAIL?: string;
};

type FeedbackDeps = {
  fetchImpl?: typeof fetch;
  now?: () => number;
};

type RateLimitEntry = {
  windowStartedAt: number;
  count: number;
  lastFingerprint: string | null;
  lastSubmittedAt: number;
};

const feedbackRateLimits = new Map<string, RateLimitEntry>();

export function resetFeedbackRateLimitsForTest() {
  feedbackRateLimits.clear();
}

function json(data: { ok: true } | { ok: false; error: string }, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function collapseWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeMultiline(value: string) {
  return value.replace(/\r\n/g, "\n").replaceAll("\u0000", "").trim();
}

function validateAndSanitizePayload(raw: unknown) {
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false as const, error: "Feedback could not be sent. Please try again." };
  }

  const payload = parsed.data;
  const email = collapseWhitespace(payload.email).toLowerCase();
  const title = collapseWhitespace(payload.title);
  const description = normalizeMultiline(payload.description);
  const website = collapseWhitespace(payload.website ?? "");
  const path = collapseWhitespace(payload.context?.path ?? "");
  const userAgent = collapseWhitespace(payload.context?.userAgent ?? "");
  const timestamp = collapseWhitespace(payload.context?.timestamp ?? "");
  const appVersion = collapseWhitespace(payload.context?.appVersion ?? "");

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false as const, error: "Feedback could not be sent. Please try again." };
  if (title.length < 3 || title.length > 120) return { ok: false as const, error: "Feedback could not be sent. Please try again." };
  if (description.length < 10 || description.length > 4000) return { ok: false as const, error: "Feedback could not be sent. Please try again." };
  if (!path || path.length > 500) return { ok: false as const, error: "Feedback could not be sent. Please try again." };
  if (!userAgent || userAgent.length > 1000) return { ok: false as const, error: "Feedback could not be sent. Please try again." };
  if (!timestamp || timestamp.length > 120) return { ok: false as const, error: "Feedback could not be sent. Please try again." };
  if (appVersion.length > 40) return { ok: false as const, error: "Feedback could not be sent. Please try again." };
  if (website) return { ok: false as const, error: "Feedback could not be sent. Please try again." };

  return {
    ok: true as const,
    payload: {
      type: payload.type,
      email,
      title,
      description,
      context: {
        path,
        userAgent,
        timestamp,
        ...(appVersion ? { appVersion } : {}),
      },
    },
  };
}

function clientIp(request: Request) {
  return request.headers.get("cf-connecting-ip")?.trim() || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

function submissionFingerprint(payload: {
  type: string;
  email: string;
  title: string;
  description: string;
}) {
  return [payload.type, payload.email, payload.title.toLowerCase(), payload.description.slice(0, 120).toLowerCase()].join("|");
}

function enforceRateLimit(request: Request, payload: { type: string; email: string; title: string; description: string }, now: number) {
  const ip = clientIp(request);
  const fingerprint = submissionFingerprint(payload);
  const existing = feedbackRateLimits.get(ip);
  if (!existing || now - existing.windowStartedAt > RATE_LIMIT_WINDOW_MS) {
    feedbackRateLimits.set(ip, {
      windowStartedAt: now,
      count: 1,
      lastFingerprint: fingerprint,
      lastSubmittedAt: now,
    });
    return { allowed: true as const };
  }

  if (existing.count >= RATE_LIMIT_MAX) return { allowed: false as const };
  if (existing.lastFingerprint === fingerprint && now - existing.lastSubmittedAt < DUPLICATE_SUBMISSION_WINDOW_MS) {
    return { allowed: false as const };
  }

  existing.count += 1;
  existing.lastFingerprint = fingerprint;
  existing.lastSubmittedAt = now;
  feedbackRateLimits.set(ip, existing);
  return { allowed: true as const };
}

function plainTextBody(payload: {
  type: keyof typeof feedbackTypeLabels;
  email: string;
  title: string;
  description: string;
  context: { path: string; userAgent: string; timestamp: string; appVersion?: string };
}) {
  return [
    `Feedback type: ${feedbackTypeLabels[payload.type]}`,
    `Reply-to email: ${payload.email}`,
    `Title: ${payload.title}`,
    "",
    "Description:",
    payload.description,
    "",
    `Path: ${payload.context.path}`,
    `User agent: ${payload.context.userAgent}`,
    `Submitted at: ${payload.context.timestamp}`,
    `App version: ${payload.context.appVersion || "unknown"}`,
  ].join("\n");
}

function htmlBody(payload: {
  type: keyof typeof feedbackTypeLabels;
  email: string;
  title: string;
  description: string;
  context: { path: string; userAgent: string; timestamp: string; appVersion?: string };
}) {
  return `
    <div style="font-family:Arial,sans-serif;color:#111;line-height:1.5">
      <h2>Revision feedback</h2>
      <p><strong>Feedback type:</strong> ${escapeHtml(feedbackTypeLabels[payload.type])}</p>
      <p><strong>Reply-to email:</strong> ${escapeHtml(payload.email)}</p>
      <p><strong>Title:</strong> ${escapeHtml(payload.title)}</p>
      <p><strong>Description:</strong><br>${escapeHtml(payload.description).replace(/\n/g, "<br>")}</p>
      <hr>
      <p><strong>Path:</strong> ${escapeHtml(payload.context.path)}</p>
      <p><strong>User agent:</strong> ${escapeHtml(payload.context.userAgent)}</p>
      <p><strong>Submitted at:</strong> ${escapeHtml(payload.context.timestamp)}</p>
      <p><strong>App version:</strong> ${escapeHtml(payload.context.appVersion || "unknown")}</p>
    </div>
  `.trim();
}

async function sendViaResend(
  env: FeedbackEnv,
  payload: {
    type: keyof typeof feedbackTypeLabels;
    email: string;
    title: string;
    description: string;
    context: { path: string; userAgent: string; timestamp: string; appVersion?: string };
  },
  fetchImpl: typeof fetch,
) {
  const preferredFrom = env.FEEDBACK_FROM_EMAIL || DEFAULT_FEEDBACK_FROM;
  const fallbackFrom = DEFAULT_FEEDBACK_FROM;
  const toEmail = env.FEEDBACK_TO_EMAIL || DEFAULT_FEEDBACK_TO;
  const resendBody = (fromEmail: string) => ({
    from: fromEmail,
    to: [toEmail],
    reply_to: payload.email,
    subject: `[Revision Feedback] ${feedbackTypeLabels[payload.type]}: ${payload.title}`,
    text: plainTextBody(payload),
    html: htmlBody(payload),
  });

  const attempt = async (fromEmail: string) =>
    fetchImpl(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY ?? ""}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(resendBody(fromEmail)),
    });

  let response = await attempt(preferredFrom);
  if (!response.ok && preferredFrom !== fallbackFrom) {
    const message = await response.clone().text();
    if (/verify|domain|sender|from/i.test(message)) {
      response = await attempt(fallbackFrom);
    }
  }
  return response;
}

export async function handleFeedbackRequest(request: Request, env: FeedbackEnv, deps: FeedbackDeps = {}) {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed." }), {
      status: 405,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        Allow: "POST",
      },
    });
  }

  if (!env.RESEND_API_KEY) {
    return json({ ok: false, error: "Feedback service is not configured." }, 500);
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return json({ ok: false, error: "Feedback could not be sent. Please try again." }, 413);
  }

  let rawBody = "";
  try {
    rawBody = await request.text();
  } catch {
    return json({ ok: false, error: "Feedback could not be sent. Please try again." }, 400);
  }

  if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
    return json({ ok: false, error: "Feedback could not be sent. Please try again." }, 413);
  }

  let rawJson: unknown;
  try {
    rawJson = JSON.parse(rawBody);
  } catch {
    return json({ ok: false, error: "Feedback could not be sent. Please try again." }, 400);
  }

  const validated = validateAndSanitizePayload(rawJson);
  if (!validated.ok) {
    return json({ ok: false, error: validated.error }, 400);
  }

  const now = deps.now?.() ?? Date.now();
  const rateLimit = enforceRateLimit(request, validated.payload, now);
  if (!rateLimit.allowed) {
    return json({ ok: false, error: "Feedback could not be sent. Please try again later." }, 429);
  }

  const fetchImpl = deps.fetchImpl ?? fetch;
  const response = await sendViaResend(env, validated.payload, fetchImpl);
  if (!response.ok) {
    const rawError = await response.text();
    console.warn("[Feedback] Resend request failed", {
      status: response.status,
      type: validated.payload.type,
      titleLength: validated.payload.title.length,
      emailDomain: validated.payload.email.split("@")[1] ?? "unknown",
      path: validated.payload.context.path,
      errorPreview: rawError.slice(0, 180),
    });
    return json({ ok: false, error: "Feedback could not be sent. Please try again." }, 502);
  }

  return json({ ok: true }, 200);
}
