import type { FeedbackEnv } from "../_shared/feedbackProxy";

export const onRequestPost: PagesFunction<FeedbackEnv> = async (context) => {
  const { request, env } = context;

  const feedbackProxy = await import("../_shared/feedbackProxy");
  const handler = feedbackProxy.handleFeedbackRequest;

  return handler(request, env);
};