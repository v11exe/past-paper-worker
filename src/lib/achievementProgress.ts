import type { AchievementId } from "../data/achievements";
import type { SupportedSubject } from "../subjects";

export type AchievementContext = {
  uploadedPaperCount?: number;
  markedAttemptCount?: number;
  scoredFullMarksOnQuestion?: boolean;
  answeredQuestionCount?: number;
  streakDays?: number;
  attemptedSubjects?: SupportedSubject[];
  latestScorePercent?: number;
};

export function evaluateAchievements(input: {
  unlocked: AchievementId[];
  context: AchievementContext;
}) {
  const unlocked = new Set(input.unlocked);
  const newlyUnlocked: AchievementId[] = [];

  const maybeUnlock = (id: AchievementId, condition: boolean) => {
    if (!condition || unlocked.has(id)) return;
    unlocked.add(id);
    newlyUnlocked.push(id);
  };

  maybeUnlock("first_upload", (input.context.uploadedPaperCount ?? 0) >= 1);
  maybeUnlock("first_mark", (input.context.markedAttemptCount ?? 0) >= 1);
  maybeUnlock("first_perfect", Boolean(input.context.scoredFullMarksOnQuestion));
  maybeUnlock("ten_questions", (input.context.answeredQuestionCount ?? 0) >= 10);
  maybeUnlock("three_streak", (input.context.streakDays ?? 0) >= 3);
  maybeUnlock("all_subjects", new Set(input.context.attemptedSubjects ?? []).size >= 4);
  maybeUnlock("high_score", (input.context.latestScorePercent ?? 0) >= 80);

  return newlyUnlocked;
}
