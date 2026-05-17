import type {
  AIProxyError,
  AIProxyOperation,
  AIProxyRequest,
  AIProxyFailureResponse,
  AIProxySuccessResponse,
} from "../../src/ai/contracts";
import { modelLabelForModel } from "../../src/ai/providerTypes";
import { redactSensitiveText } from "../../src/ai/redaction";
import type { ProxyDeps } from "./geminiProxy";

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

export type AnthropicProxyEnv = {
  ANTHROPIC_API_KEY?: string;
};

function failure(operation: AIProxyOperation, message: string, input: Partial<AIProxyError> & { model?: string | null } = {}) {
  const response: AIProxyFailureResponse = {
    ok: false,
    operation,
    provider: "anthropic",
    model: input.model ?? null,
    error: {
      type: input.type ?? "server",
      message: redactSensitiveText(message),
      retryable: input.retryable ?? false,
      statusCode: typeof input.statusCode === "number" ? input.statusCode : null,
      blockedReason: typeof input.blockedReason === "string" ? input.blockedReason : null,
      rawPreview: typeof input.rawPreview === "string" ? redactSensitiveText(input.rawPreview) : null,
      retryAfterMs: typeof input.retryAfterMs === "number" ? input.retryAfterMs : null,
    },
  };
  return response;
}

function success(operation: AIProxyOperation, provider: "anthropic", model: string, text: string, finishReason: string | null = null, usage?: Record<string, unknown>) {
  const response: AIProxySuccessResponse = {
    ok: true,
    operation,
    provider,
    model,
    modelLabel: modelLabelForModel(model),
    text: redactSensitiveText(text),
    finishReason,
    usage,
  };
  return response;
}

function systemPromptForOperation(operation: AIProxyOperation) {
  const jsonOnly = [
    "page_inventory",
    "question_boundaries",
    "question_extraction",
    "visual_inventory",
    "question_support_validation",
    "question_display_plan",
    "mark_scheme_alignment",
    "mark_scheme_recovery",
    "paper_mark",
    "smoke_extraction",
    "smoke_marking",
  ].includes(operation);
  const base = [
    "You are the secure AI provider for Past Paper Worker.",
    "Follow the user prompt exactly and keep output grounded in the supplied source content.",
  ];
  if (jsonOnly) base.push("Return valid JSON only. No markdown. No prose outside the JSON object.");
  if (operation === "paper_mark" || operation === "smoke_marking") {
    base.push("Act as a strict GCSE examiner and mark only against the supplied mark scheme.");
  }
  return base.join(" ");
}

function buildAnthropicBody(request: AIProxyRequest) {
  const unsupportedMedia = (request.media ?? []).find((item) => !SUPPORTED_IMAGE_TYPES.has(item.mimeType));
  if (unsupportedMedia) {
    throw new Error(`Unsupported media type for Claude vision: ${unsupportedMedia.mimeType}`);
  }
  const imageBlocks = (request.media ?? []).map((item) => ({
    type: "image",
    source: {
      type: "base64",
      media_type: item.mimeType,
      data: item.dataBase64,
    },
  }));
  return {
    model: request.model,
    max_tokens: request.maxTokens ?? 64000,
    temperature: request.temperature ?? 0,
    system: systemPromptForOperation(request.operation),
    messages: [
      {
        role: "user",
        content: [
          ...imageBlocks,
          { type: "text", text: request.prompt },
        ],
      },
    ],
  };
}

function extractAnthropicText(responseJson: Record<string, unknown>) {
  const content = Array.isArray(responseJson.content) ? responseJson.content : [];
  const text = content
    .filter((block): block is Record<string, unknown> => Boolean(block && typeof block === "object"))
    .filter((block) => block.type === "text")
    .map((block) => (typeof block.text === "string" ? block.text : ""))
    .join("")
    .trim();
  const stopReason = typeof responseJson.stop_reason === "string" ? responseJson.stop_reason : null;
  const usage = (responseJson.usage as Record<string, unknown> | undefined) ?? undefined;
  return { text, stopReason, usage };
}

function retryAfterMsFromResponse(response: Response, message: string) {
  const header = response.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
    const dateMs = Date.parse(header);
    if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  }
  const match = message.match(/retry(?:\s|-)?after[^0-9]*(\d+(?:\.\d+)?)(?:\s*(ms|milliseconds?|s|sec|seconds?|m|minutes?))?/i);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = (match[2] ?? "s").toLowerCase();
  if (unit.startsWith("m") && !unit.startsWith("ms")) return Math.ceil(amount * 60_000);
  if (unit.startsWith("ms") || unit.startsWith("millisecond")) return Math.ceil(amount);
  return Math.ceil(amount * 1000);
}

function anthropicErrorFromStatus(status: number, message: string, rawPreview: string | null, retryAfterMs: number | null) {
  if (status === 401 || status === 403) {
    return {
      type: "provider",
      message: "Claude provider authentication failed. Check ANTHROPIC_API_KEY in Cloudflare Worker secrets.",
      retryable: false,
      statusCode: status,
      rawPreview: rawPreview ?? undefined,
    } satisfies Partial<AIProxyError>;
  }
  if (status === 429) {
    const retryText = retryAfterMs ? ` Retry in about ${Math.max(1, Math.round(retryAfterMs / 1000))} seconds.` : "";
    return {
      type: "quota",
      message: `Claude quota or rate limit error.${retryText}`,
      retryable: true,
      statusCode: status,
      rawPreview: rawPreview ?? undefined,
      retryAfterMs: retryAfterMs ?? undefined,
    } satisfies Partial<AIProxyError>;
  }
  if (status >= 500) {
    return {
      type: "network",
      message: `Claude service error: ${message}`,
      retryable: true,
      statusCode: status,
      rawPreview: rawPreview ?? undefined,
    } satisfies Partial<AIProxyError>;
  }
  return {
    type: "provider",
    message: `Claude rejected the request: ${message}`,
    retryable: false,
    statusCode: status,
    rawPreview: rawPreview ?? undefined,
  } satisfies Partial<AIProxyError>;
}

export async function runAnthropicRequest(request: AIProxyRequest, env: AnthropicProxyEnv, deps: ProxyDeps = {}) {
  let body: Record<string, unknown>;
  try {
    body = buildAnthropicBody(request);
  } catch (error) {
    return failure(request.operation, error instanceof Error ? error.message : String(error), {
      type: "invalid_request",
      statusCode: 400,
      model: request.model,
    });
  }

  const fetchImpl = deps.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeoutMs = request.timeoutMs ?? 75_000;
  const timeoutId = setTimeout(() => controller.abort("timeout"), timeoutMs);

  try {
    const response = await fetchImpl(ANTHROPIC_MESSAGES_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY ?? "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const rawText = await response.text();
    const rawPreview = rawText ? redactSensitiveText(rawText.slice(0, 2500)) : null;

    if (!response.ok) {
      let providerMessage = response.statusText || "Unknown Claude error";
      try {
        const parsed = JSON.parse(rawText) as { error?: { type?: string; message?: string } };
        if (typeof parsed.error?.message === "string" && parsed.error.message.trim()) providerMessage = parsed.error.message;
      } catch {
        // Leave providerMessage as-is.
      }
      const retryAfterMs = retryAfterMsFromResponse(response, providerMessage);
      const mappedError = anthropicErrorFromStatus(response.status, providerMessage, rawPreview, retryAfterMs);
      return failure(request.operation, mappedError.message ?? providerMessage, { ...mappedError, model: request.model });
    }

    let responseJson: Record<string, unknown>;
    try {
      responseJson = JSON.parse(rawText) as Record<string, unknown>;
    } catch {
      return failure(request.operation, "Claude returned invalid JSON.", {
        type: "invalid_json",
        rawPreview,
        retryable: false,
        model: request.model,
      });
    }

    const { text, stopReason, usage } = extractAnthropicText(responseJson);
    if (stopReason === "refusal") {
      return failure(request.operation, "Claude refused the response for safety reasons.", {
        type: "safety",
        blockedReason: stopReason,
        rawPreview,
        model: request.model,
      });
    }
    if (!text) {
      return failure(request.operation, "Claude returned an empty response.", {
        type: "empty_response",
        rawPreview,
        retryable: true,
        model: request.model,
      });
    }
    return success(request.operation, "anthropic", request.model, text, stopReason, usage);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return failure(request.operation, `Claude request timed out after ${Math.round(timeoutMs / 1000)}s.`, {
        type: "timeout",
        retryable: true,
        model: request.model,
      });
    }
    return failure(request.operation, "Network error while contacting Claude.", {
      type: "network",
      retryable: true,
      rawPreview: error instanceof Error ? error.message : String(error),
      model: request.model,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}
