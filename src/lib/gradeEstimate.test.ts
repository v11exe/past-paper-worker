import { describe, expect, it } from "vitest";

import { calculateGradeEstimate } from "./gradeEstimate";
import type { PastPaperAttempt } from "../types";

function markedAttempt(actualScore: number, totalMarks: number): PastPaperAttempt {
  return {
    id: `attempt-${actualScore}-${totalMarks}`,
    paperId: "paper-1",
    status: "marked",
    startedAt: "2026-05-15T12:00:00.000Z",
    submittedAt: "2026-05-15T12:10:00.000Z",
    completedAt: "2026-05-15T12:11:00.000Z",
    durationSeconds: 600,
    overtimeSeconds: 0,
    actualScore,
    confidenceAdjustedScore: actualScore,
    totalMarks,
    answers: [],
    marks: [],
    remarks: [],
    markingIssues: [],
  };
}

describe("calculateGradeEstimate", () => {
  it("returns null until two marked attempts exist", () => {
    expect(
      calculateGradeEstimate({
        attempts: [markedAttempt(70, 100)],
        boundary: {
          subject: "AQA GCSE Biology",
          year: 2025,
          series: "June 2025",
          totalMarks: 200,
          boundaries: { "9": 141, "8": 127, "7": 113, "6": 94, "5": 75, "4": 56, "3": 46, "2": 32, "1": 19 },
        },
      }),
    ).toBeNull();
  });

  it("maps combined marked attempts to a grade estimate", () => {
    const result = calculateGradeEstimate({
      attempts: [markedAttempt(80, 100), markedAttempt(70, 100)],
      boundary: {
        subject: "AQA GCSE Biology",
        year: 2025,
        series: "June 2025",
        totalMarks: 200,
        boundaries: { "9": 141, "8": 127, "7": 113, "6": 94, "5": 75, "4": 56, "3": 46, "2": 32, "1": 19 },
      },
    });

    expect(result).toMatchObject({
      grade: "9",
      scaledScore: 150,
    });
  });
});
