import { afterEach, describe, expect, it, vi } from "vitest";

import { consumeClaudeFeatureUse, getClaudeFeatureUsageState } from "./claudeFeatureUsage";

describe("claudeFeatureUsage", () => {
  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it("shares one daily pool across all Claude review helpers", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-31T09:00:00.000Z"));

    consumeClaudeFeatureUse();
    consumeClaudeFeatureUse();

    expect(getClaudeFeatureUsageState()).toMatchObject({
      used: 2,
      remaining: 1,
      limited: false,
    });
  });

  it("caps usage at the daily limit", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-31T09:00:00.000Z"));

    consumeClaudeFeatureUse();
    consumeClaudeFeatureUse();
    consumeClaudeFeatureUse();
    consumeClaudeFeatureUse();

    expect(getClaudeFeatureUsageState()).toMatchObject({
      used: 3,
      remaining: 0,
      limited: true,
    });
  });
});
