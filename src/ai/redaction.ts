const GOOGLE_KEY_PREFIX = ["AI", "za"].join("");
const GOOGLE_API_KEY_PATTERN = new RegExp(`\\b${GOOGLE_KEY_PREFIX}[0-9A-Za-z\\-_]{20,}\\b`, "g");
const ANTHROPIC_API_KEY_PATTERN = /\bsk-ant-[0-9A-Za-z_-]{20,}\b/g;
const GEMINI_ENV_PATTERN = /\bGEMINI_API_KEY\s*=\s*[^\s"'`]+/gi;
const ANTHROPIC_ENV_PATTERN = /\bANTHROPIC_API_KEY\s*=\s*[^\s"'`]+/gi;
const GOOGLE_HEADER_PATTERN = /\b(x-goog-api-key\s*:\s*)([^\s"'`]+)/gi;
const ANTHROPIC_HEADER_PATTERN = /\b(x-api-key\s*:\s*)([^\s"'`]+)/gi;
const AUTHORIZATION_BEARER_PATTERN = /\b(authorization\s*:\s*Bearer\s+)([^\s"'`]+)/gi;

export function redactSensitiveText(value: string): string;
export function redactSensitiveText(value: unknown): unknown;
export function redactSensitiveText(value: unknown) {
  if (typeof value !== "string" || !value) return value;
  return value
    .replace(GOOGLE_API_KEY_PATTERN, "[REDACTED_GOOGLE_API_KEY]")
    .replace(ANTHROPIC_API_KEY_PATTERN, "[REDACTED_ANTHROPIC_API_KEY]")
    .replace(GEMINI_ENV_PATTERN, "GEMINI_API_KEY=[REDACTED]")
    .replace(ANTHROPIC_ENV_PATTERN, "ANTHROPIC_API_KEY=[REDACTED]")
    .replace(GOOGLE_HEADER_PATTERN, "$1[REDACTED]")
    .replace(ANTHROPIC_HEADER_PATTERN, "$1[REDACTED]")
    .replace(AUTHORIZATION_BEARER_PATTERN, "$1[REDACTED]");
}

export function redactSensitiveValue<T>(value: T): T {
  if (typeof value === "string") return redactSensitiveText(value) as T;
  if (Array.isArray(value)) return value.map((item) => redactSensitiveValue(item)) as T;
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, redactSensitiveValue(entry)])) as T;
}

export function hasUnredactedGoogleApiKey(value: string) {
  return new RegExp(`\\b${GOOGLE_KEY_PREFIX}[0-9A-Za-z\\-_]{20,}\\b`).test(value);
}

export function hasUnredactedAnthropicApiKey(value: string) {
  return /\bsk-ant-[0-9A-Za-z_-]{20,}\b/.test(value);
}

export function hasUnredactedSecret(value: string) {
  return hasUnredactedGoogleApiKey(value) || hasUnredactedAnthropicApiKey(value) || /\bauthorization\s*:\s*Bearer\s+(?!\[REDACTED])\S+/i.test(value);
}
