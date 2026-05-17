import {
  markSchemeRecoveryOutputSchema,
  normalizePaperMarkOutput,
  normalizeProcessedPaperOutput,
  pageInventoryOutputSchema,
  paperMarkOutputSchema,
  processedPaperOutputSchema,
  questionBoundaryOutputSchema,
  questionExtractionOutputSchema,
  type MarkSchemeRecoveryOutput,
  type PaperMarkOutput,
  type ProcessedPaperOutput,
  type QuestionBoundaryOutput,
  type QuestionExtractionOutput,
} from "../ai/schemas";
import {
  buildMarkSchemeRecoveryPrompt,
  buildPageInventoryPrompt,
  buildPaperMarkingPrompt,
  buildQuestionBoundaryPrompt,
  buildQuestionExtractionPrompt,
  type PagePromptContext,
  type QuestionBoundaryPromptContext,
} from "../ai/prompts";
import { DEFAULT_AI_MODEL, FALLBACK_AI_MODELS, GEMINI_FLASH_MODEL, AIProviderError, aiStructuredJson, modelLabelForModel, resolveAIModelConfig, type AIResultMetadata } from "../ai/provider";
import { extractChoiceStructure, inferChoiceResponseType } from "./choiceParsing";
import type {
  AppData,
  PaperPageScreenshot,
  PastPaper,
  PastPaperAnswer,
  PastPaperAttempt,
  PastPaperAsset,
  PastPaperMarkingIssue,
  PastPaperProcessingJob,
  PastPaperQuestion,
  PastPaperQuestionMark,
  PastPaperRemark,
  ProcessingDiagnostics,
  ProcessingStage,
  AIRequestDiagnostic,
  ChoiceExtractionQuality,
  MarkSchemeAlignmentQuality,
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
  "marking answers",
  "remarking question",
] as const;

type ProcessingProgressUpdate = {
  stage: ProcessingStage;
  percent: number;
  diagnostics: ProcessingDiagnostics;
};

type ProcessPaperOptions = {
  model?: string;
  fallbackModels?: string[];
  allowMarkSchemeRecovery?: boolean;
};

const MAX_EXTRACTION_PAGES_PER_CHUNK = 3;
const QUESTION_EXTRACTION_FAILURE =
  "Question extraction appears incomplete or hallucinated. Metadata was read, but extracted questions did not match the paper.";
const NEUTRAL_PLACEHOLDER_PATTERN = /__(?:[A-Z0-9]+_?)+__/;
const COPIED_SEMANTIC_EXAMPLE_PATTERN = /\b(?:state\s+one\s+purpose\s+of\s+secondary\s+storage|explain\s+(?:one\s+|two\s+|the\s+)?benefits?\s+of\s+secondary\s+storage)\b/i;
const UNSUPPORTED_FORMAT_PATTERN =
  /\b(?:tick\s*\(\s*3\s*\)\s*(?:one|one or more)\s+boxes?\s+(?:in|on)\s+each\s+row|tick\s+one\s+box\s+(?:in|on)\s+each\s+row|tick\s+one\s+box\s+for\s+each\s+row|one\s+box\s+(?:in|on)\s+each\s+row|row[-\s]?by[-\s]?row|each\s+row|complete\s+(?:the\s+)?(?:trace\s+|truth\s+|data\s+)?table|complete\s+table|complete\s+the\s+description\b.+\b(?:given\s+list|list\s+of\s+terms)|given\s+list\s+of\s+terms|not\s+all\s+terms\s+will\s+be\s+used|fill\s+in\s+(?:the\s+)?(?:trace\s+|truth\s+|data\s+)?table|table\s+by\s+writing|trace\s+table|truth\s+table|matching\s+table|matching\s+grid|matrix|grid|draw\s+(?:a\s+)?line\s+from|match\s+each|complete\s+the\s+diagram|label\s+the\s+diagram|label\s+the\s+image|fill\s+labels?|plot\s+(?:a\s+)?graph|draw|shade|sketch|annotate)\b/i;

export const supportedQuestionTypeLabels = [
  "Short written answer",
  "Long written answer",
  "Calculation or numeric answer",
  "Simple single checkbox or radio choice",
  "Simple multiple checkbox choice",
] as const;

export class MarkSchemeAlignmentError extends Error {
  details: Record<string, unknown>;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "MarkSchemeAlignmentError";
    this.details = details;
  }
}

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
  const convertedContent = question.convertedContent ?? {};
  const source = [
    question.promptText,
    question.originalFormat,
    question.convertedFormat ?? "",
    question.evidenceSnippet ?? "",
    question.extractionWarnings?.join(" ") ?? "",
    typeof originalContent.unsupportedReason === "string" ? originalContent.unsupportedReason : "",
  ].join(" ");
  const responseTypeSupported = ["long_text", "short_text", "numeric", "single_choice", "multi_select"].includes(question.responseType);
  const extractedChoice = question.responseType === "single_choice" || question.responseType === "multi_select" ? extractChoiceStructure(question.promptText) : null;
  const recoveredChoiceOptions = extractedChoice?.quality === "deterministic" ? extractedChoice.options : [];
  const storedChoiceQuality =
    typeof originalContent.choiceExtractionQuality === "string"
      ? (originalContent.choiceExtractionQuality as ChoiceExtractionQuality)
      : typeof convertedContent.choiceExtractionQuality === "string"
        ? (convertedContent.choiceExtractionQuality as ChoiceExtractionQuality)
        : extractedChoice?.quality ?? "none";
  const simpleChoiceMissingOptions =
    (question.responseType === "single_choice" || question.responseType === "multi_select") && !question.options.length && recoveredChoiceOptions.length < 2;
  const ambiguousChoiceFormat =
    (question.responseType === "single_choice" || question.responseType === "multi_select") &&
    (storedChoiceQuality === "ambiguous" || Boolean(originalContent.choiceStructureAmbiguous));
  const unsupported =
    !responseTypeSupported ||
    question.responseType === "unsupported" ||
    UNSUPPORTED_FORMAT_PATTERN.test(source) ||
    Boolean(originalContent.unsupportedQuestionFormat) ||
    ambiguousChoiceFormat ||
    (simpleChoiceMissingOptions && /\b(?:tick|select|choose|shade|circle)\b/i.test(source));

  if (!unsupported) return null;
  const reported = typeof originalContent.unsupportedReportedAt === "string";
  const reason =
    typeof originalContent.unsupportedReason === "string"
      ? originalContent.unsupportedReason
      : UNSUPPORTED_FORMAT_PATTERN.test(source)
      ? "This looks like a table, grid, matrix, or row-by-row checkbox question. The current answer UI only supports simple choices, written answers, and calculations."
        : ambiguousChoiceFormat
          ? "This choice question did not extract into a reliable option list, so it was kept unsupported instead of guessing."
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
    const config = resolveAIModelConfig(model);
    diagnostics.promptStats.push({ label, charCount: prompt.length, pageNumbers, imageCount, model, modelLabel: config.label, provider: config.provider });
    log(diagnostics.currentStage, "info", `${label} prompt prepared`, { promptChars: prompt.length, pageNumbers, imageCount, model, modelLabel: config.label, provider: config.provider });
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

const FRONT_MATTER_SIGNAL_PATTERN =
  /\b(?:for examiner['’]?s use|question mark|total|centre number|candidate number|surname|forename|candidate signature|time allowed|materials|instructions|information|advice|answer all questions|use black ink|do not write outside the box|in the spaces provided|write the question number against your answer|foundation tier|higher tier|turn over|blank page)\b/i;
const FRONT_MATTER_STRIP_PATTERN =
  /(?:for examiner['’]?s use|question mark|total|centre number|candidate number|surname|forename(?:\(s\))?|candidate signature|time allowed|materials|instructions|information|advice|answer all questions|use black ink|do not write outside the box|in the spaces provided|write the question number against your answer(?:\(s\))?|do all rough work in this book|cross through any work you do not want to be marked|foundation tier|higher tier|turn over|blank page|gcse\s+[a-z][a-z &/-]+paper\s+\d+[a-z]?|IB\/[A-Z0-9/.-]+)/gi;
const FORMULA_PAGE_PATTERN = /\b(?:equation sheet|formulae? sheet|data sheet|periodic table)\b/i;
const NO_QUESTION_PAGE_PATTERN = /\b(?:there are no questions printed on this page|do not write on this page|answer in the spaces provided)\b/i;
const AQA_QUESTION_MARKER_PATTERN = /(?:0\s*)?((?:\d\s*){1,2})\s*\.\s*(\d{1,2})/g;

type DeterministicPageRole = "cover" | "instructions" | "questions" | "blank" | "formula" | "mark_scheme" | "other";

type PreparedDeterministicPage = {
  pageNumber: number;
  role: DeterministicPageRole;
  text: string;
  ignoredFrontMatter: string | null;
  firstQuestionMarker: string | null;
};

function stripAqaInstructionFragments(text: string) {
  return text
    .replace(FRONT_MATTER_STRIP_PATTERN, " ")
    .replace(/\b(?:Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Monday)\s+\d{1,2}\s+[A-Z][a-z]+\s+20\d{2}\b/gi, " ")
    .replace(/\b(?:afternoon|morning)\b/gi, " ")
    .replace(/\b(?:please write clearly in block capitals|fill in the boxes at the top of this page)\b/gi, " ")
    .replace(/^\s*\.?\s*(?:0\s*)?(?:\d\s*){1,2}(?!\s*\.)\s*/i, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeAqaMainQuestionToken(text: string) {
  return text.replace(/\s+/g, "");
}

function cleanAqaQuestionNumber(main: string, sub: string) {
  return `${Number(normalizeAqaMainQuestionToken(main))}.${Number(sub)}`;
}

function detectLeadingAqaMainIntro(text: string) {
  const firstMarker = findFirstAqaQuestionMarker(text);
  if (!firstMarker) return null;
  const prefix = text.slice(0, firstMarker.index).trim();
  if (!prefix) return null;
  const match = prefix.match(/^\s*\.?\s*(?:0\s*)?((?:\d\s*){1,2})(?!\s*\.)\s+([\s\S]+)$/);
  if (!match) return null;
  return {
    mainQuestionNumber: Number(normalizeAqaMainQuestionToken(match[1])),
    prefix,
  };
}

export function isTransientMarkingError(reason: unknown): boolean {
  const message = reason instanceof Error ? reason.message : String(reason);
  return /\b(quota|rate limit|rate-limit|too many requests|429|temporarily unavailable|timeout|timed out|network|fetch failed|proxy)\b/i.test(message);
}

export function retryAfterMsFromError(reason: unknown): number | null {
  if (reason instanceof AIProviderError && typeof reason.retryAfterMs === "number") return reason.retryAfterMs;
  const message = reason instanceof Error ? reason.message : String(reason);
  const secondsMatch = message.match(/retry in\s+(\d+(?:\.\d+)?)s/i);
  if (secondsMatch) return Math.ceil(Number(secondsMatch[1]) * 1000);
  if (/\b(quota|rate limit|429)\b/i.test(message)) return 60_000;
  return null;
}

export function createMarkingIssue(
  questionId: string,
  type: PastPaperMarkingIssue["type"],
  message: string,
  options: {
    rawMessage?: string | null;
    retryAfterMs?: number | null;
    reportedAt?: string | null;
    reportType?: PastPaperMarkingIssue["reportType"];
    metadata?: Record<string, unknown> | null;
  } = {},
): PastPaperMarkingIssue {
  return {
    questionId,
    type,
    message,
    rawMessage: options.rawMessage ?? null,
    retryAfterMs: options.retryAfterMs ?? null,
    reportedAt: options.reportedAt ?? null,
    reportType: options.reportType ?? null,
    metadata: options.metadata ?? null,
    createdAt: nowIso(),
  };
}

function findFirstAqaQuestionMarker(text: string) {
  for (const match of text.matchAll(AQA_QUESTION_MARKER_PATTERN)) {
    const index = match.index ?? 0;
    if (!isLikelyAqaQuestionMarker(text, index, match[0], match[1], match[2])) continue;
    const marker = cleanAqaQuestionNumber(match[1], match[2]);
    const suffix = text.slice(index, Math.min(text.length, index + 320));
    const hasMarksNearby = /\[\s*\d{1,2}\s*marks?\s*]|\[\s*\d{1,2}\s*]/i.test(suffix);
    const hasQuestionStem =
      /(?:this question is about|where|what|which|describe|explain|calculate|give|state|complete|figure\s+\d+\s+shows|tick one box|tick two boxes|tick one|identify|suggest|compare|evaluate)/i.test(
        suffix,
      ) || /[A-Z][^.!?]{12,}[?.]/.test(suffix);
    if (!hasMarksNearby && !hasQuestionStem) continue;
    return { index, marker };
  }
  return null;
}

function isLikelyAqaQuestionMarker(text: string, index: number, rawMatch: string, main: string, sub: string) {
  const normalizedMain = Number(normalizeAqaMainQuestionToken(main));
  const normalizedSub = Number(sub);
  if (!Number.isInteger(normalizedMain) || !Number.isInteger(normalizedSub) || normalizedMain <= 0 || normalizedSub <= 0) return false;
  const prefix = text.slice(Math.max(0, index - 24), index);
  const suffix = text.slice(index, Math.min(text.length, index + 420));
  const hasMarksNearby = /\[\s*\d{1,2}\s*marks?\s*]|\[\s*\d{1,2}\s*]/i.test(suffix);
  const hasQuestionStem =
    /\b(?:describe|explain|suggest|give|state|plot|predict|complete|calculate|compare|evaluate|which|what|why|how|draw|identify|use data|tick)\b/i.test(
      suffix,
    ) || /[?.]/.test(suffix);
  if (!hasMarksNearby || !hasQuestionStem) return false;
  const looksLikeFormattedMarker =
    /^\s*0\s*\d/.test(rawMatch) || /\d\s+\d/.test(main) || /\s\.\s|\s\.|\.\s/.test(rawMatch);
  const strongBoundary =
    !prefix.trim() ||
    /(?:[[(,:;]|^)\s*$/.test(prefix) ||
    /\b(?:answer all questions in the spaces provided|do not write outside the box|turn over for the next question|question \d+ continues on the next page)\s*$/i.test(
      prefix,
    );
  const immediateSuffix = text.slice(index + rawMatch.length, Math.min(text.length, index + rawMatch.length + 18));
  if (!looksLikeFormattedMarker && /^\s*(?:N\/kg|kg|g|mg|mol(?:\/dm3)?|cm(?:3)?|dm(?:3)?|mm|m|s|ms|A|V|W|kW|MW|J|kJ|MJ|GJ|Hz|pH|%|°C|Ω|ohm\b)/i.test(immediateSuffix)) {
    return false;
  }
  return looksLikeFormattedMarker || strongBoundary;
}

function classifyDeterministicPage(page: PagePromptContext, style: ReturnType<typeof detectDeterministicPaperStyle>): PreparedDeterministicPage {
  const cleaned = cleanExamPageTextForParsing(page.text);
  if (!cleaned) return { pageNumber: page.pageNumber, role: "blank", text: "", ignoredFrontMatter: null, firstQuestionMarker: null };
  if (FORMULA_PAGE_PATTERN.test(cleaned)) {
    return { pageNumber: page.pageNumber, role: "formula", text: cleaned, ignoredFrontMatter: null, firstQuestionMarker: null };
  }

  if (style === "aqa_dotted") {
    const marker = findFirstAqaQuestionMarker(cleaned);
    const hasFrontMatterSignals = FRONT_MATTER_SIGNAL_PATTERN.test(cleaned) || /GCSE\s+[A-Z]/i.test(cleaned);
    if (!marker && NO_QUESTION_PAGE_PATTERN.test(cleaned)) {
      return { pageNumber: page.pageNumber, role: "blank", text: "", ignoredFrontMatter: cleaned.slice(0, 220), firstQuestionMarker: null };
    }
    if (!marker) {
      const role = hasFrontMatterSignals ? (page.pageNumber === 1 ? "cover" : "instructions") : "other";
      return { pageNumber: page.pageNumber, role, text: role === "other" ? cleaned : "", ignoredFrontMatter: role === "other" ? null : cleaned.slice(0, 220), firstQuestionMarker: null };
    }

    const prefix = cleaned.slice(0, marker.index).trim();
    if (prefix && (hasFrontMatterSignals || FRONT_MATTER_SIGNAL_PATTERN.test(prefix))) {
      const preservedPrefix = stripAqaInstructionFragments(prefix);
      return {
        pageNumber: page.pageNumber,
        role: "questions",
        text: joinPromptParts(preservedPrefix, cleaned.slice(marker.index).trim()),
        ignoredFrontMatter: prefix.slice(0, 240),
        firstQuestionMarker: marker.marker,
      };
    }

    return {
      pageNumber: page.pageNumber,
      role: "questions",
      text: cleaned,
      ignoredFrontMatter: null,
      firstQuestionMarker: marker.marker,
    };
  }

  return { pageNumber: page.pageNumber, role: "questions", text: cleaned, ignoredFrontMatter: null, firstQuestionMarker: null };
}

function prepareDeterministicPages(pages: PagePromptContext[], style: ReturnType<typeof detectDeterministicPaperStyle>) {
  return pages.map((page) => classifyDeterministicPage(page, style));
}

function parseVisiblePaperTotalMarks(coverText: string) {
  const match =
    coverText.match(/total marks?\s+(?:for this paper\s+)?(?:is|are)\s+(\d{1,3})/i) ??
    coverText.match(/there are\s+(\d{1,3})\s+marks available/i);
  return match ? Number(match[1]) : null;
}

function parseVisibleAqaQuestionCount(coverText: string) {
  const examinerUse = coverText.match(/for examiner['’]?s use\s+question mark\s+(.+?)\s+total/i);
  if (!examinerUse) return null;
  const digits = [...examinerUse[1].matchAll(/\b(\d{1,2})\b/g)].map((match) => Number(match[1])).filter((value) => Number.isInteger(value) && value > 0 && value <= 40);
  return digits.length ? Math.max(...digits) : null;
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
  if (
    aqaDottedMatches.length >= 1 &&
    /\b(?:for examiner'?s use|candidate number|question mark|time allowed|foundation tier|higher tier|answer all questions|materials|instructions)\b/i.test(combined)
  ) {
    return "aqa_dotted" as const;
  }
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

function cleanAqaQuestionPromptArtifacts(text: string) {
  return normalizeDeterministicPromptText(
    text
      .replace(/\bTurn over for the next question\b/gi, " ")
      .replace(/\bQuestion \d+ continues on the next page\b/gi, " ")
      .replace(/\bEND OF QUESTIONS?\b/gi, " ")
      .replace(/\bUse the [A-Za-z ]+ Sheet to answer questions\b[\s\S]*$/i, " ")
      .replace(/([?.])\s+(?:\d+\s*){1,4}$/g, "$1"),
  );
}

function inferDeterministicResponseType(promptText: string, maxMarks: number): PastPaperQuestion["responseType"] {
  const text = promptText.toLowerCase();
  const extractedChoice = extractChoiceStructure(promptText);
  if (extractedChoice.hasChoiceInstruction && extractedChoice.options.length >= 2) {
    return inferChoiceResponseType(promptText, "single_choice");
  }
  if (/\bdiscuss\b|\bjustify\b|\bevaluate\b|\bcompare\b|\bdescribe\b|\bexplain\b/.test(text) || maxMarks >= 5) return "long_text";
  return "short_text";
}

function mainQuestionLabelFromQuestionNumber(questionNumber: string) {
  return questionNumber.match(/^\d+/)?.[0] ?? questionNumber.replace(/\*$/, "");
}

function normalizeVisualLabel(kind: string, identifier: string) {
  const baseKind = kind[0].toUpperCase() + kind.slice(1).toLowerCase();
  return `${baseKind} ${identifier.toUpperCase()}`;
}

function extractVisualLabelMatches(promptText: string) {
  const matches: Array<{ kind: string; label: string }> = [];
  const pattern = /\b(Figure|Table|Diagram|Graph|Map)\s+([A-Z]?\d+[A-Z]?)\b|\b(Source)\s+([A-Z])\b/gi;
  for (const match of promptText.matchAll(pattern)) {
    const kind = (match[1] ?? match[3] ?? "").toLowerCase();
    const identifier = match[2] ?? match[4] ?? "";
    if (!kind || !identifier) continue;
    matches.push({ kind, label: normalizeVisualLabel(kind, identifier) });
  }
  return matches;
}

export function buildVisualLabelPageIndex(paperPages: PagePromptContext[]) {
  const index = new Map<string, number[]>();
  for (const page of paperPages) {
    for (const match of extractVisualLabelMatches(page.text)) {
      const key = match.label.toLowerCase();
      const pages = index.get(key) ?? [];
      if (!pages.includes(page.pageNumber)) pages.push(page.pageNumber);
      index.set(key, pages.sort((a, b) => a - b));
    }
  }
  return index;
}

function bestVisualPageForQuestion(labelPages: number[], questionPages: number[]) {
  if (!labelPages.length) return null;
  for (const questionPage of questionPages) {
    if (labelPages.includes(questionPage)) return questionPage;
  }
  for (const questionPage of questionPages) {
    if (labelPages.includes(questionPage - 1)) return questionPage - 1;
    if (labelPages.includes(questionPage + 1)) return questionPage + 1;
  }
  return [...labelPages].sort((a, b) => {
    const distanceA = Math.min(...questionPages.map((page) => Math.abs(page - a)));
    const distanceB = Math.min(...questionPages.map((page) => Math.abs(page - b)));
    return distanceA - distanceB || a - b;
  })[0] ?? labelPages[0] ?? null;
}

function buildDeterministicQuestion(
  questionNumber: string,
  promptText: string,
  maxMarks: number,
  pageReferences: number[],
): QuestionExtractionOutput["questions"][number] | null {
  const cleanedPrompt = normalizeDeterministicPromptText(promptText);
  if (!cleanedPrompt || maxMarks <= 0) return null;
  const extractedChoice = extractChoiceStructure(cleanedPrompt);
  const explicitChoiceQuestion = extractedChoice.hasChoiceInstruction;
  const cleanChoiceOptions = extractedChoice.options.length >= 2 ? extractedChoice.options : [];
  const unreliableChoiceQuestion = explicitChoiceQuestion && cleanChoiceOptions.length < 2;
  const unsupported = UNSUPPORTED_FORMAT_PATTERN.test(cleanedPrompt) || unreliableChoiceQuestion;
  const responseType = unsupported
    ? "unsupported"
    : explicitChoiceQuestion
      ? inferChoiceResponseType(cleanedPrompt, "single_choice")
      : inferDeterministicResponseType(cleanedPrompt, maxMarks);
  const mediaRefs = extractDeterministicMediaRefs(cleanedPrompt, pageReferences, questionNumber);
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
      ...(explicitChoiceQuestion ? { choiceExtractionQuality: extractedChoice.quality } : {}),
      ...(unsupported
        ? {
            unsupportedQuestionFormat: true,
            unsupportedReason: unreliableChoiceQuestion
              ? "Multiple-choice options could not be extracted reliably."
              : "This looks like a table, grid, matrix, or row-by-row checkbox question. The current answer UI only supports simple choices, written answers, and calculations.",
          }
        : {}),
    },
    convertedContent: {},
    options: cleanChoiceOptions,
    pageReferences: [...new Set(pageReferences)].sort((a, b) => a - b),
    mediaRefs,
    markSchemeRef: null,
    markSchemeData: null,
  };
}

function extractDeterministicMediaRefs(promptText: string, pageReferences: number[], questionNumber: string): MediaRef[] {
  const matches = extractVisualLabelMatches(promptText);
  if (!matches.length) return [];
  const seen = new Set<string>();
  return matches
    .map((match, index) => {
      const kind = match.kind.toLowerCase();
      const label = match.label;
      const key = `${kind}:${label.toLowerCase()}`;
      if (seen.has(key)) return null;
      seen.add(key);
      return {
        id: `media-${questionNumber.replace(/[^a-z0-9]+/gi, "-").replace(/(^-|-$)/g, "").toLowerCase() || "question"}-${index + 1}`,
        kind: kind === "source" ? "source_extract" : kind,
        label,
        description: null,
        sourceAssetId: null,
        pageNumber: null,
        metadata: { inferredFromPrompt: true, questionPages: [...new Set(pageReferences)].sort((a, b) => a - b) },
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
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
    const tokenPattern =
      /\[\s*(\d{1,2})\s*(?:marks?)?\s*]|(?<![a-z])\(([ivx]+)\)(?![a-z])|(?:^|\s)(\d{1,2}\*?)\s*\(([a-hj-z])\)(?![a-z])|(?<![a-z])\(([a-hj-z])\)(?![a-z])|\b(\d{1,2}\*?)(?=\s+[A-Z])/gi;
    let cursor = 0;

    for (const match of pageText.matchAll(tokenPattern)) {
      const index = match.index ?? 0;
      appendPrompt(pageText.slice(cursor, index), page.pageNumber);
      cursor = index + match[0].length;

      if (match[6]) {
        if (!isLikelyOcrMainQuestionStart(pageText, index)) continue;
        currentMain = match[6];
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

      if (match[3] && match[4]) {
        if (!isLikelyOcrMainQuestionStart(pageText, index)) continue;
        currentMain = match[3];
        currentLetter = match[4].toLowerCase();
        currentRoman = null;
        activeLevel = "letter";
        mainStem = "";
        letterStem = "";
        currentPrompt = "";
        mainStemPages = new Set<number>();
        letterStemPages = new Set<number>();
        currentPromptPages = new Set<number>();
        continue;
      }

      if (match[5]) {
        if (!currentMain) continue;
        if (activeLevel === "main") absorbCurrentIntoMainStem();
        currentLetter = match[5].toLowerCase();
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

function extractAqaDottedQuestionsFromPages(pages: PagePromptContext[]) {
  const questions: QuestionExtractionOutput["questions"] = [];
  const preparedPages = prepareDeterministicPages(pages, "aqa_dotted");
  let currentQuestionNumber: string | null = null;
  let currentPrompt = "";
  let currentPromptPages = new Set<number>();
  let currentMaxMarks: number | null = null;
  let pendingPrefix = "";
  let pendingPrefixPages = new Set<number>();
  let currentPrefix = "";

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

  const finalizeCurrentQuestion = () => {
    if (!currentQuestionNumber || currentMaxMarks === null) return;
    const promptText = joinPromptParts(currentPrefix, currentPrompt);
    const pageReferences = [...new Set([...pendingPrefixPages, ...currentPromptPages])].sort((a, b) => a - b);
    const built = buildDeterministicQuestion(currentQuestionNumber, promptText, currentMaxMarks, pageReferences);
    if (built) questions.push(built);
    currentPrompt = "";
    currentPromptPages = new Set<number>();
    currentPrefix = "";
    currentMaxMarks = null;
    pendingPrefix = "";
    pendingPrefixPages = new Set<number>();
    currentQuestionNumber = null;
  };

  for (const page of preparedPages) {
    if (page.role === "cover" || page.role === "instructions" || page.role === "blank") continue;
    const pageText = page.text;
    if (!pageText) continue;
    const activeMainQuestion = currentQuestionNumber ? Number(currentQuestionNumber.split(".")[0]) : null;
    const leadingIntro =
      currentQuestionNumber && currentMaxMarks !== null && activeMainQuestion !== null ? detectLeadingAqaMainIntro(pageText) : null;
    if (leadingIntro && leadingIntro.mainQuestionNumber !== activeMainQuestion) {
      finalizeCurrentQuestion();
    }
    const tokenPattern = /(?:0\s*)?((?:\d\s*){1,2})\s*\.\s*(\d{1,2})|\[\s*(\d{1,2})\s*(?:marks?)?\s*]/gi;
    let cursor = 0;

    for (const match of pageText.matchAll(tokenPattern)) {
      const index = match.index ?? 0;
      const segment = pageText.slice(cursor, index);
      if (currentQuestionNumber) appendPrompt(segment, page.pageNumber);
      else appendOutside(segment, page.pageNumber);
      cursor = index + match[0].length;

      if (match[1] && match[2]) {
        if (!isLikelyAqaQuestionMarker(pageText, index, match[0], match[1], match[2])) {
          if (currentQuestionNumber) appendPrompt(match[0], page.pageNumber);
          else appendOutside(match[0], page.pageNumber);
          continue;
        }
        if (currentQuestionNumber && currentMaxMarks !== null) finalizeCurrentQuestion();
        const nextQuestionNumber = cleanAqaQuestionNumber(match[1], match[2]);
        const prefix = normalizeDeterministicPromptText(stripAqaInstructionFragments(pendingPrefix));
        currentQuestionNumber = nextQuestionNumber;
        currentPrefix = prefix;
        currentPrompt = "";
        currentPromptPages = new Set<number>();
        currentMaxMarks = null;
        continue;
      }

      if (match[3] && currentQuestionNumber) {
        currentMaxMarks = Number(match[3]);
      }
    }

    const tail = pageText.slice(cursor);
    if (currentQuestionNumber) appendPrompt(tail, page.pageNumber);
    else appendOutside(tail, page.pageNumber);
    if (!currentQuestionNumber) {
      pendingPrefix = "";
      pendingPrefixPages = new Set<number>();
    }
  }

  if (currentQuestionNumber && currentMaxMarks !== null) finalizeCurrentQuestion();

  return questions;
}

function extractDeterministicQuestionsFromPages(pages: PagePromptContext[]) {
  const style = detectDeterministicPaperStyle(pages);
  if (style === "aqa_dotted") return extractAqaDottedQuestionsFromPages(pages);
  if (style === "ocr_hierarchical") return extractOcrStyleQuestionsFromPages(pages);
  return [];
}

function repairAqaDottedQuestions(questions: QuestionExtractionOutput["questions"]) {
  const repaired = questions.map((question) => {
    const promptText = cleanAqaQuestionPromptArtifacts(question.promptText);
    return {
      ...question,
      promptText,
      mediaRefs: extractDeterministicMediaRefs(promptText, question.pageReferences, question.questionNumber),
      originalContent: {
        ...question.originalContent,
        evidenceSnippet: promptText.slice(0, 240),
      },
    };
  });

  for (let index = 0; index < repaired.length - 1; index += 1) {
    const current = repaired[index];
    const next = repaired[index + 1];
    const currentMatch = current.questionNumber.match(/^(\d+)\.(\d+)$/);
    const nextMatch = next.questionNumber.match(/^(\d+)\.(\d+)$/);
    if (!currentMatch || !nextMatch) continue;
    const currentMain = Number(currentMatch[1]);
    const nextMain = Number(nextMatch[1]);
    if (nextMain <= currentMain) continue;
    const splitIndex = current.promptText.search(/\bThis question is about\b/i);
    if (splitIndex <= 20) continue;
    const stolenIntro = current.promptText.slice(splitIndex).trim();
    if (!stolenIntro || /^This question is about\b/i.test(next.promptText)) continue;
    const currentPrompt = cleanAqaQuestionPromptArtifacts(current.promptText.slice(0, splitIndex));
    const nextPrompt = cleanAqaQuestionPromptArtifacts(joinPromptParts(stolenIntro, next.promptText));
    current.promptText = currentPrompt;
    current.mediaRefs = extractDeterministicMediaRefs(currentPrompt, current.pageReferences, current.questionNumber);
    current.originalContent = { ...current.originalContent, evidenceSnippet: currentPrompt.slice(0, 240) };
    next.promptText = nextPrompt;
    next.mediaRefs = extractDeterministicMediaRefs(nextPrompt, next.pageReferences, next.questionNumber);
    next.originalContent = { ...next.originalContent, evidenceSnippet: nextPrompt.slice(0, 240) };
  }

  return repaired.filter((question) => question.promptText.trim().length > 0);
}

export function buildDeterministicProcessedPaperOutput(paper: PastPaper, paperPages: PagePromptContext[]): ProcessedPaperOutput | null {
  if (!hasMeaningfulText(paperPages)) return null;
  const style = detectDeterministicPaperStyle(paperPages);
  const coverText = paperPages[0]?.text ?? "";
  const questionCountLimit = style === "aqa_dotted" ? parseVisibleAqaQuestionCount(coverText) : null;
  const extractedQuestions = extractDeterministicQuestionsFromPages(paperPages);
  const rawQuestions = dedupeQuestions(style === "aqa_dotted" ? repairAqaDottedQuestions(extractedQuestions) : extractedQuestions);
  const questions =
    style === "aqa_dotted" && questionCountLimit
      ? rawQuestions.filter((question) => {
          const match = question.questionNumber.match(/^(\d+)\.(\d+)$/);
          if (!match) return true;
          const main = Number(match[1]);
          const sub = Number(match[2]);
          return main >= 1 && main <= questionCountLimit && sub >= 1 && sub <= 20;
        })
      : rawQuestions;
  if (!questions.length) return null;
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
    "Likely cause: scanned/image-only paper and the selected AI vision call failed or the page images were not usable.",
    "Recovery: run the AI smoke test, retry with a fallback model, or export diagnostics. The app will not invent questions from blank text.",
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
      `AI provider timed out while ${stage}.`,
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
          provider: resolveAIModelConfig(input.options.model ?? DEFAULT_AI_MODEL).provider,
          model: input.options.model ?? DEFAULT_AI_MODEL,
          modelLabel: modelLabelForModel(input.options.model ?? DEFAULT_AI_MODEL),
          fallbackFromModel: null,
          fallbackFromProvider: null,
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

function mergeMediaRefs(...items: Array<ProcessedPaperOutput["questions"][number]["mediaRefs"] | undefined>): MediaRef[] {
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

type MediaRef = ProcessedPaperOutput["questions"][number]["mediaRefs"][number];

const SUPERSCRIPT_DIGITS: Record<string, string> = {
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
  "+": "⁺",
  "-": "⁻",
};

const SUBSCRIPT_DIGITS: Record<string, string> = {
  "0": "₀",
  "1": "₁",
  "2": "₂",
  "3": "₃",
  "4": "₄",
  "5": "₅",
  "6": "₆",
  "7": "₇",
  "8": "₈",
  "9": "₉",
};

const GRAPH_COMPLETION_PATTERN = /\b(?:plot|draw|complete|label|shade|sketch)\b[\s\S]{0,80}\b(?:graph|chart|line of best fit|histogram|diagram|bar chart)\b/i;
const TABLE_COMPLETION_PATTERN = /\b(?:complete|fill in|fill out|finish)\b[\s\S]{0,40}\btable\b/i;
const WORD_BOX_PATTERN = /\b(?:word box|from the box|words from the box|correct word from the box|not all .* will be used|given list of terms)\b/i;
const VAGUE_VISUAL_REFERENCE_PATTERN = /\b(?:the results|this graph|the graph|the diagram|the table|the data|the method|the reaction|the student|the investigation|use the results|use the graph|use the data)\b/i;

function toSuperscript(value: string) {
  return value
    .split("")
    .map((char) => SUPERSCRIPT_DIGITS[char] ?? char)
    .join("");
}

function toSubscript(value: string) {
  return value
    .split("")
    .map((char) => SUBSCRIPT_DIGITS[char] ?? char)
    .join("");
}

function formatScientificDisplayText(text: string) {
  return text
    .replace(/\s*(?:-->|->|=>)\s*/g, " → ")
    .replace(/\b(cm|dm|mm|m)\s*3\b/g, (_match, unit: string) => `${unit}³`)
    .replace(/\b10\s*(?:\^?\s*-\s*(\d+))\b/g, (_match, power: string) => `10${toSuperscript(`-${power}`)}`)
    .replace(/\b([A-Z][a-z]?)(\d+)(?=[A-Z(]|$)/g, (_match, atom: string, count: string) => `${atom}${toSubscript(count)}`)
    .replace(/\b([A-Z][a-z]?)(\d+)([+-])\b/g, (_match, atom: string, count: string, charge: string) => `${atom}${toSubscript(count)}${toSuperscript(charge)}`)
    .replace(/\b([A-Z][a-z]?)([+-])\b/g, (_match, atom: string, charge: string) => `${atom}${toSuperscript(charge)}`)
    .replace(/\b([A-Za-z])\s*\^\s*(\d+)\b/g, (_match, base: string, power: string) => `${base}${toSuperscript(power)}`)
    .replace(/\s+/g, " ")
    .trim();
}

function displayBlocksFromPrompt(promptText: string) {
  const lines = promptText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const numberedLines = lines.filter((line) => /^(?:\d+[.)]|step\s+\d+)/i.test(line));
  if (numberedLines.length >= 2) {
    return [
      {
        type: "ordered_steps" as const,
        items: numberedLines.map((line) => formatScientificDisplayText(line.replace(/^(?:\d+[.)]|step\s+\d+[:.)]?)\s*/i, ""))),
      },
    ];
  }
  const bulletLines = lines.filter((line) => /^(?:[-•*])\s+/.test(line));
  if (bulletLines.length >= 2) {
    return [
      {
        type: "bullets" as const,
        items: bulletLines.map((line) => formatScientificDisplayText(line.replace(/^(?:[-•*])\s+/, ""))),
      },
    ];
  }
  if (/=|→|->|-->|=>/.test(promptText) && promptText.length <= 180) {
    return [
      {
        type: "equation" as const,
        text: formatScientificDisplayText(promptText),
        format: /[A-Z][a-z]?\d|→/.test(promptText) ? ("chemistry" as const) : ("math" as const),
      },
    ];
  }
  return [
    {
      type: "paragraph" as const,
      text: formatScientificDisplayText(promptText),
    },
  ];
}

function buildDeterministicDisplayPlan(promptText: string) {
  return {
    blocks: displayBlocksFromPrompt(promptText),
    notationWarnings: [] as string[],
    confidence: 78,
  };
}

export function resolveDeterministicMediaRefs(questions: ProcessedPaperOutput["questions"], paperPages: PagePromptContext[]): ProcessedPaperOutput["questions"] {
  const labelPageIndex = buildVisualLabelPageIndex(paperPages);
  const inheritedByMainQuestion = new Map<string, { ref: MediaRef; questionNumber: string }>();

  return questions.map((question) => {
    const mainQuestion = question.parentQuestionNumber ?? question.questionNumber.split(".")[0] ?? question.questionNumber;
    const questionPages = [...new Set(question.pageReferences)].sort((a, b) => a - b);
    const explicitRefs = mergeMediaRefs(question.mediaRefs, extractDeterministicMediaRefs(question.promptText, question.pageReferences, question.questionNumber));
    const resolvedRefs: MediaRef[] = explicitRefs.flatMap<MediaRef>((ref, index) => {
      const pages = labelPageIndex.get((ref.label ?? "").toLowerCase()) ?? [];
      const preferredPage = bestVisualPageForQuestion(pages, questionPages);
      if (preferredPage !== null) {
        return [{
          ...ref,
          pageNumber: preferredPage,
          metadata: {
            ...ref.metadata,
            fallback: false,
            candidatePages: pages,
          },
        }];
      }
      const fallbackPage = questionPages[0] ?? null;
      if (fallbackPage === null) return [];
      return [{
        ...ref,
        id: `${ref.id || `media-${question.questionNumber}`}-fallback-${index + 1}`,
        label: "Source page fallback",
        description: ref.label,
        pageNumber: fallbackPage,
        metadata: {
          ...ref.metadata,
          fallback: true,
          candidatePages: [],
          requestedLabel: ref.label,
        },
      }];
    });

    const successfulExplicitRef = resolvedRefs.find(
      (ref) => !(ref.metadata as Record<string, unknown> | undefined)?.fallback && typeof ref.pageNumber === "number",
    );
    if (successfulExplicitRef) {
      inheritedByMainQuestion.set(mainQuestion, { ref: successfulExplicitRef, questionNumber: question.questionNumber });
      return { ...question, mediaRefs: resolvedRefs };
    }

    const inherited = inheritedByMainQuestion.get(mainQuestion);
    const canInherit =
      inherited &&
      !resolvedRefs.length &&
      VAGUE_VISUAL_REFERENCE_PATTERN.test(question.promptText) &&
      !extractVisualLabelMatches(question.promptText).length;
    if (!canInherit) {
      return { ...question, mediaRefs: resolvedRefs };
    }

    return {
      ...question,
      mediaRefs: [
        ...resolvedRefs,
        {
          ...inherited.ref,
          id: `media-${question.questionNumber.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-inherited`,
          metadata: {
            ...inherited.ref.metadata,
            inheritedFromQuestionNumber: inherited.questionNumber,
            inferenceConfidence: 80,
          },
        },
      ],
    };
  });
}

function deterministicAnswerPlan(question: Pick<PastPaperQuestion, "responseType" | "promptText" | "options" | "diagramMediaRefs">) {
  const extractedChoice = question.responseType === "single_choice" || question.responseType === "multi_select" ? extractChoiceStructure(question.promptText) : null;
  return {
    kind:
      question.responseType === "numeric" || question.responseType === "single_choice" || question.responseType === "multi_select" || question.responseType === "unsupported"
        ? question.responseType
        : "plain_text",
    supported: question.responseType !== "unsupported",
    choiceExtractionQuality: extractedChoice?.quality ?? "none",
    requiresVisual: Boolean(question.diagramMediaRefs?.length),
    notes: [] as string[],
  };
}

function deterministicSupportDecision(question: ProcessedPaperOutput["questions"][number]) {
  const choice = extractChoiceStructure(question.promptText);
  const explicitOptions = question.options.length ? question.options : choice.quality === "deterministic" ? choice.options : [];
  if (GRAPH_COMPLETION_PATTERN.test(question.promptText)) {
    return { supported: false, responseType: "unsupported" as const, reason: "This question needs a graph, line, or diagram interaction that the current UI cannot represent.", choiceQuality: choice.quality };
  }
  if (TABLE_COMPLETION_PATTERN.test(question.promptText) || WORD_BOX_PATTERN.test(question.promptText) || UNSUPPORTED_FORMAT_PATTERN.test(question.promptText)) {
    return { supported: false, responseType: "unsupported" as const, reason: "This question needs a table, word box, grid, or spatial interaction that the current UI cannot represent safely.", choiceQuality: choice.quality };
  }
  const choiceQuestion = choice.hasChoiceInstruction || question.responseType === "single_choice" || question.responseType === "multi_select";
  if (choiceQuestion) {
    if (choice.hasChoiceInstruction && explicitOptions.length >= 2) {
      return {
        supported: true,
        responseType: inferChoiceResponseType(question.promptText, question.responseType === "multi_select" ? "multi_select" : "single_choice"),
        reason: "Choice options were extracted cleanly.",
        choiceQuality: explicitOptions.length >= 2 ? ("deterministic" as const) : choice.quality,
      };
    }
    return {
      supported: false,
      responseType: "unsupported" as const,
      reason:
        choice.quality === "ambiguous"
          ? "Multiple-choice options could not be extracted reliably."
          : "Multiple-choice options could not be extracted reliably.",
      choiceQuality: choice.quality,
    };
  }
  return {
    supported: question.responseType !== "unsupported",
    responseType: question.responseType === "unsupported" ? ("unsupported" as const) : question.responseType,
    reason: question.responseType === "unsupported" ? "This question format is not currently supported by the answer UI." : "This question is safely answerable in the current UI.",
    choiceQuality: choice.quality,
  };
}

function applyDeterministicSupportValidation(output: ProcessedPaperOutput): ProcessedPaperOutput {
  return {
    ...output,
    questions: output.questions.map((question) => {
      const decision = deterministicSupportDecision(question);
      return {
        ...question,
        responseType: decision.responseType,
        originalContent: {
          ...question.originalContent,
          choiceExtractionQuality: decision.choiceQuality,
          ...(decision.supported ? {} : { unsupportedQuestionFormat: true, unsupportedReason: decision.reason }),
        },
        convertedContent: {
          ...question.convertedContent,
          answerPlan: {
            kind:
              decision.responseType === "numeric" || decision.responseType === "single_choice" || decision.responseType === "multi_select" || decision.responseType === "unsupported"
                ? decision.responseType
                : "plain_text",
            supported: decision.supported,
            choiceExtractionQuality: decision.choiceQuality,
            requiresVisual: Boolean(question.mediaRefs.length),
            notes: [],
          },
        },
        options:
          (decision.responseType === "single_choice" || decision.responseType === "multi_select") && !question.options.length && decision.choiceQuality === "deterministic"
            ? extractChoiceStructure(question.promptText).options
            : question.options,
      };
    }),
  };
}

function applyDisplayPlans(output: ProcessedPaperOutput): ProcessedPaperOutput {
  return {
    ...output,
    questions: output.questions.map((question) => ({
      ...question,
      convertedContent: {
        ...question.convertedContent,
        displayPlan: buildDeterministicDisplayPlan(question.promptText),
        answerPlan:
          question.convertedContent && typeof question.convertedContent === "object" && (question.convertedContent as Record<string, unknown>).answerPlan
            ? (question.convertedContent as Record<string, unknown>).answerPlan
            : deterministicAnswerPlan({
                responseType: question.responseType,
                promptText: question.promptText,
                options: question.options,
                diagramMediaRefs: question.mediaRefs,
              } as PastPaperQuestion),
      },
    })),
  };
}

function reinterpretQuestionFormat(promptText: string, responseType: PastPaperQuestion["responseType"], options: string[]) {
  const trustChoiceTypeHint = options.length >= 2;
  const extractedChoice = responseType === "single_choice" || responseType === "multi_select" ? extractChoiceStructure(promptText, trustChoiceTypeHint) : null;
  const extracted =
    extractedChoice?.quality === "deterministic"
      ? { promptText: cleanPromptText(extractedChoice.promptText), options: extractedChoice.options }
      : responseType === "single_choice" || responseType === "multi_select"
        ? { promptText: cleanPromptText(promptText), options: [] }
        : { promptText: cleanPromptText(promptText), options: [] };
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
    visualRegions: output.visualRegions ?? [],
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

function exactQuestionMarkerPattern(questionNumber: string) {
  const normalized = normalizeDisplayQuestionNumber(questionNumber).replace(/\*/g, "");
  const roman = normalized.match(/^(\d+)\(([a-z])\)\(([ivx]+)\)$/i);
  if (roman) {
    const [, main, letter, numeral] = roman;
    return new RegExp(
      `(?:^|[^a-z0-9])(?:question\\s*|q\\s*)?0?${Number(main)}\\s*(?:\\(\\s*${letter}\\s*\\)|${letter}(?=\\s*(?:\\(|\\d|â€¢|[A-Z]|$)))\\s*(?:\\(\\s*${numeral}\\s*\\)|${numeral}(?=\\s*(?:\\d|â€¢|[A-Z]|$)))(?=\\s|[.):-]|$)`,
      "i",
    );
  }
  const letter = normalized.match(/^(\d+)\(([a-z])\)$/i);
  if (letter) {
    const [, main, subpart] = letter;
    return new RegExp(`(?:^|[^a-z0-9])(?:question\\s*|q\\s*)?0?${Number(main)}\\s*(?:\\(\\s*${subpart}\\s*\\)|${subpart}(?=\\s*(?:\\d|â€¢|[A-Z]|$)))(?=\\s|[.):-]|$)`, "i");
  }
  const dotted = normalized.match(/^(\d+)\.(\d+)$/);
  if (dotted) {
    const [, main, subpart] = dotted;
    return new RegExp(`(?:^|[^a-z0-9])(?:question\\s*|q\\s*)?0?${Number(main)}\\s*(?:[./)]|\\s*\\.\\s*)\\s*0?${Number(subpart)}(?=\\s|[.):-]|$)`, "i");
  }
  if (/^\d+\*?$/.test(normalized)) {
    return new RegExp(`(?:^|[^a-z0-9])(?:question\\s*|q\\s*)?0?${Number(normalized.replace(/\*/g, ""))}(?=\\s|[.):-]|$)`, "i");
  }
  return preciseMarkSchemeRegexForLabel(questionNumber);
}

export function markSchemeExactSubquestionRegex(questionNumber: string) {
  return exactQuestionMarkerPattern(questionNumber) ?? new RegExp(`\\b${questionNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
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
  /\b(?:mark\b|marks\b|guidance\b|correct answer(?: only)?|acceptable values?|e\.g\.|mark band|level\s+\d|ao\d?|allow\b|accept\b|ignore\b|do not\b|indicative content)\b/i;
const MARK_SCHEME_FRONT_MATTER_PATTERN =
  /\b(?:make sure that you have read and understood the mark scheme|if you are in any doubt about applying the mark scheme|need to get in touch|customer support centre)\b/i;
const MARK_SCHEME_HEADER_PATTERN =
  /\b(?:Question\s+Answer(?:s)?(?:\s+Extra information)?\s+Mark(?:\s+Guidance)?(?:\s+AO\s*\/\s*Spec\.\s*Ref\.)?)\b/i;
const AQA_MARK_SCHEME_ROW_MARKER =
  /(?:^|[\n\r\s])(?:question\s*)?0?\s*\d(?:\s*\d)?\s*[.)/]\s*\d{1,2}(?=\s|[.)/:;-]|$)/gi;

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

function questionMarkerMentions(text: string) {
  const mentions = [...text.matchAll(/(?:^|[^a-z0-9])(?:question\s*|q\s*)?(0?\d{1,2})(?:\s*(?:[./)]|\\.)\s*(\d{1,2})|\s*(?:\(\s*([a-z])\s*\)|([a-z]))(?:\s*(?:\(\s*([ivx]+)\s*\)|([ivx]+)))?)?/gi)];
  return mentions
    .map((match) => {
      const input = match.input ?? text;
      const index = match.index ?? 0;
      const prevChar = index > 0 ? input[index - 1] : "";
      const endIndex = index + (match[0]?.length ?? 0);
      const nextChar = input[endIndex] ?? "";
      const trailingSnippet = input.slice(endIndex, endIndex + 24);
      const main = Number(match[1]);
      if (!Number.isInteger(main) || main <= 0) return null;
      const sub = match[2] ? String(Number(match[2])) : null;
      const letter = (match[3] ?? match[4] ?? "").toLowerCase() || null;
      const roman = (match[5] ?? match[6] ?? "").toLowerCase() || null;
      const bareLetter = (match[4] ?? "").toLowerCase() || null;
      const bareRoman = (match[6] ?? "").toLowerCase() || null;
      if (sub && Number(sub) > 9) return null;
      if (!sub && !letter && !roman && (prevChar === "." || nextChar === ".")) return null;
      if (!sub && !letter && !roman && /^\s*(?:mark|marks|point|points|page|pages|line|lines|student|students|answer|answers|response|responses)\b/i.test(trailingSnippet)) {
        return null;
      }
      if (!sub && (bareLetter || bareRoman) && /^[a-z]{2,}/i.test(trailingSnippet)) {
        return null;
      }
      const normalized = sub ? `${main}.${sub}` : letter && roman ? `${main}(${letter})(${roman})` : letter ? `${main}(${letter})` : String(main);
      return normalized;
    })
    .filter((item): item is string => Boolean(item));
}

function dominantQuestionMarkers(text: string) {
  const counts = new Map<string, number>();
  for (const marker of questionMarkerMentions(text)) {
    counts.set(marker, (counts.get(marker) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([marker]) => marker);
}

function parentQuestionLabel(value: string) {
  return value.match(/^\d+/)?.[0] ?? null;
}

export function validateMarkSchemeAlignment(
  question: Pick<ProcessedPaperOutput["questions"][number], "questionNumber" | "parentQuestionNumber" | "maxMarks">,
  markSchemeData: Record<string, unknown> | null,
) {
  if (!markSchemeData) {
    return {
      quality: "missing" as MarkSchemeAlignmentQuality,
      confidence: 0,
      warnings: ["No aligned mark-scheme data was stored for this question."],
    };
  }

  const evidence = typeof markSchemeData.exactSectionText === "string"
    ? markSchemeData.exactSectionText
    : typeof markSchemeData.evidence === "string"
      ? markSchemeData.evidence
      : Array.isArray(markSchemeData.points)
        ? markSchemeData.points.filter((point): point is string => typeof point === "string" && point.trim().length > 0).join("\n")
      : Array.isArray(markSchemeData.rows)
        ? markSchemeData.rows
            .map((row) => (row && typeof row === "object" && typeof (row as Record<string, unknown>).markPoint === "string" ? String((row as Record<string, unknown>).markPoint) : ""))
            .filter(Boolean)
            .join("\n")
        : "";
  const normalizedEvidence = cleanMarkSchemeSectionText(evidence);
  const rows = Array.isArray(markSchemeData.rows) ? markSchemeData.rows : [];
  const hasStructuredRows = rows.some((row) => {
    if (!row || typeof row !== "object") return false;
    const value = row as Record<string, unknown>;
    const markPoint = typeof value.markPoint === "string" ? value.markPoint.trim() : "";
    const markPointHasSubstance = markPoint.length >= 6 || (/\s/.test(markPoint) && /[a-z]/i.test(markPoint));
    const hasShortExactPoint = markPoint.length >= 2 && (typeof value.marks === "number" || typeof value.marks === "string");
    return Boolean(
      markPointHasSubstance ||
        hasShortExactPoint ||
        (typeof value.guidance === "string" && value.guidance.trim()) ||
        (Array.isArray(value.accept) && value.accept.length) ||
        (Array.isArray(value.doNotAccept) && value.doNotAccept.length) ||
        (Array.isArray(value.ignore) && value.ignore.length),
    );
  });
  const hasStructuredPoints = Array.isArray(markSchemeData.points) && markSchemeData.points.some((point) => typeof point === "string" && point.trim().length > 0);
  const hasStructuredData = hasStructuredRows || hasStructuredPoints;
  const hasSubstance = MARK_SCHEME_CONTENT_SIGNAL_PATTERN.test(normalizedEvidence) || normalizedEvidence.length >= 24 || hasStructuredData;
  if (!normalizedEvidence) {
    return {
      quality: "missing" as MarkSchemeAlignmentQuality,
      confidence: 0,
      warnings: ["The aligned mark-scheme record did not contain readable evidence text."],
    };
  }

  const exactPattern = markSchemeExactSubquestionRegex(question.questionNumber);
  const exactMatch = exactPattern.test(normalizedEvidence);
  const markers = dominantQuestionMarkers(normalizedEvidence);
  const main = parentQuestionLabel(question.questionNumber);
  const parent = question.parentQuestionNumber ?? main;
  const referencesDifferentMain = Boolean(
    markers.length &&
      markers.every((marker) => parentQuestionLabel(marker) !== main) &&
      !exactMatch,
  );
  const maxMarks = markSchemeMaxMarks(markSchemeData);
  const marksMatch = maxMarks === null || question.maxMarks <= 0 || maxMarks === question.maxMarks;
  const matchedQuestionNumber =
    typeof markSchemeData.matchedMarkSchemeQuestionNumber === "string" && markSchemeData.matchedMarkSchemeQuestionNumber.trim()
      ? normalizeDisplayQuestionNumber(String(markSchemeData.matchedMarkSchemeQuestionNumber))
      : typeof markSchemeData.questionNumber === "string" && String(markSchemeData.questionNumber).trim()
        ? normalizeDisplayQuestionNumber(String(markSchemeData.questionNumber))
        : null;
  const matchedExactLabel = matchedQuestionNumber ? normalizeQuestionToken(matchedQuestionNumber) === normalizeQuestionToken(question.questionNumber) : false;
  const parentMentioned = parent ? new RegExp(`(?:^|[^a-z0-9])0?${Number(parent)}(?=\\s|[.)/:-]|$)`, "i").test(normalizedEvidence) : false;
  const warnings: string[] = [];
  const genericStoredEvidence = /\b(?:correct answer(?: only)?|acceptable values?)\b/i.test(normalizedEvidence);

  if (!hasSubstance) {
    warnings.push("The stored evidence did not contain enough visible mark-scheme content to trust the alignment.");
    return {
      quality: "missing" as MarkSchemeAlignmentQuality,
      confidence: 0,
      warnings,
    };
  }

  if (genericStoredEvidence && !matchedQuestionNumber && !exactMatch && !parentMentioned) {
    warnings.push("Using compact answer-key style evidence without a visible question-number marker.");
    return {
      quality: marksMatch ? ("nearby" as MarkSchemeAlignmentQuality) : ("broad_parent" as MarkSchemeAlignmentQuality),
      confidence: marksMatch ? 72 : 56,
      warnings,
    };
  }

  if (referencesDifferentMain) {
    warnings.push(`Evidence is dominated by another question section (${markers.slice(0, 3).join(", ")}).`);
    return {
      quality: "wrong_section" as MarkSchemeAlignmentQuality,
      confidence: 18,
      warnings,
    };
  }

  if (exactMatch || matchedExactLabel) {
    if (!marksMatch) warnings.push("Visible mark total does not match the question mark total.");
    return {
      quality: marksMatch ? ("exact" as MarkSchemeAlignmentQuality) : ("nearby" as MarkSchemeAlignmentQuality),
      confidence: marksMatch ? 92 : 78,
      warnings,
    };
  }

  if (parentMentioned) {
    warnings.push("Only the parent question section could be isolated; the exact subquestion row was not visible.");
    return {
      quality: "broad_parent" as MarkSchemeAlignmentQuality,
      confidence: marksMatch ? 58 : 48,
      warnings,
    };
  }

  if (!markers.length && !matchedQuestionNumber) {
    const genericMarkSchemeSignal = /\b(?:correct answer|acceptable values?|do not accept|do not award|also accept|accept|allow|ignore|guidance|award|mark point|marking points?)\b/i.test(normalizedEvidence);
    if (!hasStructuredData && !genericMarkSchemeSignal) {
      warnings.push("No reliable exact subquestion marker was visible in the aligned evidence.");
      return {
        quality: "missing" as MarkSchemeAlignmentQuality,
        confidence: 0,
        warnings,
      };
    }
    warnings.push(hasStructuredData ? "Using stored structured mark-scheme data without a visible question-number marker." : "Using mark-scheme evidence without a visible question-number marker.");
    return {
      quality: marksMatch ? ("nearby" as MarkSchemeAlignmentQuality) : ("broad_parent" as MarkSchemeAlignmentQuality),
      confidence: marksMatch ? 68 : 54,
      warnings,
    };
  }

  warnings.push("No reliable exact subquestion marker was visible in the aligned evidence.");
  return {
    quality: markers.length ? ("wrong_section" as MarkSchemeAlignmentQuality) : ("missing" as MarkSchemeAlignmentQuality),
    confidence: markers.length ? 24 : 0,
    warnings,
  };
}

function withValidatedAlignmentMetadata(
  question: Pick<ProcessedPaperOutput["questions"][number], "questionNumber" | "parentQuestionNumber" | "maxMarks">,
  markSchemeData: Record<string, unknown> | null,
  extras: { matchedQuestionNumber?: string | null; matchedPageNumbers?: number[]; matchedEvidenceText?: string; alignmentWarnings?: string[] } = {},
) {
  if (!markSchemeData) return null;
  const validation = validateMarkSchemeAlignment(question, markSchemeData);
  return {
    ...markSchemeData,
    alignmentQuality: validation.quality,
    alignmentConfidence: validation.confidence,
    alignedQuestionNumber: question.questionNumber,
    alignedParentQuestionNumber: question.parentQuestionNumber ?? null,
    matchedMarkSchemeQuestionNumber: extras.matchedQuestionNumber ?? (typeof markSchemeData.questionNumber === "string" ? markSchemeData.questionNumber : null),
    matchedPageNumbers: extras.matchedPageNumbers ?? (Array.isArray(markSchemeData.pageNumbers) ? markSchemeData.pageNumbers : []),
    matchedEvidenceText: extras.matchedEvidenceText ?? (typeof markSchemeData.evidence === "string" ? markSchemeData.evidence : ""),
    alignmentWarnings: [...new Set([...(Array.isArray(markSchemeData.alignmentWarnings) ? markSchemeData.alignmentWarnings.filter((item): item is string => typeof item === "string") : []), ...validation.warnings, ...(extras.alignmentWarnings ?? [])])],
  };
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

function isAqaDottedQuestionNumber(questionNumber: string) {
  return /^\d+\.\d+$/.test(normalizeDisplayQuestionNumber(questionNumber).replace(/\*/g, ""));
}

function normalizeAqaDottedMarkSchemeQuestionNumber(value: string) {
  const match = value.match(/0?\s*((?:\d\s*){1,2})\s*[.)/]\s*0?(\d{1,2})/i);
  if (!match) return null;
  return `${Number(normalizeAqaMainQuestionToken(match[1]))}.${Number(match[2])}`;
}

function aqaDottedMarkSchemeTargetRegex(questionNumber: string) {
  const normalized = normalizeDisplayQuestionNumber(questionNumber).replace(/\*/g, "");
  const match = normalized.match(/^(\d+)\.(\d+)$/);
  if (!match) return null;
  const mainPattern = match[1].split("").join("\\s*");
  const subPattern = match[2].split("").join("\\s*");
  return new RegExp(`(?:^|[\\n\\r\\s])(?:question\\s*)?0?\\s*${mainPattern}\\s*[.)/]\\s*0?\\s*${subPattern}(?=\\s|[.)/:;-]|$)`, "i");
}

function aqaMarkSchemeRowMarkers(text: string) {
  return [...text.matchAll(AQA_MARK_SCHEME_ROW_MARKER)]
    .map((match) => ({
      marker: normalizeAqaDottedMarkSchemeQuestionNumber(match[0]),
      index: match.index ?? 0,
    }))
    .filter((match): match is { marker: string; index: number } => Boolean(match.marker));
}

export function isGreedyOrWrongMarkSchemeSection(questionNumber: string, sectionText: string) {
  const target = normalizeDisplayQuestionNumber(questionNumber).replace(/\*/g, "");
  if (!isAqaDottedQuestionNumber(target)) return false;
  const markers = aqaMarkSchemeRowMarkers(sectionText);
  if (!markers.length) return false;
  return markers.some((marker, index) => index > 0 && marker.marker !== target && marker.index > 80);
}

export function validateDeterministicMarkSchemeSection(questionNumber: string, maxMarks: number, sectionText: string) {
  const openingText = cleanMarkSchemeSectionText(sectionText).slice(0, 160);
  const targetRegex = aqaDottedMarkSchemeTargetRegex(questionNumber) ?? markSchemeExactSubquestionRegex(questionNumber);
  if (!targetRegex.test(openingText)) {
    return { ok: false, reason: "Exact question marker was not visible near the start of the extracted mark-scheme section." };
  }
  if (isGreedyOrWrongMarkSchemeSection(questionNumber, sectionText)) {
    return { ok: false, reason: "The extracted mark-scheme section spilled into another question row." };
  }
  if (sectionText.length > (maxMarks <= 4 ? 1800 : 2600)) {
    return { ok: false, reason: "The extracted mark-scheme section was too large to trust as one exact row." };
  }
  const compactText = cleanMarkSchemeSectionText(sectionText);
  const remainder = compactText.replace(targetRegex, "").trim();
  const looksLikeCompactExactRow =
    compactText.length <= 220 &&
    /\b\d{1,2}\s*$/.test(compactText) &&
    /\b(?:[A-F0-9]{4,}|-?\d+(?:\.\d+)?|[A-Za-z]{3,})\b/.test(remainder);
  if (!MARK_SCHEME_CONTENT_SIGNAL_PATTERN.test(sectionText) && !/^[-•]/m.test(sectionText) && !looksLikeCompactExactRow) {
    return { ok: false, reason: "The extracted mark-scheme section did not contain enough visible marking signals." };
  }
  return { ok: true, reason: null };
}

export function extractAqaDottedMarkSchemeSection(questionNumber: string, markSchemePages: PagePromptContext[]) {
  const pages = markSchemeContentPages(markSchemePages);
  const combined = markSchemeTextWithMarkers(pages);
  if (!combined.trim()) return null;
  const matcher = aqaDottedMarkSchemeTargetRegex(questionNumber);
  if (!matcher) return null;
  const match = matcher.exec(combined);
  if (!match || match.index === undefined) return null;
  const subsequentRow = aqaMarkSchemeRowMarkers(combined).find((item) => item.index > match.index + Math.max(1, match[0].length));
  const endIndex = subsequentRow?.index ?? Math.min(combined.length, match.index + 1800);
  const rawSection = combined.slice(match.index, endIndex).trim();
  const text = cleanMarkSchemeSectionText(rawSection);
  if (!text) return null;
  const startPage = markSchemePageNumberAt(combined, match.index);
  const endPage = markSchemePageNumberAt(combined, Math.max(match.index, endIndex - 1));
  if (isGreedyOrWrongMarkSchemeSection(questionNumber, text)) return null;
  return {
    label: questionNumber,
    ref: `Mark scheme pages ${pageRange(startPage, endPage).join(", ")}, ${questionNumber}`,
    text,
    pageNumbers: pageRange(startPage, endPage),
  } satisfies DeterministicMarkSchemeSection;
}

export function extractExactAqaMarkSchemeRow(questionNumber: string, markSchemePages: PagePromptContext[]) {
  return extractAqaDottedMarkSchemeSection(questionNumber, markSchemePages);
}

function buildDeterministicMarkSchemeSections(labels: string[], markSchemePages: PagePromptContext[]) {
  const pages = markSchemeContentPages(markSchemePages);
  const combined = markSchemeTextWithMarkers(pages);
  if (!combined.trim()) return new Map<string, DeterministicMarkSchemeSection>();

  const sections = new Map<string, DeterministicMarkSchemeSection>();
  for (const label of labels) {
    if (!isAqaDottedQuestionNumber(label)) continue;
    const exact = extractAqaDottedMarkSchemeSection(label, pages);
    if (exact) sections.set(label, exact);
  }

  const starts: Array<{ label: string; index: number }> = [];
  let cursor = 0;
  for (const label of labels) {
    if (sections.has(label) || isAqaDottedQuestionNumber(label)) continue;
    const match = findMarkSchemeStartAfter(combined, label, cursor);
    if (!match) continue;
    starts.push({ label, index: match.index });
    cursor = match.index + 1;
  }

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
  const matcher =
    /(?:^|[^a-z0-9])(?:question\s*)?0?\d{1,2}(?:\s*(?:[.)/-]|\.)\s*\d{1,2}|\s*(?:\([a-z]\)|[a-z](?=\s*(?:\d|â€¢|[A-Z]|$)))(?:\s*(?:[.)/-]|\s)?\s*(?:\([ivx]+\)|[ivx](?=\s*(?:\d|â€¢|[A-Z]|$))))?)(?=\s|[.)-]|$)/gi;
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
      if (!section) {
        return isAqaDottedQuestionNumber(question.questionNumber) ? question : applyDeterministicMarkSchemeToQuestion(question, markSchemePages);
      }
      const sectionValidation = validateDeterministicMarkSchemeSection(question.questionNumber, question.maxMarks, section.text);
      const tooBroadForShortQuestion = question.maxMarks <= 3 && section.pageNumbers.length > 2;
      if (!sectionValidation.ok || tooBroadForShortQuestion) {
        return question;
      }
      const rules = extractMarkSchemeRuleNotes(section.text);
      const rows = extractDeterministicMarkSchemeRows(section.text, question.maxMarks).map((row, index) => ({
        markPoint: row.markPoint,
        accept: index === 0 ? rules.accept : [],
        doNotAccept: index === 0 ? rules.doNotAccept : [],
        ignore: index === 0 ? rules.ignore : [],
        guidance: index === 0 ? rules.guidance.join(" ") : "",
        marks: row.marks,
      }));
      const markSchemeData = withValidatedAlignmentMetadata(
        question,
        {
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
        {
          matchedQuestionNumber: question.questionNumber,
          matchedPageNumbers: section.pageNumbers,
          matchedEvidenceText: section.text,
        },
      );
      return {
        ...question,
        markSchemeRef: section.ref,
        markSchemeData,
      };
    }),
  };
}

function applyMarkSchemeAlignmentValidation(output: ProcessedPaperOutput) {
  return {
    ...output,
    questions: output.questions.map((question) => {
      if (!question.markSchemeData) return question;
      const enriched = withValidatedAlignmentMetadata(question, question.markSchemeData);
      const validation = validateMarkSchemeAlignment(question, enriched);
      const unusable = validation.quality === "wrong_section" || validation.quality === "missing" || validation.quality === "broad_parent";
      return {
        ...question,
        markSchemeRef: unusable ? null : question.markSchemeRef,
        markSchemeData: unusable ? null : enriched,
      };
    }),
  };
}

function applyDeterministicMarkSchemeToQuestion<
  T extends Pick<ProcessedPaperOutput["questions"][number], "questionNumber" | "parentQuestionNumber" | "maxMarks" | "markSchemeData" | "markSchemeRef"> &
    Partial<Pick<ProcessedPaperOutput["questions"][number], "numberingPath">>,
>(
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
        markSchemeData: withValidatedAlignmentMetadata(
          question,
          {
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
          {
            matchedQuestionNumber: question.questionNumber,
            matchedPageNumbers: [page.pageNumber],
            matchedEvidenceText: snippet,
          },
        ),
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

    const deterministicOutput = buildDeterministicProcessedPaperOutput(paper, paperPages);
    let output: ProcessedPaperOutput;

    if (deterministicOutput) {
      output = deterministicOutput;
      const detectedStyle = detectDeterministicPaperStyle(paperPages);
      const preparedPages = detectedStyle ? prepareDeterministicPages(paperPages, detectedStyle) : [];
      reporter.enterStage("building page inventory", 28, "Using deterministic parser for readable paper text", {
        pages: paperPages.length,
        detectedStyle,
        pageTypes: preparedPages.map((page) => `p${page.pageNumber}:${page.role}`).join(" / "),
      });
      preparedPages
        .filter((page) => Boolean(page.ignoredFrontMatter))
        .forEach((page) =>
          reporter.log("building page inventory", "warn", "Removed front matter before deterministic question parsing", {
            pageNumber: page.pageNumber,
            detectedPageType: page.role,
            chosenFirstQuestionMarker: page.firstQuestionMarker,
            ignoredFrontMatterSnippet: page.ignoredFrontMatter,
            warning: "question_text_contains_cover_instructions",
          }),
        );
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
      output = {
        ...output,
        questions: resolveDeterministicMediaRefs(output.questions, paperPages),
      };
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
        questions: resolveDeterministicMediaRefs(questions, paperPages),
      };
    }

    output = applyDeterministicSupportValidation(output);
    output = applyDisplayPlans(output);

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
          output = applyMarkSchemeAlignmentValidation(output);
          const afterDeterministic = output.questions.filter((question) => question.markSchemeData).length;
          if (afterDeterministic > beforeDeterministic) {
            reporter.log("aligning mark scheme", "info", "Recovered exact readable mark-scheme sections", {
              filled: afterDeterministic - beforeDeterministic,
              alignedQuestions: afterDeterministic,
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
  const validation = validateDeterministicMarkSchemeSection(question.questionNumber, question.maxMarks, section.text);
  const tooBroadForShortQuestion = question.maxMarks <= 3 && section.pageNumbers.length > 2;
  if (!validation.ok || tooBroadForShortQuestion) {
    return applyDeterministicMarkSchemeToQuestion(question, pages, [displayNumber]);
  }
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
    markSchemeData: withValidatedAlignmentMetadata(
      question,
      {
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
      {
        matchedQuestionNumber: displayNumber,
        matchedPageNumbers: section.pageNumbers,
        matchedEvidenceText: section.text,
      },
    ),
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

function alignmentQualityFromMarkSchemeData(markSchemeData: Record<string, unknown> | null): MarkSchemeAlignmentQuality {
  const raw = markSchemeData && typeof markSchemeData.alignmentQuality === "string" ? markSchemeData.alignmentQuality : "";
  return raw === "exact" || raw === "nearby" || raw === "broad_parent" || raw === "wrong_section" || raw === "missing" ? raw : "missing";
}

function isReliableAlignmentQuality(quality: MarkSchemeAlignmentQuality) {
  return quality === "exact" || quality === "nearby";
}

function markSchemeEvidenceText(markSchemeData: Record<string, unknown> | null) {
  if (!markSchemeData) return "";
  if (typeof markSchemeData.exactSectionText === "string" && markSchemeData.exactSectionText.trim()) return markSchemeData.exactSectionText.trim();
  if (typeof markSchemeData.evidence === "string" && markSchemeData.evidence.trim()) return markSchemeData.evidence.trim();
  return renderMarkSchemeDataForPrompt(markSchemeData);
}

function recoveryCandidateMarkSchemePages(
  question: Pick<PastPaperQuestion, "questionNumber" | "parentQuestionNumber">,
  markSchemePages: PagePromptContext[],
  currentBadEvidence: Record<string, unknown> | null,
) {
  const exactMatcher = markSchemeExactSubquestionRegex(question.questionNumber);
  const parent = question.parentQuestionNumber ?? question.questionNumber.match(/^\d+/)?.[0] ?? null;
  const parentMatcher = parent ? new RegExp(`(?:^|[^a-z0-9])0?${Number(parent)}(?=\\s|[.)/:-]|$)`, "i") : null;
  const hintedPages = new Set<number>(
    Array.isArray(currentBadEvidence?.matchedPageNumbers)
      ? currentBadEvidence.matchedPageNumbers.filter((page): page is number => typeof page === "number")
      : Array.isArray(currentBadEvidence?.pageNumbers)
        ? currentBadEvidence.pageNumbers.filter((page): page is number => typeof page === "number")
        : [],
  );
  const exactPages = markSchemePages.filter((page) => exactMatcher.test(page.text));
  const parentPages = markSchemePages.filter((page) => parentMatcher?.test(page.text));
  const pageNumbers = new Set<number>([
    ...exactPages.map((page) => page.pageNumber),
    ...parentPages.map((page) => page.pageNumber),
    ...[...hintedPages].flatMap((page) => [page - 1, page, page + 1]),
  ]);
  const filtered = markSchemePages.filter((page) => pageNumbers.has(page.pageNumber));
  return filtered;
}

function trimRecoveryPagesToCharBudget(pages: PagePromptContext[], maxChars = 10_000) {
  const selected: PagePromptContext[] = [];
  let totalChars = 0;
  for (const page of pages) {
    if (selected.length && totalChars + page.text.length > maxChars) break;
    selected.push(page);
    totalChars += page.text.length;
  }
  return selected;
}

async function recoverMarkSchemeForQuestionWithClaude({
  paper,
  question,
  displayNumber,
  currentBadEvidence,
  markSchemePages,
  model,
  fallbackModels,
}: {
  paper: PastPaper;
  question: PastPaperQuestion;
  displayNumber: string;
  currentBadEvidence: Record<string, unknown> | null;
  markSchemePages: PagePromptContext[];
  model: string;
  fallbackModels: string[];
}): Promise<MarkSchemeRecoveryOutput> {
  const relevantPages = trimRecoveryPagesToCharBudget(recoveryCandidateMarkSchemePages(question, markSchemePages, currentBadEvidence));
  if (!relevantPages.length) {
    return {
      status: "not_found",
      questionNumber: displayNumber,
      matchedMarkSchemeQuestionNumber: null,
      confidence: 0,
      markSchemeRef: null,
      pageNumbers: [],
      rows: [],
      evidence: "",
      whyThisMatches: "",
      whyRejectedPrevious: "",
    };
  }
  const markSchemeAsset = paper.assets.find((asset) => asset.kind === "mark_scheme");
  const media = hasMeaningfulText(relevantPages) ? [] : screenshotDataUrls(markSchemeAsset, relevantPages.map((page) => page.pageNumber), "full");
  const siblings = paper.questions
    .map((item) => displayQuestionNumberForPaper(paper, item))
    .filter((label) => label !== displayNumber)
    .filter((label) => (question.parentQuestionNumber ? label.startsWith(`${question.parentQuestionNumber}.`) : label.startsWith(`${question.questionNumber.split(".")[0]}.`)))
    .slice(0, 6);
  return aiStructuredJson(
    buildMarkSchemeRecoveryPrompt({
      title: paper.title,
      subject: paper.subject,
      questionNumber: displayNumber,
      parentQuestionNumber: question.parentQuestionNumber,
      promptText: cleanPromptText(question.promptText),
      maxMarks: question.maxMarks,
      pageReferences: question.pageReferences,
      currentBadEvidence: markSchemeEvidenceText(currentBadEvidence) || null,
      nearbyQuestionNumbers: siblings,
      markSchemePages: relevantPages,
    }),
    markSchemeRecoveryOutputSchema,
    {
      operation: "mark_scheme_recovery",
      model,
      fallbackModels,
      media,
      normalizer: (input) => input,
      debugLabel: `Mark scheme recovery ${displayNumber}`,
    },
  );
}

function recoveredMarkSchemeDataFromClaude(
  question: Pick<PastPaperQuestion, "questionNumber" | "parentQuestionNumber" | "maxMarks">,
  recovery: MarkSchemeRecoveryOutput,
) {
  if (recovery.status !== "found" || recovery.confidence < 75 || !recovery.rows.length) return null;
  const markSchemeData = withValidatedAlignmentMetadata(
    question,
    {
      source: "claude_mark_scheme_recovery",
      questionNumber: recovery.questionNumber,
      maxMarks: question.maxMarks,
      rows: recovery.rows,
      points: recovery.rows.map((row) => row.markPoint).filter(Boolean),
      evidence: recovery.evidence,
      exactSectionText: recovery.evidence,
      pageNumbers: recovery.pageNumbers,
    },
    {
      matchedQuestionNumber: recovery.matchedMarkSchemeQuestionNumber,
      matchedPageNumbers: recovery.pageNumbers,
      matchedEvidenceText: recovery.evidence,
      alignmentWarnings: [recovery.whyRejectedPrevious, recovery.whyThisMatches].filter(Boolean),
    },
  );
  return markSchemeData;
}

function markOutputSignalsInsufficient(output: PaperMarkOutput) {
  return /\b(?:insufficient|does not include|doesn't include|no relevant|no matching|no mark scheme|nothing relevant|cannot be awarded|not enough evidence)\b/i.test(
    [output.rationale, output.markSchemeEvidence ?? "", ...output.missingPoints].join(" "),
  );
}

function markOutputContradictionText(output: PaperMarkOutput, markSchemeText: string) {
  return [output.rationale, output.markSchemeEvidence ?? "", ...output.missingPoints, markSchemeText].filter(Boolean).join(" ");
}

function hasExplicitCorrectnessSignal(text: string) {
  return /\b(?:student(?:'s)? answer is correct|selected answer is correct|matches the correct answer|matches one of the acceptable values|correct and should be credited|award full marks|correct answer given)\b/i.test(text);
}

function hasExplicitMismatchSignal(text: string) {
  return /\b(?:does not match(?: the correct answer)?|does not match any acceptable|doesn't match any acceptable|does not correspond|not one of|outside acceptable range|no credit|cannot be awarded|incorrect|wrong|not correct)\b/i.test(text);
}

function extractChoiceLetter(value: string) {
  const compact = value.replace(/\s+/g, " ").trim();
  const match = compact.match(/^\s*["'([]*([A-H])(?:[.)\]:-]|\s|$)/i) ?? compact.match(/\b([A-H])\b/i);
  return match?.[1]?.toUpperCase() ?? null;
}

function extractCorrectChoiceLetter(text: string) {
  const patterns = [
    /\bcorrect answer(?: is|:)?\s*["'(\s]*([A-H])\b/i,
    /\banswer(?: only)?(?: is|:)?\s*["'(\s]*([A-H])\b/i,
    /\bmark scheme row(?: is|:)?\s*["'(\s]*([A-H])\b/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]) return match[1].toUpperCase();
  }
  return null;
}

function extractExplicitAcceptableValues(text: string) {
  const prefixes = [
    /\bacceptable values?(?: are| is)?\s*/gi,
    /\bcorrect answer(?: is|:)?\s*/gi,
    /\baward\s+\d+\s+mark(?:s)?\s+for answer\s*/gi,
  ];
  const values = prefixes.flatMap((pattern) =>
    [...text.matchAll(pattern)].flatMap((match) => {
      const start = (match.index ?? 0) + match[0].length;
      const snippet = text.slice(start, start + 120);
      return [...snippet.matchAll(/-?\d+(?:\.\d+)?/g)].map((item) => Number(item[0]));
    }),
  );
  return [...new Set(values.filter((value) => Number.isFinite(value)))];
}

function extractAnswerNumericValues(text: string) {
  return [...text.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0])).filter((value) => Number.isFinite(value));
}

function numbersOverlap(answerValues: number[], acceptableValues: number[]) {
  return answerValues.some((answerValue) => acceptableValues.some((acceptableValue) => Math.abs(answerValue - acceptableValue) < 0.0001));
}

function deterministicSingleChoiceOutput(question: PastPaperQuestion, answer: PastPaperAnswer, markSchemeText: string): PaperMarkOutput | null {
  if (question.responseType !== "single_choice") return null;
  const selectedLetter = extractChoiceLetter(answer.selectedOptions[0] ?? answer.responseText ?? "");
  const correctLetter = extractCorrectChoiceLetter(markSchemeText);
  if (!selectedLetter || !correctLetter) return null;
  const matched = selectedLetter === correctLetter;
  return {
    awardedMarks: matched ? question.maxMarks : 0,
    maxMarks: question.maxMarks,
    rationale: matched
      ? `Selected option ${selectedLetter} matches the correct answer ${correctLetter}.`
      : `Selected option ${selectedLetter} does not match the correct answer ${correctLetter}.`,
    missingPoints: matched ? [] : [`Correct answer: ${correctLetter}`],
    markSchemeEvidence: `Correct answer ${correctLetter}`,
    markSchemeReference: { source: "deterministic_single_choice" },
    confidence: 99,
  };
}

function deterministicNumericOutput(question: PastPaperQuestion, answer: PastPaperAnswer, markSchemeText: string): PaperMarkOutput | null {
  const acceptableValues = extractExplicitAcceptableValues(markSchemeText);
  const answerValues = extractAnswerNumericValues(answerText(answer, question));
  if (!acceptableValues.length || !answerValues.length) return null;
  const matched = numbersOverlap(answerValues, acceptableValues);
  return {
    awardedMarks: matched ? question.maxMarks : 0,
    maxMarks: question.maxMarks,
    rationale: matched
      ? `The student's answer includes an acceptable value (${acceptableValues.join(", ")}).`
      : `The student's answer does not include any acceptable value (${acceptableValues.join(", ")}).`,
    missingPoints: matched ? [] : [`Acceptable values: ${acceptableValues.join(" / ")}`],
    markSchemeEvidence: acceptableValues.join(" / "),
    markSchemeReference: { source: "deterministic_numeric" },
    confidence: 99,
  };
}

export function applyMarkingGuardrails(
  output: PaperMarkOutput,
  question: PastPaperQuestion,
  answer: PastPaperAnswer,
  markSchemeText: string,
): PaperMarkOutput {
  const combinedText = markOutputContradictionText(output, markSchemeText);
  let awardedMarks = output.awardedMarks;

  if (hasExplicitMismatchSignal(combinedText) && !hasExplicitCorrectnessSignal(combinedText)) {
    awardedMarks = 0;
  }

  if (question.responseType === "single_choice") {
    const selectedLetter = extractChoiceLetter(answer.selectedOptions[0] ?? answer.responseText ?? "");
    const correctLetter = extractCorrectChoiceLetter(combinedText);
    if (selectedLetter && correctLetter) {
      if (selectedLetter !== correctLetter) {
        awardedMarks = 0;
      } else if (awardedMarks === 0) {
        awardedMarks = question.maxMarks;
      }
    }
  }

  const acceptableValues = extractExplicitAcceptableValues(combinedText);
  const answerValues = extractAnswerNumericValues(answerText(answer, question));
  if (acceptableValues.length && answerValues.length) {
    if (!numbersOverlap(answerValues, acceptableValues)) {
      awardedMarks = 0;
    } else if (awardedMarks === 0 && !hasExplicitMismatchSignal(combinedText)) {
      awardedMarks = question.maxMarks;
    }
  }

  return {
    ...output,
    awardedMarks: Math.max(0, Math.min(question.maxMarks, awardedMarks)),
  };
}

function retryMarkingModel(currentModel: string, fallbackModels: string[]) {
  if (resolveAIModelConfig(currentModel).provider !== "gemini") return null;
  const ordered = [GEMINI_FLASH_MODEL.model, ...fallbackModels].filter((model, index, list) => model !== currentModel && list.indexOf(model) === index);
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

function hasStructuredRenderedMarkSchemeText(markSchemeText: string) {
  return /\b(?:Parsed mark scheme rows|Marking points|Also accept|Do not accept|Examiner guidance|Exact mark scheme section)\b/i.test(markSchemeText);
}

function mapMarkOutput(
  answerId: string,
  questionId: string,
  questionMaxMarks: number,
  output: PaperMarkOutput,
  source: "ai" | "remark",
  version: number,
  metadata?: AIResultMetadata | null,
): PastPaperQuestionMark {
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
    ...(metadata
      ? {
          provider: metadata.provider,
          model: metadata.model,
          modelLabel: metadata.modelLabel,
          fallbackFromModel: metadata.fallbackFromModel,
          fallbackFromProvider: metadata.fallbackFromModel ? resolveAIModelConfig(metadata.fallbackFromModel).provider : null,
        }
      : {}),
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
  const markSchemeAsset = paper.assets.find((asset) => asset.kind === "mark_scheme");
  const markSchemePages = pageContextsForAsset(markSchemeAsset);
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
  let markSchemeData = shouldPreferExistingMarkSchemeData ? question.markSchemeData : recoveredQuestion.markSchemeData ?? question.markSchemeData;
  let preferredMarkSchemeRef = shouldPreferExistingMarkSchemeData ? question.markSchemeRef ?? recoveredQuestion.markSchemeRef : recoveredQuestion.markSchemeRef ?? question.markSchemeRef;
  let validation = validateMarkSchemeAlignment(question, markSchemeData);
  const primaryModel = options.model ?? DEFAULT_AI_MODEL;
  const fallbackModels = options.fallbackModels ?? [...FALLBACK_AI_MODELS];
  let recoveryResult: MarkSchemeRecoveryOutput | null = null;
  const allowMarkSchemeRecovery = options.allowMarkSchemeRecovery !== false;
  let recoveryAttempted = false;

  if ((!markSchemeData || !isReliableAlignmentQuality(validation.quality)) && markSchemePages.length && allowMarkSchemeRecovery) {
    recoveryAttempted = true;
    recoveryResult = await recoverMarkSchemeForQuestionWithClaude({
      paper,
      question,
      displayNumber,
      currentBadEvidence: markSchemeData,
      markSchemePages,
      model: primaryModel,
      fallbackModels,
    });
    const recoveredData = recoveredMarkSchemeDataFromClaude(question, recoveryResult);
    const recoveredValidation = validateMarkSchemeAlignment(question, recoveredData);
    if (recoveredData && isReliableAlignmentQuality(recoveredValidation.quality)) {
      markSchemeData = recoveredData;
      preferredMarkSchemeRef = recoveryResult.markSchemeRef ?? preferredMarkSchemeRef;
      validation = recoveredValidation;
    }
  }

  const structuredMarkSchemeText = renderMarkSchemeDataForPrompt(markSchemeData);
  const markSchemeText = structuredMarkSchemeText;
  const markSchemeLooksUsable =
    Boolean(markSchemeText) &&
    (hasStructuredRenderedMarkSchemeText(markSchemeText) || hasMarkSchemeSubstance(markSchemeText, displayNumber || question.questionNumber));
  if (!markSchemeData || !isReliableAlignmentQuality(validation.quality) || !markSchemeLooksUsable) {
    throw new MarkSchemeAlignmentError("Could not safely align this question with the mark scheme.", {
      code: "mark_scheme_alignment_error",
      questionNumber: displayNumber || question.questionNumber,
      questionPrompt: question.promptText,
      pageReferences: question.pageReferences,
      recoveryAttempted,
      currentBadEvidence: markSchemeData,
      rejectedEvidence:
        validation.quality === "wrong_section" || validation.quality === "broad_parent"
          ? markSchemeData
          : question.markSchemeData && !isReliableAlignmentQuality(alignmentQualityFromMarkSchemeData(question.markSchemeData))
            ? question.markSchemeData
            : null,
      recoveryResult,
      reason:
        recoveryResult?.status === "ambiguous"
          ? "Claude recovery found more than one plausible row and could not confirm an exact match."
          : recoveryResult?.status === "not_found"
            ? "Claude recovery could not find a reliable exact row in the supplied mark scheme."
            : "No reliable exact mark-scheme row was available for this question.",
      displayMarkSchemeRef: preferredMarkSchemeRef,
      displayNumberMarkScheme: displayNumberMarkScheme?.text ?? null,
      parentQuestionMarkScheme: questionSectionMarkScheme?.text ?? null,
    });
  }
  const maxMarks = recoveredQuestion.maxMarks ?? question.maxMarks;
  const exactAnswerOutput = deterministicExactAnswerOutput(markSchemeData, answerText(answer, question), maxMarks);
  if (exactAnswerOutput) {
    return mapMarkOutput(answer.id, question.id, maxMarks, exactAnswerOutput, source, version);
  }
  const deterministicSingleChoice = deterministicSingleChoiceOutput({ ...question, maxMarks }, answer, markSchemeText);
  if (deterministicSingleChoice) {
    return mapMarkOutput(answer.id, question.id, maxMarks, deterministicSingleChoice, source, version);
  }
  const deterministicNumeric = deterministicNumericOutput({ ...question, maxMarks }, answer, markSchemeText);
  if (deterministicNumeric) {
    return mapMarkOutput(answer.id, question.id, maxMarks, deterministicNumeric, source, version);
  }
  let aiMetadata: AIResultMetadata | null = null;

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
    onResultMetadata: (metadata) => {
      aiMetadata = metadata;
    },
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
          onResultMetadata: (metadata) => {
            aiMetadata = metadata;
          },
        },
      );
    }
  }
  if (output.awardedMarks === 0 && markOutputSignalsInsufficient(output) && hasMarkSchemeSubstance(markSchemeText, displayNumber || question.questionNumber)) {
    throw new MarkSchemeAlignmentError("Could not safely align this question with the mark scheme.", {
      code: "mark_scheme_alignment_error",
      questionNumber: displayNumber,
      questionPrompt: question.promptText,
      pageReferences: question.pageReferences,
      recoveryAttempted,
      currentBadEvidence: markSchemeData,
      recoveryResult,
      reason: "The marking model still reported insufficient aligned row evidence after recovery, so the answer was not forced to zero.",
      displayMarkSchemeRef: preferredMarkSchemeRef,
    });
  }
  return mapMarkOutput(answer.id, question.id, maxMarks, applyMarkingGuardrails(output, question, answer, markSchemeText), source, version, aiMetadata);
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
