import { appMeta } from "../appMeta";

export const FEEDBACK_TYPE_OPTIONS = [
  { value: "feature_request", label: "Feature request" },
  { value: "feature_tweak", label: "Change to an existing feature" },
  { value: "bug_report", label: "Bug report" },
] as const;

export type FeedbackType = (typeof FEEDBACK_TYPE_OPTIONS)[number]["value"];

export type FeedbackAttachment = {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  contentBase64: string;
  encodedSizeEstimate: number;
};

export type FeedbackAttachmentMeta = Pick<
  FeedbackAttachment,
  "id" | "filename" | "contentType" | "sizeBytes" | "encodedSizeEstimate"
>;

export type FeedbackDraft = {
  type: FeedbackType;
  email: string;
  title: string;
  description: string;
  website: string;
  attachments: FeedbackAttachmentMeta[];
};

export type FeedbackValidationErrors = Partial<Record<keyof FeedbackDraft, string>>;

type FeedbackRequestBody = {
  type: FeedbackType;
  email: string;
  title: string;
  description: string;
  systemGenerated?: boolean;
  metadata?: Record<string, unknown>;
  website?: string;
  context: {
    path: string;
    userAgent: string;
    timestamp: string;
    appVersion?: string;
  };
  attachments?: Array<{
    filename: string;
    contentType: string;
    sizeBytes: number;
    contentBase64: string;
  }>;
};

type FeedbackResponse = {
  ok: boolean;
  error?: string;
};

type FeedbackSubmissionContext = {
  path: string;
  appVersion?: string;
};

type DiagnosticReportInput = {
  title: string;
  description: string;
  context: FeedbackSubmissionContext;
  metadata?: Record<string, unknown>;
  attachments?: FeedbackAttachment[];
};

const FEEDBACK_STORAGE_KEY = "past-paper-worker:feedback-draft:v1";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ATTACHMENT_COUNT = 3;
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const MAX_RAW_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_ENCODED_ATTACHMENT_BYTES = 34 * 1024 * 1024;
const ATTACHMENT_OVERHEAD_ESTIMATE = 200 * 1024;

const allowedAttachmentTypes = new Map<string, string[]>([
  ["application/pdf", [".pdf"]],
  ["image/png", [".png"]],
  ["image/jpeg", [".jpg", ".jpeg"]],
  ["application/json", [".json"]],
  ["text/plain", [".txt", ".log"]],
]);

export const feedbackAttachmentLimits = {
  maxCount: MAX_ATTACHMENT_COUNT,
  maxFileBytes: MAX_ATTACHMENT_BYTES,
  maxRawBytes: MAX_RAW_ATTACHMENT_BYTES,
  maxEncodedBytes: MAX_ENCODED_ATTACHMENT_BYTES,
};

export const emptyFeedbackDraft = (): FeedbackDraft => ({
  type: "feature_request",
  email: "",
  title: "",
  description: "",
  website: "",
  attachments: [],
});

function trimLineBreaks(value: string) {
  return value.replace(/\r\n/g, "\n").trim();
}

function collapseInlineWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeFilename(value: string) {
  const withoutReserved = value.replace(/[\\/:*?"<>|]/g, "_");
  let sanitized = "";
  for (const char of withoutReserved) {
    const code = char.charCodeAt(0);
    sanitized += code >= 32 ? char : "_";
  }
  return sanitized.trim();
}

function extensionForFilename(value: string) {
  const match = /\.[a-z0-9]+$/i.exec(value);
  return match ? match[0].toLowerCase() : "";
}

function attachmentTypeAllowed(filename: string, contentType: string) {
  const normalizedName = normalizeFilename(filename);
  const extension = extensionForFilename(normalizedName);
  if (!normalizedName || !extension) return false;
  const allowedExtensions = allowedAttachmentTypes.get(contentType.toLowerCase());
  return Boolean(allowedExtensions?.includes(extension));
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function estimateEncodedSize(rawBytes: number) {
  return Math.ceil((rawBytes * 4) / 3);
}

export function attachmentTotals(attachments: FeedbackAttachmentMeta[]) {
  return attachments.reduce(
    (totals, file) => ({
      rawBytes: totals.rawBytes + file.sizeBytes,
      encodedBytes: totals.encodedBytes + file.encodedSizeEstimate,
    }),
    { rawBytes: 0, encodedBytes: 0 },
  );
}

export async function fileToBase64(file: File): Promise<string> {
  const buffer =
    typeof file.arrayBuffer === "function"
      ? await file.arrayBuffer()
      : await new Promise<ArrayBuffer>((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(reader.error ?? new Error("File could not be read."));
          reader.onload = () => {
            if (reader.result instanceof ArrayBuffer) resolve(reader.result);
            else reject(new Error("File could not be read."));
          };
          reader.readAsArrayBuffer(file);
        });
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

export async function filesToFeedbackAttachments(files: FileList | File[]) {
  const fileArray = Array.from(files);
  const attachments: FeedbackAttachment[] = [];
  for (const file of fileArray) {
    const filename = normalizeFilename(file.name);
    const contentType = file.type || "application/octet-stream";
    const contentBase64 = await fileToBase64(file);
    attachments.push({
      id: `${filename}-${file.size}-${file.lastModified}`,
      filename,
      contentType,
      sizeBytes: file.size,
      contentBase64,
      encodedSizeEstimate: estimateEncodedSize(file.size),
    });
  }
  return attachments;
}

function attachmentValidationError(attachments: FeedbackAttachmentMeta[], type: FeedbackType) {
  if (type !== "bug_report" && attachments.length) return "Attachments are only available for bug reports.";
  if (!attachments.length) return null;
  if (attachments.length > MAX_ATTACHMENT_COUNT) return `Attach up to ${MAX_ATTACHMENT_COUNT} files.`;
  for (const file of attachments) {
    if (!attachmentTypeAllowed(file.filename, file.contentType)) {
      return "Only PDF, PNG, JPG, JSON, TXT, and LOG files are supported.";
    }
    if (file.sizeBytes > MAX_ATTACHMENT_BYTES) {
      return `Each file must be ${formatFileSize(MAX_ATTACHMENT_BYTES)} or smaller.`;
    }
  }
  const totals = attachmentTotals(attachments);
  if (totals.rawBytes > MAX_RAW_ATTACHMENT_BYTES) {
    return `Attachments must total ${formatFileSize(MAX_RAW_ATTACHMENT_BYTES)} or less.`;
  }
  if (totals.encodedBytes + ATTACHMENT_OVERHEAD_ESTIMATE > MAX_ENCODED_ATTACHMENT_BYTES) {
    return "Feedback could not be sent because the attachments are too large or unsupported.";
  }
  return null;
}

export function validateFeedbackDraft(draft: FeedbackDraft): FeedbackValidationErrors {
  const errors: FeedbackValidationErrors = {};
  const email = collapseInlineWhitespace(draft.email).toLowerCase();
  const title = collapseInlineWhitespace(draft.title);
  const description = trimLineBreaks(draft.description);

  if (!draft.type) errors.type = "Choose a feedback type.";
  if (!email) errors.email = "Enter your email.";
  else if (!EMAIL_PATTERN.test(email)) errors.email = "Enter a valid email address.";

  if (!title) errors.title = "Enter a title.";
  else if (title.length < 3) errors.title = "Title must be at least 3 characters.";
  else if (title.length > 120) errors.title = "Title must be 120 characters or fewer.";

  if (!description) errors.description = "Enter a description.";
  else if (description.length < 10) errors.description = "Description must be at least 10 characters.";
  else if (description.length > 4000) errors.description = "Description must be 4000 characters or fewer.";

  if (draft.website.trim()) errors.website = "Leave this field empty.";

  const attachmentError = attachmentValidationError(draft.attachments, draft.type);
  if (attachmentError) errors.attachments = attachmentError;

  return errors;
}

export function feedbackDraftIsValid(errors: FeedbackValidationErrors) {
  return Object.keys(errors).length === 0;
}

function sanitizedDraft(draft: FeedbackDraft): FeedbackDraft {
  return {
    type: draft.type,
    email: collapseInlineWhitespace(draft.email).toLowerCase(),
    title: collapseInlineWhitespace(draft.title),
    description: trimLineBreaks(draft.description),
    website: draft.website.trim(),
    attachments:
      draft.type === "bug_report"
        ? draft.attachments.map((file) => ({
            ...file,
            filename: normalizeFilename(file.filename),
            contentType: file.contentType.trim().toLowerCase(),
          }))
        : [],
  };
}

export function loadFeedbackDraft() {
  try {
    const raw = window.localStorage.getItem(FEEDBACK_STORAGE_KEY);
    if (!raw) return emptyFeedbackDraft();
    const parsed = JSON.parse(raw) as Partial<FeedbackDraft>;
    const attachments = Array.isArray(parsed.attachments)
      ? parsed.attachments
          .filter((item): item is FeedbackAttachmentMeta => {
            if (!item || typeof item !== "object") return false;
            const candidate = item as Record<string, unknown>;
            return (
              typeof candidate.id === "string" &&
              typeof candidate.filename === "string" &&
              typeof candidate.contentType === "string" &&
              typeof candidate.sizeBytes === "number" &&
              typeof candidate.encodedSizeEstimate === "number"
            );
          })
          .slice(0, MAX_ATTACHMENT_COUNT)
      : [];
    return {
      ...emptyFeedbackDraft(),
      ...parsed,
      attachments,
      type: FEEDBACK_TYPE_OPTIONS.some((option) => option.value === parsed.type) ? (parsed.type as FeedbackType) : "feature_request",
    };
  } catch {
    return emptyFeedbackDraft();
  }
}

export function saveFeedbackDraft(draft: FeedbackDraft) {
  try {
    window.localStorage.setItem(
      FEEDBACK_STORAGE_KEY,
      JSON.stringify({
        ...draft,
        attachments: draft.attachments.map(({ id, filename, contentType, sizeBytes, encodedSizeEstimate }) => ({
          id,
          filename,
          contentType,
          sizeBytes,
          encodedSizeEstimate,
        })),
      }),
    );
  } catch {
    // Best effort only.
  }
}

export function clearFeedbackDraft() {
  window.localStorage.removeItem(FEEDBACK_STORAGE_KEY);
}

export async function submitFeedback(
  draft: FeedbackDraft,
  attachments: FeedbackAttachment[],
  context: FeedbackSubmissionContext,
  fetchImpl: typeof fetch = fetch,
) {
  const cleaned = sanitizedDraft(draft);
  const payload: FeedbackRequestBody = {
    type: cleaned.type,
    email: cleaned.email,
    title: cleaned.title,
    description: cleaned.description,
    ...(cleaned.website ? { website: cleaned.website } : {}),
    context: {
      path: context.path,
      userAgent: navigator.userAgent,
      timestamp: new Date().toISOString(),
      appVersion: context.appVersion ?? appMeta.version,
    },
    ...(cleaned.type === "bug_report" && attachments.length
      ? {
          attachments: attachments.map((file) => ({
            filename: normalizeFilename(file.filename),
            contentType: file.contentType.trim().toLowerCase(),
            sizeBytes: file.sizeBytes,
            contentBase64: file.contentBase64,
          })),
        }
      : {}),
  };

  const response = await fetchImpl("/api/feedback", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  let body: FeedbackResponse | null = null;
  try {
    body = (await response.json()) as FeedbackResponse;
  } catch {
    body = null;
  }

  if (!response.ok || !body?.ok) {
    throw new Error(body?.error || "Feedback could not be sent. Please try again.");
  }
}

export async function buildJsonFeedbackAttachment(filename: string, payload: unknown): Promise<FeedbackAttachment> {
  const file = new File([JSON.stringify(payload, null, 2)], filename, { type: "application/json" });
  const [attachment] = await filesToFeedbackAttachments([file]);
  if (!attachment) throw new Error("Diagnostic attachment could not be created.");
  return attachment;
}

export async function submitDiagnosticReport(input: DiagnosticReportInput, fetchImpl: typeof fetch = fetch) {
  const attachments = input.attachments ?? [];
  const payload: FeedbackRequestBody = {
    type: "bug_report",
    email: "feedback@omair.uk",
    title: input.title,
    description: input.description,
    systemGenerated: true,
    metadata: input.metadata ?? {},
    context: {
      path: input.context.path,
      userAgent: navigator.userAgent,
      timestamp: new Date().toISOString(),
      appVersion: input.context.appVersion ?? appMeta.version,
    },
    ...(attachments.length
      ? {
          attachments: attachments.map((file) => ({
            filename: normalizeFilename(file.filename),
            contentType: file.contentType.trim().toLowerCase(),
            sizeBytes: file.sizeBytes,
            contentBase64: file.contentBase64,
          })),
        }
      : {}),
  };

  const response = await fetchImpl("/api/feedback", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  let body: FeedbackResponse | null = null;
  try {
    body = (await response.json()) as FeedbackResponse;
  } catch {
    body = null;
  }

  if (!response.ok || !body?.ok) {
    throw new Error(body?.error || "Feedback could not be sent. Please try again.");
  }
}
