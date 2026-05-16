export {
  AI_MODEL_CHOICES,
  AIProviderError,
  DEFAULT_AI_PROVIDER,
  DEFAULT_AI_MODEL,
  FALLBACK_AI_MODELS,
  CLAUDE_SONNET_MODEL,
  GEMINI_FLASH_LITE_MODEL,
  GEMINI_FLASH_MODEL,
  aiChat,
  aiStructuredJson,
  ensureAIReadyForUserAction,
  modelLabelForModel,
  resolveAIModelConfig,
  runAISmokeTest,
} from "./aiClient";
export type { AIResultMetadata } from "./aiClient";
export type { AIModelConfig, AIProviderId } from "./providerTypes";
