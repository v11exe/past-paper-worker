import { handleAiProxyRequest } from "../functions/_shared/aiProxy";
import { handleFeedbackRequest } from "../functions/_shared/feedbackProxy";

type AssetBinding = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};

type WorkerEnv = {
  ANTHROPIC_API_KEY?: string;
  GEMINI_API_KEY?: string;
  RESEND_API_KEY?: string;
  FEEDBACK_TO_EMAIL?: string;
  FEEDBACK_FROM_EMAIL?: string;
  ASSETS: AssetBinding;
};

function isAiRoute(pathname: string) {
  return pathname === "/api/ai" || pathname.startsWith("/api/ai/");
}

function isDebugEnvRoute(pathname: string) {
  return pathname === "/api/debug/env";
}

function isFeedbackRoute(pathname: string) {
  return pathname === "/api/feedback";
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

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: unknown) {
    void ctx;
    const url = new URL(request.url);
    if (isDebugEnvRoute(url.pathname)) {
      return json({
        hasAnthropicKey: !!env.ANTHROPIC_API_KEY,
        hasGeminiKey: !!env.GEMINI_API_KEY,
        keys: Object.keys(env).sort(),
      });
    }
    if (isAiRoute(url.pathname)) {
      return handleAiProxyRequest(request, env);
    }
    if (isFeedbackRoute(url.pathname)) {
      return handleFeedbackRequest(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};
