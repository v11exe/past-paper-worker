import { geminiResponseJsonSchemas } from "../../src/ai/geminiSchemas";
import {
  aiProxyRequestSchema,
  type AIProxyError,
  type AIProxyFailureResponse,
  type AIProxyOperation,
  type AIProxyRequest,
  type AIProxySuccessResponse,
} from "../../src/ai/contracts";
import { redactSensitiveText, redactSensitiveValue } from "../../src/ai/redaction";

const GEMINI_API_ROOT = "https://generativelanguage.googleapis.com/v1beta/models";
const MAX_REQUEST_BYTES = 9 * 1024 * 1024;
const GOOGLE_KEY_PREFIX = ["AI", "za"].join("");

type ProxyEnv = {
  GEMINI_API_KEY?: string;
};

type ProxyDeps = {
  fetchImpl?: typeof fetch;
};

function json(data: AIProxySuccessResponse | AIProxyFailureResponse, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function failure(operation: AIProxyOperation, message: string, input: Partial<AIProxyError> = {}) {
  const response: AIProxyFailureResponse = {
    ok: false,
    operation,
    model: null,
    error: {
      type: input.type ?? "server",
      message: redactSensitiveText(message),
      retryable: input.retryable ?? false,
      statusCode: typeof input.statusCode === "number" ? input.statusCode : null,
      blockedReason: typeof input.blockedReason === "string" ? input.blockedReason : null,
      rawPreview: typeof input.rawPreview === "string" ? redactSensitiveText(input.rawPreview) : null,
    },
  };
  return response;
}

function success(operation: AIProxyOperation, model: string, text: string, finishReason: string | null = null, usage?: Record<string, unknown>) {
  const response: AIProxySuccessResponse = {
    ok: true,
    operation,
    model,
    text: redactSensitiveText(text),
    finishReason,
    usage,
  };
  return response;
}

function badRequest(operation: AIProxyOperation, message: string, rawPreview?: string) {
  return json(
    failure(operation, message, {
      type: "invalid_request",
      statusCode: 400,
      rawPreview,
    }),
    400,
  );
}

function isStructuredOperation(operation: AIProxyOperation) {
  return Object.prototype.hasOwnProperty.call(geminiResponseJsonSchemas, operation);
}

function buildGeminiBody(request: AIProxyRequest) {
  const parts = [
    ...(request.media ?? []).map((item) => ({
      inlineData: {
        mimeType: item.mimeType,
        data: item.dataBase64,
      },
    })),
    { text: request.prompt },
  ];
  const responseJsonSchema = geminiResponseJsonSchemas[request.operation];
  return {
    contents: [{ role: "user", parts }],
    generationConfig: {
      temperature: request.temperature ?? 0.2,
      ...(request.maxTokens ? { maxOutputTokens: request.maxTokens } : {}),
      responseMimeType: isStructuredOperation(request.operation) ? "application/json" : "text/plain",
      ...(responseJsonSchema ? { responseJsonSchema } : {}),
    },
  };
}

function extractGeminiText(responseJson: Record<string, unknown>) {
  const promptFeedback = responseJson.promptFeedback as Record<string, unknown> | undefined;
  const blockReason = typeof promptFeedback?.blockReason === "string" ? promptFeedback.blockReason : null;
  const candidates = Array.isArray(responseJson.candidates) ? responseJson.candidates : [];
  const candidate = candidates[0] as Record<string, unknown> | undefined;
  const finishReason = typeof candidate?.finishReason === "string" ? candidate.finishReason : null;
  const content = candidate?.content as Record<string, unknown> | undefined;
  const parts = Array.isArray(content?.parts) ? content.parts : [];
  const text = parts
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const value = (part as Record<string, unknown>).text;
      return typeof value === "string" ? value : "";
    })
    .join("")
    .trim();
  const usage = (responseJson.usageMetadata as Record<string, unknown> | undefined) ?? undefined;
  return { text, blockReason, finishReason, usage };
}

function geminiErrorFromStatus(status: number, message: string, rawPreview: string | null) {
  if (status === 429) {
    return {
      type: "quota",
      message: `Gemini quota or rate limit error: ${message}`,
      retryable: true,
      statusCode: status,
      rawPreview: rawPreview ?? undefined,
    } satisfies Partial<AIProxyError>;
  }
  if (status >= 500) {
    return {
      type: "network",
      message: `Gemini service error: ${message}`,
      retryable: true,
      statusCode: status,
      rawPreview: rawPreview ?? undefined,
    } satisfies Partial<AIProxyError>;
  }
  return {
    type: "provider",
    message: `Gemini rejected the request: ${message}`,
    retryable: false,
    statusCode: status,
    rawPreview: rawPreview ?? undefined,
  } satisfies Partial<AIProxyError>;
}

async function runGeminiRequest(request: AIProxyRequest, env: ProxyEnv, deps: ProxyDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeoutMs = request.timeoutMs ?? 75_000;
  const timeoutId = setTimeout(() => controller.abort("timeout"), timeoutMs);

  try {
    const response = await fetchImpl(`${GEMINI_API_ROOT}/${encodeURIComponent(request.model)}:generateContent`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": env.GEMINI_API_KEY ?? "",
      },
      body: JSON.stringify(buildGeminiBody(request)),
      signal: controller.signal,
    });
    const rawText = await response.text();
    const rawPreview = rawText ? redactSensitiveText(rawText.slice(0, 2500)) : null;

    if (!response.ok) {
      let providerMessage = response.statusText || "Unknown Gemini error";
      try {
        const parsed = JSON.parse(rawText) as { error?: { message?: string } };
        if (typeof parsed.error?.message === "string" && parsed.error.message.trim()) providerMessage = parsed.error.message;
      } catch {
        // Leave providerMessage as-is.
      }
      return failure(request.operation, providerMessage, geminiErrorFromStatus(response.status, providerMessage, rawPreview));
    }

    let responseJson: Record<string, unknown>;
    try {
      responseJson = JSON.parse(rawText) as Record<string, unknown>;
    } catch (error) {
      return failure(request.operation, "Gemini returned invalid JSON.", {
        type: "invalid_json",
        rawPreview,
        retryable: false,
      });
    }

    const { text, blockReason, finishReason, usage } = extractGeminiText(responseJson);
    if (blockReason || finishReason === "SAFETY") {
      return failure(request.operation, "Gemini blocked the response for safety reasons.", {
        type: "safety",
        blockedReason: blockReason ?? finishReason ?? "SAFETY",
        rawPreview,
      });
    }
    if (!text) {
      return failure(request.operation, "Gemini returned an empty response.", {
        type: "empty_response",
        rawPreview,
        retryable: true,
      });
    }
    return success(request.operation, request.model, text, finishReason, usage);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return failure(request.operation, `Gemini request timed out after ${Math.round(timeoutMs / 1000)}s.`, {
        type: "timeout",
        retryable: true,
      });
    }
    return failure(request.operation, "Network error while contacting Gemini.", {
      type: "network",
      retryable: true,
      rawPreview: error instanceof Error ? error.message : String(error),
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function smokeResponse(request: AIProxyRequest, env: ProxyEnv, deps: ProxyDeps) {
  if (request.operation === "smoke_ping") {
    if (!env.GEMINI_API_KEY) {
      return failure(request.operation, "GEMINI_API_KEY missing at runtime. Check Cloudflare Worker runtime secrets, not build variables.", { type: "server", statusCode: 500 });
    }
    return success(request.operation, request.model, JSON.stringify({ provider: "gemini", keyConfigured: true }));
  }
  if (request.operation === "smoke_diagnostics") {
    const fakeGoogleKey = `${GOOGLE_KEY_PREFIX}FAKESECRETKEY1234567890123456789`;
    const text = JSON.stringify(
      redactSensitiveValue({
        echoedEnv: "GEMINI_API_KEY=PASTE_ROTATED_GEMINI_KEY_HERE",
        fakeGoogleKey,
        header: `x-goog-api-key: ${fakeGoogleKey}`,
      }),
    );
    return success(request.operation, request.model, text);
  }
  return runGeminiRequest(request, env, deps);
}

export async function handleAiProxyRequest(request: Request, env: ProxyEnv, deps: ProxyDeps = {}) {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength && contentLength > MAX_REQUEST_BYTES) {
    return json(
      failure("suggestions", "Request body is too large for the Gemini proxy.", {
        type: "invalid_request",
        statusCode: 413,
      }),
      413,
    );
  }

  const rawBody = await request.text();
  if (!rawBody.trim()) return badRequest("suggestions", "Request body was empty.");
  if (rawBody.length > MAX_REQUEST_BYTES) return badRequest("suggestions", "Request body is too large.");

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch (error) {
    return json(
      failure("suggestions", "Request body was not valid JSON.", {
        type: "invalid_json",
        statusCode: 400,
        rawPreview: rawBody.slice(0, 500),
      }),
      400,
    );
  }

  const parsedRequest = aiProxyRequestSchema.safeParse(parsedBody);
  if (!parsedRequest.success) {
    return badRequest("suggestions", "Request body did not match the expected Gemini proxy schema.", JSON.stringify(parsedRequest.error.issues));
  }

  if (!env.GEMINI_API_KEY && !["smoke_ping", "smoke_diagnostics"].includes(parsedRequest.data.operation)) {
    return json(
      failure(parsedRequest.data.operation, "GEMINI_API_KEY missing at runtime. Check Cloudflare Worker runtime secrets, not build variables.", {
        type: "server",
        statusCode: 500,
      }),
      500,
    );
  }

  const result =
    parsedRequest.data.operation === "smoke_ping" || parsedRequest.data.operation === "smoke_diagnostics"
      ? await smokeResponse(parsedRequest.data, env, deps)
      : await runGeminiRequest(parsedRequest.data, env, deps);

  return json(result, result.ok ? 200 : (result.error.statusCode ?? 500));
}
