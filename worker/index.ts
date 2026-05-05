import { handleAiProxyRequest } from "../functions/_shared/geminiProxy";
import type { AIProxyFailureResponse, AIProxyOperation } from "../src/ai/contracts";

type AssetBinding = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};

type WorkerEnv = {
  GEMINI_API_KEY?: string;
  ASSETS: AssetBinding;
};

function isAiRoute(pathname: string) {
  return pathname === "/api/ai" || pathname.startsWith("/api/ai/");
}

function isDebugEnvRoute(pathname: string) {
  return pathname === "/api/debug/env";
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function inferOperation(request: Request) {
  try {
    const body = await request.clone().json() as { operation?: unknown };
    return typeof body.operation === "string" ? body.operation : "suggestions";
  } catch {
    return "suggestions";
  }
}

async function missingRuntimeKeyResponse(request: Request) {
  const operation = (await inferOperation(request)) as AIProxyOperation;
  const hint = "Check Cloudflare Worker runtime secrets, not build variables";
  const payload: AIProxyFailureResponse & { hint: string } = {
    ok: false,
    operation,
    model: null,
    error: {
      type: "server",
      message: "GEMINI_API_KEY missing at runtime",
      retryable: false,
      statusCode: 500,
      blockedReason: null,
      rawPreview: hint,
    },
    hint,
  };
  return json(payload, 500);
}

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: unknown) {
    void ctx;
    const url = new URL(request.url);
    if (isDebugEnvRoute(url.pathname)) {
      return json({
        hasKey: !!env.GEMINI_API_KEY,
        keys: Object.keys(env).sort(),
      });
    }
    if (isAiRoute(url.pathname)) {
      if (!env.GEMINI_API_KEY) {
        return missingRuntimeKeyResponse(request);
      }
      return handleAiProxyRequest(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};
