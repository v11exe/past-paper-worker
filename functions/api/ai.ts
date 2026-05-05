import { handleAiProxyRequest } from "../_shared/geminiProxy";

export async function onRequestPost(context: { request: Request; env: { GEMINI_API_KEY?: string } }) {
  return handleAiProxyRequest(context.request, context.env);
}
