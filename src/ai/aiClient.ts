import { z } from "zod";
import { createId } from "../lib/id";
import type { AIRequestDiagnostic, AISmokeTestResult } from "../types";
import {
  aiProxyRequestSchema,
  aiProxyResponseSchema,
  type AIProxyFailureResponse,
  type AIProxyOperation,
  type AIProxyRequest,
  type AIProxyResponse,
  type AIProxySuccessResponse,
} from "./contracts";
import {
  modelLabelForModel,
  resolveAIModelConfig,
  type AIProviderId,
  DEFAULT_AI_MODEL,
} from "./providerTypes";
import { hasUnredactedSecret, redactSensitiveText, redactSensitiveValue } from "./redaction";

export {
  AI_MODEL_CHOICES,
  CLAUDE_SONNET_MODEL,
  DEFAULT_AI_MODEL,
  DEFAULT_AI_PROVIDER,
  FALLBACK_AI_MODELS,
  GEMINI_FLASH_LITE_MODEL,
  GEMINI_FLASH_MODEL,
  modelLabelForModel,
  resolveAIModelConfig,
} from "./providerTypes";

type AITestMock = {
  respond?: (request: AIProxyRequest) => Promise<AITestMockResponse> | AITestMockResponse;
  chat?: (prompt: string, request: AIProxyRequest) => Promise<unknown> | unknown;
  ai?: {
    chat?: (prompt: string, request: AIProxyRequest) => Promise<unknown> | unknown;
  };
};

type AITestMockSuccessResponse = Omit<AIProxySuccessResponse, "provider"> & {
  provider?: AIProviderId;
};

type AITestMockResponse = AITestMockSuccessResponse | AIProxyFailureResponse;

declare global {
  interface Window {
    __AI_TEST_MOCK__?: AITestMock;
  }
}

export type AIResultMetadata = {
  provider: AIProviderId;
  model: string;
  modelLabel: string;
  fallbackFromModel: string | null;
};

type AIChatOptions = {
  operation: AIProxyOperation;
  model?: string;
  fallbackModels?: string[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  media?: string[];
  requestLabel?: string;
  diagnosticFallbackFromModel?: string | null;
  onRequestDiagnostic?: (diagnostic: AIRequestDiagnostic) => void;
};

type StructuredJsonOptions = AIChatOptions & {
  normalizer?: (input: unknown) => unknown;
  debugLabel?: string;
  onResultMetadata?: (metadata: AIResultMetadata) => void;
  onSchemaError?: (error: { label: string; paths: string[]; issues: string[]; rawPreview: string; extractedJsonPreview: string }) => void;
};

export class AIProviderError extends Error {
  readonly diagnostic: AIRequestDiagnostic | null;
  readonly rawError: unknown;
  readonly timedOut: boolean;
  readonly errorType: string | null;
  readonly retryAfterMs: number | null;
  readonly httpStatus: number | null;
  readonly provider: AIProviderId | null;
  readonly model: string | null;
  readonly modelLabel: string | null;
  readonly operation: string | null;

  constructor(
    message: string,
    input: {
      diagnostic?: AIRequestDiagnostic | null;
      rawError?: unknown;
      timedOut?: boolean;
      errorType?: string | null;
      retryAfterMs?: number | null;
      httpStatus?: number | null;
      provider?: AIProviderId | null;
      model?: string | null;
      modelLabel?: string | null;
      operation?: string | null;
    } = {},
  ) {
    super(message);
    this.name = "AIProviderError";
    this.diagnostic = input.diagnostic ?? null;
    this.rawError = input.rawError;
    this.timedOut = Boolean(input.timedOut);
    this.errorType = input.errorType ?? null;
    this.retryAfterMs = input.retryAfterMs ?? null;
    this.httpStatus = input.httpStatus ?? null;
    this.provider = input.provider ?? null;
    this.model = input.model ?? null;
    this.modelLabel = input.modelLabel ?? null;
    this.operation = input.operation ?? null;
  }
}

class AIRequestTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`AI provider request timed out after ${Math.round(timeoutMs / 1000)}s`);
    this.name = "AIRequestTimeoutError";
  }
}

function safeStringify(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function stringifyResponseContent(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return safeStringify(value);
}

function preview(value: unknown, maxChars = 1800): string {
  const text = redactSensitiveText(typeof value === "string" ? value : safeStringify(value));
  if (!text) return text;
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n[clipped ${text.length - maxChars} chars]` : text;
}

function serializeError(error: unknown): unknown {
  if (error instanceof Error) {
    return redactSensitiveValue({
      name: error.name,
      message: error.message,
      stack: error.stack,
      ...(error instanceof AIProviderError
        ? {
            timedOut: error.timedOut,
            diagnostic: error.diagnostic,
            rawError: error.rawError,
            errorType: error.errorType,
            retryAfterMs: error.retryAfterMs,
            httpStatus: error.httpStatus,
            provider: error.provider,
            model: error.model,
            modelLabel: error.modelLabel,
            operation: error.operation,
          }
        : {}),
    });
  }
  return redactSensitiveValue(error);
}

function dataUrlByteSize(dataUrl: string) {
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex < 0) return dataUrl.length;
  return Math.round(((dataUrl.length - commaIndex - 1) * 3) / 4);
}

function mediaBytes(media: string[] | undefined) {
  return (media ?? []).reduce((sum, item) => sum + (item.startsWith("data:") ? dataUrlByteSize(item) : item.length), 0);
}

function issuePath(issue: z.ZodIssue) {
  return issue.path.length ? issue.path.join(".") : "(root)";
}

function formatSchemaIssues(error: z.ZodError) {
  return error.issues.map((issue) => `${issuePath(issue)}: ${issue.message} (${issue.code})`).join("\n");
}

function logSchemaFailure(input: { label: string; raw: string; extractedJson: string; parsed: unknown; normalized: unknown; error: z.ZodError }) {
  console.error(`[AI provider] ${input.label} schema validation failed`);
  console.error("[AI provider] Exact raw response:", redactSensitiveText(input.raw));
  console.error("[AI provider] Exact extracted JSON:", redactSensitiveText(input.extractedJson));
  console.error("[AI provider] Parsed JSON before normalization:", preview(input.parsed, 5000));
  if (input.normalized !== input.parsed) {
    console.error("[AI provider] Parsed JSON after normalization:", preview(input.normalized, 5000));
  }
  console.error("[AI provider] Exact schema failure reason:", formatSchemaIssues(input.error));
  console.error("[AI provider] Full Zod issues:", preview(input.error.issues, 5000));
}

function extractJson(raw: string) {
  const trimmed = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return trimmed;
  const braceStart = trimmed.indexOf("{");
  const braceEnd = trimmed.lastIndexOf("}");
  if (braceStart >= 0 && braceEnd > braceStart) return trimmed.slice(braceStart, braceEnd + 1);
  const listStart = trimmed.indexOf("[");
  const listEnd = trimmed.lastIndexOf("]");
  if (listStart >= 0 && listEnd > listStart) return trimmed.slice(listStart, listEnd + 1);
  return trimmed;
}

function parseDataUrl(dataUrl: string) {
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(dataUrl);
  if (!match) {
    throw new Error("Only base64 data URLs can be sent to the secure AI proxy.");
  }
  return { mimeType: match[1], dataBase64: match[2] };
}

function defaultProxyUrl() {
  if (typeof window !== "undefined") {
    const hostname = window.location.hostname;
    if (hostname === "127.0.0.1" || hostname === "localhost") return "";
  }
  return "/api/ai";
}

function resolveProxyUrl() {
  return (import.meta.env.VITE_AI_PROXY_URL?.trim() || import.meta.env.VITE_GEMINI_PROXY_URL?.trim() || defaultProxyUrl()).trim();
}

export function parseRetryAfterMs(message: string): number | null {
  const match = message.match(/retry in\s+(\d+(?:\.\d+)?)s/i);
  return match ? Math.ceil(Number(match[1]) * 1000) : null;
}

async function ensureProxyConfigured() {
  if (window.__AI_TEST_MOCK__) return "__AI_TEST_MOCK__";
  const proxyUrl = resolveProxyUrl();
  if (proxyUrl) return proxyUrl;
  throw new Error(
    "AI proxy URL is not configured for local development. Set VITE_AI_PROXY_URL in .env.local or run the app through the Cloudflare Worker route.",
  );
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timeoutId = 0;
  const timeout = new Promise<T>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new AIRequestTimeoutError(timeoutMs)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timeoutId));
}

async function callTestMock(request: AIProxyRequest) {
  const mock = window.__AI_TEST_MOCK__;
  if (!mock) return null;
  const normalizeMockResponse = (payload: AITestMockResponse): AIProxyResponse => {
    if (payload.ok) {
      const config = resolveAIModelConfig(payload.model || request.model);
      return {
        ...payload,
        provider: payload.provider ?? request.provider ?? config.provider,
        modelLabel: payload.modelLabel ?? config.label,
      };
    }
    return payload;
  };
  if (mock.respond) return aiProxyResponseSchema.parse(normalizeMockResponse(await mock.respond(request)));
  const chat = mock.chat ?? mock.ai?.chat;
  if (!chat) throw new Error("AI test mock is present but does not expose respond() or chat().");
  const result = await chat(request.prompt, request);
  if (typeof result === "object" && result !== null && "ok" in result) {
    return aiProxyResponseSchema.parse(result as AIProxyResponse);
  }
  const config = resolveAIModelConfig(request.model);
  return {
    ok: true,
    operation: request.operation,
    provider: request.provider ?? config.provider,
    model: request.model,
    modelLabel: config.label,
    text: stringifyResponseContent(result),
  } satisfies AIProxySuccessResponse;
}

async function callProxy(request: AIProxyRequest) {
  const mocked = await callTestMock(request);
  if (mocked) return mocked;

  const proxyUrl = await ensureProxyConfigured();
  const response = await fetch(proxyUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(request),
  });
  const raw = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`AI proxy returned invalid JSON (${response.status}). ${preview(raw)}`);
  }
  const normalized = aiProxyResponseSchema.safeParse(parsed);
  if (!normalized.success) {
    throw new Error(`AI proxy returned an unexpected payload (${response.status}).`);
  }
  return normalized.data;
}

function failureToError(response: AIProxyFailureResponse, diagnostic: AIRequestDiagnostic) {
  return new AIProviderError(response.error.message, {
    diagnostic,
    rawError: redactSensitiveValue(response.error),
    timedOut: response.error.type === "timeout",
    errorType: response.error.type,
    retryAfterMs: response.error.retryAfterMs ?? parseRetryAfterMs(response.error.message),
    httpStatus: response.error.statusCode ?? null,
    provider: response.provider ?? diagnostic.provider ?? null,
    model: response.model,
    modelLabel: response.model ? modelLabelForModel(response.model) : diagnostic.modelLabel ?? null,
    operation: response.operation,
  });
}

async function executeProxyCall(request: AIProxyRequest, options: AIChatOptions) {
  return withTimeout(callProxy(request), options.timeoutMs ?? 75_000);
}

export async function ensureAIReadyForUserAction() {
  return ensureProxyConfigured();
}

function shouldTryFallback(error: unknown) {
  if (error instanceof AIProviderError) {
    if (["server", "network", "quota", "timeout", "empty_response", "invalid_json"].includes(error.errorType ?? "") || error.timedOut) return true;
    if (error.errorType === "provider") {
      return error.httpStatus === 401 || error.httpStatus === 403 || /(?:api[_ -]?key|auth|unavailable|runtime secret|missing at runtime)/i.test(error.message);
    }
    return false;
  }
  if (error instanceof AIRequestTimeoutError) return true;
  return false;
}

async function aiChatDetailed(prompt: string, options: AIChatOptions): Promise<{ text: string; metadata: AIResultMetadata }> {
  await ensureProxyConfigured();
  const models = [options.model ?? DEFAULT_AI_MODEL, ...(options.fallbackModels ?? [])].filter((model, index, list) => list.indexOf(model) === index);
  let lastError: unknown = null;
  let lastDiagnostic: AIRequestDiagnostic | null = null;

  for (const [index, model] of models.entries()) {
    const startedAt = new Date();
    const config = resolveAIModelConfig(model);
    const fallbackFromModel = index > 0 ? models[index - 1] : options.diagnosticFallbackFromModel ?? null;
    const fallbackFromConfig = fallbackFromModel ? resolveAIModelConfig(fallbackFromModel) : null;
    const request = aiProxyRequestSchema.parse({
      operation: options.operation,
      provider: config.provider,
      model,
      prompt,
      temperature: options.temperature ?? 0.2,
      maxTokens: options.maxTokens,
      timeoutMs: options.timeoutMs,
      requestLabel: options.requestLabel,
      retryCount: index,
      media: (options.media ?? []).map(parseDataUrl),
    });
    const diagnostic: AIRequestDiagnostic = {
      id: createId("ai-request"),
      label: options.requestLabel ?? options.operation,
      operation: options.operation,
      provider: config.provider,
      model,
      modelLabel: config.label,
      fallbackFromModel,
      fallbackFromProvider: fallbackFromConfig?.provider ?? null,
      promptChars: prompt.length,
      mediaCount: options.media?.length ?? 0,
      mediaBytes: mediaBytes(options.media),
      startedAt: startedAt.toISOString(),
      endedAt: null,
      elapsedMs: null,
      retryCount: index,
      status: "running",
      rawResponsePreview: null,
      rawError: null,
    };
    lastDiagnostic = diagnostic;
    options.onRequestDiagnostic?.(diagnostic);

    try {
      const response = await executeProxyCall(request, options);
      const endedAt = new Date();
      diagnostic.endedAt = endedAt.toISOString();
      diagnostic.elapsedMs = endedAt.getTime() - startedAt.getTime();
      if (!response.ok) {
        diagnostic.status = response.error.type === "timeout" ? "timeout" : "error";
        diagnostic.rawError = redactSensitiveValue(response.error);
        options.onRequestDiagnostic?.(diagnostic);
        lastError = failureToError(response, diagnostic);
        if (index < models.length - 1 && shouldTryFallback(lastError)) continue;
        throw lastError;
      }
      diagnostic.status = "success";
      diagnostic.provider = response.provider;
      diagnostic.model = response.model;
      diagnostic.modelLabel = response.modelLabel ?? modelLabelForModel(response.model);
      diagnostic.rawResponsePreview = preview(response.text);
      diagnostic.rawError = null;
      options.onRequestDiagnostic?.(diagnostic);
      return {
        text: response.text,
        metadata: {
          provider: response.provider,
          model: response.model,
          modelLabel: response.modelLabel ?? modelLabelForModel(response.model),
          fallbackFromModel,
        },
      };
    } catch (error) {
      const endedAt = new Date();
      diagnostic.endedAt = endedAt.toISOString();
      diagnostic.elapsedMs = endedAt.getTime() - startedAt.getTime();
      diagnostic.status = error instanceof AIRequestTimeoutError ? "timeout" : "error";
      diagnostic.rawError = serializeError(error);
      options.onRequestDiagnostic?.(diagnostic);
      lastError = error;
      if (index < models.length - 1 && shouldTryFallback(error)) continue;
      break;
    }
  }

  const message = lastError instanceof Error ? lastError.message : "AI provider request failed";
  throw new AIProviderError(message, {
    diagnostic: lastDiagnostic,
    rawError: serializeError(lastError),
    timedOut: lastError instanceof AIRequestTimeoutError || lastDiagnostic?.status === "timeout",
    errorType: lastError instanceof AIProviderError ? lastError.errorType : null,
    retryAfterMs: lastError instanceof AIProviderError ? lastError.retryAfterMs : parseRetryAfterMs(message),
    httpStatus: lastError instanceof AIProviderError ? lastError.httpStatus : null,
    provider: lastError instanceof AIProviderError ? lastError.provider : lastDiagnostic?.provider ?? null,
    model: lastError instanceof AIProviderError ? lastError.model : lastDiagnostic?.model ?? null,
    modelLabel: lastError instanceof AIProviderError ? lastError.modelLabel : lastDiagnostic?.modelLabel ?? null,
    operation: lastError instanceof AIProviderError ? lastError.operation : options.operation,
  });
}

export async function aiChat(prompt: string, options: AIChatOptions) {
  return (await aiChatDetailed(prompt, options)).text;
}

type ParsedStructuredJson<S extends z.ZodTypeAny> = {
  data: z.output<S>;
  raw: string;
  extractedJson: string;
  metadata: AIResultMetadata;
};

function schemaErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function reportParseFailure(raw: string, extractedJson: string, label: string, error: unknown, options: StructuredJsonOptions) {
  options.onSchemaError?.({
    label,
    paths: ["(parse)"],
    issues: [schemaErrorMessage(error)],
    rawPreview: preview(raw),
    extractedJsonPreview: preview(extractedJson),
  });
}

function reportValidationFailure(raw: string, extractedJson: string, parsed: unknown, normalized: unknown, label: string, error: z.ZodError, options: StructuredJsonOptions) {
  logSchemaFailure({
    label,
    raw,
    extractedJson,
    parsed,
    normalized,
    error,
  });
  options.onSchemaError?.({
    label,
    paths: error.issues.map(issuePath),
    issues: error.issues.map((issue) => `${issuePath(issue)}: ${issue.message} (${issue.code})`),
    rawPreview: preview(raw),
    extractedJsonPreview: preview(extractedJson),
  });
}

function parseStructuredJson<S extends z.ZodTypeAny>(raw: string, schema: S, label: string, options: StructuredJsonOptions, metadata: AIResultMetadata): ParsedStructuredJson<S> {
  let parsed: unknown;
  let extractedJson = "";
  try {
    extractedJson = extractJson(raw);
    parsed = JSON.parse(extractedJson);
  } catch (error) {
    reportParseFailure(raw, extractedJson, label, error, options);
    throw new Error(`AI returned invalid JSON: ${schemaErrorMessage(error)}`);
  }

  const normalized = options.normalizer ? options.normalizer(parsed) : parsed;
  const result = schema.safeParse(normalized);
  if (!result.success) {
    reportValidationFailure(raw, extractedJson, parsed, normalized, label, result.error, options);
    throw new Error(`AI JSON did not match the required schema: ${formatSchemaIssues(result.error)}`);
  }

  return { data: result.data, raw, extractedJson, metadata };
}

function buildRepairPrompt(originalPrompt: string, raw: string) {
  return [
    originalPrompt,
    "Your previous response was not valid JSON for the required schema. Return only a corrected JSON object matching the schema. Do not include markdown or commentary.",
    "Previous response:",
    preview(raw, 6000),
  ].join("\n\n");
}

export async function aiStructuredJson<S extends z.ZodTypeAny>(prompt: string, schema: S, options: StructuredJsonOptions): Promise<z.output<S>> {
  const label = options.debugLabel ?? options.operation;
  const chatOptions = {
    ...options,
    requestLabel: options.requestLabel ?? label,
    temperature: options.temperature ?? 0.1,
  };
  const first = await aiChatDetailed(prompt, chatOptions);
  try {
    const parsed = parseStructuredJson(first.text, schema, label, options, first.metadata);
    options.onResultMetadata?.(parsed.metadata);
    return parsed.data;
  } catch (firstError) {
    if (first.metadata.provider !== "anthropic") throw firstError;

    try {
      const repaired = await aiChatDetailed(buildRepairPrompt(prompt, first.text), {
        ...chatOptions,
        model: first.metadata.model,
        fallbackModels: [],
        requestLabel: `${label} JSON repair`,
        temperature: 0,
      });
      const parsedRepair = parseStructuredJson(repaired.text, schema, `${label} JSON repair`, options, repaired.metadata);
      options.onResultMetadata?.(parsedRepair.metadata);
      return parsedRepair.data;
    } catch (repairError) {
      const fallbackModels = (options.fallbackModels ?? []).filter((model) => resolveAIModelConfig(model).provider !== "anthropic");
      if (!fallbackModels.length) throw repairError;
      const [fallbackModel, ...remainingFallbacks] = fallbackModels;
      const fallback = await aiChatDetailed(prompt, {
        ...chatOptions,
        model: fallbackModel,
        fallbackModels: remainingFallbacks,
        requestLabel: `${label} fallback`,
        diagnosticFallbackFromModel: first.metadata.model,
      });
      const parsedFallback = parseStructuredJson(fallback.text, schema, `${label} fallback`, options, {
        ...fallback.metadata,
        fallbackFromModel: first.metadata.model,
      });
      options.onResultMetadata?.(parsedFallback.metadata);
      return parsedFallback.data;
    }
  }
}

function smokeResult(success: boolean, payload: { elapsedMs: number; rawResponsePreview?: string | null; rawError?: unknown }) {
  return {
    success,
    elapsedMs: payload.elapsedMs,
    rawResponsePreview: payload.rawResponsePreview ?? null,
    rawError: payload.rawError ?? null,
  };
}

async function timedCall<T>(call: () => Promise<T>) {
  const started = Date.now();
  try {
    const value = await call();
    return { success: true, elapsedMs: Date.now() - started, value, rawError: null };
  } catch (error) {
    return { success: false, elapsedMs: Date.now() - started, value: null, rawError: serializeError(error) };
  }
}

export async function runAISmokeTest(model = DEFAULT_AI_MODEL): Promise<AISmokeTestResult> {
  const startedAt = new Date();
  const config = resolveAIModelConfig(model);

  const proxyCheck = await timedCall(() =>
    callProxy(
      aiProxyRequestSchema.parse({
        operation: "smoke_ping",
        provider: config.provider,
        model,
        prompt: "ping",
        timeoutMs: 15_000,
        requestLabel: "Smoke ping",
      }),
    ),
  );
  const textCall = await timedCall(() =>
    aiChat("Reply with exactly: ok", {
      operation: "smoke_text",
      model,
      timeoutMs: 20_000,
      requestLabel: "Smoke text",
      temperature: 0,
      maxTokens: 16,
    }),
  );
  const extractionCall = await timedCall(() =>
    aiStructuredJson(
      [
        "Return one extracted question in the required schema.",
        "Visible text: Question 1(a) Describe one benefit of encryption. [2 marks]",
        "Use responseType short_text, pageReferences [1], and no mark scheme data.",
      ].join("\n"),
      z.object({
        questions: z.array(
          z.object({
            questionNumber: z.string(),
            parentQuestionNumber: z.string().nullable(),
            numberingPath: z.array(z.string()),
            promptText: z.string(),
            maxMarks: z.number(),
            responseType: z.string(),
            originalFormat: z.string(),
            convertedFormat: z.string().nullable(),
            originalContent: z.record(z.unknown()),
            convertedContent: z.record(z.unknown()),
            options: z.array(z.string()),
            pageReferences: z.array(z.number()),
            mediaRefs: z.array(z.unknown()),
            markSchemeRef: z.string().nullable(),
            markSchemeData: z.record(z.unknown()).nullable(),
          }),
        ),
      }),
      { operation: "smoke_extraction", model, timeoutMs: 30_000, requestLabel: "Smoke extraction" },
    ),
  );
  const markingCall = await timedCall(() =>
    aiStructuredJson(
      [
        "Return a marking decision in the required schema.",
        "Question: State one protocol used to send email.",
        "Student answer: SMTP",
        "Mark scheme: SMTP 1 mark. Correct answer only.",
      ].join("\n"),
      z.object({
        awardedMarks: z.number(),
        maxMarks: z.number(),
        rationale: z.string(),
        missingPoints: z.array(z.string()),
        markSchemeEvidence: z.string().nullable(),
        markSchemeReference: z.record(z.unknown()),
        confidence: z.number(),
      }),
      { operation: "smoke_marking", model, timeoutMs: 30_000, requestLabel: "Smoke marking" },
    ),
  );
  const diagnosticsRedactionCheck = await timedCall(() =>
    callProxy(
      aiProxyRequestSchema.parse({
        operation: "smoke_diagnostics",
        provider: config.provider,
        model,
        prompt: "Check diagnostics redaction",
        timeoutMs: 10_000,
        requestLabel: "Smoke diagnostics",
      }),
    ),
  );

  const endedAt = new Date();
  const redactionPreview =
    diagnosticsRedactionCheck.success && diagnosticsRedactionCheck.value && "ok" in diagnosticsRedactionCheck.value && diagnosticsRedactionCheck.value.ok
      ? diagnosticsRedactionCheck.value.text
      : null;

  return {
    id: createId("ai-smoke"),
    provider: config.provider,
    model,
    modelLabel: config.label,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    elapsedMs: endedAt.getTime() - startedAt.getTime(),
    proxyCheck: smokeResult(proxyCheck.success, {
      elapsedMs: proxyCheck.elapsedMs,
      rawResponsePreview: proxyCheck.success && proxyCheck.value ? preview(proxyCheck.value) : null,
      rawError: proxyCheck.rawError,
    }),
    textCall: smokeResult(textCall.success, {
      elapsedMs: textCall.elapsedMs,
      rawResponsePreview: typeof textCall.value === "string" ? preview(textCall.value) : null,
      rawError: textCall.rawError,
    }),
    extractionCall: smokeResult(extractionCall.success, {
      elapsedMs: extractionCall.elapsedMs,
      rawResponsePreview: extractionCall.success ? preview(extractionCall.value) : null,
      rawError: extractionCall.rawError,
    }),
    markingCall: smokeResult(markingCall.success, {
      elapsedMs: markingCall.elapsedMs,
      rawResponsePreview: markingCall.success ? preview(markingCall.value) : null,
      rawError: markingCall.rawError,
    }),
    diagnosticsRedactionCheck: {
      ...smokeResult(diagnosticsRedactionCheck.success, {
        elapsedMs: diagnosticsRedactionCheck.elapsedMs,
        rawResponsePreview: redactionPreview,
        rawError: diagnosticsRedactionCheck.rawError,
      }),
      redacted:
        typeof redactionPreview === "string"
          ? !hasUnredactedSecret(redactionPreview) && /\[REDACTED/.test(redactionPreview)
          : null,
    },
  };
}
