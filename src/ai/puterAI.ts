import { z } from "zod";
import { createId } from "../lib/id";
import type { PuterRequestDiagnostic, PuterSmokeTestResult } from "../types";

type PuterChatResponse = string | { text?: unknown; message?: { content?: unknown; images?: unknown[] } };
type PuterModelEntry = { id?: unknown; aliases?: unknown };
type PuterApi = {
  ai?: {
    chat?: (prompt: string | unknown[], ...args: unknown[]) => Promise<PuterChatResponse>;
    listModels?: (provider?: string | null) => Promise<PuterModelEntry[]>;
  };
};

declare global {
  interface Window {
    puter?: PuterApi;
    __PUTER_TEST_MOCK__?: PuterApi;
  }
}

export const DEFAULT_PUTER_MODEL = "gpt-5.4-nano";
export const FALLBACK_PUTER_MODELS = ["gpt-5.4-mini", "gpt-5-nano"] as const;
export const PUTER_MODEL_CHOICES = [DEFAULT_PUTER_MODEL, ...FALLBACK_PUTER_MODELS] as const;

const TINY_IMAGE_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

type PuterChatOptions = {
  model?: string;
  fallbackModels?: string[];
  temperature?: number;
  maxTokens?: number;
  testMode?: boolean;
  timeoutMs?: number;
  media?: string[];
  requestLabel?: string;
  onRequestDiagnostic?: (diagnostic: PuterRequestDiagnostic) => void;
};

type StructuredJsonOptions = PuterChatOptions & {
  normalizer?: (input: unknown) => unknown;
  debugLabel?: string;
  onSchemaError?: (error: { label: string; paths: string[]; issues: string[]; rawPreview: string; extractedJsonPreview: string }) => void;
};

export class PuterAIError extends Error {
  readonly diagnostic: PuterRequestDiagnostic | null;
  readonly rawError: unknown;
  readonly timedOut: boolean;

  constructor(message: string, input: { diagnostic?: PuterRequestDiagnostic | null; rawError?: unknown; timedOut?: boolean } = {}) {
    super(message);
    this.name = "PuterAIError";
    this.diagnostic = input.diagnostic ?? null;
    this.rawError = input.rawError;
    this.timedOut = Boolean(input.timedOut);
  }
}

class PuterTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Puter request timed out after ${Math.round(timeoutMs / 1000)}s`);
    this.name = "PuterTimeoutError";
  }
}

function getPuter() {
  return window.__PUTER_TEST_MOCK__ ?? window.puter;
}

async function waitForPuter(timeoutMs = 12_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const puter = getPuter();
    if (puter?.ai?.chat) return puter;
    await new Promise((resolve) => window.setTimeout(resolve, 120));
  }
  throw new Error("Puter.js did not load. Check your network connection and the CDN script.");
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timeoutId = 0;
  const timeout = new Promise<T>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new PuterTimeoutError(timeoutMs)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timeoutId));
}

function textFromResponse(response: PuterChatResponse) {
  if (typeof response === "string") return response;
  if (response.message?.content !== undefined && response.message.content !== null) return stringifyResponseContent(response.message.content);
  if (response.text !== undefined && response.text !== null) return stringifyResponseContent(response.text);
  return stringifyResponseContent(response);
}

function stringifyResponseContent(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function preview(value: unknown, maxChars = 1800) {
  const text = typeof value === "string" ? value : safeStringify(value);
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n[clipped ${text.length - maxChars} chars]` : text;
}

function extractJson(raw: string) {
  const trimmed = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  if (trimmed.startsWith("{")) return trimmed;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

function safeStringify(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function serializeError(error: unknown): unknown {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      ...(error instanceof PuterAIError ? { timedOut: error.timedOut, diagnostic: error.diagnostic, rawError: error.rawError } : {}),
    };
  }
  return error;
}

function dataUrlByteSize(dataUrl: string) {
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex < 0) return dataUrl.length;
  return Math.round(((dataUrl.length - commaIndex - 1) * 3) / 4);
}

function mediaBytes(media: string[] | undefined) {
  return (media ?? []).reduce((sum, item) => {
    const text = typeof item === "string" ? item : stringifyResponseContent(item);
    return sum + (text.startsWith("data:") ? dataUrlByteSize(text) : text.length);
  }, 0);
}

function issuePath(issue: z.ZodIssue) {
  return issue.path.length ? issue.path.join(".") : "(root)";
}

function formatSchemaIssues(error: z.ZodError) {
  return error.issues.map((issue) => `${issuePath(issue)}: ${issue.message} (${issue.code})`).join("\n");
}

function logSchemaFailure(input: { label: string; raw: string; extractedJson: string; parsed: unknown; normalized: unknown; error: z.ZodError }) {
  console.error(`[Puter AI] ${input.label} schema validation failed`);
  console.error("[Puter AI] Exact raw response:", input.raw);
  console.error("[Puter AI] Exact extracted JSON:", input.extractedJson);
  console.error("[Puter AI] Parsed JSON before normalization:", safeStringify(input.parsed));
  if (input.normalized !== input.parsed) {
    console.error("[Puter AI] Parsed JSON after normalization:", safeStringify(input.normalized));
  }
  console.error("[Puter AI] Exact schema failure reason:", formatSchemaIssues(input.error));
  console.error("[Puter AI] Full Zod issues:", safeStringify(input.error.issues));
}

function requestOptions(options: PuterChatOptions, model: string) {
  return {
    model,
    temperature: options.temperature ?? 0.2,
    ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
  };
}

function invokePuterChat(puter: PuterApi, prompt: string, media: string[] | undefined, options: PuterChatOptions, model: string) {
  const ai = puter.ai;
  if (!ai?.chat) throw new Error("Puter.js did not expose puter.ai.chat().");
  const config = requestOptions(options, model);
  if (media?.length) {
    return options.testMode ? ai.chat(prompt, media, true, config) : ai.chat(prompt, media, config);
  }
  return options.testMode ? ai.chat(prompt, true, config) : ai.chat(prompt, config);
}

export async function puterChat(prompt: string, options: PuterChatOptions = {}) {
  const puter = await waitForPuter();
  const models = [options.model ?? DEFAULT_PUTER_MODEL, ...(options.fallbackModels ?? [])].filter((model, index, list) => list.indexOf(model) === index);
  let lastError: unknown = null;
  let lastDiagnostic: PuterRequestDiagnostic | null = null;

  for (const [index, model] of models.entries()) {
    const startedAt = new Date();
    const diagnostic: PuterRequestDiagnostic = {
      id: createId("puter-request"),
      label: options.requestLabel ?? "Puter chat",
      model,
      fallbackFromModel: index > 0 ? models[index - 1] : null,
      promptChars: prompt.length,
      mediaCount: options.media?.length ?? 0,
      mediaBytes: mediaBytes(options.media),
      startedAt: startedAt.toISOString(),
      endedAt: null,
      elapsedMs: null,
      status: "running",
      rawResponsePreview: null,
      rawError: null,
    };
    lastDiagnostic = diagnostic;
    console.info("[Puter AI] request started", diagnostic);
    options.onRequestDiagnostic?.(diagnostic);

    try {
      const response = await withTimeout(invokePuterChat(puter, prompt, options.media, options, model), options.timeoutMs ?? 75_000);
      const endedAt = new Date();
      const text = textFromResponse(response);
      diagnostic.endedAt = endedAt.toISOString();
      diagnostic.elapsedMs = endedAt.getTime() - startedAt.getTime();
      diagnostic.status = "success";
      diagnostic.rawResponsePreview = preview(text);
      console.info("[Puter AI] request completed", diagnostic);
      options.onRequestDiagnostic?.(diagnostic);
      return text;
    } catch (error) {
      const endedAt = new Date();
      diagnostic.endedAt = endedAt.toISOString();
      diagnostic.elapsedMs = endedAt.getTime() - startedAt.getTime();
      diagnostic.status = error instanceof PuterTimeoutError ? "timeout" : "error";
      diagnostic.rawError = serializeError(error);
      lastError = error;
      console.error("[Puter AI] request failed", diagnostic);
      options.onRequestDiagnostic?.(diagnostic);
    }
  }

  const message = lastError instanceof Error ? lastError.message : "Puter request failed";
  throw new PuterAIError(message, {
    diagnostic: lastDiagnostic,
    rawError: serializeError(lastError),
    timedOut: lastError instanceof PuterTimeoutError || lastDiagnostic?.status === "timeout",
  });
}

export async function puterStructuredJson<S extends z.ZodTypeAny>(prompt: string, schema: S, options: StructuredJsonOptions = {}): Promise<z.output<S>> {
  const label = options.debugLabel ?? "Structured JSON";
  const raw = await puterChat(prompt, {
    ...options,
    requestLabel: options.requestLabel ?? label,
    temperature: options.temperature ?? 0.1,
  });

  let parsed: unknown;
  let extractedJson = "";
  try {
    extractedJson = extractJson(raw);
    parsed = JSON.parse(extractedJson);
  } catch (error) {
    console.error(`[Puter AI] ${label} parse failed`);
    console.error("[Puter AI] Exact raw response:", raw);
    console.error("[Puter AI] Exact extracted JSON:", extractedJson);
    options.onSchemaError?.({
      label,
      paths: ["(parse)"],
      issues: [error instanceof Error ? error.message : String(error)],
      rawPreview: preview(raw),
      extractedJsonPreview: preview(extractedJson),
    });
    throw new Error(`AI returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  const normalized = options.normalizer ? options.normalizer(parsed) : parsed;
  if (isPuterApiErrorObject(normalized)) {
    const message = puterApiErrorMessage(normalized);
    options.onSchemaError?.({
      label,
      paths: ["(puter-api-error)"],
      issues: [message],
      rawPreview: preview(raw),
      extractedJsonPreview: preview(extractedJson),
    });
    throw new PuterAIError(message, { rawError: normalized });
  }
  const result = schema.safeParse(normalized);
  if (!result.success) {
    logSchemaFailure({
      label,
      raw,
      extractedJson,
      parsed,
      normalized,
      error: result.error,
    });
    const paths = result.error.issues.map(issuePath);
    const reasons = formatSchemaIssues(result.error);
    options.onSchemaError?.({
      label,
      paths,
      issues: result.error.issues.map((issue) => `${issuePath(issue)}: ${issue.message} (${issue.code})`),
      rawPreview: preview(raw),
      extractedJsonPreview: preview(extractedJson),
    });
    throw new Error(`AI JSON did not match the required schema: ${paths.join(", ")}\n${reasons}`);
  }

  return result.data;
}

function isPuterApiErrorObject(value: unknown): value is { error?: unknown; message?: unknown; code?: unknown } {
  return Boolean(value && typeof value === "object" && ("error" in value || "code" in value) && !("pages" in value) && !("questions" in value) && !("alignments" in value));
}

function puterApiErrorMessage(value: { error?: unknown; message?: unknown; code?: unknown }) {
  const message = typeof value.message === "string" ? value.message : typeof value.error === "string" ? value.error : "Puter returned an API error";
  const code = typeof value.code === "string" ? ` (${value.code})` : "";
  return `Puter returned an API error: ${message}${code}. Run the smoke test and sign in or refresh Puter before processing.`;
}

async function timedSmokeCall<T>(call: () => Promise<T>, timeoutMs: number) {
  const started = Date.now();
  try {
    const response = await withTimeout(call(), timeoutMs);
    return {
      success: true,
      elapsedMs: Date.now() - started,
      rawResponsePreview: preview(response),
      rawError: null,
    };
  } catch (error) {
    return {
      success: false,
      elapsedMs: Date.now() - started,
      rawResponsePreview: null,
      rawError: serializeError(error),
    };
  }
}

export async function runPuterSmokeTest(model = DEFAULT_PUTER_MODEL): Promise<PuterSmokeTestResult> {
  const puter = await waitForPuter();
  const startedAt = new Date();
  const modelCheck = await timedSmokeCall(async () => {
    if (!puter.ai?.listModels) return "puter.ai.listModels() unavailable";
    const models = await puter.ai.listModels();
    const supported = models.some((entry) => {
      const id = typeof entry.id === "string" ? entry.id : "";
      const aliases = Array.isArray(entry.aliases) ? entry.aliases.filter((alias): alias is string => typeof alias === "string") : [];
      return id === model || id === `openai/${model}` || aliases.includes(model) || aliases.includes(`openai/${model}`);
    });
    return { supported, checkedModel: model, returnedModels: models.length };
  }, 15_000);

  const textCall = await timedSmokeCall(
    () => invokePuterChat(puter, "Reply with exactly: ok", undefined, { temperature: 0 }, model),
    25_000,
  );

  const imageCall = await timedSmokeCall(
    () => invokePuterChat(puter, "Reply with JSON only: {\"imageInputSeen\":true}", [TINY_IMAGE_DATA_URL], { temperature: 0 }, model),
    30_000,
  );
  const endedAt = new Date();

  return {
    id: createId("puter-smoke"),
    model,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    elapsedMs: endedAt.getTime() - startedAt.getTime(),
    modelCheck: {
      supported:
        modelCheck.success && typeof modelCheck.rawResponsePreview === "string" && modelCheck.rawResponsePreview.includes('"supported": true')
          ? true
          : modelCheck.success && typeof modelCheck.rawResponsePreview === "string" && modelCheck.rawResponsePreview.includes('"supported": false')
            ? false
            : null,
      rawResponsePreview: modelCheck.rawResponsePreview,
      rawError: modelCheck.rawError,
    },
    textCall: {
      success: textCall.success,
      elapsedMs: textCall.elapsedMs,
      rawResponsePreview: textCall.rawResponsePreview,
      rawError: textCall.rawError,
    },
    imageCall: {
      success: imageCall.success,
      elapsedMs: imageCall.elapsedMs,
      callShape: "puter.ai.chat(prompt, [mediaDataUrl], options)",
      rawResponsePreview: imageCall.rawResponsePreview,
      rawError: imageCall.rawError,
    },
  };
}
