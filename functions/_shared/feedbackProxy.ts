import { z } from "zod";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const MAX_REQUEST_BYTES = 39 * 1024 * 1024;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 5;
const DUPLICATE_SUBMISSION_WINDOW_MS = 60 * 1000;
const DEFAULT_FEEDBACK_TO = "feedback@omair.uk";
const DEFAULT_FEEDBACK_FROM = "Revision Feedback <onboarding@resend.dev>";
const MAX_ATTACHMENT_COUNT = 3;
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const MAX_RAW_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_ENCODED_ATTACHMENT_BYTES = 34 * 1024 * 1024;
const ATTACHMENT_OVERHEAD_ESTIMATE = 200 * 1024;

const feedbackTypeLabels = {
  feature_request: "Feature request",
  feature_tweak: "Change to an existing feature",
  bug_report: "Bug report",
} as const;

const supportedAttachmentTypes = new Map<string, string[]>([
  ["application/pdf", [".pdf"]],
  ["image/png", [".png"]],
  ["image/jpeg", [".jpg", ".jpeg"]],
  ["application/json", [".json"]],
  ["text/plain", [".txt", ".log"]],
]);

const requestSchema = z.object({
  type: z.enum(["feature_request", "feature_tweak", "bug_report"]),
  email: z.string(),
  title: z.string(),
  description: z.string(),
  systemGenerated: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
  website: z.string().optional(),
  context: z
    .object({
      path: z.string(),
      userAgent: z.string(),
      timestamp: z.string(),
      appVersion: z.string().optional(),
    })
    .optional(),
  attachments: z
    .array(
      z.object({
        filename: z.string(),
        contentType: z.string(),
        sizeBytes: z.number(),
        contentBase64: z.string(),
      }),
    )
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

type SanitizedAttachment = {
  filename: string;
  contentType: string;
  sizeBytes: number;
  contentBase64: string;
  encodedSizeEstimate: number;
};

type SanitizedPayload = {
  type: keyof typeof feedbackTypeLabels;
  email: string;
  title: string;
  description: string;
  systemGenerated: boolean;
  metadata: Record<string, unknown> | null;
  attachments: SanitizedAttachment[];
  context: { path: string; userAgent: string; timestamp: string; appVersion?: string };
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

function normalizeFilename(value: string) {
  const withoutReserved = value.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ");
  let sanitized = "";
  for (const char of withoutReserved) {
    const code = char.charCodeAt(0);
    sanitized += code >= 32 ? char : "_";
  }
  return sanitized.trim().slice(0, 120);
}

function extensionForFilename(value: string) {
  const match = /\.[a-z0-9]+$/i.exec(value);
  return match ? match[0].toLowerCase() : "";
}

function estimateEncodedSize(rawBytes: number) {
  return Math.ceil((rawBytes * 4) / 3);
}

function base64LooksValid(value: string) {
  return /^[A-Za-z0-9+/=\s]+$/.test(value);
}

function decodedSizeFromBase64(value: string) {
  const sanitized = value.replace(/\s+/g, "");
  const padding = sanitized.endsWith("==") ? 2 : sanitized.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((sanitized.length * 3) / 4) - padding);
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function attachmentSummary(attachments: SanitizedAttachment[]) {
  if (!attachments.length) return [];
  return [
    "",
    "Attached files:",
    ...attachments.map(
      (file) => `- ${file.filename} (${file.contentType}, ${formatFileSize(file.sizeBytes)})`,
    ),
    `Total estimated encoded size: ${formatFileSize(
      attachments.reduce((sum, file) => sum + file.encodedSizeEstimate, 0),
    )}`,
  ];
}

function metadataSummary(metadata: Record<string, unknown> | null) {
  if (!metadata) return [];
  const serialized = JSON.stringify(metadata, null, 2);
  if (!serialized) return [];
  const clipped = serialized.length > 20_000 ? `${serialized.slice(0, 20_000)}\n[clipped ${serialized.length - 20_000} chars]` : serialized;
  return ["", "Metadata:", clipped];
}

function attachmentTypeAllowed(filename: string, contentType: string) {
  const allowedExtensions = supportedAttachmentTypes.get(contentType.toLowerCase());
  if (!allowedExtensions) return false;
  return allowedExtensions.includes(extensionForFilename(filename));
}

function attachmentErrorMessage() {
  return "Feedback could not be sent because the attachments are too large or unsupported.";
}

function validateAndSanitizeAttachments(rawAttachments: unknown, type: keyof typeof feedbackTypeLabels) {
  const attachments = Array.isArray(rawAttachments) ? rawAttachments : [];
  if (type !== "bug_report" && attachments.length) {
    return { ok: false as const, error: "Feedback could not be sent. Please try again." };
  }
  if (!attachments.length) return { ok: true as const, attachments: [] as SanitizedAttachment[] };
  if (attachments.length > MAX_ATTACHMENT_COUNT) return { ok: false as const, error: attachmentErrorMessage() };

  const sanitized: SanitizedAttachment[] = [];
  let totalRawBytes = 0;
  let totalEncodedBytes = 0;

  for (const entry of attachments) {
    if (!entry || typeof entry !== "object") return { ok: false as const, error: attachmentErrorMessage() };
    const record = entry as Record<string, unknown>;
    const filename = normalizeFilename(String(record.filename ?? ""));
    const contentType = collapseWhitespace(String(record.contentType ?? "")).toLowerCase();
    const sizeBytes = Number(record.sizeBytes ?? 0);
    const contentBase64 = String(record.contentBase64 ?? "").replace(/\s+/g, "");
    if (!filename || !contentType || !Number.isFinite(sizeBytes) || sizeBytes <= 0 || !contentBase64) {
      return { ok: false as const, error: attachmentErrorMessage() };
    }
    if (!attachmentTypeAllowed(filename, contentType)) return { ok: false as const, error: attachmentErrorMessage() };
    if (!base64LooksValid(contentBase64)) return { ok: false as const, error: attachmentErrorMessage() };
    if (sizeBytes > MAX_ATTACHMENT_BYTES) return { ok: false as const, error: attachmentErrorMessage() };

    const decodedBytes = decodedSizeFromBase64(contentBase64);
    if (Math.abs(decodedBytes - sizeBytes) > 4) return { ok: false as const, error: attachmentErrorMessage() };
    const encodedSizeEstimate = estimateEncodedSize(sizeBytes);
    totalRawBytes += sizeBytes;
    totalEncodedBytes += encodedSizeEstimate;
    sanitized.push({ filename, contentType, sizeBytes, contentBase64, encodedSizeEstimate });
  }

  if (totalRawBytes > MAX_RAW_ATTACHMENT_BYTES) return { ok: false as const, error: attachmentErrorMessage() };
  if (totalEncodedBytes + ATTACHMENT_OVERHEAD_ESTIMATE > MAX_ENCODED_ATTACHMENT_BYTES) {
    return { ok: false as const, error: attachmentErrorMessage() };
  }

  return { ok: true as const, attachments: sanitized };
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
  const systemGenerated = Boolean(payload.systemGenerated);
  const metadata = payload.metadata && typeof payload.metadata === "object" && !Array.isArray(payload.metadata) ? payload.metadata : null;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false as const, error: "Feedback could not be sent. Please try again." };
  if (title.length < 3 || title.length > 120) return { ok: false as const, error: "Feedback could not be sent. Please try again." };
  if (description.length < 10 || description.length > 4000) return { ok: false as const, error: "Feedback could not be sent. Please try again." };
  if (!path || path.length > 500) return { ok: false as const, error: "Feedback could not be sent. Please try again." };
  if (!userAgent || userAgent.length > 1000) return { ok: false as const, error: "Feedback could not be sent. Please try again." };
  if (!timestamp || timestamp.length > 120) return { ok: false as const, error: "Feedback could not be sent. Please try again." };
  if (appVersion.length > 40) return { ok: false as const, error: "Feedback could not be sent. Please try again." };
  if (website) return { ok: false as const, error: "Feedback could not be sent. Please try again." };

  const attachments = validateAndSanitizeAttachments(payload.attachments, payload.type);
  if (!attachments.ok) return attachments;

  return {
    ok: true as const,
    payload: {
      type: payload.type,
      email,
      title,
      description,
      systemGenerated,
      metadata,
      attachments: attachments.attachments,
      context: {
        path,
        userAgent,
        timestamp,
        ...(appVersion ? { appVersion } : {}),
      },
    } satisfies SanitizedPayload,
  };
}

function clientIp(request: Request) {
  return request.headers.get("cf-connecting-ip")?.trim() || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

function submissionFingerprint(payload: SanitizedPayload) {
  return [payload.type, payload.email, payload.title.toLowerCase(), payload.description.slice(0, 120).toLowerCase(), payload.systemGenerated ? "system" : "user"].join("|");
}

function enforceRateLimit(request: Request, payload: SanitizedPayload, now: number) {
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

function plainTextBody(payload: SanitizedPayload) {
  return [
    `Feedback type: ${feedbackTypeLabels[payload.type]}`,
    `System generated: ${payload.systemGenerated ? "yes" : "no"}`,
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
    ...metadataSummary(payload.metadata),
    ...attachmentSummary(payload.attachments),
  ].join("\n");
}

function htmlBody(payload: SanitizedPayload) {
  const attachments = payload.attachments.length
    ? `
      <hr>
      <p><strong>Attached files:</strong></p>
      <ul>
        ${payload.attachments
          .map(
            (file) =>
              `<li>${escapeHtml(file.filename)} (${escapeHtml(file.contentType)}, ${escapeHtml(
                formatFileSize(file.sizeBytes),
              )})</li>`,
          )
          .join("")}
      </ul>
      <p><strong>Total estimated encoded size:</strong> ${escapeHtml(
        formatFileSize(payload.attachments.reduce((sum, file) => sum + file.encodedSizeEstimate, 0)),
      )}</p>
    `
    : "";

  return `
    <div style="font-family:Arial,sans-serif;color:#111;line-height:1.5">
      <h2>Revision feedback</h2>
      <p><strong>Feedback type:</strong> ${escapeHtml(feedbackTypeLabels[payload.type])}</p>
      <p><strong>System generated:</strong> ${payload.systemGenerated ? "yes" : "no"}</p>
      <p><strong>Reply-to email:</strong> ${escapeHtml(payload.email)}</p>
      <p><strong>Title:</strong> ${escapeHtml(payload.title)}</p>
      <p><strong>Description:</strong><br>${escapeHtml(payload.description).replace(/\n/g, "<br>")}</p>
      <hr>
      <p><strong>Path:</strong> ${escapeHtml(payload.context.path)}</p>
      <p><strong>User agent:</strong> ${escapeHtml(payload.context.userAgent)}</p>
      <p><strong>Submitted at:</strong> ${escapeHtml(payload.context.timestamp)}</p>
      <p><strong>App version:</strong> ${escapeHtml(payload.context.appVersion || "unknown")}</p>
      ${
        payload.metadata
          ? `<p><strong>Metadata:</strong></p><pre style="white-space:pre-wrap;background:#f5f5f5;padding:12px;border-radius:8px">${escapeHtml(
              JSON.stringify(payload.metadata, null, 2).slice(0, 20000),
            )}</pre>`
          : ""
      }
      ${attachments}
    </div>
  `.trim();
}

async function sendViaResend(env: FeedbackEnv, payload: SanitizedPayload, fetchImpl: typeof fetch) {
  const preferredFrom = env.FEEDBACK_FROM_EMAIL || DEFAULT_FEEDBACK_FROM;
  const fallbackFrom = DEFAULT_FEEDBACK_FROM;
  const toEmail = env.FEEDBACK_TO_EMAIL || DEFAULT_FEEDBACK_TO;
  const resendBody = (fromEmail: string) => ({
    from: fromEmail,
    to: [toEmail],
    reply_to: payload.email,
    subject: payload.systemGenerated ? `[Past Paper Worker] ${payload.title}` : `[Revision Feedback] ${feedbackTypeLabels[payload.type]}: ${payload.title}`,
    text: plainTextBody(payload),
    html: htmlBody(payload),
    ...(payload.attachments.length
      ? {
          attachments: payload.attachments.map((file) => ({
            filename: file.filename,
            content: file.contentBase64,
          })),
        }
      : {}),
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

function resendAttachmentFailure(rawError: string) {
  return /attachment|attachments|file type|unsupported|too large|content too large|payload too large|413/i.test(rawError);
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
    return json({ ok: false, error: attachmentErrorMessage() }, 413);
  }

  let rawBody = "";
  try {
    rawBody = await request.text();
  } catch {
    return json({ ok: false, error: "Feedback could not be sent. Please try again." }, 400);
  }

  if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
    return json({ ok: false, error: attachmentErrorMessage() }, 413);
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
      attachmentCount: validated.payload.attachments.length,
      attachmentNames: validated.payload.attachments.map((file) => file.filename),
      errorPreview: rawError.slice(0, 180),
    });
    return json(
      {
        ok: false,
        error: resendAttachmentFailure(rawError) ? attachmentErrorMessage() : "Feedback could not be sent. Please try again.",
      },
      502,
    );
  }

  return json({ ok: true }, 200);
}
