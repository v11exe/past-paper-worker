export type AIProviderId = "anthropic" | "gemini";

export type AIModelConfig = {
  provider: AIProviderId;
  model: string;
  label: string;
  shortLabel: string;
  supportsVision: boolean;
  supportsJson: boolean;
  defaultMaxTokens: number;
};

export const CLAUDE_SONNET_MODEL: AIModelConfig = {
  provider: "anthropic",
  model: "claude-sonnet-4-6",
  label: "Claude Sonnet 4.6",
  shortLabel: "Claude Sonnet",
  supportsVision: true,
  supportsJson: true,
  defaultMaxTokens: 64000,
};

export const GEMINI_FLASH_LITE_MODEL: AIModelConfig = {
  provider: "gemini",
  model: "gemini-2.5-flash-lite",
  label: "Gemini 2.5 Flash Lite",
  shortLabel: "Gemini Flash Lite",
  supportsVision: true,
  supportsJson: true,
  defaultMaxTokens: 65536,
};

export const GEMINI_FLASH_MODEL: AIModelConfig = {
  provider: "gemini",
  model: "gemini-2.5-flash",
  label: "Gemini 2.5 Flash",
  shortLabel: "Gemini Flash",
  supportsVision: true,
  supportsJson: true,
  defaultMaxTokens: 65536,
};

export const DEFAULT_AI_MODEL = CLAUDE_SONNET_MODEL.model;
export const DEFAULT_AI_PROVIDER: AIProviderId = "anthropic";

export const FALLBACK_AI_MODELS = [
  GEMINI_FLASH_LITE_MODEL.model,
  GEMINI_FLASH_MODEL.model,
] as const;

export const AI_MODEL_CHOICES = [
  CLAUDE_SONNET_MODEL,
  GEMINI_FLASH_LITE_MODEL,
  GEMINI_FLASH_MODEL,
] as const;

export function inferProviderFromModel(model: string): AIProviderId | null {
  if (/^claude-/i.test(model)) return "anthropic";
  if (/^gemini-/i.test(model)) return "gemini";
  return null;
}

export function resolveAIModelConfig(model = DEFAULT_AI_MODEL): AIModelConfig {
  return AI_MODEL_CHOICES.find((choice) => choice.model === model) ?? {
    provider: inferProviderFromModel(model) ?? DEFAULT_AI_PROVIDER,
    model,
    label: model,
    shortLabel: model,
    supportsVision: true,
    supportsJson: true,
    defaultMaxTokens: 64000,
  };
}

export function modelLabelForModel(model: string, short = false) {
  const config = resolveAIModelConfig(model);
  return short ? config.shortLabel : config.label;
}
