import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyMarkingGuardrails,
  applyDeterministicMarkSchemeFallback,
  buildDeterministicProcessedPaperOutput,
  computeAttemptScores,
  formatPercent,
  formatClock,
  isAnswerAttempted,
  mapProcessedOutput,
  displayQuestionNumberForPaper,
  markAnswerWithAI,
  pageContextsForAsset,
  processPaperWithAI,
  questionSupportIssue,
  startAttempt,
  supportedTotalMarksForPaper,
  unsupportedMarksForPaper,
  validateProcessedPaperIntegrity,
} from "./paperEngine";
import type { ProcessedPaperOutput } from "../ai/schemas";
import type { PastPaper, PastPaperAnswer, PastPaperAttempt, PastPaperQuestion } from "../types";

function testPaperPath(fileName: string) {
  return resolve(process.cwd(), "test papers", fileName);
}

const paper = {
  id: "paper",
  totalMarks: null,
  questions: [
    { id: "q1", maxMarks: 3 },
    { id: "q2", maxMarks: 2 },
  ],
} as PastPaper;

describe("computeAttemptScores", () => {
  it("keeps actual and confidence-adjusted scores separate", () => {
    const attempt = {
      marks: [{ questionId: "q1", awardedMarks: 2, maxMarks: 3, accepted: true }],
      answers: [{ questionId: "q2", skippedWithConfidence: true, confidencePredictedMarks: 1 }],
    } as unknown as PastPaperAttempt;

    const result = computeAttemptScores(attempt, paper);

    expect(result.actualScore).toBe(2);
    expect(result.confidenceAdjustedScore).toBe(3);
    expect(result.totalMarks).toBe(5);
  });

  it("uses the paper total as the displayed denominator when it is known", () => {
    const attempt = {
      marks: [{ questionId: "q1", awardedMarks: 2, maxMarks: 3, accepted: true }],
      answers: [],
    } as unknown as PastPaperAttempt;

    const result = computeAttemptScores(attempt, { ...paper, totalMarks: 100 } as PastPaper);

    expect(result.actualScore).toBe(2);
    expect(result.totalMarks).toBe(100);
  });

  it("deducts unsupported question marks from the denominator and keeps confidence marks", () => {
    const supportedQuestion = {
      id: "q1",
      maxMarks: 3,
      responseType: "short_text",
      originalContent: {},
      options: [],
      extractionWarnings: [],
      promptText: "Explain one purpose of RAM.",
    } as unknown as PastPaperQuestion;
    const unsupportedQuestion = {
      id: "q2",
      maxMarks: 4,
      responseType: "short_text",
      originalContent: { unsupportedQuestionFormat: true, unsupportedReason: "Row-by-row checkbox table." },
      options: [],
      extractionWarnings: [],
      promptText: "Tick one box in each row.",
    } as unknown as PastPaperQuestion;
    const paperWithUnsupported = {
      ...paper,
      totalMarks: 7,
      questions: [supportedQuestion, unsupportedQuestion],
    } as PastPaper;
    const attempt = {
      marks: [{ questionId: "q1", awardedMarks: 2, maxMarks: 3, accepted: true }],
      answers: [{ questionId: "q1", skippedWithConfidence: true, confidencePredictedMarks: 1 }],
    } as unknown as PastPaperAttempt;

    const result = computeAttemptScores(attempt, paperWithUnsupported);

    expect(questionSupportIssue(unsupportedQuestion)?.unsupported).toBe(true);
    expect(unsupportedMarksForPaper(paperWithUnsupported)).toBe(4);
    expect(supportedTotalMarksForPaper(paperWithUnsupported)).toBe(3);
    expect(result.totalMarks).toBe(3);
    expect(result.actualScore).toBe(2);
    expect(result.confidenceAdjustedScore).toBe(3);
    expect(formatPercent(result.actualScore, result.totalMarks)).toBe("66.7%");
  });
});

describe("startAttempt", () => {
  it("uses the paper total rather than the extracted-question sum when available", () => {
    const attempt = startAttempt({ ...paper, totalMarks: 100 } as PastPaper);

    expect(attempt.totalMarks).toBe(100);
  });
});

describe("formatClock", () => {
  it("uses hours only when the timer is over an hour", () => {
    expect(formatClock(65)).toBe("1:05");
    expect(formatClock(3665)).toBe("1:01:05");
  });
});

describe("isAnswerAttempted", () => {
  it("ignores skipped and blank answers", () => {
    expect(isAnswerAttempted({ skipped: true, responseText: "answer", numericResponse: null, selectedOptions: [] } as unknown as PastPaperAnswer)).toBe(false);
    expect(isAnswerAttempted({ skipped: false, responseText: " ", numericResponse: null, selectedOptions: [] } as unknown as PastPaperAnswer)).toBe(false);
    expect(isAnswerAttempted({ skipped: false, responseText: null, numericResponse: null, selectedOptions: ["A"] } as unknown as PastPaperAnswer)).toBe(true);
  });
});

describe("questionSupportIssue", () => {
  function question(promptText: string, responseType: PastPaperQuestion["responseType"] = "short_text", options: string[] = []) {
    return {
      id: promptText,
      maxMarks: 1,
      responseType,
      originalContent: {},
      originalFormat: "text",
      convertedFormat: null,
      evidenceSnippet: null,
      extractionWarnings: [],
      promptText,
      options,
    } as unknown as PastPaperQuestion;
  }

  it.each([
    "Complete the table to show two advantages and two disadvantages.",
    "Tick one box in each row.",
    "Label the diagram of the heart.",
    "Draw a line from each component to its function.",
  ])("marks unsupported custom UI formats: %s", (promptText) => {
    expect(questionSupportIssue(question(promptText))?.unsupported).toBe(true);
  });

  it("keeps ordinary short answers supported", () => {
    expect(questionSupportIssue(question("State one reason why the CPU uses cache memory."))).toBeNull();
  });

  it("keeps simple recovered single-choice questions supported", () => {
    expect(questionSupportIssue(question("Tick one box. A RAM B ROM C HDD D SSD", "single_choice"))).toBeNull();
  });
});

describe("applyMarkingGuardrails", () => {
  function question(responseType: PastPaperQuestion["responseType"], maxMarks = 1): PastPaperQuestion {
    return {
      id: `question-${responseType}`,
      paperId: "paper-1",
      questionNumber: "1",
      parentQuestionNumber: null,
      numberingPath: ["1"],
      promptText: "Prompt",
      maxMarks,
      responseType,
      originalFormat: "text",
      convertedFormat: null,
      originalContent: {},
      convertedContent: {},
      diagramMediaRefs: [],
      options: [],
      pageReferences: [1],
      evidenceSnippet: null,
      imagePageReferences: [1],
      confidence: null,
      extractionWarnings: [],
      markSchemeRef: null,
      markSchemeData: null,
      displayOrder: 0,
    };
  }

  function answer(patch: Partial<PastPaperAnswer>): PastPaperAnswer {
    return {
      id: "answer-1",
      attemptId: "attempt-1",
      questionId: "question-1",
      responseText: null,
      numericResponse: null,
      selectedOptions: [],
      skipped: false,
      skippedWithConfidence: false,
      confidencePredictedMarks: null,
      createdAt: "2026-05-15T12:00:00.000Z",
      updatedAt: "2026-05-15T12:00:00.000Z",
      ...patch,
    };
  }

  it("forces single-choice mismatches to zero when D is chosen and C is correct", () => {
    const guarded = applyMarkingGuardrails(
      {
        awardedMarks: 1,
        maxMarks: 1,
        rationale: "The student's selected answer does not match the correct answer.",
        missingPoints: [],
        markSchemeEvidence: "The correct answer is C.",
        markSchemeReference: {},
        confidence: 80,
      },
      question("single_choice", 1),
      answer({ selectedOptions: ["D. cytoplasm"] }),
      "The correct answer is C.",
    );

    expect(guarded.awardedMarks).toBe(0);
  });

  it("forces numeric mismatches to zero when the answer is outside acceptable values", () => {
    const guarded = applyMarkingGuardrails(
      {
        awardedMarks: 2,
        maxMarks: 2,
        rationale: "Acceptable values are 6, 6.25, or 6.3 micrometres.",
        missingPoints: [],
        markSchemeEvidence: "Acceptable values are 6 / 6.25 / 6.3 micrometres.",
        markSchemeReference: {},
        confidence: 80,
      },
      question("numeric", 2),
      answer({ responseText: "10, maybe 3" }),
      "Acceptable values are 6 / 6.25 / 6.3 micrometres.",
    );

    expect(guarded.awardedMarks).toBe(0);
  });

  it("keeps correct single-choice matches credited when C is chosen and C is correct", () => {
    const guarded = applyMarkingGuardrails(
      {
        awardedMarks: 0,
        maxMarks: 1,
        rationale: "The correct answer is C.",
        missingPoints: [],
        markSchemeEvidence: "The correct answer is C.",
        markSchemeReference: {},
        confidence: 80,
      },
      question("single_choice", 1),
      answer({ selectedOptions: ["C. cell wall"] }),
      "The correct answer is C.",
    );

    expect(guarded.awardedMarks).toBe(1);
  });

  it("keeps numeric matches fully credited when an acceptable value is present", () => {
    const guarded = applyMarkingGuardrails(
      {
        awardedMarks: 0,
        maxMarks: 2,
        rationale: "Acceptable values are 6, 6.25, or 6.3 micrometres.",
        missingPoints: [],
        markSchemeEvidence: "Acceptable values are 6 / 6.25 / 6.3 micrometres.",
        markSchemeReference: {},
        confidence: 80,
      },
      question("numeric", 2),
      answer({ responseText: "6.25" }),
      "Acceptable values are 6 / 6.25 / 6.3 micrometres.",
    );

    expect(guarded.awardedMarks).toBe(2);
  });
});

const validQuestion: ProcessedPaperOutput["questions"][number] = {
  questionNumber: "1",
  parentQuestionNumber: null,
  numberingPath: ["1"],
  promptText: "Describe the visible process shown in Figure 1.",
  maxMarks: 2,
  responseType: "short_text",
  originalFormat: "text",
  convertedFormat: null,
  originalContent: { evidenceSnippet: "Describe the visible process shown in Figure 1." },
  convertedContent: {},
  options: [],
  pageReferences: [1],
  mediaRefs: [],
  markSchemeRef: null,
  markSchemeData: null,
};

const baseOutput: ProcessedPaperOutput = {
  title: "Paper",
  year: null,
  series: null,
  paperCode: null,
  totalMarks: 2,
  durationMinutes: 30,
  questions: [validQuestion],
};

const basePaper = {
  id: "paper",
  title: "Paper",
  subject: "Computer Science",
  topic: null,
  subtopic: null,
  year: null,
  series: null,
  paperCode: null,
  totalMarks: null,
  durationMinutes: null,
  hasMarkScheme: false,
  processingStatus: "unprocessed",
  processingError: null,
  assets: [],
  questions: [],
  jobs: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
} as PastPaper;

async function loadPdfPageTexts(path: string) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(readFileSync(path));
  const pdf = await pdfjs.getDocument({ data }).promise;
  const pages: Array<{ pageNumber: number; text: string; charCount: number; hasScreenshot: false }> = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items.map((item) => ("str" in item ? item.str : "")).join(" ").replace(/\s+/g, " ").trim();
    pages.push({ pageNumber, text, charCount: text.length, hasScreenshot: false });
  }
  return pages;
}

function stripScreenshotFlag<T extends { hasScreenshot: boolean }>(page: T) {
  const { hasScreenshot, ...rest } = page;
  void hasScreenshot;
  return rest;
}

function buildPdfPaper(title: string, subject: string, pageTexts: Array<{ pageNumber: number; text: string; charCount: number; hasScreenshot: false }>) {
  return {
    ...basePaper,
    title,
    subject,
    assets: [
      {
        id: "paper-asset",
        paperId: "paper",
        kind: "paper",
        fileName: `${title}.pdf`,
        mimeType: "application/pdf",
        size: 1,
        textContent: pageTexts.map((page) => `Page ${page.pageNumber}\n${page.text}`).join("\n\n"),
        pageCount: pageTexts.length,
        pageTexts: pageTexts.map(stripScreenshotFlag),
        pageScreenshots: [],
        objectUrl: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  } as PastPaper;
}

function buildPdfPaperWithMarkScheme(
  title: string,
  subject: string,
  pageTexts: Array<{ pageNumber: number; text: string; charCount: number; hasScreenshot: false }>,
  markSchemePageTexts: Array<{ pageNumber: number; text: string; charCount: number; hasScreenshot: false }>,
) {
  return {
    ...buildPdfPaper(title, subject, pageTexts),
    hasMarkScheme: true,
    assets: [
      {
        id: "paper-asset",
        paperId: "paper",
        kind: "paper",
        fileName: `${title}.pdf`,
        mimeType: "application/pdf",
        size: 1,
        textContent: pageTexts.map((page) => `Page ${page.pageNumber}\n${page.text}`).join("\n\n"),
        pageCount: pageTexts.length,
        pageTexts: pageTexts.map(stripScreenshotFlag),
        pageScreenshots: [],
        objectUrl: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "mark-scheme-asset",
        paperId: "paper",
        kind: "mark_scheme",
        fileName: `${title}-ms.pdf`,
        mimeType: "application/pdf",
        size: 1,
        textContent: markSchemePageTexts.map((page) => `Page ${page.pageNumber}\n${page.text}`).join("\n\n"),
        pageCount: markSchemePageTexts.length,
        pageTexts: markSchemePageTexts.map(stripScreenshotFlag),
        pageScreenshots: [],
        objectUrl: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  } as PastPaper;
}

describe("validateProcessedPaperIntegrity", () => {
  it("rejects empty promptText", () => {
    const result = validateProcessedPaperIntegrity({ ...baseOutput, questions: [{ ...validQuestion, promptText: "" }] });
    expect(result.valid).toBe(false);
    expect(result.failures.join("\n")).toContain("promptText is empty");
  });

  it("rejects placeholder and copied example questions", () => {
    const placeholder = validateProcessedPaperIntegrity({ ...baseOutput, questions: [{ ...validQuestion, promptText: "__QUESTION_TEXT_FROM_SUPPLIED_PAPER_ONLY__" }] });
    expect(placeholder.valid).toBe(false);

    const bannedRegressionString = "secondary storage";
    const copied = validateProcessedPaperIntegrity({ ...baseOutput, questions: [{ ...validQuestion, promptText: `State one purpose of ${bannedRegressionString}.` }] });
    expect(copied.valid).toBe(false);

    const realPaperTopic = validateProcessedPaperIntegrity({ ...baseOutput, questions: [{ ...validQuestion, promptText: "Compare primary storage and secondary storage in a computer system." }] });
    expect(realPaperTopic.valid).toBe(true);
  });

  it("rejects totalMarks=100 with only two extracted marks", () => {
    const result = validateProcessedPaperIntegrity({ ...baseOutput, totalMarks: 100 });
    expect(result.valid).toBe(false);
    expect(result.failures.join("\n")).toContain("less than 50%");
  });

  it("rejects near-complete papers when extracted marks do not match the paper total", () => {
    const result = validateProcessedPaperIntegrity({
      ...baseOutput,
      totalMarks: 80,
      questions: [
        { ...validQuestion, questionNumber: "1", numberingPath: ["1"], maxMarks: 40 },
        { ...validQuestion, questionNumber: "2", numberingPath: ["2"], maxMarks: 39 },
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.failures.join("\n")).toContain("do not match the paper total");
  });

  it("prevents mapProcessedOutput from setting ready after invalid extraction", () => {
    expect(() => mapProcessedOutput(basePaper, { ...baseOutput, questions: [{ ...validQuestion, promptText: "" }] })).toThrow(
      "Question extraction appears incomplete or hallucinated",
    );
  });

  it("cleans mark suffixes and extracts embedded multiple-choice options", () => {
    const mapped = mapProcessedOutput(basePaper, {
      ...baseOutput,
      questions: [
        {
          ...validQuestion,
          promptText: "Which cell is not dividing by mitosis? [1 mark] Tick one box. A B C D",
          responseType: "single_choice",
          options: [],
        },
      ],
    });

    expect(mapped.questions[0].promptText).toBe("Which cell is not dividing by mitosis? Tick one box.");
    expect(mapped.questions[0].options).toEqual(["A", "B", "C", "D"]);
  });
});

describe("applyDeterministicMarkSchemeFallback", () => {
  it("fills missing mark-scheme data from readable numbered mark-scheme text", () => {
    const aligned = applyDeterministicMarkSchemeFallback(
      { ...baseOutput, questions: [{ ...validQuestion, questionNumber: "1", numberingPath: ["1"] }] },
      [
        {
          pageNumber: 2,
          charCount: 80,
          hasScreenshot: false,
          text: "Question 1\nAward one mark for naming diffusion.\nAward one mark for explaining movement down a concentration gradient.",
        },
      ],
    );

    expect(aligned.questions[0].markSchemeData).toMatchObject({
      source: "deterministic_mark_scheme_section",
    });
  });

  it("does not let readable mark-scheme alignment overwrite the question paper mark allocation", () => {
    const aligned = applyDeterministicMarkSchemeFallback(
      {
        ...baseOutput,
        questions: [{ ...validQuestion, questionNumber: "4*", numberingPath: ["4*"], maxMarks: 8 }],
      },
      [
        {
          pageNumber: 1,
          charCount: 82,
          hasScreenshot: false,
          text: "4* Discuss the impact of AI. [20 marks] indicative content and levels of response.",
        },
      ],
    );

    expect(aligned.questions[0].maxMarks).toBe(8);
  });
});

describe("pageContextsForAsset", () => {
  it("reconstructs page-level contexts from legacy whole-document PDF text", () => {
    const pages = pageContextsForAsset({
      id: "asset",
      paperId: "paper",
      kind: "paper",
      fileName: "paper.pdf",
      mimeType: "application/pdf",
      size: 100,
      textContent: "Page 1\nCover text\n\nPage 2\nQuestion one text\n\nPage 3\nQuestion continuation",
      pageCount: null,
      pageTexts: [],
      pageScreenshots: [],
      objectUrl: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    expect(pages.map((page) => page.pageNumber)).toEqual([1, 2, 3]);
    expect(pages[1].text).toContain("Question one text");
    expect(pages[2].charCount).toBeGreaterThan(0);
  });
});

describe("markAnswerWithAI", () => {
  afterEach(() => {
    window.__AI_TEST_MOCK__ = undefined;
  });

  const question = {
    id: "q1",
    paperId: "paper",
    questionNumber: "1",
    promptText: validQuestion.promptText,
    maxMarks: 2,
    responseType: "short_text",
    markSchemeData: null,
  } as PastPaperQuestion;
  const answer = {
    id: "a1",
    attemptId: "attempt",
    questionId: "q1",
    responseText: "A visible process.",
    skipped: false,
    skippedWithConfidence: false,
    confidencePredictedMarks: null,
    selectedOptions: [],
    numericResponse: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as PastPaperAnswer;

  it("refuses to mark when no markSchemeData exists", async () => {
    await expect(markAnswerWithAI(basePaper, question, answer, 1)).rejects.toThrow("no aligned mark scheme");
  });

  it("marks when aligned markSchemeData exists", async () => {
    window.__AI_TEST_MOCK__ = {
      ai: {
        chat: async () =>
          JSON.stringify({
            awardedMarks: 1,
            maxMarks: 2,
            rationale: "Matches one supplied point.",
            missingPoints: ["Add detail."],
            markSchemeEvidence: "Visible mark point.",
            markSchemeReference: {},
            confidence: 80,
          }),
      },
    };
    const mark = await markAnswerWithAI(basePaper, { ...question, markSchemeData: { points: ["Visible mark point."] } }, answer, 1);
    expect(mark.awardedMarks).toBe(1);
  });

  it("recovers readable mark-scheme text during marking when processed questions have no stored alignment", async () => {
    window.__AI_TEST_MOCK__ = {
      ai: {
        chat: async (prompt: string | unknown[]) => {
          const promptText = String(prompt);
          expect(promptText).toContain("Award one mark for hexadecimal");
          return JSON.stringify({
            awardedMarks: 1,
            maxMarks: 2,
            rationale: "Answer matches the recovered mark-scheme window.",
            missingPoints: ["Add the denary conversion."],
            markSchemeEvidence: "Award one mark for hexadecimal.",
            markSchemeReference: { source: "deterministic_mark_scheme_window" },
            confidence: 84,
          });
        },
      },
    };
    const q1c = {
      ...question,
      questionNumber: "1(c)",
      numberingPath: ["1", "(c)"],
      maxMarks: 2,
      promptText: "(c) Convert hexadecimal 2F to denary. [2]",
      markSchemeData: null,
    } as PastPaperQuestion;
    const paperWithReadableMarkScheme = {
      ...basePaper,
      hasMarkScheme: true,
      questions: [q1c],
      assets: [
        {
          id: "ms",
          paperId: "paper",
          kind: "mark_scheme",
          fileName: "ms.pdf",
          mimeType: "application/pdf",
          size: 100,
          textContent: "Question Answer Mark Guidance 1 (c) Award one mark for hexadecimal place value. Award one mark for denary answer 47. 2",
          pageTexts: [
            {
              pageNumber: 1,
              text: "Question Answer Mark Guidance 1 (c) Award one mark for hexadecimal place value. Award one mark for denary answer 47. 2",
              charCount: 118,
            },
          ],
          objectUrl: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    } as PastPaper;

    const mark = await markAnswerWithAI(paperWithReadableMarkScheme, q1c, { ...answer, questionId: q1c.id, responseText: "47" } as PastPaperAnswer, 1);

    expect(mark.awardedMarks).toBe(1);
    expect(mark.maxMarks).toBe(2);
  });

  it("uses the parent mark-scheme section for lettered subparts so the marker can choose the correct row", async () => {
    window.__AI_TEST_MOCK__ = {
      ai: {
        chat: async (prompt: string | unknown[]) => {
          const promptText = String(prompt);
          expect(promptText).toContain("3 (e) Encryption prevents private data being read");
          expect(promptText).toContain("Encryption protects data if intercepted");
          expect(promptText).not.toContain("Receive packets");
          expect(promptText).not.toContain("stale ethernet row");
          return JSON.stringify({
            awardedMarks: 1,
            maxMarks: 2,
            rationale: "Uses the encryption row from the supplied question 3 section.",
            missingPoints: ["Add a second reason."],
            markSchemeEvidence: "3 (e) Encryption prevents private data being read.",
            markSchemeReference: { reference: "3(e)" },
            confidence: 86,
          });
        },
      },
    };
    const q3e = {
      ...question,
      id: "q3e",
      questionNumber: "3(e)",
      numberingPath: ["3", "(e)"],
      displayOrder: 0,
      maxMarks: 2,
      promptText: "Give two reasons why the library should use encryption.",
      markSchemeData: { source: "deterministic_mark_scheme_window", rows: [{ markPoint: "stale ethernet row", marks: 2 }], evidence: "stale ethernet row" },
    } as PastPaperQuestion;
    const paperWithQuestionSection = {
      ...basePaper,
      hasMarkScheme: true,
      questions: [q3e],
      assets: [
        {
          id: "ms",
          paperId: "paper",
          kind: "mark_scheme",
          fileName: "ms.pdf",
          mimeType: "application/pdf",
          size: 100,
          textContent:
            "3 (c) Ethernet is low cost for purchase. 2\n3 (d) Receive packets. Forward packets. Maintain a routing table. 3\n3 (e) Encryption prevents private data being read. Encryption protects data if intercepted. 2\n4 (a) Physical security methods. 2",
          pageTexts: [
            {
              pageNumber: 1,
              text:
                "3 (c) Ethernet is low cost for purchase. 2\n3 (d) Receive packets. Forward packets. Maintain a routing table. 3\n3 (e) Encryption prevents private data being read. Encryption protects data if intercepted. 2\n4 (a) Physical security methods. 2",
              charCount: 226,
            },
          ],
          objectUrl: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    } as PastPaper;

    const mark = await markAnswerWithAI(paperWithQuestionSection, q3e, { ...answer, questionId: "q3e", responseText: "It prevents private data being read." } as PastPaperAnswer, 1);

    expect(mark.awardedMarks).toBe(1);
  });

  it("cleans visible numbering and mark suffixes from stored prompts", () => {
    const mapped = mapProcessedOutput(basePaper, {
      ...baseOutput,
      questions: [{ ...validQuestion, promptText: "1(c) (ii) Convert hexadecimal 2F to denary. [2 marks]", questionNumber: "1(c)(ii)", numberingPath: ["1", "(c)", "(ii)"] }],
    });

    expect(mapped.questions[0].promptText).toBe("Convert hexadecimal 2F to denary.");
  });

  it("normalizes common marking response shape drift instead of rejecting the mark", async () => {
    window.__AI_TEST_MOCK__ = {
      ai: {
        chat: async () =>
          JSON.stringify({
            awardedMarks: "1",
            maxMarks: "2",
            missingPoints: "Add a named example.",
            markSchemeEvidence: ["visible mark point", "allow equivalent wording"],
            markSchemeReference: "02.2",
            confidence: "76",
          }),
      },
    };

    const mark = await markAnswerWithAI(basePaper, { ...question, markSchemeData: { points: ["Visible mark point."] } }, answer, 1);

    expect(mark.awardedMarks).toBe(1);
    expect(mark.markSchemeEvidence).toBe("visible mark point; allow equivalent wording");
    expect(mark.markSchemeReference).toEqual({ reference: "02.2" });
  });

  it("clamps impossible awarded marks to the question maximum", async () => {
    window.__AI_TEST_MOCK__ = {
      ai: {
        chat: async () =>
          JSON.stringify({
            awardedMarks: 2,
            maxMarks: 2,
            rationale: "Model over-awarded.",
            missingPoints: [],
            markSchemeEvidence: "Visible mark point.",
            markSchemeReference: {},
            confidence: 80,
          }),
      },
    };

    const mark = await markAnswerWithAI(basePaper, { ...question, maxMarks: 1, markSchemeData: { points: ["Visible mark point."] } }, answer, 1);

    expect(mark.awardedMarks).toBe(1);
    expect(mark.maxMarks).toBe(1);
  });

  it("uses display numbering to find the correct mark-scheme section for simple reset question numbers", async () => {
    window.__AI_TEST_MOCK__ = {
      ai: {
        chat: async (prompt: string | unknown[]) => {
          expect(typeof prompt).toBe("string");
          const promptText = String(prompt);
          expect(promptText).toContain("gene");
          expect(promptText).not.toContain("palisade mesophyll");
          return JSON.stringify({
            awardedMarks: 1,
            maxMarks: 1,
            rationale: "Gene matches the displayed mark-scheme section.",
            missingPoints: [],
            markSchemeEvidence: "01.2 gene",
            markSchemeReference: { reference: "01.2" },
            confidence: 88,
          });
        },
      },
    };
    const q1 = { ...question, id: "q1", questionNumber: "1", displayOrder: 0, maxMarks: 1, markSchemeData: { points: ["chromosome location"] } } as PastPaperQuestion;
    const q2 = { ...question, id: "q2", questionNumber: "2", displayOrder: 1, maxMarks: 1, promptText: "What controls a characteristic?", markSchemeData: null } as PastPaperQuestion;
    const paperWithMarkScheme = {
      ...basePaper,
      hasMarkScheme: true,
      questions: [q1, q2],
      assets: [
        {
          id: "ms",
          paperId: "paper",
          kind: "mark_scheme",
          fileName: "ms.pdf",
          mimeType: "application/pdf",
          size: 100,
          textContent: "01.1 nucleus\n01.2 gene\n01.3 chromosome",
          pageTexts: [{ pageNumber: 1, text: "01.1 nucleus\n01.2 gene\n01.3 chromosome", charCount: 38 }],
          objectUrl: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    } as PastPaper;
    const q2Answer = { ...answer, questionId: "q2", responseText: "Gene" } as PastPaperAnswer;

    const mark = await markAnswerWithAI(paperWithMarkScheme, q2, q2Answer, 1);

    expect(displayQuestionNumberForPaper(paperWithMarkScheme, q2)).toBe("1.2");
    expect(mark.awardedMarks).toBe(1);
  });

  it("prefers already aligned mark-scheme data over display-number text windows", async () => {
    window.__AI_TEST_MOCK__ = {
      ai: {
        chat: async (prompt: string | unknown[]) => {
          const promptText = String(prompt);
          expect(promptText).toContain("gene");
          expect(promptText).not.toContain("palisade mesophyll");
          return JSON.stringify({
            awardedMarks: 1,
            maxMarks: 1,
            rationale: "Gene is the aligned point.",
            missingPoints: [],
            markSchemeEvidence: "Aligned row: gene",
            markSchemeReference: { source: "visible_mark_scheme_row" },
            confidence: 90,
          });
        },
      },
    };
    const q1 = { ...question, id: "q1", questionNumber: "1", displayOrder: 0, maxMarks: 1 } as PastPaperQuestion;
    const q2 = { ...question, id: "q2", questionNumber: "2", displayOrder: 1, maxMarks: 1, markSchemeData: { rows: [{ markPoint: "gene", marks: 1 }], evidence: "gene" } } as PastPaperQuestion;
    const paperWithMisleadingText = {
      ...basePaper,
      hasMarkScheme: true,
      questions: [q1, q2],
      assets: [
        {
          id: "ms",
          paperId: "paper",
          kind: "mark_scheme",
          fileName: "ms.pdf",
          mimeType: "application/pdf",
          size: 100,
          textContent: "01.2 palisade mesophyll",
          pageTexts: [{ pageNumber: 1, text: "01.2 palisade mesophyll", charCount: 24 }],
          objectUrl: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    } as PastPaper;

    const mark = await markAnswerWithAI(paperWithMisleadingText, q2, { ...answer, questionId: "q2", responseText: "Gene" } as PastPaperAnswer, 1);

    expect(mark.awardedMarks).toBe(1);
  });

  it("falls back to existing aligned mark-scheme data when display numbering is only a UI label", async () => {
    window.__AI_TEST_MOCK__ = {
      ai: {
        chat: async (prompt: string | unknown[]) => {
          const promptText = String(prompt);
          expect(promptText).toContain("Known aligned point.");
          return JSON.stringify({
            awardedMarks: 1,
            maxMarks: 1,
            rationale: "Uses existing alignment.",
            missingPoints: [],
            markSchemeEvidence: "Known aligned point.",
            markSchemeReference: { reference: "02.1" },
            confidence: 80,
          });
        },
      },
    };
    const q1 = { ...question, id: "q1", questionNumber: "1", displayOrder: 0, maxMarks: 1, markSchemeData: { points: ["First point."] } } as PastPaperQuestion;
    const q2 = { ...question, id: "q2", questionNumber: "2", displayOrder: 1, maxMarks: 1, markSchemeData: { points: ["Known aligned point."] } } as PastPaperQuestion;
    const paperWithUnmatchedScheme = {
      ...basePaper,
      questions: [q1, q2],
      assets: [
        {
          id: "ms",
          paperId: "paper",
          kind: "mark_scheme",
          fileName: "ms.pdf",
          mimeType: "application/pdf",
          size: 100,
          textContent: "02.1 Known aligned point.",
          pageTexts: [{ pageNumber: 1, text: "02.1 Known aligned point.", charCount: 24 }],
          objectUrl: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    } as PastPaper;

    const mark = await markAnswerWithAI(paperWithUnmatchedScheme, q2, { ...answer, questionId: "q2" } as PastPaperAnswer, 1);

    expect(mark.awardedMarks).toBe(1);
  });

  it("throws a marking error when the recovered mark scheme still does not match the question after retry", async () => {
    window.__AI_TEST_MOCK__ = {
      ai: {
        chat: async () =>
          JSON.stringify({
            awardedMarks: 0,
            maxMarks: 1,
            rationale: "The supplied mark scheme content does not include any relevant criteria for this question, so it is insufficient to award marks.",
            missingPoints: [],
            markSchemeEvidence: null,
            markSchemeReference: {},
            confidence: 30,
          }),
      },
    };

    await expect(
      markAnswerWithAI(
        basePaper,
        { ...question, maxMarks: 1, markSchemeData: { rows: [{ markPoint: "CPU", marks: 1 }], evidence: "CPU" } },
        { ...answer, responseText: "RAM" } as PastPaperAnswer,
        1,
      ),
    ).rejects.toThrow("could not be matched to a reliable mark-scheme row");
  });

  it("treats OCR exact-answer rows like B0 and 16 as the real answer, not as concatenated footer text", async () => {
    const exactRow = { rows: [{ markPoint: "B0 1 Correct answer only", marks: 1 }], evidence: "1(d) B0 1 Correct answer only" };
    const numericRow = { rows: [{ markPoint: "16 1 Correct answer only", marks: 1 }], evidence: "1(e) 16 1 Correct answer only" };

    const q1d = { ...question, id: "q1d", questionNumber: "1(d)", maxMarks: 1, promptText: "Convert to hexadecimal.", markSchemeData: exactRow } as PastPaperQuestion;
    const q1e = { ...question, id: "q1e", questionNumber: "1(e)", maxMarks: 1, promptText: "Identify how many unique values.", markSchemeData: numericRow } as PastPaperQuestion;

    const markedHex = await markAnswerWithAI(basePaper, q1d, { ...answer, questionId: "q1d", responseText: "1011 = 11 = B 0000 = 0 = 0 B0 is the answer" } as PastPaperAnswer, 1);
    const markedCount = await markAnswerWithAI(basePaper, q1e, { ...answer, questionId: "q1e", responseText: "16" } as PastPaperAnswer, 1);
    const wrongHex = await markAnswerWithAI(basePaper, q1d, { ...answer, questionId: "q1d", responseText: "B1" } as PastPaperAnswer, 1);
    const wrongCount = await markAnswerWithAI(basePaper, q1e, { ...answer, questionId: "q1e", responseText: "2, either it is a 0 or a 1" } as PastPaperAnswer, 1);

    expect(markedHex.awardedMarks).toBe(1);
    expect(markedHex.markSchemeEvidence).toBe("B0");
    expect(markedCount.awardedMarks).toBe(1);
    expect(markedCount.markSchemeEvidence).toBe("16");
    expect(wrongHex.awardedMarks).toBe(0);
    expect(wrongHex.rationale).toContain("Expected B0");
    expect(wrongCount.awardedMarks).toBe(0);
    expect(wrongCount.rationale).toContain("Expected 16");
  });

  it("rejects malformed Gemini marking JSON with a clear parser error", async () => {
    window.__AI_TEST_MOCK__ = {
      ai: {
        chat: async () => "not valid json",
      },
    };

    await expect(
      markAnswerWithAI(
        basePaper,
        { ...question, maxMarks: 1, markSchemeData: { rows: [{ markPoint: "B0", marks: 1 }], evidence: "B0 correct answer only" } },
        { ...answer, questionId: "q1d", responseText: "B0" } as PastPaperAnswer,
        1,
      ),
    ).rejects.toThrow("AI returned invalid JSON");
  });
});

describe("displayQuestionNumberForPaper", () => {
  it("groups simple extracted question numbers into main-question rows when numbering resets", () => {
    const questions = [
      { id: "q1", questionNumber: "1", displayOrder: 0 },
      { id: "q2", questionNumber: "2", displayOrder: 1 },
      { id: "q3", questionNumber: "3", displayOrder: 2 },
      { id: "q4", questionNumber: "1", displayOrder: 3 },
      { id: "q5", questionNumber: "2", displayOrder: 4 },
    ] as PastPaperQuestion[];
    const paperWithQuestions = { ...basePaper, questions } as PastPaper;

    expect(questions.map((item) => displayQuestionNumberForPaper(paperWithQuestions, item))).toEqual(["1.1", "1.2", "1.3", "2.1", "2.2"]);
  });

  it("normalizes copyright-symbol subpart mistakes into c labels", () => {
    const q = { id: "q3c", questionNumber: "3©", displayOrder: 0 } as PastPaperQuestion;
    const paperWithQuestions = { ...basePaper, questions: [q] } as PastPaper;

    expect(displayQuestionNumberForPaper(paperWithQuestions, q)).toBe("3(c)");
  });

  it("keeps OCR-style main question numbers plain when the paper already has hierarchical subparts", () => {
    const questions = [
      { id: "q1a", questionNumber: "1(a)", displayOrder: 0 },
      { id: "q1f", questionNumber: "1(f)", displayOrder: 1 },
      { id: "q2", questionNumber: "2", displayOrder: 2 },
      { id: "q3ai", questionNumber: "3(a)(i)", displayOrder: 3 },
    ] as PastPaperQuestion[];
    const paperWithQuestions = { ...basePaper, questions } as PastPaper;

    expect(displayQuestionNumberForPaper(paperWithQuestions, questions[2])).toBe("2");
  });
});

describe("processPaperWithAI", () => {
  afterEach(() => {
    window.__AI_TEST_MOCK__ = undefined;
  });

  it("fails clearly for image-only papers when the image call fails", async () => {
    window.__AI_TEST_MOCK__ = {
      ai: {
        chat: async (_prompt, media) => {
          if (Array.isArray(media) && media.length) throw new Error("image input unsupported");
          return "{}";
        },
      },
    };
    const imageOnlyPaper = {
      ...basePaper,
      assets: [
        {
          id: "asset",
          paperId: "paper",
          kind: "paper",
          fileName: "paper.png",
          mimeType: "image/png",
          size: 10,
          textContent: "",
          pageCount: 1,
          pageTexts: [{ pageNumber: 1, text: "", charCount: 0 }],
          pageScreenshots: [
            {
              pageNumber: 1,
              dataUrl: "data:image/png;base64,AAAA",
              thumbnailDataUrl: "data:image/png;base64,AAAA",
              width: 1,
              height: 1,
              byteSize: 3,
              thumbnailByteSize: 3,
              mimeType: "image/png",
              renderScale: 1,
            },
          ],
          objectUrl: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    } as PastPaper;

    await expect(processPaperWithAI(imageOnlyPaper, () => undefined)).rejects.toThrow("Image input failed");
  });

  it("retries text-only when images fail but readable text exists", async () => {
    window.__AI_TEST_MOCK__ = {
      ai: {
        chat: async (prompt, media) => {
          if (Array.isArray(media) && media.length) throw new Error("image input unsupported");
          const text = String(prompt);
          if (text.includes("Build a compact inventory")) {
            return JSON.stringify({
              title: "Paper",
              year: null,
              series: null,
              paperCode: null,
              totalMarks: 2,
              durationMinutes: 30,
              pages: [{ pageNumber: 1, role: "questions", questionHints: ["1"], visualContent: [], textSummary: "Question 1", needsImage: false }],
            });
          }
          if (text.includes("Identify the ordered question boundaries")) {
            return JSON.stringify({
              questions: [{ questionNumber: "1", parentQuestionNumber: null, numberingPath: ["1"], startPage: 1, endPage: 1, maxMarks: 2, responseTypeHint: "short_text", hasVisualContent: false, mediaRefs: [] }],
            });
          }
          if (text.includes("Extract structured exam questions")) {
            return JSON.stringify({ questions: [validQuestion] });
          }
          return "{}";
        },
      },
    };
    const textRichPaper = {
      ...basePaper,
      assets: [
        {
          id: "asset",
          paperId: "paper",
          kind: "paper",
          fileName: "paper.pdf",
          mimeType: "application/pdf",
          size: 10,
          textContent: "Page 1\nDescribe the visible process shown in Figure 1. Explain how the evidence in the source supports the answer.",
          pageCount: 1,
          pageTexts: [{ pageNumber: 1, text: "Describe the visible process shown in Figure 1. Explain how the evidence in the source supports the answer.", charCount: 99 }],
          pageScreenshots: [
            {
              pageNumber: 1,
              dataUrl: "data:image/png;base64,AAAA",
              thumbnailDataUrl: "data:image/png;base64,AAAA",
              width: 1,
              height: 1,
              byteSize: 3,
              thumbnailByteSize: 3,
              mimeType: "image/png",
              renderScale: 1,
            },
          ],
          objectUrl: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    } as PastPaper;

    const processed = await processPaperWithAI(textRichPaper, () => undefined, { fallbackModels: [] });

    expect(processed.processingStatus).toBe("ready");
    expect(processed.questions).toHaveLength(1);
  });

  it("repairs an empty first subpart when the model put the visible prompt on its parent container", async () => {
    window.__AI_TEST_MOCK__ = {
      ai: {
        chat: async (prompt) => {
          const text = String(prompt);
          if (text.includes("Build a compact inventory")) {
            return JSON.stringify({
              title: "Paper",
              year: null,
              series: null,
              paperCode: null,
              totalMarks: 2,
              durationMinutes: 30,
              pages: [{ pageNumber: 1, role: "questions", questionHints: ["1", "1(a)"], visualContent: [], textSummary: "Question 1(a)", needsImage: false }],
            });
          }
          if (text.includes("Identify the ordered question boundaries")) {
            return JSON.stringify({
              questions: [
                { questionNumber: "1", parentQuestionNumber: null, numberingPath: ["1"], startPage: 1, endPage: 1, maxMarks: 2, responseTypeHint: "short_text", hasVisualContent: false, mediaRefs: [] },
                { questionNumber: "1(a)", parentQuestionNumber: "1", numberingPath: ["1", "(a)"], startPage: 1, endPage: 1, maxMarks: 2, responseTypeHint: "short_text", hasVisualContent: false, mediaRefs: [] },
              ],
            });
          }
          if (text.includes("Extract structured exam questions")) {
            return JSON.stringify({
              questions: [
                { ...validQuestion, questionNumber: "1", numberingPath: ["1"], promptText: "Computers represent data in binary form. Tick one box.", maxMarks: 2 },
                { ...validQuestion, questionNumber: "1(a)", parentQuestionNumber: "1", numberingPath: ["1", "(a)"], promptText: "", maxMarks: 2 },
              ],
            });
          }
          return "{}";
        },
      },
    };
    const textRichPaper = {
      ...basePaper,
      assets: [
        {
          id: "asset",
          paperId: "paper",
          kind: "paper",
          fileName: "paper.pdf",
          mimeType: "application/pdf",
          size: 10,
          textContent: "Page 1\nComputers represent data in binary form. Tick one box. Explain your answer using the visible file-size information in the table.",
          pageCount: 1,
          pageTexts: [{ pageNumber: 1, text: "Computers represent data in binary form. Tick one box. Explain your answer using the visible file-size information in the table.", charCount: 121 }],
          pageScreenshots: [],
          objectUrl: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    } as PastPaper;

    const processed = await processPaperWithAI(textRichPaper, () => undefined, { fallbackModels: [] });

    expect(processed.processingStatus).toBe("ready");
    expect(processed.questions).toHaveLength(1);
    expect(processed.questions[0].questionNumber).toBe("1(a)");
    expect(processed.questions[0].promptText).toContain("Computers represent data");
  });

  it("processes the real OCR computer science paper deterministically with the correct order and total", async () => {
    const pageTexts = await loadPdfPageTexts(testPaperPath("June 2022 QP - Paper 1 OCR Computer Science GCSE (1).pdf"));
    const paper = buildPdfPaper("comp sci p1 2022", "Computer Science", pageTexts);

    const processed = await processPaperWithAI(paper, () => undefined, { fallbackModels: [] });
    const labels = processed.questions.map((question) => question.questionNumber);

    expect(processed.totalMarks).toBe(80);
    expect(processed.durationMinutes).toBe(90);
    expect(processed.questions.reduce((sum, question) => sum + question.maxMarks, 0)).toBe(80);
    expect(labels).toEqual([
      "1(a)",
      "1(b)",
      "1(c)",
      "1(d)",
      "1(e)",
      "1(f)",
      "2",
      "3(a)(i)",
      "3(a)(ii)",
      "3(b)",
      "3(c)",
      "3(d)",
      "3(e)",
      "3(f)",
      "4*",
      "5(a)",
      "5(b)",
      "5(c)",
      "6(a)(i)",
      "6(a)(ii)",
      "6(b)(i)",
      "6(b)(ii)",
      "6(c)",
      "6(d)(i)",
      "6(d)(ii)",
      "7(a)(i)",
      "7(a)(ii)",
      "7(b)(i)",
      "7(b)(ii)",
    ]);
    expect(labels.some((label) => /2\.81|9\(c\)|1\.8|3\.11/.test(label))).toBe(false);
  });

  it("builds a clean deterministic output for the real AQA biology paper without duplicate or impossible labels", async () => {
    const pageTexts = await loadPdfPageTexts(testPaperPath("June 2018 QP (2).pdf"));
    const paper = buildPdfPaper("bio 2018", "Biology", pageTexts);

    const output = buildDeterministicProcessedPaperOutput(paper, pageTexts);
    const labels = output?.questions.map((question) => question.questionNumber) ?? [];
    const firstPrompt = output?.questions[0]?.promptText ?? "";

    expect(output).not.toBeNull();
    expect(output?.totalMarks).toBe(100);
    expect(output?.durationMinutes).toBe(105);
    expect(output?.questions.reduce((sum, question) => sum + question.maxMarks, 0)).toBe(100);
    expect(labels[0]).toBe("1.1");
    expect(labels).toContain("1.8");
    expect(labels).toContain("2.1");
    expect(labels.every((label) => /^\d+\.\d+$/.test(label))).toBe(true);
    expect(new Set(labels).size).toBe(labels.length);
    expect(firstPrompt).toMatch(/^This question is about the cell cycle\./);
    expect(firstPrompt).toContain("Chromosomes are copied during the cell cycle.");
    expect(firstPrompt).toContain("Where are chromosomes found?");
    expect(firstPrompt).not.toMatch(/For Examiner|Question Mark|TOTAL|Time allowed|Materials|Instructions|Centre number|Candidate number|Surname|Forename/i);
  });

  it("strips AQA front-cover instructions when the first valid dotted question starts after them", () => {
    const pageTexts = [
      {
        pageNumber: 1,
        text: "For Examiner's Use Question Mark TOTAL Time allowed: 1 hour 45 minutes Materials Instructions Answer all questions Centre number Candidate number Surname Forename GCSE BIOLOGY Foundation Tier",
        charCount: 173,
        hasScreenshot: false as const,
      },
      {
        pageNumber: 2,
        text: "Do not write outside the box 0 1 This question is about the cell cycle. 0 1 . 1 Chromosomes are copied during the cell cycle. Where are chromosomes found? [1 mark]",
        charCount: 164,
        hasScreenshot: false as const,
      },
    ];
    const paper = buildPdfPaper("bio front matter", "Biology", pageTexts);

    const output = buildDeterministicProcessedPaperOutput(paper, pageTexts);

    expect(output).not.toBeNull();
    expect(output?.questions[0]?.questionNumber).toBe("1.1");
    expect(output?.questions[0]?.promptText).toBe(
      "This question is about the cell cycle. Chromosomes are copied during the cell cycle. Where are chromosomes found?",
    );
  });

  it("processes the real OCR 2024 computer science paper without impossible numbering regressions", async () => {
    const pageTexts = await loadPdfPageTexts(testPaperPath("June 2024 QP - Paper 1 OCR Computer Science GCSE.pdf"));
    const paper = buildPdfPaper("comp sci p1 2024", "Computer Science", pageTexts);

    const processed = await processPaperWithAI(paper, () => undefined, { fallbackModels: [] });
    const labels = processed.questions.map((question) => question.questionNumber);

    expect(processed.totalMarks).toBeGreaterThan(0);
    expect(processed.durationMinutes).toBeGreaterThan(0);
    expect(processed.questions.reduce((sum, question) => sum + question.maxMarks, 0)).toBe(processed.totalMarks);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels.every((label) => /^(?:\d+\*?|\d+\([a-z]+\)|\d+\([a-z]+\)\([ivx]+\))$/i.test(label))).toBe(true);
    expect(labels.some((label) => /2\.81|9\(c\)|1\.8|3\.11/.test(label))).toBe(false);
  });

  it("keeps AQA chemistry 2021 cover text out of extracted questions and preserves figure refs", async () => {
    const pageTexts = await loadPdfPageTexts(testPaperPath("June 2021 QP (3).pdf"));
    const paper = buildPdfPaper("chem 2021", "Chemistry", pageTexts);

    const output = buildDeterministicProcessedPaperOutput(paper, pageTexts);
    const labels = output?.questions.map((question) => question.questionNumber) ?? [];
    const q11 = output?.questions.find((question) => question.questionNumber === "1.1");
    const q14 = output?.questions.find((question) => question.questionNumber === "1.4");
    const q21 = output?.questions.find((question) => question.questionNumber === "2.1");
    const q101 = output?.questions.find((question) => question.questionNumber === "10.1");
    const q106 = output?.questions.find((question) => question.questionNumber === "10.6");

    expect(output).not.toBeNull();
    expect(labels).not.toContain("0.1");
    expect(labels).not.toContain("0.2");
    expect(labels).not.toContain("0.3");
    expect(labels).not.toContain("0.4");
    expect(labels).not.toContain("0.5");
    expect(labels).not.toContain("0.7");
    expect(labels).not.toContain("1.95");
    expect(labels).toContain("10.1");
    expect(labels).toContain("10.7");
    expect(q11?.promptText).toMatch(/^This question is about fuels and energy\./);
    expect(q11?.promptText).toContain("Figure 1 shows the percentage of electricity generated in the UK between 2007 and 2017");
    expect(q11?.promptText).not.toMatch(/Use the Physics Equations Sheet/i);
    expect(q11?.promptText).not.toMatch(/For Examiner|Time allowed|Materials|Candidate number|There are no questions printed on this page/i);
    expect(q11?.mediaRefs.map((ref) => ref.label)).toContain("Figure 1");
    expect(q14?.promptText).toMatch(/^Solar energy may not be able to replace the generation of electricity from fossil fuels completely\./);
    expect(q14?.promptText).not.toMatch(/For Examiner|Time allowed|Candidate number|This question is about alkanes/i);
    expect(q21?.mediaRefs.map((ref) => ref.label)).toEqual(expect.arrayContaining(["Table 1", "Figure 2"]));
    expect(q21?.promptText).toMatch(/^This question is about alkanes\./);
    expect(q101?.promptText).toMatch(/^This question is about alkenes and alcohols\./);
    expect(q106?.promptText).toContain("1.95 kJ");
  });

  it("keeps AQA physics 2023 numbering stable and retains values like 9.8 N/kg inside the prompt text", async () => {
    const pageTexts = await loadPdfPageTexts(testPaperPath("June 2023 QP (2).pdf"));
    const paper = buildPdfPaper("physics 2023", "Physics", pageTexts);

    const output = buildDeterministicProcessedPaperOutput(paper, pageTexts);
    const labels = output?.questions.map((question) => question.questionNumber) ?? [];
    const q11 = output?.questions.find((question) => question.questionNumber === "1.1");
    const q21 = output?.questions.find((question) => question.questionNumber === "2.1");
    const q41 = output?.questions.find((question) => question.questionNumber === "4.1");

    expect(output).not.toBeNull();
    expect(labels).toContain("4.1");
    expect(labels).not.toContain("9.8");
    expect(labels.every((label) => /^\d+\.\d+$/.test(label))).toBe(true);
    expect(q11?.promptText).not.toMatch(/Use the Physics Equations Sheet/i);
    expect(q21?.promptText).toMatch(/^Figure 2 shows the equipment a student used to determine the specific heat capacity of iron\./);
    expect(q21?.mediaRefs.map((ref) => ref.label)).toContain("Figure 2");
    expect(q41?.promptText).toContain("9.8 N/kg");
    expect(q41?.promptText).not.toMatch(/\b9\.8\b.*question/i);
  });

  it("extracts exact OCR mark-scheme sections with the right guidance for supported questions", async () => {
    const pageTexts = await loadPdfPageTexts(testPaperPath("June 2022 QP - Paper 1 OCR Computer Science GCSE (1).pdf"));
    const markSchemePageTexts = await loadPdfPageTexts(testPaperPath("June 2022 MS - Paper 1 OCR Computer Science GCSE (1).pdf"));
    const paper = buildPdfPaperWithMarkScheme("comp sci p1 2022", "Computer Science", pageTexts, markSchemePageTexts);

    const processed = await processPaperWithAI(paper, () => undefined, { fallbackModels: [] });
    const byNumber = new Map(processed.questions.map((question) => [question.questionNumber, question] as const));
    const q1c = byNumber.get("1(c)");
    const q3e = byNumber.get("3(e)");
    const q3f = byNumber.get("3(f)");
    const q5a = byNumber.get("5(a)");
    const q6ai = byNumber.get("6(a)(i)");

    expect(q1c?.markSchemeRef).toContain("1(c)");
    expect(typeof q1c?.markSchemeData?.evidence).toBe("string");
    expect(String(q1c?.markSchemeData?.evidence)).toContain("1 mark for answer 47");
    expect(String(q1c?.markSchemeData?.evidence)).not.toContain("1 (d)");
    expect(String(byNumber.get("1(f)")?.markSchemeData?.evidence)).toContain("00010001");
    expect(String(byNumber.get("1(f)")?.markSchemeData?.evidence)).not.toContain("J277");

    expect(String(q3e?.markSchemeData?.evidence)).toContain("Data cannot be understood if intercepted");
    expect(String(q3e?.markSchemeData?.evidence)).not.toContain("Receive packets");

    expect(String(q3f?.markSchemeData?.evidence)).toContain("SMTP");
    expect(String(q3f?.markSchemeData?.evidence)).toContain("HTTPS");
    expect(String(q3f?.markSchemeData?.evidence)).not.toContain("Receive packets");

    expect(JSON.stringify(q5a?.markSchemeData)).toContain("Do not award password");
    expect(JSON.stringify(q5a?.markSchemeData)).toContain("passcodes /word on doors");
    expect(JSON.stringify(q6ai?.markSchemeData)).toContain("MP2 do not award");
    expect(JSON.stringify(q6ai?.markSchemeData)).toContain("frequency");
    expect(byNumber.get("3(b)")?.originalContent?.unsupportedQuestionFormat).toBe(true);
    expect(displayQuestionNumberForPaper(processed, byNumber.get("2")!)).toBe("2");
  });

  it("retries OCR marking with a stronger model when a weak first pass wrongly claims the exact row is insufficient", async () => {
    const pageTexts = await loadPdfPageTexts(testPaperPath("June 2022 QP - Paper 1 OCR Computer Science GCSE (1).pdf"));
    const markSchemePageTexts = await loadPdfPageTexts(testPaperPath("June 2022 MS - Paper 1 OCR Computer Science GCSE (1).pdf"));
    const paper = buildPdfPaperWithMarkScheme("comp sci p1 2022", "Computer Science", pageTexts, markSchemePageTexts);
    const processed = await processPaperWithAI(paper, () => undefined, { fallbackModels: [] });
    const q3f = processed.questions.find((question) => question.questionNumber === "3(f)");
    if (!q3f) throw new Error("Expected Q3(f) to exist in the processed OCR paper.");

    const seenModels: string[] = [];
    window.__AI_TEST_MOCK__ = {
      ai: {
        chat: async (prompt: string | unknown[], config?: unknown) => {
          const promptText = String(prompt);
          const model = typeof config === "object" && config ? String((config as { model?: unknown }).model ?? "") : "";
          seenModels.push(model);
          expect(promptText).toContain("SMTP");
          expect(promptText).toContain("HTTPS");
          expect(promptText).not.toContain("Receive packets");
          if (model === "gemini-2.5-flash-lite") {
            return JSON.stringify({
              awardedMarks: 0,
              maxMarks: 2,
              rationale: "The supplied mark scheme content does not include any relevant criteria for Q3(f), so it is insufficient to award marks.",
              missingPoints: [],
              markSchemeEvidence: null,
              markSchemeReference: {},
              confidence: 42,
            });
          }
          return JSON.stringify({
            awardedMarks: 2,
            maxMarks: 2,
            rationale: "SMTP and HTTPS both match the exact Q3(f) row.",
            missingPoints: [],
            markSchemeEvidence: "3 (f) 1 mark each e.g. Send email: SMTP // simple mail transfer protocol Access website securely : HTTPS // hypertext transfer protocol secure",
            markSchemeReference: { reference: "3(f)" },
            confidence: 91,
          });
        },
      },
    };

    const mark = await markAnswerWithAI(
      processed,
      q3f,
      {
        id: "a-q3f",
        attemptId: "attempt",
        questionId: q3f.id,
        responseText: "SMTP to send email. HTTPS to access a website securely.",
        skipped: false,
        skippedWithConfidence: false,
        confidencePredictedMarks: null,
        selectedOptions: [],
        numericResponse: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      } as PastPaperAnswer,
      1,
    );

    expect(mark.awardedMarks).toBe(2);
    expect(seenModels).toContain("gemini-2.5-flash-lite");
    expect(seenModels).toContain("gemini-2.5-flash");
  });

  it("includes OCR do-not-accept guidance in the marking prompt for physical security answers", async () => {
    const pageTexts = await loadPdfPageTexts(testPaperPath("June 2022 QP - Paper 1 OCR Computer Science GCSE (1).pdf"));
    const markSchemePageTexts = await loadPdfPageTexts(testPaperPath("June 2022 MS - Paper 1 OCR Computer Science GCSE (1).pdf"));
    const paper = buildPdfPaperWithMarkScheme("comp sci p1 2022", "Computer Science", pageTexts, markSchemePageTexts);
    const processed = await processPaperWithAI(paper, () => undefined, { fallbackModels: [] });
    const q5a = processed.questions.find((question) => question.questionNumber === "5(a)");
    if (!q5a) throw new Error("Expected Q5(a) to exist in the processed OCR paper.");

    window.__AI_TEST_MOCK__ = {
      ai: {
        chat: async (prompt: string | unknown[]) => {
          const promptText = String(prompt);
          expect(promptText).toContain("Do not award password");
          expect(promptText).toContain("passcodes /word on doors");
          return JSON.stringify({
            awardedMarks: 1,
            maxMarks: 2,
            rationale: "CCTV is creditworthy, but password is not because the exact row says not to award it.",
            missingPoints: ["Add one more valid physical security method."],
            markSchemeEvidence: "Do not award password, but do award passcodes /word on doors.",
            markSchemeReference: { reference: "5(a)" },
            confidence: 88,
          });
        },
      },
    };

    const mark = await markAnswerWithAI(
      processed,
      q5a,
      {
        id: "a-q5a",
        attemptId: "attempt",
        questionId: q5a.id,
        responseText: "Password on the door and CCTV.",
        skipped: false,
        skippedWithConfidence: false,
        confidencePredictedMarks: null,
        selectedOptions: [],
        numericResponse: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      } as PastPaperAnswer,
      1,
    );

    expect(mark.awardedMarks).toBe(1);
  });
});
