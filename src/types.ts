export type ProcessingStage =
  | "uploading"
  | "extracting"
  | "building page inventory"
  | "identifying questions"
  | "extracting question details"
  | "aligning mark scheme"
  | "finalising"
  | "marking answers"
  | "remarking question";

export type ProcessingStatus = "unprocessed" | "processing" | "ready" | "failed";
export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type ResponseType = "long_text" | "short_text" | "numeric" | "single_choice" | "multi_select";
export type AttemptStatus = "in_progress" | "submitted" | "marked" | "saved";

export type PaperPageText = {
  pageNumber: number;
  text: string;
  charCount: number;
};

export type PaperPageScreenshot = {
  pageNumber: number;
  dataUrl: string;
  thumbnailDataUrl: string;
  width: number;
  height: number;
  byteSize: number;
  thumbnailByteSize: number;
  mimeType: string;
  renderScale: number;
};

export type AssetExtractionDiagnostics = {
  pageCount: number;
  textCharCount: number;
  pageTextCharCounts: Array<{ pageNumber: number; charCount: number }>;
  screenshotCount: number;
  screenshots: Array<{
    pageNumber: number;
    width: number;
    height: number;
    byteSize: number;
    thumbnailByteSize: number;
    mimeType: string;
  }>;
  warnings: string[];
};

export type PastPaperAsset = {
  id: string;
  paperId: string;
  kind: "paper" | "mark_scheme";
  fileName: string;
  mimeType: string;
  size: number;
  textContent: string | null;
  pageCount?: number | null;
  pageTexts?: PaperPageText[];
  pageScreenshots?: PaperPageScreenshot[];
  extractionDiagnostics?: AssetExtractionDiagnostics | null;
  objectUrl: string | null;
  createdAt: string;
};

export type PaperMediaRef = {
  id: string;
  kind: string;
  label: string;
  description: string | null;
  sourceAssetId: string | null;
  pageNumber: number | null;
  metadata: Record<string, unknown>;
};

export type PastPaperQuestion = {
  id: string;
  paperId: string;
  questionNumber: string;
  parentQuestionNumber: string | null;
  numberingPath: string[];
  promptText: string;
  maxMarks: number;
  responseType: ResponseType;
  originalFormat: string;
  convertedFormat: string | null;
  originalContent: Record<string, unknown>;
  convertedContent: Record<string, unknown>;
  diagramMediaRefs: PaperMediaRef[];
  options: string[];
  pageReferences: number[];
  evidenceSnippet?: string | null;
  imagePageReferences?: number[];
  confidence?: number | null;
  extractionWarnings?: string[];
  markSchemeRef: string | null;
  markSchemeData: Record<string, unknown> | null;
  displayOrder: number;
};

export type PastPaperProcessingJob = {
  id: string;
  paperId: string;
  attemptId: string | null;
  remarkId: string | null;
  kind: "processing" | "marking" | "remarking";
  status: JobStatus;
  progressPercent: number;
  currentStage: ProcessingStage;
  errorMessage: string | null;
  diagnostics?: ProcessingDiagnostics | null;
  createdAt: string;
  updatedAt: string;
};

export type ProcessingLogEntry = {
  at: string;
  stage: ProcessingStage;
  level: "info" | "warn" | "error";
  message: string;
  metadata?: Record<string, unknown>;
};

export type ProcessingStageTiming = {
  stage: ProcessingStage;
  startedAt: string;
  endedAt: string | null;
  elapsedMs: number | null;
};

export type PuterRequestDiagnostic = {
  id: string;
  label: string;
  model: string;
  fallbackFromModel?: string | null;
  promptChars: number;
  mediaCount: number;
  mediaBytes: number;
  startedAt: string;
  endedAt: string | null;
  elapsedMs: number | null;
  status: "running" | "success" | "error" | "timeout";
  rawResponsePreview?: string | null;
  rawError?: unknown;
};

export type ProcessingDiagnostics = {
  id: string;
  createdAt: string;
  updatedAt: string;
  currentStage: ProcessingStage;
  lastSuccessfulStage: ProcessingStage | null;
  stageTimings: ProcessingStageTiming[];
  logs: ProcessingLogEntry[];
  paperPageCount: number;
  markSchemePageCount: number;
  pageTextStats: Array<{ assetKind: PastPaperAsset["kind"]; pageNumber: number; charCount: number }>;
  screenshotStats: Array<{
    assetKind: PastPaperAsset["kind"];
    pageNumber: number;
    width: number;
    height: number;
    byteSize: number;
    thumbnailByteSize: number;
    mimeType: string;
  }>;
  promptStats: Array<{ label: string; charCount: number; pageNumbers?: number[]; imageCount?: number; model: string }>;
  puterRequests: PuterRequestDiagnostic[];
  schemaErrors: Array<{ label: string; paths: string[]; issues: string[]; rawPreview: string; extractedJsonPreview: string }>;
  integrityFailures?: string[];
  smokeTests: PuterSmokeTestResult[];
};

export type PuterSmokeTestResult = {
  id: string;
  model: string;
  startedAt: string;
  endedAt: string;
  elapsedMs: number;
  modelCheck: {
    supported: boolean | null;
    rawResponsePreview?: string | null;
    rawError?: unknown;
  };
  textCall: {
    success: boolean;
    elapsedMs?: number;
    rawResponsePreview?: string | null;
    rawError?: unknown;
  };
  imageCall: {
    success: boolean;
    elapsedMs?: number;
    callShape: "puter.ai.chat(prompt, [mediaDataUrl], options)";
    rawResponsePreview?: string | null;
    rawError?: unknown;
  };
};

export type PastPaper = {
  id: string;
  title: string;
  subject: string;
  topic: string | null;
  subtopic: string | null;
  year: number | null;
  series: string | null;
  paperCode: string | null;
  totalMarks: number | null;
  durationMinutes: number | null;
  hasMarkScheme: boolean;
  processingStatus: ProcessingStatus;
  processingError: string | null;
  processingDiagnostics?: ProcessingDiagnostics | null;
  assets: PastPaperAsset[];
  questions: PastPaperQuestion[];
  jobs: PastPaperProcessingJob[];
  createdAt: string;
  updatedAt: string;
};

export type PastPaperAnswer = {
  id: string;
  attemptId: string;
  questionId: string;
  responseText: string | null;
  numericResponse: number | null;
  selectedOptions: string[];
  skipped: boolean;
  skippedWithConfidence: boolean;
  confidencePredictedMarks: number | null;
  createdAt: string;
  updatedAt: string;
};

export type PastPaperQuestionMark = {
  id: string;
  answerId: string;
  questionId: string;
  source: "ai" | "remark";
  reviewVersion: number;
  awardedMarks: number;
  maxMarks: number;
  rationale: string;
  missingPoints: string[];
  markSchemeEvidence: string | null;
  markSchemeReference: Record<string, unknown>;
  accepted: boolean;
  createdAt: string;
};

export type PastPaperRemark = {
  id: string;
  attemptId: string;
  answerId: string;
  questionId: string;
  status: JobStatus;
  notes: string | null;
  proposedMarkId: string | null;
  acceptedMarkId: string | null;
  acceptedAt: string | null;
  createdAt: string;
};

export type PastPaperAttempt = {
  id: string;
  paperId: string;
  status: AttemptStatus;
  startedAt: string;
  submittedAt: string | null;
  completedAt: string | null;
  durationSeconds: number;
  overtimeSeconds: number;
  actualScore: number;
  confidenceAdjustedScore: number;
  totalMarks: number;
  answers: PastPaperAnswer[];
  marks: PastPaperQuestionMark[];
  remarks: PastPaperRemark[];
};

export type PaperDraftInput = {
  title: string;
  subject: string;
  topic: string;
  subtopic: string;
  year: string;
  series: string;
  paperCode: string;
};

export type AppData = {
  papers: PastPaper[];
  attempts: PastPaperAttempt[];
};
