import { handleAiProxyRequest } from "../functions/_shared/aiProxy";
import { handleFeedbackRequest } from "../functions/_shared/feedbackProxy";
import { attemptSharePayloadSchema } from "../src/lib/sharePayload";

type AssetBinding = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};

type KVBinding = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
};

type WorkerEnv = {
  ANTHROPIC_API_KEY?: string;
  GEMINI_API_KEY?: string;
  RESEND_API_KEY?: string;
  FEEDBACK_TO_EMAIL?: string;
  FEEDBACK_FROM_EMAIL?: string;
  SHARE_KV?: KVBinding;
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

function isShareCreateRoute(pathname: string) {
  return pathname === "/api/share";
}

function shareReadMatch(pathname: string) {
  return /^\/api\/share\/([A-Za-z0-9]{7})$/.exec(pathname);
}

function shareStorageKey(shareId: string) {
  return `attempt-share:${shareId}`;
}

function createShareId() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 7);
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
    if (isShareCreateRoute(url.pathname)) {
      if (request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);
      if (!env.SHARE_KV) return json({ ok: false, error: "Share links are not configured on this deployment yet." }, 503);
      let payload: unknown;
      try {
        payload = await request.json();
      } catch {
        return json({ ok: false, error: "Invalid share payload." }, 400);
      }
      const parsed = attemptSharePayloadSchema.safeParse(payload);
      if (!parsed.success) {
        return json({ ok: false, error: "Invalid share payload." }, 400);
      }
      const shareId = createShareId();
      await env.SHARE_KV.put(shareStorageKey(shareId), JSON.stringify(parsed.data), { expirationTtl: 60 * 60 * 24 * 30 });
      return json({
        ok: true,
        shareId,
        shareUrl: `${url.origin}/share/${shareId}`,
      });
    }
    const shareMatch = shareReadMatch(url.pathname);
    if (shareMatch) {
      if (request.method !== "GET") return json({ ok: false, error: "Method not allowed." }, 405);
      if (!env.SHARE_KV) return json({ ok: false, error: "Share links are not configured on this deployment yet." }, 503);
      const stored = await env.SHARE_KV.get(shareStorageKey(shareMatch[1]));
      if (!stored) return json({ ok: false, error: "Share not found." }, 404);
      let payload: unknown;
      try {
        payload = JSON.parse(stored);
      } catch {
        return json({ ok: false, error: "Stored share payload is invalid." }, 500);
      }
      const parsed = attemptSharePayloadSchema.safeParse(payload);
      if (!parsed.success) {
        return json({ ok: false, error: "Stored share payload is invalid." }, 500);
      }
      return json({ ok: true, share: parsed.data });
    }
    return env.ASSETS.fetch(request);
  },
};
