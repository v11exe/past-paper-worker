import { describe, expect, it, vi } from "vitest";

import { formatRecommendedPaperLabel, pickRecommendedPaper } from "./paperRecommendations";

describe("pickRecommendedPaper", () => {
  it("prefers an unseen paper from the same subject", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);

    const result = pickRecommendedPaper({
      subject: "AQA GCSE Biology",
      registry: [
        { subject: "AQA GCSE Biology", year: 2024, series: "May/June", paperNumber: 1, component: "Tier Cross" },
      ],
      uploadedOrAttemptedLabels: [],
      lastAttemptedAtByLabel: {},
    });

    expect(result?.paperNumber).toBe(1);
    expect(result ? formatRecommendedPaperLabel(result) : null).toBe("2024 May/June Paper 1");
  });

  it("falls back to the oldest attempted paper when everything is seen", () => {
    const result = pickRecommendedPaper({
      subject: "AQA GCSE Biology",
      registry: [
        { subject: "AQA GCSE Biology", year: 2023, series: "May/June", paperNumber: 1, component: "Tier Cross" },
        { subject: "AQA GCSE Biology", year: 2024, series: "May/June", paperNumber: 1, component: "Tier Cross" },
      ],
      uploadedOrAttemptedLabels: ["2023 May/June Paper 1", "2024 May/June Paper 1"],
      lastAttemptedAtByLabel: {
        "2023 May/June Paper 1": "2026-05-01T10:00:00.000Z",
        "2024 May/June Paper 1": "2026-05-20T10:00:00.000Z",
      },
    });

    expect(result?.year).toBe(2023);
  });
});
