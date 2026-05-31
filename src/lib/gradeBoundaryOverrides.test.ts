import { afterEach, describe, expect, it } from "vitest";

import { gradeBoundaries } from "../data/gradeBoundaries";
import { loadGradeBoundaryOverrides, resolveGradeBoundary, saveGradeBoundaryOverride } from "./gradeBoundaryOverrides";

const STORAGE_KEY = "past-paper-worker:grade-boundary-overrides:v1";

describe("gradeBoundaryOverrides", () => {
  afterEach(() => {
    window.localStorage.removeItem(STORAGE_KEY);
  });

  it("falls back to defaults when stored override values are incomplete", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        "AQA GCSE Biology": { "9": 140 },
      }),
    );

    const resolved = resolveGradeBoundary(gradeBoundaries[0], loadGradeBoundaryOverrides());

    expect(resolved.boundaries["9"]).toBe(gradeBoundaries[0].boundaries["9"]);
  });

  it("applies a saved override when all grade thresholds are present", () => {
    const override = { "9": 140, "8": 126, "7": 112, "6": 93, "5": 74, "4": 55, "3": 45, "2": 31, "1": 18 } as const;
    saveGradeBoundaryOverride("AQA GCSE Biology", override);

    const resolved = resolveGradeBoundary(gradeBoundaries[0], loadGradeBoundaryOverrides());

    expect(resolved.boundaries["9"]).toBe(140);
    expect(resolved.boundaries["4"]).toBe(55);
  });
});
