import { appMeta } from "../appMeta";

export const FEEDBACK_TYPE_OPTIONS = [
  { value: "feature_request", label: "Feature request" },
  { value: "feature_tweak", label: "Change to an existing feature" },
  { value: "bug_report", label: "Bug report" },
] as const;

export type FeedbackType = (typeof FEEDBACK_TYPE_OPTIONS)[number]["value"];

export type FeedbackDraft = {
  type: FeedbackType;
  email: string;
  title: string;
  description: string;
  website: string;
};

export type FeedbackValidationErrors = Partial<Record<keyof FeedbackDraft, string>>;

type FeedbackRequestBody = {
  type: FeedbackType;
  email: string;
  title: string;
  description: string;
  website?: string;
  context: {
    path: string;
    userAgent: string;
    timestamp: string;
    appVersion?: string;
  };
};

type FeedbackResponse = {
  ok: boolean;
  error?: string;
};

type FeedbackSubmissionContext = {
  path: string;
  appVersion?: string;
};

const FEEDBACK_STORAGE_KEY = "past-paper-worker:feedback-draft:v1";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const emptyFeedbackDraft = (): FeedbackDraft => ({
  type: "feature_request",
  email: "",
  title: "",
  description: "",
  website: "",
});

function trimLineBreaks(value: string) {
  return value.replace(/\r\n/g, "\n").trim();
}

function collapseInlineWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
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
  };
}

export function loadFeedbackDraft() {
  try {
    const raw = window.localStorage.getItem(FEEDBACK_STORAGE_KEY);
    if (!raw) return emptyFeedbackDraft();
    const parsed = JSON.parse(raw) as Partial<FeedbackDraft>;
    return {
      ...emptyFeedbackDraft(),
      ...parsed,
      type: FEEDBACK_TYPE_OPTIONS.some((option) => option.value === parsed.type) ? (parsed.type as FeedbackType) : "feature_request",
    };
  } catch {
    return emptyFeedbackDraft();
  }
}

export function saveFeedbackDraft(draft: FeedbackDraft) {
  try {
    window.localStorage.setItem(FEEDBACK_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // Best effort only.
  }
}

export function clearFeedbackDraft() {
  window.localStorage.removeItem(FEEDBACK_STORAGE_KEY);
}

export async function submitFeedback(draft: FeedbackDraft, context: FeedbackSubmissionContext, fetchImpl: typeof fetch = fetch) {
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
