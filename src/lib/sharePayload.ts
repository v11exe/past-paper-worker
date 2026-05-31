import { z } from "zod";

import type { PastPaper, PastPaperAnswer, PastPaperAttempt, PastPaperMarkingIssue, PastPaperQuestion, PastPaperQuestionMark } from "../types";

export const attemptShareQuestionSchema = z.object({
  number: z.string().min(1).max(64),
  marks: z.number().int().min(0).max(1000),
  scored: z.number().int().min(0).max(1000),
  status: z.enum(["correct", "partial", "mistake", "blank", "excluded", "pending", "issue"]),
});

export const attemptSharePayloadSchema = z
  .object({
    subject: z.string().min(1).max(120),
    date: z.string().min(1).max(32),
    paperLabel: z.string().min(1).max(220),
    totalMarks: z.number().int().min(0).max(10000),
    scoredMarks: z.number().int().min(0).max(10000),
    questions: z.array(attemptShareQuestionSchema).min(1).max(400),
  })
  .superRefine((value, ctx) => {
    if (value.scoredMarks > value.totalMarks) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "scoredMarks cannot exceed totalMarks",
        path: ["scoredMarks"],
      });
    }
  });

export type AttemptSharePayload = z.infer<typeof attemptSharePayloadSchema>;

function isUnsupportedQuestion(question: PastPaperQuestion) {
  const originalContent = (question.originalContent ?? {}) as Record<string, unknown>;
  return question.responseType === "unsupported" || Boolean(originalContent.unsupportedQuestionFormat);
}

function isAnswerAttempted(answer: PastPaperAnswer | null | undefined) {
  if (!answer || answer.skipped) return false;
  if (answer.responseText?.trim()) return true;
  if (answer.numericResponse !== null) return true;
  return answer.selectedOptions.length > 0;
}

function latestAcceptedMark(attempt: PastPaperAttempt, questionId: string) {
  return attempt.marks.filter((mark) => mark.accepted && mark.questionId === questionId).at(-1) ?? null;
}

function latestMarkingIssue(attempt: PastPaperAttempt, questionId: string) {
  return attempt.markingIssues?.filter((issue) => issue.questionId === questionId).at(-1) ?? null;
}

function scoreForQuestion(mark: PastPaperQuestionMark | null, question: PastPaperQuestion) {
  return Math.max(0, Math.min(question.maxMarks, mark?.awardedMarks ?? 0));
}

function questionStatus(input: {
  question: PastPaperQuestion;
  answer: PastPaperAnswer | null;
  mark: PastPaperQuestionMark | null;
  issue: PastPaperMarkingIssue | null;
}) {
  if (isUnsupportedQuestion(input.question)) return "excluded" as const;
  if (input.issue?.type === "transient_provider_error") return "pending" as const;
  if (input.issue?.type === "mark_scheme_alignment_error") return "issue" as const;
  if (!input.mark) return isAnswerAttempted(input.answer) ? ("issue" as const) : ("blank" as const);
  if (input.mark.awardedMarks >= input.question.maxMarks) return "correct" as const;
  if (input.mark.awardedMarks > 0) return "partial" as const;
  return "mistake" as const;
}

function buildPaperLabel(paper: PastPaper) {
  return [paper.title, paper.year ?? null, paper.series ?? null, paper.paperCode ?? null].filter(Boolean).join(" · ");
}

export function buildAttemptSharePayload(input: { paper: PastPaper; attempt: PastPaperAttempt }): AttemptSharePayload {
  const questions = input.paper.questions.map((question) => {
    const answer = input.attempt.answers.find((item) => item.questionId === question.id) ?? null;
    const mark = latestAcceptedMark(input.attempt, question.id);
    const issue = latestMarkingIssue(input.attempt, question.id) ?? null;
    const status = questionStatus({ question, answer, mark, issue });
    return {
      number: question.questionNumber,
      marks: question.maxMarks,
      scored: status === "excluded" ? 0 : scoreForQuestion(mark, question),
      status,
    };
  });

  const totalMarks = questions.filter((question) => question.status !== "excluded").reduce((sum, question) => sum + question.marks, 0);
  const scoredMarks = questions.reduce((sum, question) => sum + question.scored, 0);
  const completedAt = input.attempt.completedAt ?? input.attempt.submittedAt ?? input.attempt.startedAt;

  return attemptSharePayloadSchema.parse({
    subject: input.paper.subject,
    date: completedAt.slice(0, 10),
    paperLabel: buildPaperLabel(input.paper),
    totalMarks,
    scoredMarks,
    questions,
  });
}
