import {
  aiProxyRequestSchema,
  type AIProxyError,
  type AIProxyFailureResponse,
  type AIProxyOperation,
  type AIProxyRequest,
  type AIProxySuccessResponse,
} from "../../src/ai/contracts";
import { inferProviderFromModel, modelLabelForModel, type AIProviderId } from "../../src/ai/providerTypes";
import { redactSensitiveText, redactSensitiveValue } from "../../src/ai/redaction";
import { runAnthropicRequest, type AnthropicProxyEnv } from "./anthropicProxy";
import { runGeminiRequest, type GeminiProxyEnv, type ProxyDeps } from "./geminiProxy";

const MAX_REQUEST_BYTES = 9 * 1024 * 1024;
const GOOGLE_KEY_PREFIX = ["AI", "za"].join("");
const FAKE_ANTHROPIC_KEY = "sk-ant-FAKESECRETKEY123456789012345678901234567890";

export type AIProxyEnv = AnthropicProxyEnv & GeminiProxyEnv;

function json(data: AIProxySuccessResponse | AIProxyFailureResponse, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function failure(operation: AIProxyOperation, message: string, input: Partial<AIProxyError> & { provider?: AIProviderId | null; model?: string | null } = {}) {
  const response: AIProxyFailureResponse = {
    ok: false,
    operation,
    provider: input.provider ?? null,
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

function success(operation: AIProxyOperation, provider: AIProviderId, model: string, text: string, finishReason: string | null = null, usage?: Record<string, unknown>) {
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

export function resolveProxyProvider(request: Pick<AIProxyRequest, "provider" | "model">): AIProviderId | null {
  return request.provider ?? inferProviderFromModel(request.model);
}

function missingKeyFailure(request: AIProxyRequest, provider: AIProviderId) {
  const envName = provider === "anthropic" ? "ANTHROPIC_API_KEY" : "GEMINI_API_KEY";
  const providerName = provider === "anthropic" ? "Claude" : "Gemini";
  return failure(request.operation, `${envName} missing at runtime. Check Cloudflare Worker runtime secrets, not build variables.`, {
    provider,
    model: request.model,
    type: "server",
    retryable: true,
    statusCode: 500,
    rawPreview: `${providerName} runtime key not configured`,
  });
}

function providerKeyConfigured(provider: AIProviderId, env: AIProxyEnv) {
  return provider === "anthropic" ? Boolean(env.ANTHROPIC_API_KEY) : Boolean(env.GEMINI_API_KEY);
}

async function smokeResponse(request: AIProxyRequest, env: AIProxyEnv, provider: AIProviderId) {
  if (request.operation === "smoke_ping") {
    if (!providerKeyConfigured(provider, env)) return missingKeyFailure(request, provider);
    return success(request.operation, provider, request.model, JSON.stringify({ provider, keyConfigured: true }));
  }
  if (request.operation === "smoke_diagnostics") {
    const fakeGoogleKey = `${GOOGLE_KEY_PREFIX}FAKESECRETKEY1234567890123456789`;
    const text = JSON.stringify(
      redactSensitiveValue({
        echoedEnv: {
          ANTHROPIC_API_KEY: FAKE_ANTHROPIC_KEY,
          GEMINI_API_KEY: "PASTE_ROTATED_GEMINI_KEY_HERE",
        },
        fakeAnthropicKey: FAKE_ANTHROPIC_KEY,
        fakeGoogleKey,
        headers: {
          "x-api-key": FAKE_ANTHROPIC_KEY,
          "x-goog-api-key": fakeGoogleKey,
          authorization: `Bearer ${FAKE_ANTHROPIC_KEY}`,
        },
      }),
    );
    return success(request.operation, provider, request.model, text);
  }
  return null;
}

export async function handleAiProxyRequest(request: Request, env: AIProxyEnv, deps: ProxyDeps = {}) {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength && contentLength > MAX_REQUEST_BYTES) {
    return json(
      failure("suggestions", "Request body is too large for the AI proxy.", {
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
  } catch {
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
    return badRequest("suggestions", "Request body did not match the expected AI proxy schema.", JSON.stringify(parsedRequest.error.issues));
  }

  const provider = resolveProxyProvider(parsedRequest.data);
  if (!provider) {
    return json(
      failure(parsedRequest.data.operation, `Could not infer AI provider from model ${parsedRequest.data.model}.`, {
        type: "invalid_request",
        statusCode: 400,
        model: parsedRequest.data.model,
      }),
      400,
    );
  }

  const providerRequest: AIProxyRequest = { ...parsedRequest.data, provider };
  const smoke = await smokeResponse(providerRequest, env, provider);
  if (smoke) return json(smoke, smoke.ok ? 200 : (smoke.error.statusCode ?? 500));

  if (!providerKeyConfigured(provider, env)) {
    const result = missingKeyFailure(providerRequest, provider);
    return json(result, result.error.statusCode ?? 500);
  }

  const result = provider === "anthropic"
    ? await runAnthropicRequest(providerRequest, env, deps)
    : await runGeminiRequest(providerRequest, env, deps);

  return json(result, result.ok ? 200 : (result.error.statusCode ?? 500));
}
