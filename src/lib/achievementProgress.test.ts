import { describe, expect, it } from "vitest";

import { evaluateAchievements } from "./achievementProgress";

describe("evaluateAchievements", () => {
  it("unlocks first_upload exactly once", () => {
    expect(evaluateAchievements({ unlocked: [], context: { uploadedPaperCount: 1 } })).toContain("first_upload");
    expect(evaluateAchievements({ unlocked: ["first_upload"], context: { uploadedPaperCount: 2 } })).not.toContain("first_upload");
  });

  it("unlocks all four-subject and high-score milestones", () => {
    expect(
      evaluateAchievements({
        unlocked: [],
        context: {
          attemptedSubjects: [
            "AQA GCSE Biology",
            "AQA GCSE Chemistry",
            "AQA GCSE Physics",
            "OCR GCSE Computer Science J277",
          ],
          latestScorePercent: 85,
        },
      }),
    ).toEqual(expect.arrayContaining(["all_subjects", "high_score"]));
  });
});
