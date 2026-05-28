import type { FeedbackEnv } from "../_shared/feedbackProxy";
import { handleFeedbackRequest } from "../_shared/feedbackProxy";

export const onRequestPost: PagesFunction<FeedbackEnv> = async (context) => {
  const { request, env } = context;

  return handleFeedbackRequest(request, env);
};