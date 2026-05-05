import { handleAiProxyRequest } from "../functions/_shared/geminiProxy";

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

export default {
  async fetch(request: Request, env: WorkerEnv) {
    const url = new URL(request.url);
    if (isAiRoute(url.pathname)) {
      return handleAiProxyRequest(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};
