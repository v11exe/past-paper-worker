import { describe, expect, it } from "vitest";

import { buildAttemptSharePayload } from "./sharePayload";
import type { PastPaper, PastPaperAttempt, PastPaperQuestion } from "../types";

function question(patch: Partial<PastPaperQuestion>): PastPaperQuestion {
  return {
    id: patch.id ?? "question-1",
    paperId: "paper-1",
    questionNumber: patch.questionNumber ?? "1",
    parentQuestionNumber: null,
    numberingPath: [patch.questionNumber ?? "1"],
    promptText: patch.promptText ?? "State one thing.",
    maxMarks: patch.maxMarks ?? 2,
    responseType: patch.responseType ?? "short_text",
    originalFormat: patch.originalFormat ?? "text",
    convertedFormat: null,
    originalContent: patch.originalContent ?? {},
    convertedContent: {},
    diagramMediaRefs: [],
    options: [],
    pageReferences: [1],
    evidenceSnippet: null,
    imagePageReferences: [1],
    confidence: null,
    extractionWarnings: [],
    markSchemeRef: patch.markSchemeRef ?? null,
    markSchemeData: patch.markSchemeData ?? null,
    displayOrder: patch.displayOrder ?? 0,
  };
}

function paper(questions: PastPaperQuestion[]): PastPaper {
  return {
    id: "paper-1",
    title: "Question UI paper",
    subject: "AQA GCSE Biology",
    topic: null,
    subtopic: null,
    year: 2026,
    series: "June",
    paperCode: "8461/1",
    totalMarks: questions.reduce((sum, item) => sum + item.maxMarks, 0),
    durationMinutes: 60,
    hasMarkScheme: true,
    processingStatus: "ready",
    processingError: null,
    processingDiagnostics: null,
    assets: [],
    questions,
    jobs: [],
    createdAt: "2026-05-15T12:00:00.000Z",
    updatedAt: "2026-05-15T12:00:00.000Z",
  };
}

function attempt(): PastPaperAttempt {
  return {
    id: "attempt-1",
    paperId: "paper-1",
    status: "marked",
    startedAt: "2026-05-15T12:00:00.000Z",
    submittedAt: "2026-05-15T12:10:00.000Z",
    completedAt: "2026-05-15T12:11:00.000Z",
    durationSeconds: 600,
    overtimeSeconds: 0,
    actualScore: 1,
    confidenceAdjustedScore: 1,
    totalMarks: 2,
    answers: [
      {
        id: "answer-1",
        attemptId: "attempt-1",
        questionId: "question-1",
        responseText: "Sensitive student answer",
        numericResponse: null,
        selectedOptions: [],
        skipped: false,
        skippedWithConfidence: false,
        confidencePredictedMarks: null,
        createdAt: "2026-05-15T12:00:00.000Z",
        updatedAt: "2026-05-15T12:00:00.000Z",
      },
    ],
    marks: [
      {
        id: "mark-1",
        answerId: "answer-1",
        questionId: "question-1",
        source: "ai",
        reviewVersion: 1,
        awardedMarks: 1,
        maxMarks: 2,
        rationale: "Sensitive explanation",
        missingPoints: ["Add the second mark-scheme point."],
        markSchemeEvidence: "Award 1 mark for a named point.",
        markSchemeReference: { point: "A" },
        accepted: true,
        createdAt: "2026-05-15T12:10:00.000Z",
      },
    ],
    remarks: [],
    markingIssues: [],
  };
}

describe("buildAttemptSharePayload", () => {
  it("omits answer text and mark-scheme text", () => {
    const payload = buildAttemptSharePayload({
      paper: paper([
        question({
          markSchemeData: {
            rows: [{ markPoint: "Award 1 mark for a named point." }],
          },
        }),
      ]),
      attempt: attempt(),
    });

    expect(payload).toMatchObject({
      subject: "AQA GCSE Biology",
      totalMarks: 2,
      scoredMarks: 1,
    });
    expect(payload.questions[0]).toMatchObject({ number: "1", marks: 2, scored: 1, status: "partial" });
    expect(JSON.stringify(payload)).not.toContain("Sensitive student answer");
    expect(JSON.stringify(payload)).not.toContain("Award 1 mark for a named point.");
  });
});
