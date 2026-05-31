import type { GradeBoundary } from "../data/gradeBoundaries";
import type { PastPaperAttempt } from "../types";

export type GradeEstimate = {
  grade: "9" | "8" | "7" | "6" | "5" | "4" | "3" | "2" | "1";
  percent: number;
  scaledScore: number;
  currentBoundary: number;
  nextBoundary: number | null;
  progressToNext: number;
};

const gradeOrder: GradeEstimate["grade"][] = ["9", "8", "7", "6", "5", "4", "3", "2", "1"];

export function calculateGradeEstimate(input: {
  attempts: PastPaperAttempt[];
  boundary: GradeBoundary | null;
}): GradeEstimate | null {
  const markedAttempts = input.attempts.filter((attempt) => attempt.status === "marked");
  if (markedAttempts.length < 2 || !input.boundary) return null;
  const boundary = input.boundary;

  const totalAvailable = markedAttempts.reduce((sum, attempt) => sum + attempt.totalMarks, 0);
  if (!totalAvailable) return null;

  const totalScored = markedAttempts.reduce((sum, attempt) => sum + attempt.actualScore, 0);
  const percent = totalScored / totalAvailable;
  const scaledScore = Math.round(percent * boundary.totalMarks);

  const grade = gradeOrder.find((value) => scaledScore >= boundary.boundaries[value]) ?? "1";
  const currentBoundary = boundary.boundaries[grade];
  const nextGrade = gradeOrder[gradeOrder.indexOf(grade) - 1] ?? null;
  const nextBoundary = nextGrade ? boundary.boundaries[nextGrade] : null;
  const progressToNext = nextBoundary && nextBoundary > currentBoundary ? Math.max(0, Math.min(1, (scaledScore - currentBoundary) / (nextBoundary - currentBoundary))) : 1;

  return {
    grade,
    percent,
    scaledScore,
    currentBoundary,
    nextBoundary,
    progressToNext,
  };
}
