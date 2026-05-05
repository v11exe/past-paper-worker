import {
  markSchemeAlignmentOutputSchema,
  normalizeMarkSchemeAlignmentOutput,
  normalizePaperMarkOutput,
  normalizeProcessedPaperOutput,
  pageInventoryOutputSchema,
  paperMarkOutputSchema,
  processedPaperOutputSchema,
  questionBoundaryOutputSchema,
  questionExtractionOutputSchema,
  type MarkSchemeAlignmentOutput,
  type PaperMarkOutput,
  type ProcessedPaperOutput,
  type QuestionBoundaryOutput,
  type QuestionExtractionOutput,
} from "../ai/schemas";
import {
  buildMarkSchemeAlignmentPrompt,
  buildPageInventoryPrompt,
  buildPaperMarkingPrompt,
  buildQuestionBoundaryPrompt,
  buildQuestionExtractionPrompt,
  type PagePromptContext,
  type QuestionBoundaryPromptContext,
} from "../ai/prompts";
import { DEFAULT_AI_MODEL, FALLBACK_AI_MODELS, AIProviderError, aiStructuredJson } from "../ai/provider";
import type {
  AppData,
  PaperPageScreenshot,
  PastPaper,
  PastPaperAnswer,
  PastPaperAttempt,
  PastPaperAsset,
  PastPaperProcessingJob,
  PastPaperQuestion,
  PastPaperQuestionMark,
  PastPaperRemark,
  ProcessingDiagnostics,
  ProcessingStage,
  AIRequestDiagnostic,
} from "../types";
import { createId } from "./id";
import type { z } from "zod";

export const processingStages = [
  "uploading",
  "extracting",
  "building page inventory",
  "identifying questions",
  "extracting question details",
  "aligning mark scheme",
  "finalising",
] as const;

type ProcessingProgressUpdate = {
  stage: ProcessingStage;
  percent: number;
  diagnostics: ProcessingDiagnostics;
};

type ProcessPaperOptions = {
  model?: string;
  fallbackModels?: string[];
};

const MAX_EXTRACTION_PAGES_PER_CHUNK = 3;
const MAX_AI_MARK_SCHEME_ALIGNMENT_PROMPT_CHARS = 28_000;
const QUESTION_EXTRACTION_FAILURE =
  "Question extraction appears incomplete or hallucinated. Metadata was read, but extracted questions did not match the paper.";
const NEUTRAL_PLACEHOLDER_PATTERN = /__(?:[A-Z0-9]+_?)+__/;
const COPIED_SEMANTIC_EXAMPLE_PATTERN = /\b(?:state\s+one\s+purpose\s+of\s+secondary\s+storage|explain\s+(?:one\s+|two\s+|the\s+)?benefits?\s+of\s+secondary\s+storage)\b/i;
const UNSUPPORTED_FORMAT_PATTERN =
  /\b(?:tick\s*\(\s*3\s*\)\s*(?:one|one or more)\s+boxes?\s+on\s+each\s+row|tick\s+one\s+box\s+in\s+each\s+row|one\s+box\s+(?:in|on)\s+each\s+row|complete\s+the\s+table|table\s+by\s+writing|complete\s+the\s+description|given\s+list\s+of\s+terms|word\s+bank|matching\s+table|matrix|grid|draw|shade|label\s+the\s+diagram)\b/i;

export const supportedQuestionTypeLabels = [
  "Short written answer",
  "Long written answer",
  "Calculation or numeric answer",
  "Simple single checkbox or radio choice",
  "Simple multiple checkbox choice",
] as const;

export function nowIso() {
  return new Date().toISOString();
}

export function formatClock(seconds: number) {
  const sign = seconds < 0 ? "-" : "";
  const absolute = Math.abs(seconds);
  const hours = Math.floor(absolute / 3600);
  const minutes = Math.floor((absolute % 3600) / 60);
  const remaining = absolute % 60;
  if (hours > 0) return `${sign}${hours}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
  return `${sign}${minutes}:${String(remaining).padStart(2, "0")}`;
}

export function answerText(answer: PastPaperAnswer, question?: PastPaperQuestion) {
  if (answer.skipped) return answer.skippedWithConfidence ? `Skipped with ${answer.confidencePredictedMarks ?? 0} predicted marks` : "Skipped";
  if (answer.responseText) return answer.responseText;
  if (answer.numericResponse !== null) return String(answer.numericResponse);
  if (answer.selectedOptions.length) return answer.selectedOptions.join(", ");
  return question?.responseType === "multi_select" || question?.responseType === "single_choice" ? "No option selected" : "No answer supplied";
}

export function isAnswerAttempted(answer: PastPaperAnswer) {
  if (answer.skipped) return false;
  if (answer.responseText?.trim()) return true;
  if (answer.numericResponse !== null) return true;
  return answer.selectedOptions.length > 0;
}

export function acceptedMarks(attempt: PastPaperAttempt, questionId?: string) {
  return attempt.marks.filter((mark) => mark.accepted && (!questionId || mark.questionId === questionId));
}

export function questionSupportIssue(question: PastPaperQuestion) {
  if (!question.responseType) return null;
  const originalContent = question.originalContent ?? {};
  const source = [
    question.promptText,
    question.originalFormat,
    question.convertedFormat ?? "",
    question.evidenceSnippet ?? "",
    question.extractionWarnings?.join(" ") ?? "",
    typeof originalContent.unsupportedReason === "string" ? originalContent.unsupportedReason : "",
  ].join(" ");
  const responseTypeSupported = ["long_text", "short_text", "numeric", "single_choice", "multi_select"].includes(question.responseType);
  const simpleChoiceMissingOptions = (question.responseType === "single_choice" || question.responseType === "multi_select") && !question.options.length;
  const unsupported =
    !responseTypeSupported ||
    UNSUPPORTED_FORMAT_PATTERN.test(source) ||
    Boolean(originalContent.unsupportedQuestionFormat) ||
    (simpleChoiceMissingOptions && /\b(?:tick|select|choose)\b/i.test(source));

  if (!unsupported) return null;
  const reported = typeof originalContent.unsupportedReportedAt === "string";
  const reason =
    typeof originalContent.unsupportedReason === "string"
      ? originalContent.unsupportedReason
      : UNSUPPORTED_FORMAT_PATTERN.test(source)
        ? "This looks like a table, grid, matrix, or row-by-row checkbox question. The current answer UI only supports simple choices, written answers, and calculations."
        : simpleChoiceMissingOptions
          ? "This choice question did not extract into a simple option list."
          : "This question format is not currently supported by the answer UI.";
  return { unsupported: true, reason, reported };
}

export function unsupportedMarksForPaper(paper: PastPaper) {
  return paper.questions.reduce((sum, question) => sum + (questionSupportIssue(question) ? question.maxMarks : 0), 0);
}

export function isMarkingErrorMark(mark: Pick<PastPaperQuestionMark, "markSchemeReference"> | null | undefined) {
  if (!mark || !mark.markSchemeReference || typeof mark.markSchemeReference !== "object") return false;
  return (mark.markSchemeReference as Record<string, unknown>).error === true;
}

export function supportedTotalMarksForPaper(paper: PastPaper) {
  const rawTotal = paper.totalMarks ?? paper.questions.reduce((sum, question) => sum + question.maxMarks, 0);
  const adjusted = Math.max(0, rawTotal - unsupportedMarksForPaper(paper));
  return adjusted || rawTotal;
}

export function formatPercent(score: number, total: number) {
  if (total <= 0) return "0.0%";
  return `${((score / total) * 100).toFixed(1)}%`;
}

export function computeAttemptScores(attempt: PastPaperAttempt, paper: PastPaper): PastPaperAttempt {
  const accepted = acceptedMarks(attempt);
  const actualScore = accepted.reduce((sum, mark) => sum + mark.awardedMarks, 0);
  const totalMarks = supportedTotalMarksForPaper(paper);
  const confidencePredictedMarks = attempt.answers.reduce((sum, answer) => {
    if (!answer.skippedWithConfidence) return sum;
    return sum + (answer.confidencePredictedMarks ?? 0);
  }, 0);

  return {
    ...attempt,
    actualScore,
    totalMarks,
    confidenceAdjustedScore: actualScore + confidencePredictedMarks,
  };
}

export function bestScoreForPaper(data: AppData, paperId: string) {
  const attempts = data.attempts.filter((attempt) => attempt.paperId === paperId && attempt.status === "marked");
  if (!attempts.length) return null;
  return Math.max(...attempts.map((attempt) => attempt.actualScore));
}

export function buildProcessingJob(paperId: string): PastPaperProcessingJob {
  const createdAt = nowIso();
  return {
    id: createId("job"),
    paperId,
    attemptId: null,
    remarkId: null,
    kind: "processing",
    status: "queued",
    progressPercent: 0,
    currentStage: "uploading",
    errorMessage: null,
    diagnostics: null,
    createdAt,
    updatedAt: createdAt,
  };
}

function cloneDiagnostics(diagnostics: ProcessingDiagnostics): ProcessingDiagnostics {
  return JSON.parse(JSON.stringify(diagnostics)) as ProcessingDiagnostics;
}

function splitLegacyTextPages(text: string): PagePromptContext[] {
  const matches = [...text.matchAll(/(?:^|\n)\s*Page\s+(\d+)\s*\n/g)];
  if (matches.length < 2) return [];

  return matches
    .map((match, index) => {
      const pageNumber = Number(match[1]);
      const start = (match.index ?? 0) + match[0].length;
      const end = index + 1 < matches.length ? matches[index + 1].index ?? text.length : text.length;
      const pageText = text.slice(start, end).trim();
      return {
        pageNumber,
        text: pageText,
        charCount: pageText.length,
        hasScreenshot: false,
      };
    })
    .filter((page) => Number.isInteger(page.pageNumber) && page.pageNumber > 0);
}

function assetPageCount(asset: PastPaperAsset | undefined) {
  if (!asset) return 0;
  if (asset.pageCount) return asset.pageCount;
  if (asset.pageTexts?.length) return asset.pageTexts.length;
  const legacyPages = asset.textContent ? splitLegacyTextPages(asset.textContent) : [];
  if (legacyPages.length) return legacyPages.length;
  return asset.pageScreenshots?.length ?? 0;
}

function buildInitialDiagnostics(paper: PastPaper): ProcessingDiagnostics {
  const paperAsset = paper.assets.find((asset) => asset.kind === "paper");
  const markSchemeAsset = paper.assets.find((asset) => asset.kind === "mark_scheme");
  const now = nowIso();
  return {
    id: createId("diagnostics"),
    createdAt: now,
    updatedAt: now,
    currentStage: "uploading",
    lastSuccessfulStage: null,
    stageTimings: [],
    logs: [],
    paperPageCount: assetPageCount(paperAsset),
    markSchemePageCount: assetPageCount(markSchemeAsset),
    pageTextStats: paper.assets.flatMap((asset) => (asset.pageTexts ?? []).map((page) => ({ assetKind: asset.kind, pageNumber: page.pageNumber, charCount: page.charCount }))),
    screenshotStats: paper.assets.flatMap((asset) =>
      (asset.pageScreenshots ?? []).map((screenshot) => ({
        assetKind: asset.kind,
        pageNumber: screenshot.pageNumber,
        width: screenshot.width,
        height: screenshot.height,
        byteSize: screenshot.byteSize,
        thumbnailByteSize: screenshot.thumbnailByteSize,
        mimeType: screenshot.mimeType,
      })),
    ),
    promptStats: [],
    aiRequests: [],
    schemaErrors: [],
    integrityFailures: [],
    smokeTests: [],
  };
}

function makeProgressReporter(onProgress: (update: ProcessingProgressUpdate) => void, diagnostics: ProcessingDiagnostics) {
  let currentPercent = 0;

  function emit(stage: ProcessingStage, percent = currentPercent) {
    currentPercent = percent;
    diagnostics.updatedAt = nowIso();
    onProgress({ stage, percent, diagnostics: cloneDiagnostics(diagnostics) });
  }

  function log(stage: ProcessingStage, level: "info" | "warn" | "error", message: string, metadata?: Record<string, unknown>) {
    diagnostics.logs.push({ at: nowIso(), stage, level, message, metadata });
    const consoleMethod = level === "error" ? console.error : level === "warn" ? console.warn : console.info;
    consoleMethod("[Past Paper Worker]", stage, message, metadata ?? {});
    emit(stage);
  }

  function enterStage(stage: ProcessingStage, percent: number, message: string, metadata?: Record<string, unknown>) {
    const now = nowIso();
    const active = diagnostics.stageTimings.find((timing) => timing.stage === diagnostics.currentStage && timing.endedAt === null);
    if (active) {
      active.endedAt = now;
      active.elapsedMs = new Date(now).getTime() - new Date(active.startedAt).getTime();
      diagnostics.lastSuccessfulStage = active.stage;
    }
    diagnostics.currentStage = stage;
    diagnostics.stageTimings.push({ stage, startedAt: now, endedAt: null, elapsedMs: null });
    currentPercent = percent;
    log(stage, "info", message, metadata);
  }

  function completeStage(stage: ProcessingStage) {
    const now = nowIso();
    const active = [...diagnostics.stageTimings].reverse().find((timing) => timing.stage === stage && timing.endedAt === null);
    if (active) {
      active.endedAt = now;
      active.elapsedMs = new Date(now).getTime() - new Date(active.startedAt).getTime();
    }
    diagnostics.lastSuccessfulStage = stage;
    emit(stage);
  }

  function addPrompt(label: string, prompt: string, model: string, pageNumbers?: number[], imageCount?: number) {
    diagnostics.promptStats.push({ label, charCount: prompt.length, pageNumbers, imageCount, model });
    log(diagnostics.currentStage, "info", `${label} prompt prepared`, { promptChars: prompt.length, pageNumbers, imageCount, model });
  }

  function addAIRequest(request: AIRequestDiagnostic) {
    const existingIndex = diagnostics.aiRequests.findIndex((item) => item.id === request.id);
    if (existingIndex >= 0) diagnostics.aiRequests[existingIndex] = request;
    else diagnostics.aiRequests.push(request);
    emit(diagnostics.currentStage);
  }

  function addSchemaError(error: { label: string; paths: string[]; issues: string[]; rawPreview: string; extractedJsonPreview: string }) {
    diagnostics.schemaErrors.push(error);
    log(diagnostics.currentStage, "error", `${error.label} schema validation failed`, { paths: error.paths, issues: error.issues });
  }

  return { emit, log, enterStage, completeStage, addPrompt, addAIRequest, addSchemaError };
}

export function pageContextsForAsset(asset: PastPaperAsset | undefined): PagePromptContext[] {
  if (!asset) return [];
  const screenshots = new Set((asset.pageScreenshots ?? []).map((screenshot) => screenshot.pageNumber));
  if (asset.pageTexts?.length) {
    return asset.pageTexts.map((page) => ({
      pageNumber: page.pageNumber,
      text: page.text,
      charCount: page.charCount,
      hasScreenshot: screenshots.has(page.pageNumber),
    }));
  }
  if (asset.textContent) {
    const legacyPages = splitLegacyTextPages(asset.textContent).map((page) => ({
      ...page,
      hasScreenshot: screenshots.has(page.pageNumber),
    }));
    if (legacyPages.length) return legacyPages;
    return [{ pageNumber: 1, text: asset.textContent, charCount: asset.textContent.length, hasScreenshot: screenshots.has(1) }];
  }
  if (asset.pageScreenshots?.length) {
    return asset.pageScreenshots.map((screenshot) => ({ pageNumber: screenshot.pageNumber, text: "", charCount: 0, hasScreenshot: true }));
  }
  return [];
}

function syncDerivedPageTextDiagnostics(diagnostics: ProcessingDiagnostics, paper: PastPaper, paperPages: PagePromptContext[], markSchemePages: PagePromptContext[]) {
  const existing = new Set(diagnostics.pageTextStats.map((item) => `${item.assetKind}:${item.pageNumber}`));
  for (const page of paperPages) {
    const key = `paper:${page.pageNumber}`;
    if (!existing.has(key)) diagnostics.pageTextStats.push({ assetKind: "paper", pageNumber: page.pageNumber, charCount: page.charCount });
  }
  for (const page of markSchemePages) {
    const key = `mark_scheme:${page.pageNumber}`;
    if (!existing.has(key)) diagnostics.pageTextStats.push({ assetKind: "mark_scheme", pageNumber: page.pageNumber, charCount: page.charCount });
  }
  const paperAsset = paper.assets.find((asset) => asset.kind === "paper");
  const markSchemeAsset = paper.assets.find((asset) => asset.kind === "mark_scheme");
  diagnostics.paperPageCount = Math.max(diagnostics.paperPageCount, paperPages.length || assetPageCount(paperAsset));
  diagnostics.markSchemePageCount = Math.max(diagnostics.markSchemePageCount, markSchemePages.length || assetPageCount(markSchemeAsset));
}

function pagesForChunk(chunkPageNumbers: number[], paperPages: PagePromptContext[]) {
  const matched = paperPages.filter((page) => chunkPageNumbers.includes(page.pageNumber));
  if (matched.length) return { pages: matched, usedWholeDocumentFallback: false };
  const wholeDocument = paperPages.length === 1 && paperPages[0].charCount > 0 ? paperPages[0] : null;
  if (!wholeDocument) return { pages: [], usedWholeDocumentFallback: false };
  return {
    pages: [
      {
        ...wholeDocument,
        pageNumber: chunkPageNumbers[0] ?? wholeDocument.pageNumber,
      },
    ],
    usedWholeDocumentFallback: true,
  };
}

function screenshotForPage(asset: PastPaperAsset | undefined, pageNumber: number) {
  return asset?.pageScreenshots?.find((screenshot) => screenshot.pageNumber === pageNumber) ?? null;
}

function screenshotDataUrls(asset: PastPaperAsset | undefined, pageNumbers: number[], mode: "thumbnail" | "full") {
  return pageNumbers
    .map((pageNumber) => screenshotForPage(asset, pageNumber))
    .filter((screenshot): screenshot is PaperPageScreenshot => screenshot !== null)
    .map((screenshot) => (mode === "thumbnail" ? screenshot.thumbnailDataUrl : screenshot.dataUrl))
    .filter((dataUrl) => Boolean(dataUrl));
}

function hasMeaningfulText(pages: PagePromptContext[]) {
  return pages.reduce((sum, page) => sum + page.charCount, 0) >= 80;
}

function joinPromptParts(...parts: Array<string | null | undefined>) {
  const cleaned = parts
    .map((part) => part?.replace(/\s+/g, " ").trim() ?? "")
    .filter(Boolean);
  return cleaned.filter((part, index) => part.toLowerCase() !== cleaned[index - 1]?.toLowerCase()).join(" ").trim();
}

function cleanExamPageTextForParsing(text: string) {
  return text
    .replace(/^\s*\d+\s+Turn over\s+©\s+OCR\s+\d{4}\s*/i, "")
    .replace(/^\s*\d+\s+©\s+OCR\s+\d{4}\s*/i, "")
    .replace(/^\s*\d+\s*\*\s*\d+\s*\*\s*(?:Turn over\s*[►>]\s*)?IB\/[A-Z0-9/.-]+\s*/i, "")
    .replace(/^\s*Do not write outside the box\s*/i, "")
    .replace(/\bPMT\b/gi, " ")
    .replace(/\bEND OF QUESTION PAPER\b/gi, " ")
    .replace(/Oxford Cambridge and RSA Copyright Information[\s\S]*$/i, " ")
    .replace(/\.{5,}/g, " ")
    .replace(/\s*•\s*/g, " ; ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseVisiblePaperTotalMarks(coverText: string) {
  const match = coverText.match(/total marks?\s+(?:for this paper\s+)?(?:is|are)\s+(\d{1,3})/i) ?? coverText.match(/there are\s+(\d{1,3})\s+marks available/i);
  return match ? Number(match[1]) : null;
}

function parseVisiblePaperDurationMinutes(coverText: string) {
  const compact = coverText.replace(/\s+/g, " ").trim();
  const hourMinute = compact.match(/time allowed:\s*(\d+)\s*hour(?:s)?\s*(\d+)\s*minute(?:s)?/i);
  if (hourMinute) return Number(hourMinute[1]) * 60 + Number(hourMinute[2]);
  const minuteOnly = compact.match(/time allowed:\s*(\d+)\s*minute(?:s)?/i);
  return minuteOnly ? Number(minuteOnly[1]) : null;
}

function parseVisiblePaperCode(coverText: string) {
  const match = coverText.match(/\b([A-Z]\d{3}\/\d{2}|[A-Z0-9]{4,}\/[A-Z0-9]{1,3})\b/);
  return match?.[1] ?? null;
}

function parseVisiblePaperYear(coverText: string) {
  const match = coverText.match(/\b(20\d{2})\b/);
  return match ? Number(match[1]) : null;
}

function detectDeterministicPaperStyle(pages: PagePromptContext[]) {
  const combined = pages.map((page) => page.text).join(" ");
  const aqaDottedMatches = combined.match(/\b0\s*\d{1,2}\s*\.\s*\d{1,2}\b/g) ?? [];
  if (aqaDottedMatches.length >= 6) return "aqa_dotted" as const;
  if (/\bOCR\b/i.test(pages[0]?.text ?? "")) return "ocr_hierarchical" as const;
  const ocrPatternMatches = combined.match(/\([a-z]\)\s+[A-Z]/g) ?? [];
  if (ocrPatternMatches.length >= 5) return "ocr_hierarchical" as const;
  return null;
}

function normalizeDeterministicPromptText(text: string) {
  return cleanPromptText(
    text
      .replace(/\bPMT\b/gi, " ")
      .replace(/\bEND OF QUESTION PAPER\b/gi, " ")
      .replace(/\.{5,}/g, " ")
      .replace(/\s*;\s*/g, "; ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function inferDeterministicResponseType(promptText: string, maxMarks: number): PastPaperQuestion["responseType"] {
  const text = promptText.toLowerCase();
  if (/\btick\s*\(\s*3\s*\)\s*one or more boxes?\b|\bone or more boxes?\b/.test(text)) return "multi_select";
  if (/\btick\s*\(\s*3\s*\)\s*one box\b|\btick one box\b|\bchoose one\b|\bselect one\b/.test(text)) return "single_choice";
  if (/\bdiscuss\b|\bjustify\b|\bevaluate\b|\bcompare\b|\bdescribe\b|\bexplain\b/.test(text) || maxMarks >= 5) return "long_text";
  return "short_text";
}

function mainQuestionLabelFromQuestionNumber(questionNumber: string) {
  return questionNumber.match(/^\d+/)?.[0] ?? questionNumber.replace(/\*$/, "");
}

function buildDeterministicQuestion(
  questionNumber: string,
  promptText: string,
  maxMarks: number,
  pageReferences: number[],
): QuestionExtractionOutput["questions"][number] | null {
  const cleanedPrompt = normalizeDeterministicPromptText(promptText);
  if (!cleanedPrompt || maxMarks <= 0) return null;
  const unsupported = UNSUPPORTED_FORMAT_PATTERN.test(cleanedPrompt);
  const responseType = unsupported ? "long_text" : inferDeterministicResponseType(cleanedPrompt, maxMarks);
  let numberingPath = [...questionNumber.matchAll(/\d+|\([a-z]+\)|\([ivx]+\)|\d+\.\d+/gi)].map((match) => match[0]);
  if (questionNumber.includes(".") && /^\d+\.\d+$/.test(questionNumber)) {
    const [main, sub] = questionNumber.split(".");
    numberingPath = [main, sub];
  }
  if (!numberingPath.length) numberingPath = [questionNumber];
  return {
    questionNumber,
    parentQuestionNumber: numberingPath.length > 1 ? mainQuestionLabelFromQuestionNumber(questionNumber) : null,
    numberingPath,
    promptText: cleanedPrompt,
    maxMarks,
    responseType,
    originalFormat: unsupported ? "unsupported_table_or_grid" : "text",
    convertedFormat: null,
    originalContent: {
      evidenceSnippet: cleanedPrompt.slice(0, 240),
      confidence: 92,
      extractionWarnings: unsupported ? ["Recovered from readable paper text as an unsupported question format."] : [],
      ...(unsupported
        ? {
            unsupportedQuestionFormat: true,
            unsupportedReason:
              "This looks like a table, grid, matrix, or row-by-row checkbox question. The current answer UI only supports simple choices, written answers, and calculations.",
          }
        : {}),
    },
    convertedContent: {},
    options: [],
    pageReferences: [...new Set(pageReferences)].sort((a, b) => a - b),
    mediaRefs: [],
    markSchemeRef: null,
    markSchemeData: null,
  };
}

function isLikelyOcrMainQuestionStart(pageText: string, index: number) {
  const prefix = pageText.slice(Math.max(0, index - 40), index);
  return !prefix.trim() || /\]\s*$/.test(prefix) || /answer all the questions\.\s*$/i.test(prefix);
}

function extractOcrStyleQuestionsFromPages(pages: PagePromptContext[]) {
  const questions: QuestionExtractionOutput["questions"] = [];
  let currentMain: string | null = null;
  let currentLetter: string | null = null;
  let currentRoman: string | null = null;
  let activeLevel: "main" | "letter" | "roman" | null = null;
  let mainStem = "";
  let letterStem = "";
  let currentPrompt = "";
  let mainStemPages = new Set<number>();
  let letterStemPages = new Set<number>();
  let currentPromptPages = new Set<number>();

  const appendPrompt = (segment: string, pageNumber: number) => {
    const cleaned = segment.replace(/\s+/g, " ").trim();
    if (!cleaned) return;
    currentPrompt = joinPromptParts(currentPrompt, cleaned);
    currentPromptPages.add(pageNumber);
  };

  const absorbCurrentIntoMainStem = () => {
    if (!currentPrompt) return;
    mainStem = joinPromptParts(mainStem, currentPrompt);
    currentPromptPages.forEach((pageNumber) => mainStemPages.add(pageNumber));
    currentPrompt = "";
    currentPromptPages = new Set<number>();
  };

  const absorbCurrentIntoLetterStem = () => {
    if (!currentPrompt) return;
    letterStem = joinPromptParts(letterStem, currentPrompt);
    currentPromptPages.forEach((pageNumber) => letterStemPages.add(pageNumber));
    currentPrompt = "";
    currentPromptPages = new Set<number>();
  };

  const finalizeCurrentQuestion = (marks: number) => {
    if (!currentMain || !activeLevel) return;
    const questionNumber =
      activeLevel === "roman" && currentLetter && currentRoman
        ? `${currentMain}(${currentLetter})(${currentRoman})`
        : activeLevel === "letter" && currentLetter
          ? `${currentMain}(${currentLetter})`
          : currentMain;
    const promptText =
      activeLevel === "roman"
        ? joinPromptParts(mainStem, letterStem, currentPrompt)
        : activeLevel === "letter"
          ? joinPromptParts(mainStem, currentPrompt)
          : currentPrompt;
    const pageReferences = [
      ...(activeLevel === "roman" ? [...mainStemPages, ...letterStemPages] : activeLevel === "letter" ? [...mainStemPages] : []),
      ...currentPromptPages,
    ];
    const built = buildDeterministicQuestion(questionNumber, promptText, marks, pageReferences);
    if (built) questions.push(built);

    currentPrompt = "";
    currentPromptPages = new Set<number>();
    if (activeLevel === "roman") {
      currentRoman = null;
      activeLevel = "letter";
      return;
    }
    if (activeLevel === "letter") {
      currentLetter = null;
      currentRoman = null;
      letterStem = "";
      letterStemPages = new Set<number>();
      activeLevel = "main";
      return;
    }
    activeLevel = "main";
  };

  for (const page of pages) {
    const pageText = cleanExamPageTextForParsing(page.text);
    if (!pageText) continue;
    const tokenPattern = /\[\s*(\d{1,2})\s*(?:marks?)?\s*]|(?<![a-z])\(([ivx]+)\)(?![a-z])|(?<![a-z])\(([a-hj-z])\)(?![a-z])|\b(\d{1,2}\*?)(?=\s+[A-Z])/gi;
    let cursor = 0;

    for (const match of pageText.matchAll(tokenPattern)) {
      const index = match.index ?? 0;
      appendPrompt(pageText.slice(cursor, index), page.pageNumber);
      cursor = index + match[0].length;

      if (match[4]) {
        if (!isLikelyOcrMainQuestionStart(pageText, index)) continue;
        currentMain = match[4];
        currentLetter = null;
        currentRoman = null;
        activeLevel = "main";
        mainStem = "";
        letterStem = "";
        currentPrompt = "";
        mainStemPages = new Set<number>();
        letterStemPages = new Set<number>();
        currentPromptPages = new Set<number>();
        continue;
      }

      if (match[3]) {
        if (!currentMain) continue;
        if (activeLevel === "main") absorbCurrentIntoMainStem();
        currentLetter = match[3].toLowerCase();
        currentRoman = null;
        activeLevel = "letter";
        letterStem = "";
        letterStemPages = new Set<number>();
        currentPrompt = "";
        currentPromptPages = new Set<number>();
        continue;
      }

      if (match[2]) {
        if (!currentMain || !currentLetter) continue;
        if (activeLevel === "letter") absorbCurrentIntoLetterStem();
        currentRoman = match[2].toLowerCase();
        activeLevel = "roman";
        currentPrompt = "";
        currentPromptPages = new Set<number>();
        continue;
      }

      if (match[1]) finalizeCurrentQuestion(Number(match[1]));
    }

    appendPrompt(pageText.slice(cursor), page.pageNumber);
  }

  return questions;
}

function cleanAqaQuestionNumber(main: string, sub: string) {
  return `${Number(main)}.${Number(sub)}`;
}

function extractAqaDottedQuestionsFromPages(pages: PagePromptContext[]) {
  const questions: QuestionExtractionOutput["questions"] = [];
  let currentQuestionNumber: string | null = null;
  let currentPrompt = "";
  let currentPromptPages = new Set<number>();
  let pendingPrefix = "";
  let pendingPrefixPages = new Set<number>();
  let currentPrefix = "";
  const mainContexts = new Map<string, string>();

  const appendOutside = (segment: string, pageNumber: number) => {
    const cleaned = segment.replace(/\s+/g, " ").trim();
    if (!cleaned) return;
    pendingPrefix = joinPromptParts(pendingPrefix, cleaned);
    pendingPrefixPages.add(pageNumber);
  };

  const appendPrompt = (segment: string, pageNumber: number) => {
    const cleaned = segment.replace(/\s+/g, " ").trim();
    if (!cleaned) return;
    currentPrompt = joinPromptParts(currentPrompt, cleaned);
    currentPromptPages.add(pageNumber);
  };

  const finalizeCurrentQuestion = (marks: number) => {
    if (!currentQuestionNumber) return;
    const main = currentQuestionNumber.split(".")[0];
    const storedContext = mainContexts.get(main) ?? "";
    const promptText = joinPromptParts(storedContext, currentPrefix, currentPrompt);
    const pageReferences = [...new Set([...pendingPrefixPages, ...currentPromptPages])].sort((a, b) => a - b);
    const built = buildDeterministicQuestion(currentQuestionNumber, promptText, marks, pageReferences);
    if (built) questions.push(built);
    currentPrompt = "";
    currentPromptPages = new Set<number>();
    currentPrefix = "";
    pendingPrefix = "";
    pendingPrefixPages = new Set<number>();
  };

  for (const page of pages) {
    const pageText = cleanExamPageTextForParsing(page.text);
    if (!pageText) continue;
    const tokenPattern = /(?:0\s*)?(\d{1,2})\s*\.\s*(\d{1,2})|\[\s*(\d{1,2})\s*(?:marks?)?\s*]/gi;
    let cursor = 0;

    for (const match of pageText.matchAll(tokenPattern)) {
      const index = match.index ?? 0;
      const segment = pageText.slice(cursor, index);
      if (currentQuestionNumber) appendPrompt(segment, page.pageNumber);
      else appendOutside(segment, page.pageNumber);
      cursor = index + match[0].length;

      if (match[1] && match[2]) {
        const nextQuestionNumber = cleanAqaQuestionNumber(match[1], match[2]);
        const main = nextQuestionNumber.split(".")[0];
        const prefix = normalizeDeterministicPromptText(pendingPrefix);
        if (prefix && !mainContexts.has(main) && /(?:this question is about|figure\s+\d+\s+shows|the diagram|the graph)/i.test(prefix)) {
          mainContexts.set(main, prefix);
        }
        currentQuestionNumber = nextQuestionNumber;
        currentPrefix = prefix;
        currentPrompt = "";
        currentPromptPages = new Set<number>();
        continue;
      }

      if (match[3]) finalizeCurrentQuestion(Number(match[3]));
    }

    const tail = pageText.slice(cursor);
    if (currentQuestionNumber) appendPrompt(tail, page.pageNumber);
    else appendOutside(tail, page.pageNumber);
  }

  return questions;
}

function extractDeterministicQuestionsFromPages(pages: PagePromptContext[]) {
  const style = detectDeterministicPaperStyle(pages);
  if (style === "aqa_dotted") return extractAqaDottedQuestionsFromPages(pages);
  if (style === "ocr_hierarchical") return extractOcrStyleQuestionsFromPages(pages);
  return [];
}

export function buildDeterministicProcessedPaperOutput(paper: PastPaper, paperPages: PagePromptContext[]): ProcessedPaperOutput | null {
  if (!hasMeaningfulText(paperPages)) return null;
  const questions = dedupeQuestions(extractDeterministicQuestionsFromPages(paperPages));
  if (!questions.length) return null;
  const coverText = paperPages[0]?.text ?? "";
  const sumMarks = questions.reduce((sum, question) => sum + question.maxMarks, 0);
  const output: ProcessedPaperOutput = {
    title: paper.title,
    year: parseVisiblePaperYear(coverText) ?? paper.year,
    series: paper.series,
    paperCode: parseVisiblePaperCode(coverText) ?? paper.paperCode,
    totalMarks: parseVisiblePaperTotalMarks(coverText) ?? paper.totalMarks ?? sumMarks,
    durationMinutes: parseVisiblePaperDurationMinutes(coverText) ?? paper.durationMinutes,
    questions,
  };
  const integrity = validateProcessedPaperIntegrity(output);
  return integrity.valid ? output : null;
}

function imageOnlyFailureMessage(stage: ProcessingStage) {
  return [
    `Image input failed while ${stage}.`,
    "Likely cause: scanned/image-only paper and the selected Gemini vision call failed or the page images were not usable.",
    "Recovery: run the Gemini smoke test, retry with a fallback model, or export diagnostics. The app will not invent questions from blank text.",
  ].join("\n");
}

function range(start: number, end: number) {
  const values: number[] = [];
  for (let value = start; value <= end; value += 1) values.push(value);
  return values;
}

function boundaryContext(boundary: QuestionBoundaryOutput["questions"][number]): QuestionBoundaryPromptContext {
  return {
    questionNumber: boundary.questionNumber,
    parentQuestionNumber: boundary.parentQuestionNumber,
    numberingPath: boundary.numberingPath.length ? boundary.numberingPath : [boundary.questionNumber],
    startPage: boundary.startPage,
    endPage: boundary.endPage,
    maxMarks: boundary.maxMarks,
    responseTypeHint: boundary.responseTypeHint,
    hasVisualContent: boundary.hasVisualContent,
  };
}

function chunkBoundaries(boundaries: QuestionBoundaryOutput["questions"], pages: PagePromptContext[]) {
  if (!boundaries.length) {
    const chunks: Array<{ boundaries: QuestionBoundaryPromptContext[]; pageNumbers: number[] }> = [];
    for (let index = 0; index < pages.length; index += MAX_EXTRACTION_PAGES_PER_CHUNK) {
      const pageNumbers = pages.slice(index, index + MAX_EXTRACTION_PAGES_PER_CHUNK).map((page) => page.pageNumber);
      chunks.push({ boundaries: [], pageNumbers });
    }
    return chunks;
  }

  const sorted = [...boundaries].sort((a, b) => a.startPage - b.startPage || a.questionNumber.localeCompare(b.questionNumber, undefined, { numeric: true }));
  const chunks: Array<{ boundaries: QuestionBoundaryPromptContext[]; pageNumbers: number[] }> = [];
  let current: { boundaries: QuestionBoundaryPromptContext[]; pageNumbers: number[] } | null = null;

  for (const boundary of sorted) {
    const pageNumbers = range(boundary.startPage, boundary.endPage);
    if (
      current &&
      current.boundaries.length &&
      new Set([...current.pageNumbers, ...pageNumbers]).size > MAX_EXTRACTION_PAGES_PER_CHUNK &&
      pageNumbers.length <= MAX_EXTRACTION_PAGES_PER_CHUNK
    ) {
      chunks.push(current);
      current = null;
    }

    if (!current) current = { boundaries: [], pageNumbers: [] };
    current.boundaries.push(boundaryContext(boundary));
    current.pageNumbers = [...new Set([...current.pageNumbers, ...pageNumbers])].sort((a, b) => a - b);
  }

  if (current) chunks.push(current);
  return chunks;
}

function processingFailureMessage(stage: ProcessingStage, error: unknown) {
  if (error instanceof AIProviderError && error.diagnostic?.mediaCount && error.diagnostic.mediaCount > 0) {
    return imageOnlyFailureMessage(stage);
  }
  if (error instanceof AIProviderError && error.timedOut) {
    return [
      `Gemini timed out while ${stage}.`,
      "Likely cause: large prompt, missing page images, unsupported image call shape, or a slow model.",
      "Suggested recovery: retry with chunked processing or switch to the fallback model. A diagnostic export is available from the processing panel.",
    ].join("\n");
  }
  return error instanceof Error ? error.message : "Processing failed";
}

async function structuredJsonWithTextFallback<S extends z.ZodTypeAny>(input: {
  prompt: string;
  schema: S;
  hasReadableText: boolean;
  label: string;
  stage: ProcessingStage;
  reporter: ReturnType<typeof makeProgressReporter>;
  options: Parameters<typeof aiStructuredJson<S>>[2];
}) {
  try {
    return await aiStructuredJson(input.prompt, input.schema, input.options);
  } catch (error) {
    const mediaCount = input.options?.media?.length ?? 0;
    if (!(error instanceof AIProviderError) && mediaCount > 0 && !input.hasReadableText) {
      throw new AIProviderError(error instanceof Error ? error.message : String(error), {
        diagnostic: {
          id: createId("ai-request"),
          label: input.label,
          operation: input.options.operation,
          model: input.options.model ?? DEFAULT_AI_MODEL,
          fallbackFromModel: null,
          promptChars: input.prompt.length,
          mediaCount,
          mediaBytes: input.options.media?.reduce((sum, item) => sum + item.length, 0) ?? 0,
          startedAt: nowIso(),
          endedAt: nowIso(),
          elapsedMs: 0,
          retryCount: 0,
          status: "error",
          rawResponsePreview: null,
          rawError: error instanceof Error ? error.message : String(error),
        },
        rawError: error,
      });
    }
    if (!(error instanceof AIProviderError) || mediaCount === 0 || !input.hasReadableText) throw error;
    input.reporter.log(input.stage, "warn", `${input.label} image call failed; retrying with text-only source content`, {
      imageCount: mediaCount,
      reason: error.message,
    });
    return aiStructuredJson(input.prompt, input.schema, {
      ...input.options,
      media: [],
      requestLabel: `${input.label} text-only retry`,
    });
  }
}

function questionNumberKey(question: Pick<ProcessedPaperOutput["questions"][number], "questionNumber" | "numberingPath">) {
  const path = question.numberingPath.length ? question.numberingPath.join("/") : question.questionNumber;
  return path.trim().toLowerCase();
}

function isSubpartPath(path: string[]) {
  return path.length > 1 || path.some((part) => /[()[\].]/.test(part));
}

function promptTextForRepair(question: Pick<ProcessedPaperOutput["questions"][number], "promptText" | "evidenceSnippet" | "originalContent">) {
  const prompt = question.promptText.trim();
  if (prompt) return prompt;
  const directEvidence = typeof question.evidenceSnippet === "string" ? question.evidenceSnippet.trim() : "";
  if (directEvidence) return directEvidence;
  const originalEvidence =
    question.originalContent && typeof question.originalContent === "object" && !Array.isArray(question.originalContent) && typeof question.originalContent.evidenceSnippet === "string"
      ? question.originalContent.evidenceSnippet.trim()
      : "";
  return originalEvidence;
}

export function validateProcessedPaperIntegrity(output: ProcessedPaperOutput, input?: { intentionallyPartial?: boolean }) {
  const failures: string[] = [];
  const seenNumbers = new Map<string, Set<string>>();

  if (!output.questions.length) failures.push("No questions were extracted.");

  for (const [index, question] of output.questions.entries()) {
    const label = `questions.${index}`;
    const promptText = question.promptText.trim();
    const questionNumber = question.questionNumber.trim();
    const pathKey = questionNumberKey(question);

    if (!questionNumber) failures.push(`${label}.questionNumber is empty.`);
    if (!promptText) failures.push(`${label}.promptText is empty.`);
    if (NEUTRAL_PLACEHOLDER_PATTERN.test(promptText) || NEUTRAL_PLACEHOLDER_PATTERN.test(questionNumber)) {
      failures.push(`${label} copied a schema placeholder instead of visible paper content.`);
    }
    if (COPIED_SEMANTIC_EXAMPLE_PATTERN.test(promptText)) {
      failures.push(`${label} appears to contain copied prompt-example content.`);
    }
    if (question.maxMarks <= 0) failures.push(`${label}.maxMarks must be greater than 0 unless the source visibly shows a zero-mark item.`);
    if (!question.pageReferences.length) failures.push(`${label}.pageReferences is empty.`);

    const numberKey = questionNumber.toLowerCase();
    const existingPaths = seenNumbers.get(numberKey) ?? new Set<string>();
    if (existingPaths.size && !existingPaths.has(pathKey) && !isSubpartPath(question.numberingPath)) {
      failures.push(`${label}.questionNumber duplicates ${question.questionNumber} without a unique subpart numbering path.`);
    }
    if (existingPaths.has(pathKey)) {
      failures.push(`${label}.questionNumber duplicates an existing numbering path.`);
    }
    existingPaths.add(pathKey);
    seenNumbers.set(numberKey, existingPaths);
  }

  const extractedMarks = output.questions.reduce((sum, question) => sum + question.maxMarks, 0);
  if (!input?.intentionallyPartial && output.totalMarks !== null && output.totalMarks > 0) {
    if (extractedMarks < output.totalMarks * 0.5) {
      failures.push(`Extracted question marks (${extractedMarks}) are less than 50% of total marks (${output.totalMarks}).`);
    } else if (extractedMarks !== output.totalMarks) {
      failures.push(`Extracted question marks (${extractedMarks}) do not match the paper total (${output.totalMarks}).`);
    }
  }

  return { valid: failures.length === 0, failures };
}

function mergeUniqueNumbers(...items: Array<number[] | undefined>) {
  return [...new Set(items.flatMap((item) => item ?? []))].sort((a, b) => a - b);
}

function mergeUniqueOptions(...items: Array<string[] | undefined>) {
  return uniqueOptions(items.flatMap((item) => item ?? []));
}

function mergeMediaRefs(...items: Array<ProcessedPaperOutput["questions"][number]["mediaRefs"] | undefined>) {
  const seen = new Set<string>();
  return items.flatMap((item) => item ?? []).filter((item) => {
    const key = item.id || `${item.kind}:${item.label}:${item.pageNumber ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mergeExtractionWarnings(...items: Array<string[] | undefined>) {
  return uniqueOptions(items.flatMap((item) => item ?? []));
}

function repairExtractedQuestionArtifacts(questions: QuestionExtractionOutput["questions"]) {
  const usedParents = new Set<number>();
  const repaired = questions.map((question, index) => {
    const promptText = question.promptText.trim();
    if (promptText) {
      return promptText === question.promptText ? question : { ...question, promptText };
    }

    const parentIndex = questions.findIndex((candidate, candidateIndex) => {
      if (candidateIndex >= index || !candidate.promptText.trim()) return false;
      const parentToken = question.parentQuestionNumber ? normalizeQuestionToken(question.parentQuestionNumber) : "";
      const parentPathToken = question.numberingPath.length > 1 ? normalizeQuestionToken(question.numberingPath[0]) : "";
      const candidateToken = normalizeQuestionToken(candidate.questionNumber);
      return Boolean(candidateToken && (candidateToken === parentToken || candidateToken === parentPathToken));
    });

    if (parentIndex < 0) return question;

    const parent = questions[parentIndex];
    const parentPrompt = promptTextForRepair(parent);
    usedParents.add(parentIndex);
    return {
      ...question,
      promptText: parentPrompt,
      responseType: question.responseType === "long_text" && parent.responseType !== "long_text" ? parent.responseType : question.responseType,
      originalFormat: question.originalFormat || parent.originalFormat,
      convertedFormat: question.convertedFormat ?? parent.convertedFormat,
      originalContent: {
        ...parent.originalContent,
        ...question.originalContent,
        repairedFromParentQuestionNumber: parent.questionNumber,
      },
      convertedContent: {
        ...parent.convertedContent,
        ...question.convertedContent,
      },
      options: mergeUniqueOptions(question.options, parent.options),
      pageReferences: mergeUniqueNumbers(question.pageReferences, parent.pageReferences),
      mediaRefs: mergeMediaRefs(question.mediaRefs, parent.mediaRefs),
      evidenceSnippet: question.evidenceSnippet ?? parent.evidenceSnippet ?? parentPrompt,
      imagePageReferences: mergeUniqueNumbers(question.imagePageReferences, parent.imagePageReferences),
      confidence: question.confidence ?? parent.confidence,
      extractionWarnings: mergeExtractionWarnings(question.extractionWarnings, parent.extractionWarnings, ["Recovered prompt text from the visible parent question heading."]),
    };
  });

  return repaired.filter((question, index) => {
    if (!usedParents.has(index)) return true;
    const parent = questions[index];
    return !questions.some((candidate, candidateIndex) => candidateIndex > index && candidate.promptText.trim() === "" && candidate.parentQuestionNumber && normalizeQuestionToken(candidate.parentQuestionNumber) === normalizeQuestionToken(parent.questionNumber));
  });
}

function cleanPromptText(promptText: string) {
  return promptText
    .replace(/\s*(?:[[(]\s*\d+\s*(?:marks?)?\s*[\])]|\[\s*\d+\s*])/gi, "")
    .replace(/^\s*(?:question\s*)?\d+\s*(?:[.)/-]\s*)?/i, "")
    .replace(/^\s*(?:\([a-z]\)|[a-z][.)])\s*/i, "")
    .replace(/^\s*(?:\([ivx]+\)|[ivx]+[.)])\s*/i, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([?.!,;:])/g, "$1")
    .trim();
}

function uniqueOptions(options: string[]) {
  const seen = new Set<string>();
  return options
    .map((option) => option.replace(/\s+/g, " ").trim())
    .filter((option) => {
      const key = option.toLowerCase();
      if (!option || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function extractEmbeddedChoiceOptions(promptText: string) {
  const cleaned = cleanPromptText(promptText);
  const tickSplit = cleaned.split(/\bTick\s+one\s+box\.?/i);
  const tail = tickSplit[1]?.trim() ?? "";
  if (!tail) return { promptText: cleaned, options: [] };

  const letterRun = tail.match(/^((?:[A-H]\s*){2,})$/i);
  if (letterRun) {
    return { promptText: `${tickSplit[0].trim()} Tick one box.`, options: tail.split(/\s+/).filter(Boolean) };
  }

  const labelled = [...tail.matchAll(/\b([A-H])[\s).:-]+([^A-H]+?)(?=\s+[A-H][\s).:-]+|$)/gi)].map((match) => `${match[1].toUpperCase()} ${match[2].trim()}`);
  if (labelled.length >= 2) return { promptText: `${tickSplit[0].trim()} Tick one box.`, options: labelled };

  const shortWords = tail.split(/\s+/).filter(Boolean);
  if (shortWords.length >= 2 && shortWords.length <= 8 && shortWords.every((word) => word.length <= 28)) {
    return { promptText: `${tickSplit[0].trim()} Tick one box.`, options: shortWords };
  }

  return { promptText: cleaned, options: [] };
}

function reinterpretQuestionFormat(promptText: string, responseType: PastPaperQuestion["responseType"], options: string[]) {
  const extracted = responseType === "single_choice" || responseType === "multi_select" ? extractEmbeddedChoiceOptions(promptText) : { promptText: cleanPromptText(promptText), options: [] };
  return {
    promptText: extracted.promptText,
    options: uniqueOptions(options.length ? options : extracted.options),
  };
}

export function mapProcessedOutput(paper: PastPaper, output: ProcessedPaperOutput, diagnostics?: ProcessingDiagnostics): PastPaper {
  const integrity = validateProcessedPaperIntegrity(output);
  if (!integrity.valid) {
    if (diagnostics) diagnostics.integrityFailures = integrity.failures;
    throw new Error([QUESTION_EXTRACTION_FAILURE, ...integrity.failures.map((failure) => `- ${failure}`)].join("\n"));
  }

  const updatedAt = nowIso();
  const questions = output.questions.map<PastPaperQuestion>((question, index) => {
    const interpreted = reinterpretQuestionFormat(promptTextForRepair(question), question.responseType, question.options);
    return {
    id: createId("question"),
    paperId: paper.id,
    questionNumber: question.questionNumber,
    parentQuestionNumber: question.parentQuestionNumber,
    numberingPath: question.numberingPath,
    promptText: interpreted.promptText,
    maxMarks: question.maxMarks,
    responseType: question.responseType,
    originalFormat: question.originalFormat,
    convertedFormat: question.convertedFormat,
    originalContent: question.originalContent,
    convertedContent: question.convertedContent,
    diagramMediaRefs: question.mediaRefs,
    options: interpreted.options,
    pageReferences: question.pageReferences,
    evidenceSnippet: question.evidenceSnippet ?? (typeof question.originalContent.evidenceSnippet === "string" ? question.originalContent.evidenceSnippet : null),
    imagePageReferences: question.imagePageReferences ?? [],
    confidence: question.confidence ?? null,
    extractionWarnings: question.extractionWarnings ?? [],
    markSchemeRef: question.markSchemeRef,
    markSchemeData: question.markSchemeData,
    displayOrder: index,
    };
  });

  return {
    ...paper,
    title: output.title || paper.title,
    year: output.year ?? paper.year,
    series: output.series ?? paper.series,
    paperCode: output.paperCode ?? paper.paperCode,
    totalMarks: output.totalMarks ?? questions.reduce((sum, question) => sum + question.maxMarks, 0),
    durationMinutes: output.durationMinutes ?? paper.durationMinutes,
    processingStatus: "ready",
    processingError: null,
    processingDiagnostics: diagnostics ?? paper.processingDiagnostics ?? null,
    questions,
    updatedAt,
  };
}

function dedupeQuestions(questions: QuestionExtractionOutput["questions"]) {
  const seen = new Set<string>();
  const deduped: QuestionExtractionOutput["questions"] = [];
  for (const question of questions) {
    const key = questionNumberKey(question);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(question);
  }
  return deduped;
}

function normalizeSequentialSimpleQuestionNumbers(questions: QuestionExtractionOutput["questions"]) {
  let previousSimpleNumber = 0;
  let hasReset = false;
  for (const question of questions) {
    const simple = question.questionNumber.trim().match(/^\d+$/);
    if (!simple || question.numberingPath.length > 1) continue;
    const number = Number(simple[0]);
    if (previousSimpleNumber > 0 && number < previousSimpleNumber) hasReset = true;
    previousSimpleNumber = number;
  }
  if (!hasReset) return questions;

  let mainQuestion = 1;
  previousSimpleNumber = 0;
  return questions.map((question) => {
    const simple = question.questionNumber.trim().match(/^\d+$/);
    if (!simple || question.numberingPath.length > 1) return question;
    const number = Number(simple[0]);
    if (previousSimpleNumber > 0 && number < previousSimpleNumber) mainQuestion += 1;
    previousSimpleNumber = number;
    const main = String(mainQuestion);
    const sub = String(number);
    return {
      ...question,
      questionNumber: `${main}.${sub}`,
      parentQuestionNumber: main,
      numberingPath: [main, sub],
    };
  });
}

function applyMarkSchemeAlignment(output: ProcessedPaperOutput, alignment: MarkSchemeAlignmentOutput): ProcessedPaperOutput {
  const alignments = new Map(alignment.alignments.map((item) => [normalizeQuestionToken(item.questionNumber), item]));
  return {
    ...output,
    questions: output.questions.map((question) => {
      const match = questionNumberVariants(question).map((variant) => alignments.get(normalizeQuestionToken(variant))).find(Boolean);
      if (!match) return question;
      const alignedMaxMarks = markSchemeMaxMarks(match.markSchemeData);
      return {
        ...question,
        markSchemeRef: match.markSchemeRef,
        markSchemeData: match.markSchemeData,
        maxMarks: question.maxMarks > 0 ? question.maxMarks : alignedMaxMarks ?? question.maxMarks,
      };
    }),
  };
}

function markSchemeMaxMarks(markSchemeData: Record<string, unknown> | null) {
  if (!markSchemeData) return null;
  const direct = typeof markSchemeData.maxMarks === "number" && Number.isFinite(markSchemeData.maxMarks) ? Math.round(markSchemeData.maxMarks) : null;
  if (direct && direct > 0 && direct <= 30) return direct;
  const rows = Array.isArray(markSchemeData.rows) ? markSchemeData.rows : [];
  const rowMarks = rows.reduce((sum, row) => {
    if (typeof row !== "object" || row === null) return sum;
    const marks = (row as Record<string, unknown>).marks;
    return sum + (typeof marks === "number" && Number.isFinite(marks) ? Math.max(0, Math.round(marks)) : 0);
  }, 0);
  return rowMarks > 0 && rowMarks <= 30 ? rowMarks : null;
}

function normalizeQuestionToken(value: string) {
  return value
    .toLowerCase()
    .replace(/©|Â©/g, "c")
    .replace(/question/g, "")
    .replace(/[()[\]\s]+/g, "")
    .replace(/[^a-z0-9.]/g, "");
}

function normalizeDisplayQuestionNumber(value: string) {
  return value
    .replace(/©|Â©/g, "(c)")
    .replace(/[–—â€“â€”]/g, "-")
    .replace(/\s+/g, "")
    .replace(/^question/i, "")
    .replace(/^(\d+)([a-z])$/i, "$1($2)")
    .replace(/^(\d+)\(([a-z])\)([ivx]+)$/i, "$1($2)($3)")
    .replace(/^(\d+)([a-z])([ivx]+)$/i, "$1($2)($3)");
}

function questionNumberVariants(question: Pick<ProcessedPaperOutput["questions"][number], "questionNumber"> & Partial<Pick<ProcessedPaperOutput["questions"][number], "numberingPath">>) {
  const numberingPath = Array.isArray(question.numberingPath) ? question.numberingPath : [];
  const rawValues = [question.questionNumber, numberingPath.join("."), numberingPath.join("")].filter(Boolean);
  const variants = new Set<string>();
  for (const raw of rawValues) {
    const compact = normalizeQuestionToken(raw);
    if (!compact) continue;
    variants.add(compact);
    const firstNumber = compact.match(/^\d+/)?.[0];
    if (firstNumber) {
      const padded = firstNumber.padStart(2, "0");
      variants.add(`${padded}${compact.slice(firstNumber.length)}`);
      variants.add(`${Number(firstNumber)}${compact.slice(firstNumber.length)}`);
    }
  }
  return [...variants].filter(Boolean).sort((a, b) => b.length - a.length);
}

function markSchemeRegexForVariant(variant: string) {
  const firstNumber = variant.match(/^\d+/)?.[0];
  const tail = variant.slice(firstNumber?.length ?? 0);
  if (!firstNumber) return null;
  const numberPattern = firstNumber.length > 1 && firstNumber.startsWith("0") ? `0?${Number(firstNumber)}` : `0?${firstNumber}`;
  const tailPattern = tail
    ? tail
        .split("")
        .map((char) => (/[a-z0-9]/i.test(char) ? `\\s*\\(?${char}\\)?` : "\\s*(?:[.)/-]|\\s)?\\s*"))
        .join("")
    : "";
  return new RegExp(`(?:^|[^a-z0-9])(?:question\\s*)?${numberPattern}${tailPattern}(?=\\s|[.)-]|$)`, "i");
}

type DeterministicMarkSchemeSection = {
  label: string;
  ref: string;
  text: string;
  pageNumbers: number[];
};

const MARK_SCHEME_CONTENT_SIGNAL_PATTERN =
  /\b(?:mark\b|marks\b|guidance\b|correct answer only|e\.g\.|mark band|level\s+\d|ao\d?|allow\b|accept\b|ignore\b|do not\b|indicative content)\b/i;
const MARK_SCHEME_FRONT_MATTER_PATTERN =
  /\b(?:make sure that you have read and understood the mark scheme|if you are in any doubt about applying the mark scheme|need to get in touch|customer support centre)\b/i;
const MARK_SCHEME_HEADER_PATTERN =
  /\b(?:Question\s+Answer(?:s)?(?:\s+Extra information)?\s+Mark(?:\s+Guidance)?(?:\s+AO\s*\/\s*Spec\.\s*Ref\.)?)\b/i;

function markSchemeContentPages(pages: PagePromptContext[]) {
  const firstContentIndex = pages.findIndex((page) => MARK_SCHEME_HEADER_PATTERN.test(page.text));
  return firstContentIndex >= 0 ? pages.slice(firstContentIndex) : pages;
}

function markSchemeTextWithMarkers(pages: PagePromptContext[]) {
  return pages.map((page) => `\n[[MSPAGE ${page.pageNumber}]]\n${page.text}`).join("\n");
}

function markSchemePageNumberAt(text: string, index: number) {
  const prefix = text.slice(0, index);
  const matches = [...prefix.matchAll(/\[\[MSPAGE\s+(\d+)]]/g)];
  const last = matches.at(-1);
  return last ? Number(last[1]) : 1;
}

function questionNumberVariantsFromLabel(label: string) {
  return questionNumberVariants({ questionNumber: label, numberingPath: [label] });
}

function preciseMarkSchemeRegexForLabel(label: string) {
  const normalized = normalizeDisplayQuestionNumber(label).replace(/\*/g, "");
  const roman = normalized.match(/^(\d+)\(([a-z])\)\(([ivx]+)\)$/i);
  if (roman) {
    const [, main, letter, numeral] = roman;
    return new RegExp(
      `(?:^|[^a-z0-9])0?${Number(main)}\\s*(?:\\(\\s*${letter}\\s*\\)|${letter})\\s*(?:\\(\\s*${numeral}\\s*\\)|${numeral})(?=\\s*(?:\\d|•|[A-Z]|$))`,
      "i",
    );
  }
  const letter = normalized.match(/^(\d+)\(([a-z])\)$/i);
  if (letter) {
    const [, main, subpart] = letter;
    return new RegExp(`(?:^|[^a-z0-9])0?${Number(main)}\\s*(?:\\(\\s*${subpart}\\s*\\)|${subpart})(?=\\s*(?:\\d|•|[A-Z]|$))`, "i");
  }
  const dotted = normalized.match(/^(\d+)\.(\d+)$/);
  if (dotted) {
    const [, main, subpart] = dotted;
    return new RegExp(`(?:^|[^a-z0-9])0?${Number(main)}\\s*[.)/]\\s*${subpart}(?=\\s*(?:\\d|•|[A-Z]|$))`, "i");
  }
  if (/^\d+\*?$/.test(normalized)) {
    return new RegExp(`(?:^|[^a-z0-9])0?${Number(normalized)}(?=\\s*(?:\\d|•|[A-Z]|$))`, "i");
  }
  return null;
}

function isLikelyMarkSchemeSectionStart(text: string, index: number, label: string) {
  const snippet = cleanMarkSchemeSectionText(text.slice(index, Math.min(text.length, index + 520)));
  if (!snippet) return false;
  if (MARK_SCHEME_FRONT_MATTER_PATTERN.test(snippet) && !MARK_SCHEME_CONTENT_SIGNAL_PATTERN.test(snippet)) return false;
  if (/[a-z)]/i.test(label) && /^\d+\s*[a-z]\s*\.\s*[a-z]/i.test(snippet)) return false;
  if (/^\d+\*?$/.test(label.trim()) && !MARK_SCHEME_CONTENT_SIGNAL_PATTERN.test(snippet)) return false;
  return true;
}

function findMarkSchemeStartAfter(text: string, label: string, fromIndex: number) {
  const preciseRegex = preciseMarkSchemeRegexForLabel(label);
  if (preciseRegex) {
    const flags = preciseRegex.flags.includes("g") ? preciseRegex.flags : `${preciseRegex.flags}g`;
    const regex = new RegExp(preciseRegex.source, flags);
    regex.lastIndex = Math.max(0, fromIndex);
    const match = regex.exec(text);
    if (match?.index !== undefined && isLikelyMarkSchemeSectionStart(text, match.index, label)) {
      return { index: match.index, variant: normalizeQuestionToken(label) };
    }
  }
  let best: { index: number; variant: string } | null = null;
  for (const variant of questionNumberVariantsFromLabel(label)) {
    const baseRegex = markSchemeRegexForVariant(variant);
    if (!baseRegex) continue;
    const flags = baseRegex.flags.includes("g") ? baseRegex.flags : `${baseRegex.flags}g`;
    const regex = new RegExp(baseRegex.source, flags);
    regex.lastIndex = Math.max(0, fromIndex);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text))) {
      const index = match.index ?? 0;
      if (!isLikelyMarkSchemeSectionStart(text, index, label)) continue;
      if (!best || index < best.index || (index === best.index && variant.length > best.variant.length)) {
        best = { index, variant };
      }
      break;
    }
  }
  return best;
}

function cleanMarkSchemeSectionText(text: string) {
  return text
    .replace(/\[\[MSPAGE\s+\d+]]/g, " ")
    .replace(/\b[A-Z]\d{3}\s*\/\s*\d{2}\s+Mark Scheme\s+June(?:\s+\d{4})?\b/gi, " ")
    .replace(/\bMARK SCHEME\s*[–-]\s*GCSE [A-Z ]+\s*[–-]\s*[^–-]+\s*[–-]\s*JUNE\s+\d{4}\b/gi, " ")
    .replace(/\bQuestion\s+Answer(?:s)?(?:\s+Extra information)?\s+Mark(?:\s+Guidance)?(?:\s+AO\s*\/\s*Spec\.\s*Ref\.)?\b/gi, " ")
    .replace(/\bPMT\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pageRange(start: number, end: number) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [start];
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function buildDeterministicMarkSchemeSections(labels: string[], markSchemePages: PagePromptContext[]) {
  const pages = markSchemeContentPages(markSchemePages);
  const combined = markSchemeTextWithMarkers(pages);
  if (!combined.trim()) return new Map<string, DeterministicMarkSchemeSection>();

  const starts: Array<{ label: string; index: number }> = [];
  let cursor = 0;
  for (const label of labels) {
    const match = findMarkSchemeStartAfter(combined, label, cursor);
    if (!match) continue;
    starts.push({ label, index: match.index });
    cursor = match.index + 1;
  }

  const sections = new Map<string, DeterministicMarkSchemeSection>();
  for (const [index, start] of starts.entries()) {
    const nextIndex = starts[index + 1]?.index ?? combined.length;
    const startPage = markSchemePageNumberAt(combined, start.index);
    const endPage = markSchemePageNumberAt(combined, Math.max(start.index, nextIndex - 1));
    const rawSection = combined.slice(start.index, nextIndex).trim();
    const text = cleanMarkSchemeSectionText(rawSection);
    if (!text) continue;
    sections.set(start.label, {
      label: start.label,
      ref: `Mark scheme pages ${pageRange(startPage, endPage).join(", ")}, ${start.label}`,
      text,
      pageNumbers: pageRange(startPage, endPage),
    });
  }

  return sections;
}

function cleanMarkSchemeClause(text: string) {
  return text
    .replace(/\b[A-Z]\d{3}\s*\/\s*\d{2}\s+Mark Scheme\s+June(?:\s+\d{4})?\b/gi, " ")
    .replace(/\bJUNE(?:\s+\d{4})?\b/gi, " ")
    .replace(/\bPMT\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[;,]$/, "");
}

function candidateExactAnswersFromMarkPoint(markPoint: string) {
  const cleaned = cleanMarkSchemeClause(markPoint)
    .replace(/^\d+\s*\([a-zivx]+\)\s*/i, "")
    .replace(/\b\d+\s*mark(?:s)?\s+for\s+/i, "")
    .replace(/\bCorrect answer only\b/gi, "")
    .trim();

  const exactTokenMatch = cleaned.match(/^(?:answer\s+)?([A-F]*\d+[A-F0-9]*)\b/i);
  if (exactTokenMatch?.[1]) return [exactTokenMatch[1]];

  const pureNumberMatch = cleaned.match(/^(\d+)\b/);
  if (pureNumberMatch?.[1]) return [pureNumberMatch[1]];

  return cleaned
    .split(/\s*\/\/\s*|\s+\bor\b\s+/i)
    .map((part) => cleanMarkSchemeClause(part))
    .map((part) => part.replace(/\bCorrect answer only\b/gi, "").trim())
    .filter(Boolean)
    .filter((part) => /\d/.test(part))
    .filter((part) => !/\b(?:mark|accept|award|ignore|guidance|read whole answer|question is|the question is)\b/i.test(part))
    .filter((part) => part.length <= 32);
}

function normalizeExactAnswerValue(value: string) {
  return value.toLowerCase().replace(/\s+/g, "").replace(/[.,;:()[\]{}]/g, "");
}

function extractFinalCandidateAnswer(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  const explicitFinal = normalized.match(/(?:final\s+answer|answer)\s*(?:is|=)\s*([A-F]*\d+[A-F0-9]*)/i);
  if (explicitFinal?.[1]) return explicitFinal[1];
  const trailingHexLike = [...normalized.matchAll(/\b([A-F]*\d+[A-F0-9]*)\b/gi)].at(-1)?.[1];
  if (trailingHexLike) return trailingHexLike;
  const tokens = [...normalized.matchAll(/\b[A-F]*\d+[A-F0-9]*\b/gi)].map((match) => match[0]).filter(Boolean);
  return tokens.at(-1) ?? normalized;
}

function deterministicExactAnswerOutput(markSchemeData: Record<string, unknown> | null, answerTextValue: string, maxMarks: number): PaperMarkOutput | null {
  if (!markSchemeData || maxMarks !== 1) return null;
  const rows = Array.isArray(markSchemeData.rows)
    ? markSchemeData.rows.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
    : [];
  if (rows.length !== 1) return null;
  const row = rows[0];
  const markPoint = typeof row.markPoint === "string" ? cleanMarkSchemeClause(row.markPoint) : "";
  if (!markPoint) return null;
  const accept = Array.isArray(row.accept) ? row.accept : [];
  const doNotAccept = Array.isArray(row.doNotAccept) ? row.doNotAccept : [];
  const ignore = Array.isArray(row.ignore) ? row.ignore : [];
  const guidance = typeof row.guidance === "string" ? row.guidance.trim() : "";
  const hasExactAnswerCue = /\bCorrect answer only\b/i.test(typeof row.markPoint === "string" ? row.markPoint : "") || /\bCorrect answer only\b/i.test(guidance);
  if (!hasExactAnswerCue || accept.length || doNotAccept.length || ignore.length) return null;
  const candidates = candidateExactAnswersFromMarkPoint(markPoint);
  if (!candidates.length) return null;
  const normalizedAnswer = normalizeExactAnswerValue(extractFinalCandidateAnswer(answerTextValue));
  if (!normalizedAnswer) return null;
  const matched = candidates.find((candidate) => normalizeExactAnswerValue(candidate) === normalizedAnswer);
  if (!matched) {
    return {
      awardedMarks: 0,
      maxMarks,
      rationale: `Exact answer required. Expected ${candidates.join(" or ")}, but the student's final stated answer was ${extractFinalCandidateAnswer(answerTextValue)}.`,
      missingPoints: [`Correct answer only: ${candidates.join(" or ")}`],
      markSchemeEvidence: candidates.join(" / "),
      markSchemeReference: { source: "deterministic_exact_answer" },
      confidence: 99,
    };
  }
  return {
    awardedMarks: 1,
    maxMarks,
    rationale: `Exact answer matches the mark-scheme answer ${matched}.`,
    missingPoints: [],
    markSchemeEvidence: matched,
    markSchemeReference: { source: "deterministic_exact_answer" },
    confidence: 99,
  };
}

function extractMarkSchemeRuleNotes(sectionText: string) {
  const keywordMatcher =
    /\b(?:Do not (?:accept|award|allow)|Accept|accept|allow|ignore|No FT|Mark first|Question is|The question is|Read whole answer|Correct answer only|MP\d+\s+do not award)\b/gi;
  const hits = [...sectionText.matchAll(keywordMatcher)]
    .map((match) => ({ index: match.index ?? 0, keyword: match[0] }))
    .sort((a, b) => a.index - b.index);
  const accept: string[] = [];
  const doNotAccept: string[] = [];
  const ignore: string[] = [];
  const guidance: string[] = [];

  for (const [index, hit] of hits.entries()) {
    const nextIndex = hits[index + 1]?.index ?? Math.min(sectionText.length, hit.index + 260);
    const phrase = cleanMarkSchemeClause(sectionText.slice(hit.index, nextIndex));
    if (!phrase) continue;
    if (/^do not /i.test(phrase)) {
      const split = phrase.match(/^(Do not (?:accept|award|allow)\s+[^,.;]+),\s*but do award\s+(.+)$/i);
      if (split) {
        doNotAccept.push(cleanMarkSchemeClause(split[1]));
        accept.push(cleanMarkSchemeClause(`Accept ${split[2]}`));
        continue;
      }
      doNotAccept.push(phrase);
      continue;
    }
    if (/^(?:Accept|accept|allow)\b/i.test(phrase)) {
      accept.push(phrase);
      continue;
    }
    if (/^ignore\b/i.test(phrase)) {
      ignore.push(phrase);
      continue;
    }
    guidance.push(phrase);
  }

  return {
    accept: [...new Set(accept)],
    doNotAccept: [...new Set(doNotAccept)],
    ignore: [...new Set(ignore)],
    guidance: [...new Set(guidance)],
  };
}

function extractDeterministicMarkSchemeRows(sectionText: string, maxMarks: number) {
  const bullets = [...sectionText.matchAll(/•\s*([^•]+)/g)]
    .map((match) => cleanMarkSchemeClause(match[1] ?? ""))
    .filter(Boolean);
  if (bullets.length) {
    return bullets.map((markPoint) => ({
      markPoint,
      marks: 1,
    }));
  }

  const markForRows = [...sectionText.matchAll(/(\d{1,2})\s+mark(?:s)?\s+for\s+([^]+?)(?=(?:\d{1,2}\s+mark(?:s)?\s+for\b|\b(?:Do not|Accept|accept|allow|ignore|No FT|Mark first|Question is|The question is|Read whole answer|Correct answer only|MP\d+\s+do not award)\b|$))/gi)]
    .map((match) => ({
      markPoint: cleanMarkSchemeClause((match[2] ?? "").replace(/\s+\d{1,2}\s*$/, "")),
      marks: Math.max(1, Number(match[1])),
    }))
    .filter((row) => row.markPoint);
  if (markForRows.length) return markForRows;

  const answerOnlyMatch = sectionText.match(/^(.*?)(?:\s+)(\d{1,2})(?:\s+)(?:Correct answer only|C\s*orrect\s*a\s*nswer\s*o\s*nly|Accept|accept|allow|Do not|ignore|Mark first|Question is|The question is|Read whole answer|MP\d+)/i);
  if (answerOnlyMatch?.[1]) {
    return [
      {
        markPoint: cleanMarkSchemeClause(answerOnlyMatch[1]),
        marks: Math.max(1, maxMarks),
      },
    ];
  }

  return [
    {
      markPoint: cleanMarkSchemeClause(sectionText),
      marks: Math.max(1, maxMarks),
    },
  ];
}

function nextMarkSchemeQuestionIndex(text: string, fromIndex: number) {
  const matcher = /(?:^|[^a-z0-9])(?:question\s*)?0?\d{1,2}\s*(?:[.)/-]|\s)?\s*(?:\([a-z]\)|[a-z])?(?:\s*(?:[.)/-]|\s)?\s*(?:\([ivx]+\)|[ivx]+))?(?=\s|[.)-]|$)/gi;
  matcher.lastIndex = Math.max(0, fromIndex);
  const match = matcher.exec(text);
  return match?.index ?? -1;
}

function textWindowAround(text: string, index: number, maxChars = 1800) {
  const nextIndex = nextMarkSchemeQuestionIndex(text, index + 8);
  const defaultEnd = Math.min(text.length, index + Math.floor(maxChars * 0.88));
  const end = nextIndex > index ? Math.min(defaultEnd, nextIndex) : defaultEnd;
  return text.slice(index, end).trim();
}

function visibleMarksFromText(...values: string[]) {
  const text = values.filter(Boolean).join(" ");
  const explicit = [...text.matchAll(/(?:\[\s*(\d{1,2})\s*(?:marks?)?\s*]|\(\s*(\d{1,2})\s*marks?\s*\)|\b(\d{1,2})\s*marks?\b)/gi)]
    .map((match) => Number(match[1] ?? match[2] ?? match[3]))
    .filter((value) => Number.isInteger(value) && value > 0 && value <= 30);
  return explicit[0] ?? null;
}

type VisibleQuestionCandidate = {
  questionNumber: string;
  parentQuestionNumber: string | null;
  numberingPath: string[];
  promptText: string;
  maxMarks: number;
  pageReferences: number[];
};

function pageTextWithMarkers(pages: PagePromptContext[]) {
  return pages.map((page) => `\n[[PAGE ${page.pageNumber}]]\n${page.text}`).join("\n");
}

function pageNumberAt(text: string, index: number) {
  const prefix = text.slice(0, index);
  const matches = [...prefix.matchAll(/\[\[PAGE\s+(\d+)]]/g)];
  const last = matches.at(-1);
  return last ? Number(last[1]) : 1;
}

function questionLabelBeforeMark(text: string, markIndex: number, previousMarkEnd: number): VisibleQuestionCandidate | null {
  const windowStart = Math.max(0, previousMarkEnd - 180);
  const segment = text.slice(windowStart, markIndex);
  const tokens = [...segment.matchAll(/(?:^|\s)(\d{1,2}\*?)(?=\s+[A-Z(])|(?<![a-z])\(([a-z])\)(?![a-z])|(?<![a-z])\(([ivx]+)\)(?![a-z])/gi)].map((match) => ({
    token: match[1] ?? match[2] ?? match[3] ?? "",
    index: windowStart + (match.index ?? 0),
    raw: match[0],
    kind: match[1] ? "main" : /^[ivx]+$/i.test(match[3] ?? "") ? "roman" : "letter",
  }));
  if (!tokens.length) return null;

  const mainToken = [...tokens].reverse().find((token) => token.kind === "main");
  if (!mainToken) return null;
  const afterMain = tokens.filter((token) => token.index > mainToken.index);
  const letterToken = afterMain.find((token) => token.kind === "letter");
  const afterLetter = letterToken ? afterMain.filter((token) => token.index > letterToken.index) : [];
  const romanToken = afterLetter.find((token) => token.kind === "roman");
  const selected = [mainToken, letterToken, romanToken].filter((token): token is NonNullable<typeof token> => Boolean(token));
  const main = mainToken.token.replace("*", "");
  const path = [
    mainToken.token,
    letterToken ? `(${letterToken.token.toLowerCase()})` : null,
    romanToken ? `(${romanToken.token.toLowerCase()})` : null,
  ].filter((part): part is string => Boolean(part));
  const questionNumber = path.join("");
  const labelEnd = selected.at(-1)!.index + selected.at(-1)!.raw.length;
  const promptText = cleanPromptText(text.slice(labelEnd, markIndex).replace(/\[\[PAGE\s+\d+]]/g, " "));
  if (!promptText || promptText.length < 6) return null;
  return {
    questionNumber,
    parentQuestionNumber: path.length > 1 ? main : null,
    numberingPath: path,
    promptText,
    maxMarks: 0,
    pageReferences: [pageNumberAt(text, markIndex)],
  };
}

function visibleQuestionCandidatesFromPages(pages: PagePromptContext[]): VisibleQuestionCandidate[] {
  const text = pageTextWithMarkers(pages);
  const candidates: VisibleQuestionCandidate[] = [];
  let previousMarkEnd = 0;
  for (const match of text.matchAll(/\[\s*(\d{1,2})\s*]/g)) {
    const markIndex = match.index ?? 0;
    const marks = Number(match[1]);
    if (!Number.isInteger(marks) || marks <= 0 || marks > 30) continue;
    const candidate = questionLabelBeforeMark(text, markIndex, previousMarkEnd);
    previousMarkEnd = markIndex + match[0].length;
    if (!candidate) continue;
    candidates.push({ ...candidate, maxMarks: marks });
  }
  return candidates;
}

function addMissingVisibleQuestions(questions: QuestionExtractionOutput["questions"], paperPages: PagePromptContext[]) {
  const candidates = visibleQuestionCandidatesFromPages(paperPages);
  if (!candidates.length) return questions;
  const existing = new Set(questions.flatMap((question) => questionNumberVariants(question).map(normalizeQuestionToken)));
  const additions = candidates.filter((candidate) => !existing.has(normalizeQuestionToken(candidate.questionNumber)));
  if (!additions.length) return questions;
  const recoveredQuestions: QuestionExtractionOutput["questions"] = additions.map((candidate) => {
    const unsupported = UNSUPPORTED_FORMAT_PATTERN.test(candidate.promptText);
    return {
      questionNumber: candidate.questionNumber,
      parentQuestionNumber: candidate.parentQuestionNumber,
      numberingPath: candidate.numberingPath,
      promptText: candidate.promptText,
      maxMarks: candidate.maxMarks,
      responseType: unsupported ? "long_text" : "short_text",
      originalFormat: unsupported ? "unsupported_table_or_grid" : "text",
      convertedFormat: null,
      originalContent: {
        evidenceSnippet: candidate.promptText,
        confidence: 72,
        extractionWarnings: ["Recovered from visible paper text because the AI extraction missed this marked item."],
        ...(unsupported
          ? {
              unsupportedQuestionFormat: true,
              unsupportedReason:
                "This recovered question appears to be a table, grid, matrix, or row-by-row checkbox format that the answer UI cannot safely represent yet.",
            }
          : {}),
      },
      convertedContent: {},
      options: [],
      pageReferences: candidate.pageReferences,
      mediaRefs: [],
      markSchemeRef: null,
      markSchemeData: null,
    };
  });
  return [
    ...questions,
    ...recoveredQuestions,
  ].sort((a, b) => {
    const pageDelta = (a.pageReferences[0] ?? 999) - (b.pageReferences[0] ?? 999);
    if (pageDelta) return pageDelta;
    return normalizeQuestionToken(a.questionNumber).localeCompare(normalizeQuestionToken(b.questionNumber), undefined, { numeric: true });
  });
}

export function applyDeterministicMarkSchemeFallback(output: ProcessedPaperOutput, markSchemePages: PagePromptContext[]): ProcessedPaperOutput {
  if (!markSchemePages.length) return output;
  const labels = output.questions.map((question) => question.questionNumber);
  const sections = buildDeterministicMarkSchemeSections(labels, markSchemePages);

  return {
    ...output,
    questions: output.questions.map((question) => {
      if (question.markSchemeData) return question;
      const section = sections.get(question.questionNumber);
      if (!section) return applyDeterministicMarkSchemeToQuestion(question, markSchemePages);
      const rules = extractMarkSchemeRuleNotes(section.text);
      const rows = extractDeterministicMarkSchemeRows(section.text, question.maxMarks).map((row, index) => ({
        markPoint: row.markPoint,
        accept: index === 0 ? rules.accept : [],
        doNotAccept: index === 0 ? rules.doNotAccept : [],
        ignore: index === 0 ? rules.ignore : [],
        guidance: index === 0 ? rules.guidance.join(" ") : "",
        marks: row.marks,
      }));
      return {
        ...question,
        markSchemeRef: section.ref,
        markSchemeData: {
          source: "deterministic_mark_scheme_section",
          questionNumber: question.questionNumber,
          maxMarks: question.maxMarks,
          pageNumbers: section.pageNumbers,
          rows,
          points: rows.map((row) => row.markPoint).filter(Boolean),
          evidence: section.text,
          accept: rules.accept,
          doNotAccept: rules.doNotAccept,
          ignore: rules.ignore,
          guidanceNotes: rules.guidance,
          exactSectionText: section.text,
        },
      };
    }),
  };
}

function applyDeterministicMarkSchemeToQuestion<T extends Pick<ProcessedPaperOutput["questions"][number], "questionNumber" | "maxMarks" | "markSchemeData" | "markSchemeRef"> & Partial<Pick<ProcessedPaperOutput["questions"][number], "numberingPath">>>(
  question: T,
  markSchemePages: PagePromptContext[],
  extraVariants: string[] = [],
): T {
  if (question.markSchemeData) return question;
  const variants = [...new Set([...questionNumberVariants(question), ...extraVariants.map(normalizeQuestionToken).filter(Boolean)])];
  for (const page of markSchemePages) {
    if (!page.text.trim()) continue;
    for (const variant of variants) {
      const regex = markSchemeRegexForVariant(variant);
      const match = regex?.exec(page.text);
      if (!match || match.index === undefined) continue;
      const snippet = textWindowAround(page.text, match.index);
      if (!snippet) continue;
      const visibleMaxMarks = visibleMarksFromText(snippet);
      const inferredMaxMarks = visibleMaxMarks ? Math.max(question.maxMarks, visibleMaxMarks) : question.maxMarks;
      return {
        ...question,
        markSchemeRef: `Mark scheme page ${page.pageNumber}, near ${variant}`,
        maxMarks: question.maxMarks > 0 ? question.maxMarks : inferredMaxMarks,
        markSchemeData: {
          source: "deterministic_mark_scheme_window",
          pageNumber: page.pageNumber,
          questionNumberVariants: variants,
          maxMarks: inferredMaxMarks,
          rows: [
            {
              markPoint: snippet,
              accept: [],
              doNotAccept: [],
              ignore: [],
              guidance: "Use only the visible mark scheme window around this question reference.",
              marks: inferredMaxMarks,
            },
          ],
          evidence: snippet,
          points: [snippet],
        },
      };
    }
  }
  return question;
}

export async function processPaperWithAI(paper: PastPaper, onProgress: (update: ProcessingProgressUpdate) => void, options: ProcessPaperOptions = {}) {
  const paperAsset = paper.assets.find((asset) => asset.kind === "paper");
  const markSchemeAsset = paper.assets.find((asset) => asset.kind === "mark_scheme");
  const model = options.model ?? DEFAULT_AI_MODEL;
  const fallbackModels = options.fallbackModels ?? [...FALLBACK_AI_MODELS];
  const diagnostics = buildInitialDiagnostics(paper);
  const reporter = makeProgressReporter(onProgress, diagnostics);
  const topicPath = [paper.topic, paper.subtopic].filter((value): value is string => Boolean(value));

  try {
    reporter.enterStage("extracting", 18, "Loaded extracted file content", {
      paperPageCount: diagnostics.paperPageCount,
      markSchemePageCount: diagnostics.markSchemePageCount,
      paperTextChars: paperAsset?.textContent?.length ?? 0,
      markSchemeTextChars: markSchemeAsset?.textContent?.length ?? 0,
      screenshotCount: diagnostics.screenshotStats.length,
    });
    reporter.completeStage("extracting");

    const paperPages = pageContextsForAsset(paperAsset);
    const markSchemePagesForDiagnostics = pageContextsForAsset(markSchemeAsset);
    syncDerivedPageTextDiagnostics(diagnostics, paper, paperPages, markSchemePagesForDiagnostics);
    if (!paperPages.length) {
      throw new Error("No paper pages were available after upload extraction.");
    }

    const inventoryPageNumbers = paperPages.map((page) => page.pageNumber);
    const inventoryMedia = screenshotDataUrls(paperAsset, inventoryPageNumbers, "thumbnail");
    if (!hasMeaningfulText(paperPages) && !inventoryMedia.length) {
      throw new Error("No readable paper text or page images were available. Question extraction cannot proceed without source content.");
    }

    let output = buildDeterministicProcessedPaperOutput(paper, paperPages);

    if (output) {
      reporter.enterStage("building page inventory", 28, "Using deterministic parser for readable paper text", {
        pages: paperPages.length,
        detectedStyle: detectDeterministicPaperStyle(paperPages),
      });
      reporter.completeStage("building page inventory");

      reporter.enterStage("identifying questions", 42, "Recovered ordered question boundaries from readable page text", {
        questionCount: output.questions.length,
        totalMarks: output.totalMarks,
      });
      reporter.completeStage("identifying questions");

      reporter.enterStage("extracting question details", 58, "Built structured questions from readable page text", {
        questionCount: output.questions.length,
        extractedMarks: output.questions.reduce((sum, question) => sum + question.maxMarks, 0),
      });
      reporter.completeStage("extracting question details");
    } else {
      reporter.enterStage("building page inventory", 28, "Building compact page inventory", {
        pages: paperPages.length,
        selectedModel: model,
        fallbackModels,
      });
      const inventoryPrompt = buildPageInventoryPrompt({
        title: paper.title,
        subject: paper.subject,
        topicPath,
        pages: paperPages,
      });
      reporter.addPrompt("Page inventory", inventoryPrompt, model, paperPages.map((page) => page.pageNumber), inventoryMedia.length);
      const inventory = await structuredJsonWithTextFallback({
        prompt: inventoryPrompt,
        schema: pageInventoryOutputSchema,
        hasReadableText: hasMeaningfulText(paperPages),
        label: "Page inventory",
        stage: "building page inventory",
        reporter,
        options: {
          operation: "page_inventory",
          model,
          fallbackModels,
          media: inventoryMedia,
          timeoutMs: 60_000,
          debugLabel: "Page inventory",
          onRequestDiagnostic: reporter.addAIRequest,
          onSchemaError: reporter.addSchemaError,
        },
      });
      reporter.completeStage("building page inventory");

      reporter.enterStage("identifying questions", 42, "Identifying question boundaries", {
        pageCount: paperPages.length,
        inventoryPages: inventory.pages.length,
        selectedModel: model,
      });
      const boundaryPrompt = buildQuestionBoundaryPrompt({
        title: inventory.title ?? paper.title,
        subject: paper.subject,
        inventoryJson: JSON.stringify(inventory),
        pages: paperPages,
      });
      reporter.addPrompt("Question boundaries", boundaryPrompt, model, paperPages.map((page) => page.pageNumber), inventoryMedia.length);
      const boundaries = await structuredJsonWithTextFallback({
        prompt: boundaryPrompt,
        schema: questionBoundaryOutputSchema,
        hasReadableText: hasMeaningfulText(paperPages),
        label: "Question boundaries",
        stage: "identifying questions",
        reporter,
        options: {
          operation: "question_boundaries",
          model,
          fallbackModels,
          media: inventoryMedia,
          timeoutMs: 60_000,
          normalizer: normalizeProcessedPaperOutput,
          debugLabel: "Question boundaries",
          onRequestDiagnostic: reporter.addAIRequest,
          onSchemaError: reporter.addSchemaError,
        },
      });
      if (!boundaries.questions.length) throw new Error("No question boundaries were identified.");
      reporter.completeStage("identifying questions");

      reporter.enterStage("extracting question details", 58, "Extracting structured questions in chunks", {
        questionBoundaryCount: boundaries.questions.length,
        maxPagesPerChunk: MAX_EXTRACTION_PAGES_PER_CHUNK,
      });
      const chunks = chunkBoundaries(boundaries.questions, paperPages);
      const extractedQuestions: QuestionExtractionOutput["questions"] = [];
      for (const [index, chunk] of chunks.entries()) {
        const { pages: chunkPages, usedWholeDocumentFallback } = pagesForChunk(chunk.pageNumbers, paperPages);
        const chunkMedia = screenshotDataUrls(paperAsset, chunk.pageNumbers, "full");
        if (!hasMeaningfulText(chunkPages) && !chunkMedia.length) {
          throw new Error(`Pages ${chunk.pageNumbers.join(", ")} have no readable text or usable screenshots. Question extraction cannot proceed.`);
        }
        if (usedWholeDocumentFallback) {
          reporter.log("extracting question details", "warn", "Using whole-document legacy text for a page range because page-level text was not available", {
            requestedPages: chunk.pageNumbers,
            wholeDocumentChars: chunkPages[0]?.charCount ?? 0,
          });
        }
        const chunkPrompt = buildQuestionExtractionPrompt({
          title: inventory.title ?? paper.title,
          subject: paper.subject,
          boundaries: chunk.boundaries,
          pages: chunkPages,
        });
        const label = `Question details chunk ${index + 1}/${chunks.length}`;
        reporter.addPrompt(label, chunkPrompt, model, chunk.pageNumbers, chunkMedia.length);
        const extracted = await structuredJsonWithTextFallback({
          prompt: chunkPrompt,
          schema: questionExtractionOutputSchema,
          hasReadableText: hasMeaningfulText(chunkPages),
          label,
          stage: "extracting question details",
          reporter,
        options: {
            operation: "question_extraction",
            model,
            fallbackModels,
            media: chunkMedia,
            timeoutMs: 65_000,
            normalizer: normalizeProcessedPaperOutput,
            debugLabel: label,
            onRequestDiagnostic: reporter.addAIRequest,
            onSchemaError: reporter.addSchemaError,
          },
        });
        extractedQuestions.push(...extracted.questions);
        reporter.emit("extracting question details", 58 + Math.round(((index + 1) / Math.max(chunks.length, 1)) * 20));
      }

      const questions = dedupeQuestions(normalizeSequentialSimpleQuestionNumbers(addMissingVisibleQuestions(repairExtractedQuestionArtifacts(extractedQuestions), paperPages)));
      if (!questions.length) throw new Error("AI did not return any structured questions.");
      reporter.completeStage("extracting question details");

      output = {
        title: inventory.title ?? paper.title,
        year: inventory.year ?? paper.year,
        series: inventory.series ?? paper.series,
        paperCode: inventory.paperCode ?? paper.paperCode,
        totalMarks: inventory.totalMarks ?? questions.reduce((sum, question) => sum + question.maxMarks, 0),
        durationMinutes: inventory.durationMinutes ?? paper.durationMinutes,
        questions,
      };
    }

    if (markSchemeAsset) {
      reporter.enterStage("aligning mark scheme", 82, "Aligning mark scheme separately", {
        markSchemePageCount: assetPageCount(markSchemeAsset),
        markSchemeTextChars: markSchemeAsset.textContent?.length ?? 0,
      });
      const markSchemePages = pageContextsForAsset(markSchemeAsset);
      if (markSchemePages.length) {
        const readableMarkScheme = hasMeaningfulText(markSchemePages);
        const beforeDeterministic = output.questions.filter((question) => question.markSchemeData).length;
        if (readableMarkScheme) {
          output = applyDeterministicMarkSchemeFallback(output, markSchemePages);
          const afterDeterministic = output.questions.filter((question) => question.markSchemeData).length;
          if (afterDeterministic > beforeDeterministic) {
            reporter.log("aligning mark scheme", "info", "Recovered exact readable mark-scheme sections", {
              filled: afterDeterministic - beforeDeterministic,
              alignedQuestions: afterDeterministic,
            });
          }
        }

        const unresolvedQuestions = output.questions.filter((question) => !question.markSchemeData);
        if (unresolvedQuestions.length) {
          const alignmentPrompt = buildMarkSchemeAlignmentPrompt({
            title: output.title,
            subject: paper.subject,
            questions: unresolvedQuestions.map((question) => ({
              questionNumber: question.questionNumber,
              promptText: question.promptText,
              maxMarks: question.maxMarks,
              pageReferences: question.pageReferences,
            })),
            markSchemePages,
          });
          const markSchemePageNumbers = markSchemePages.map((page) => page.pageNumber);
          const markSchemeMedia = hasMeaningfulText(markSchemePages) ? [] : screenshotDataUrls(markSchemeAsset, markSchemePageNumbers, "full");
          reporter.addPrompt("Mark scheme alignment", alignmentPrompt, model, markSchemePageNumbers, markSchemeMedia.length);
          const shouldUseAiAlignment = alignmentPrompt.length <= MAX_AI_MARK_SCHEME_ALIGNMENT_PROMPT_CHARS || !readableMarkScheme;
          if (shouldUseAiAlignment) {
            try {
              const alignment = await structuredJsonWithTextFallback({
                prompt: alignmentPrompt,
                schema: markSchemeAlignmentOutputSchema,
                hasReadableText: readableMarkScheme,
                label: "Mark scheme alignment",
                stage: "aligning mark scheme",
                reporter,
                options: {
                  operation: "mark_scheme_alignment",
                  model,
                  fallbackModels: alignmentPrompt.length > 24_000 ? [] : fallbackModels,
                  media: markSchemeMedia,
                  timeoutMs: 35_000,
                  debugLabel: "Mark scheme alignment",
                  normalizer: normalizeMarkSchemeAlignmentOutput,
                  onRequestDiagnostic: reporter.addAIRequest,
                  onSchemaError: reporter.addSchemaError,
                },
              });
              output = applyMarkSchemeAlignment(output, alignment);
            } catch (error) {
              reporter.log("aligning mark scheme", "warn", "Mark scheme alignment failed; questions were kept without fabricated mark-scheme data", {
                error: error instanceof Error ? error.message : String(error),
              });
            }
          } else {
            reporter.log("aligning mark scheme", "warn", "Skipping AI mark-scheme alignment because the unresolved-question prompt is still too large", {
              promptChars: alignmentPrompt.length,
              maxPromptChars: MAX_AI_MARK_SCHEME_ALIGNMENT_PROMPT_CHARS,
              unresolvedQuestions: unresolvedQuestions.length,
            });
          }
        }
      } else {
        reporter.log("aligning mark scheme", "warn", "No readable mark-scheme pages were available for alignment");
      }
      reporter.completeStage("aligning mark scheme");
    }

    reporter.enterStage("finalising", 94, "Validating final structured output", {
      questionCount: output.questions.length,
      selectedModel: model,
    });
    const normalized = normalizeProcessedPaperOutput(output);
    const finalResult = processedPaperOutputSchema.safeParse(normalized);
    if (!finalResult.success) {
      reporter.addSchemaError({
        label: "Final processed paper",
        paths: finalResult.error.issues.map((issue) => (issue.path.length ? issue.path.join(".") : "(root)")),
        issues: finalResult.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message} (${issue.code})`),
        rawPreview: JSON.stringify(output).slice(0, 1800),
        extractedJsonPreview: JSON.stringify(normalized).slice(0, 1800),
      });
      throw new Error("Final processed paper did not match the required schema.");
    }
    const integrity = validateProcessedPaperIntegrity(finalResult.data);
    if (!integrity.valid) {
      diagnostics.integrityFailures = integrity.failures;
      reporter.log("finalising", "error", QUESTION_EXTRACTION_FAILURE, { integrityFailures: integrity.failures });
      throw new Error([QUESTION_EXTRACTION_FAILURE, ...integrity.failures.map((failure) => `- ${failure}`)].join("\n"));
    }
    reporter.completeStage("finalising");
    reporter.emit("finalising", 100);
    return mapProcessedOutput(paper, finalResult.data, cloneDiagnostics(diagnostics));
  } catch (error) {
    const message = processingFailureMessage(diagnostics.currentStage, error);
    reporter.log(diagnostics.currentStage, "error", message, { rawError: error instanceof AIProviderError ? error.rawError : error instanceof Error ? error.stack : error });
    throw new Error(message);
  }
}

export function makeBlankAnswer(attemptId: string, question: PastPaperQuestion): PastPaperAnswer {
  const createdAt = nowIso();
  return {
    id: createId("answer"),
    attemptId,
    questionId: question.id,
    responseText: null,
    numericResponse: null,
    selectedOptions: [],
    skipped: false,
    skippedWithConfidence: false,
    confidencePredictedMarks: null,
    createdAt,
    updatedAt: createdAt,
  };
}

export function startAttempt(paper: PastPaper): PastPaperAttempt {
  const id = createId("attempt");
  const startedAt = nowIso();
  const totalMarks = paper.totalMarks ?? paper.questions.reduce((sum, question) => sum + question.maxMarks, 0);
  return {
    id,
    paperId: paper.id,
    status: "in_progress",
    startedAt,
    submittedAt: null,
    completedAt: null,
    durationSeconds: 0,
    overtimeSeconds: 0,
    actualScore: 0,
    confidenceAdjustedScore: 0,
    totalMarks,
    answers: paper.questions.map((question) => makeBlankAnswer(id, question)),
    marks: [],
    remarks: [],
  };
}

export function displayQuestionNumberForPaper(paper: Pick<PastPaper, "questions">, question: Pick<PastPaperQuestion, "id" | "questionNumber" | "displayOrder">) {
  const sorted = [...paper.questions].sort((a, b) => a.displayOrder - b.displayOrder);
  const hasHierarchicalLabels = sorted.some((item) => /(?:\([a-zivx]+\)|\d+\*|[a-z]$|Â©|©)/i.test(normalizeDisplayQuestionNumber(item.questionNumber.trim())));
  let mainQuestion = 1;
  let previousSimpleNumber = 0;

  for (const [index, item] of sorted.entries()) {
    const raw = normalizeDisplayQuestionNumber(item.questionNumber.trim());
    const dotted = raw.match(/^(\d+)[.)/](\d+(?:[.)/]\d+)*)$/);
    if (dotted) {
      if (item.id === question.id) return raw.replace(/[)/]/g, ".");
      mainQuestion = Number(dotted[1]);
      previousSimpleNumber = Number(dotted[2].match(/\d+/)?.[0] ?? 0);
      continue;
    }

    const simple = raw.match(/^\d+$/);
    if (simple) {
      const number = Number(raw);
      if (hasHierarchicalLabels) {
        if (item.id === question.id) return raw;
        previousSimpleNumber = number;
        mainQuestion = number;
        continue;
      }
      if (index > 0 && previousSimpleNumber > 0 && number < previousSimpleNumber) mainQuestion += 1;
      previousSimpleNumber = number;
      if (item.id === question.id) return `${mainQuestion}.${number}`;
      continue;
    }

    if (item.id === question.id) return raw || `Q${index + 1}`;
  }

  return normalizeDisplayQuestionNumber(question.questionNumber) || "Question";
}

function markSchemeTextForDisplayNumber(paper: PastPaper, displayNumber: string) {
  const markSchemeAsset = paper.assets.find((asset) => asset.kind === "mark_scheme");
  const pages = pageContextsForAsset(markSchemeAsset);
  if (!pages.length) return null;
  const variants = questionNumberVariants({ questionNumber: displayNumber, numberingPath: [displayNumber] });

  for (const page of pages) {
    for (const variant of variants) {
      const matcher = markSchemeRegexForVariant(variant);
      const match = matcher?.exec(page.text);
      if (!match || match.index === undefined) continue;
      const snippet = textWindowAround(page.text, match.index);
      if (snippet) return { ref: `Mark scheme page ${page.pageNumber}, ${displayNumber}`, text: snippet };
    }
  }

  return null;
}

function deterministicMarkSchemeQuestionForPaper(paper: PastPaper, question: PastPaperQuestion, displayNumber: string) {
  const markSchemeAsset = paper.assets.find((asset) => asset.kind === "mark_scheme");
  const pages = pageContextsForAsset(markSchemeAsset);
  if (!pages.length) return question;
  const orderedQuestions = paper.questions.length ? paper.questions : [question];
  const labels = orderedQuestions.map((item) => (item.id === question.id ? displayNumber : displayQuestionNumberForPaper(paper, item)));
  const sections = buildDeterministicMarkSchemeSections(labels, pages);
  const section = sections.get(displayNumber);
  if (!section) return applyDeterministicMarkSchemeToQuestion(question, pages, [displayNumber]);
  const rules = extractMarkSchemeRuleNotes(section.text);
  const rows = extractDeterministicMarkSchemeRows(section.text, question.maxMarks).map((row, index) => ({
    markPoint: row.markPoint,
    accept: index === 0 ? rules.accept : [],
    doNotAccept: index === 0 ? rules.doNotAccept : [],
    ignore: index === 0 ? rules.ignore : [],
    guidance: index === 0 ? rules.guidance.join(" ") : "",
    marks: row.marks,
  }));
  return {
    ...question,
    markSchemeRef: section.ref,
    markSchemeData: {
      source: "deterministic_mark_scheme_section",
      questionNumber: displayNumber,
      maxMarks: question.maxMarks,
      pageNumbers: section.pageNumbers,
      rows,
      points: rows.map((row) => row.markPoint).filter(Boolean),
      evidence: section.text,
      accept: rules.accept,
      doNotAccept: rules.doNotAccept,
      ignore: rules.ignore,
      guidanceNotes: rules.guidance,
      exactSectionText: section.text,
    },
  } satisfies PastPaperQuestion;
}

function renderMarkSchemeDataForPrompt(markSchemeData: Record<string, unknown> | null) {
  if (!markSchemeData) return "";
  const rows = Array.isArray(markSchemeData.rows)
    ? markSchemeData.rows
        .map((row, index) => {
          const value = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
          return [
            `Row ${index + 1}: ${typeof value.markPoint === "string" ? value.markPoint : ""}`.trim(),
            Array.isArray(value.accept) && value.accept.length ? `Also accept: ${value.accept.join("; ")}` : null,
            Array.isArray(value.doNotAccept) && value.doNotAccept.length ? `Do not accept: ${value.doNotAccept.join("; ")}` : null,
            Array.isArray(value.ignore) && value.ignore.length ? `Ignore: ${value.ignore.join("; ")}` : null,
            typeof value.guidance === "string" && value.guidance.trim() ? `Guidance: ${value.guidance}` : null,
          ]
            .filter(Boolean)
            .join("\n");
        })
        .filter(Boolean)
    : [];
  const points = Array.isArray(markSchemeData.points) ? markSchemeData.points.filter((value): value is string => typeof value === "string" && Boolean(value.trim())) : [];
  const topLevelAccept = Array.isArray(markSchemeData.accept) ? markSchemeData.accept.filter((value): value is string => typeof value === "string" && Boolean(value.trim())) : [];
  const topLevelDoNotAccept = Array.isArray(markSchemeData.doNotAccept)
    ? markSchemeData.doNotAccept.filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    : [];
  const topLevelIgnore = Array.isArray(markSchemeData.ignore) ? markSchemeData.ignore.filter((value): value is string => typeof value === "string" && Boolean(value.trim())) : [];
  const guidanceNotes = Array.isArray(markSchemeData.guidanceNotes)
    ? markSchemeData.guidanceNotes.filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    : [];
  const exactSectionText = typeof markSchemeData.exactSectionText === "string" ? markSchemeData.exactSectionText : typeof markSchemeData.evidence === "string" ? markSchemeData.evidence : "";
  return [
    rows.length ? `Parsed mark scheme rows:\n${rows.join("\n\n")}` : null,
    points.length && !rows.length ? `Marking points:\n${points.join("\n")}` : null,
    topLevelAccept.length ? `Also accept:\n${topLevelAccept.join("\n")}` : null,
    topLevelDoNotAccept.length ? `Do not accept:\n${topLevelDoNotAccept.join("\n")}` : null,
    topLevelIgnore.length ? `Ignore:\n${topLevelIgnore.join("\n")}` : null,
    guidanceNotes.length ? `Examiner guidance:\n${guidanceNotes.join("\n")}` : null,
    exactSectionText ? `Exact mark scheme section:\n${exactSectionText}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function markOutputSignalsInsufficient(output: PaperMarkOutput) {
  return /\b(?:insufficient|does not include|doesn't include|no relevant|no matching|no mark scheme|nothing relevant|cannot be awarded|not enough evidence)\b/i.test(
    [output.rationale, output.markSchemeEvidence ?? "", ...output.missingPoints].join(" "),
  );
}

function retryMarkingModel(currentModel: string, fallbackModels: string[]) {
  const ordered = ["gemini-2.5-flash", DEFAULT_AI_MODEL, ...fallbackModels].filter((model, index, list) => model !== currentModel && list.indexOf(model) === index);
  return ordered[0] ?? null;
}

function markSchemeSectionForQuestion(paper: PastPaper, displayNumber: string, questionNumber: string) {
  const markSchemeAsset = paper.assets.find((asset) => asset.kind === "mark_scheme");
  const pages = pageContextsForAsset(markSchemeAsset);
  if (!pages.length) return null;
  const parts = displayNumber.match(/\d+/g) ?? questionNumber.match(/\d+/g) ?? [];
  const main = parts[0];
  if (!main) return null;
  const nextMain = String(Number(main) + 1);
  const startPattern = new RegExp(`(?:^|[^a-z0-9])(?:question\\s*)?0?${main}\\s*(?=(?:[.)/-]|\\s|\\([a-z]\\)|[a-z]))`, "i");
  const endPattern = new RegExp(`(?:^|[^a-z0-9])(?:question\\s*)?0?${nextMain}\\s*(?=(?:[.)/-]|\\s|\\([a-z]\\)|[a-z]))`, "gi");
  const combined = pages.map((page) => `\n\n--- Mark scheme page ${page.pageNumber} ---\n${page.text}`).join("");
  const combinedStart = startPattern.exec(combined);
  if (combinedStart?.index !== undefined) {
    endPattern.lastIndex = combinedStart.index + combinedStart[0].length;
    const combinedEnd = endPattern.exec(combined);
    const end = combinedEnd?.index ?? Math.min(combined.length, combinedStart.index + 12_000);
    const snippet = combined.slice(combinedStart.index, end).trim();
    if (snippet) {
      return {
        ref: `Mark scheme question ${main} section`,
        text: snippet,
      };
    }
  }

  for (const page of pages) {
    const startMatch = startPattern.exec(page.text);
    if (!startMatch || startMatch.index === undefined) continue;
    endPattern.lastIndex = startMatch.index + startMatch[0].length;
    const endMatch = endPattern.exec(page.text);
    const end = endMatch?.index ?? Math.min(page.text.length, startMatch.index + 6000);
    const snippet = page.text.slice(startMatch.index, end).trim();
    if (snippet) {
      return {
        ref: `Mark scheme page ${page.pageNumber}, question ${main} section`,
        text: snippet,
      };
    }
  }

  return null;
}

function hasMarkSchemeSubstance(markSchemeText: string, label: string) {
  const text = markSchemeText.replace(/\s+/g, " ").trim();
  if (text.length < 30) return false;
  const compactText = normalizeQuestionToken(text);
  const compactLabel = normalizeQuestionToken(label);
  if (!/\b(?:mark|marks|answer|guidance|accept|allow|correct|award|level|indicative|tick|point|from:|e\.g\.)\b/i.test(text) && !text.includes("✓")) {
    return Boolean(compactLabel && compactText.includes(compactLabel) && text.length > 70);
  }
  return compactLabel ? compactText.includes(compactLabel.slice(0, Math.min(3, compactLabel.length))) || text.length > 300 : text.length > 300;
}

function mapMarkOutput(answerId: string, questionId: string, questionMaxMarks: number, output: PaperMarkOutput, source: "ai" | "remark", version: number): PastPaperQuestionMark {
  const maxMarks = questionMaxMarks;
  return {
    id: createId("mark"),
    answerId,
    questionId,
    source,
    reviewVersion: version,
    awardedMarks: Math.min(maxMarks, Math.max(0, output.awardedMarks)),
    maxMarks,
    rationale: output.rationale,
    missingPoints: output.missingPoints,
    markSchemeEvidence: output.markSchemeEvidence,
    markSchemeReference: output.markSchemeReference,
    accepted: source === "ai",
    createdAt: nowIso(),
  };
}

export function createMarkingErrorMark(
  answerId: string,
  questionId: string,
  maxMarks: number,
  message: string,
  source: "ai" | "remark",
  version: number,
): PastPaperQuestionMark {
  return {
    id: createId("mark"),
    answerId,
    questionId,
    source,
    reviewVersion: version,
    awardedMarks: 0,
    maxMarks,
    rationale: message,
    missingPoints: [],
    markSchemeEvidence: null,
    markSchemeReference: { error: true, code: "mark_scheme_mismatch" },
    accepted: source === "ai",
    createdAt: nowIso(),
  };
}

export async function markAnswerWithAI(
  paper: PastPaper,
  question: PastPaperQuestion,
  answer: PastPaperAnswer,
  version: number,
  source: "ai" | "remark" = "ai",
  options: ProcessPaperOptions = {},
) {
  const displayNumber = displayQuestionNumberForPaper(paper, question);
  const recoveredQuestion = deterministicMarkSchemeQuestionForPaper(paper, question, displayNumber);
  const displayNumberMarkScheme = displayNumber !== question.questionNumber ? markSchemeTextForDisplayNumber(paper, displayNumber) : null;
  const hasSubpartLabel = /[a-z)]/i.test(displayNumber) || /[a-z)©Â©]/i.test(question.questionNumber);
  const questionSectionMarkScheme = hasSubpartLabel ? markSchemeSectionForQuestion(paper, displayNumber, question.questionNumber) : null;
  const existingMarkSchemeSource =
    question.markSchemeData && typeof question.markSchemeData.source === "string" ? String(question.markSchemeData.source) : null;
  const shouldPreferExistingMarkSchemeData = Boolean(
    question.markSchemeData &&
      existingMarkSchemeSource !== "deterministic_mark_scheme_window" &&
      existingMarkSchemeSource !== "deterministic_mark_scheme_section",
  );
  const markSchemeData = shouldPreferExistingMarkSchemeData ? question.markSchemeData : recoveredQuestion.markSchemeData ?? question.markSchemeData;
  const preferredMarkSchemeRef = shouldPreferExistingMarkSchemeData ? question.markSchemeRef ?? recoveredQuestion.markSchemeRef : recoveredQuestion.markSchemeRef ?? question.markSchemeRef;
  const structuredMarkSchemeText = renderMarkSchemeDataForPrompt(markSchemeData);
  const markSchemeText = structuredMarkSchemeText || questionSectionMarkScheme?.text || displayNumberMarkScheme?.text || "";
  const hasStructuredMarkScheme = Boolean(structuredMarkSchemeText.replace(/\s+/g, "").length > 10);
  const needsReadableSection = Boolean(questionSectionMarkScheme || (!markSchemeData && displayNumberMarkScheme));
  if (!markSchemeText || (needsReadableSection ? !hasMarkSchemeSubstance(markSchemeText, displayNumber || question.questionNumber) : !hasStructuredMarkScheme && !hasMarkSchemeSubstance(markSchemeText, displayNumber || question.questionNumber))) {
    const label = displayNumber || question.questionNumber;
    throw new Error(`Question ${label} has no aligned mark scheme with readable marking content. Marks were not fabricated.`);
  }
  const maxMarks = recoveredQuestion.maxMarks ?? question.maxMarks;
  const exactAnswerOutput = deterministicExactAnswerOutput(markSchemeData, answerText(answer, question), maxMarks);
  if (exactAnswerOutput) {
    return mapMarkOutput(answer.id, question.id, maxMarks, exactAnswerOutput, source, version);
  }
  const primaryModel = options.model ?? DEFAULT_AI_MODEL;
  const fallbackModels = options.fallbackModels ?? [...FALLBACK_AI_MODELS];

  const prompt = buildPaperMarkingPrompt({
    subject: paper.subject,
    questionNumber: displayNumber,
    promptText: cleanPromptText(question.promptText),
    maxMarks,
    answerText: answerText(answer, question),
    markSchemeText: preferredMarkSchemeRef
      ? `${preferredMarkSchemeRef}\n${markSchemeText}`
      : questionSectionMarkScheme
        ? `${questionSectionMarkScheme.ref}\n${markSchemeText}`
        : displayNumberMarkScheme
          ? `${displayNumberMarkScheme.ref}\n${markSchemeText}`
          : markSchemeText,
  });
  let output = await aiStructuredJson(prompt, paperMarkOutputSchema, {
    operation: "paper_mark",
    model: primaryModel,
    fallbackModels,
    normalizer: normalizePaperMarkOutput,
    debugLabel: `Marking question ${question.questionNumber}`,
  });
  if (output.awardedMarks === 0 && markOutputSignalsInsufficient(output) && hasMarkSchemeSubstance(markSchemeText, displayNumber || question.questionNumber)) {
    const retryModel = retryMarkingModel(primaryModel, fallbackModels);
    if (retryModel) {
      output = await aiStructuredJson(
        `${prompt}\n\nThe supplied mark scheme section above is the exact relevant section for this question and is sufficient to award marks. Re-evaluate carefully, including do-not-accept and ignore guidance.`,
        paperMarkOutputSchema,
        {
          operation: "paper_mark",
          model: retryModel,
          fallbackModels: fallbackModels.filter((model) => model !== retryModel),
          normalizer: normalizePaperMarkOutput,
          debugLabel: `Retry marking question ${question.questionNumber}`,
        },
      );
    }
  }
  if (output.awardedMarks === 0 && markOutputSignalsInsufficient(output) && hasMarkSchemeSubstance(markSchemeText, displayNumber || question.questionNumber)) {
    throw new Error(
      `Question ${displayNumber} could not be matched to a reliable mark-scheme row. Review the aligned mark scheme for this question instead of awarding a fabricated zero.`,
    );
  }
  return mapMarkOutput(answer.id, question.id, maxMarks, output, source, version);
}

export function createRemark(attemptId: string, answer: PastPaperAnswer, notes: string | null): PastPaperRemark {
  return {
    id: createId("remark"),
    attemptId,
    answerId: answer.id,
    questionId: answer.questionId,
    status: "queued",
    notes,
    proposedMarkId: null,
    acceptedMarkId: null,
    acceptedAt: null,
    createdAt: nowIso(),
  };
}
