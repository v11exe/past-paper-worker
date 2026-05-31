const MAX_DAILY_CLAUDE_FEATURE_USES = 3;

function usageKey(date: Date) {
  return `claude-feature-uses:${date.toISOString().slice(0, 10)}`;
}

function readUsageCount(date: Date) {
  const value = Number(window.localStorage.getItem(usageKey(date)) ?? "0");
  return Number.isFinite(value) && value > 0 ? Math.min(MAX_DAILY_CLAUDE_FEATURE_USES, Math.trunc(value)) : 0;
}

export function getClaudeFeatureUsageState(now = new Date()) {
  const used = readUsageCount(now);
  return {
    used,
    remaining: Math.max(0, MAX_DAILY_CLAUDE_FEATURE_USES - used),
    limited: used >= MAX_DAILY_CLAUDE_FEATURE_USES,
  };
}

export function consumeClaudeFeatureUse(now = new Date()) {
  const next = Math.min(MAX_DAILY_CLAUDE_FEATURE_USES, readUsageCount(now) + 1);
  window.localStorage.setItem(usageKey(now), String(next));
  return getClaudeFeatureUsageState(now);
}
