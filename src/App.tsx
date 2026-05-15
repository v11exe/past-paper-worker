import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  BarChart3,
  BrainCircuit,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Code2,
  Clock3,
  Copy,
  Download,
  Edit3,
  ExternalLink,
  Eye,
  FileText,
  FlaskConical,
  Github,
  Info,
  Loader2,
  Maximize2,
  MessageSquare,
  ListChecks,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Plus,
  RotateCcw,
  Save,
  ScanLine,
  Settings2,
  ShieldCheck,
  SkipForward,
  Sparkles,
  Target,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_AI_MODEL, FALLBACK_AI_MODELS, AI_MODEL_CHOICES, ensureAIReadyForUserAction, aiChat, runAISmokeTest } from "./ai/provider";
import { appMeta } from "./appMeta";
import { AppLogo } from "./components/AppLogo";
import { cleanChoiceGlyphs, extractInlineOptions } from "./lib/choiceParsing";
import { subjectMetaForLabel, subjectMetaList, unsupportedSubjects } from "./subjectMeta";
import { selectableSubjects, supportedSubjects, type SelectableSubject, type SupportedSubject } from "./subjects";
import { currentVersionEntry, versionHistory } from "./versionHistory";
import { extractFileAssetContent } from "./lib/fileText";
import {
  FEEDBACK_TYPE_OPTIONS,
  clearFeedbackDraft,
  emptyFeedbackDraft,
  filesToFeedbackAttachments,
  feedbackDraftIsValid,
  formatFileSize,
  loadFeedbackDraft,
  saveFeedbackDraft,
  submitFeedback,
  validateFeedbackDraft,
  type FeedbackAttachment,
  type FeedbackDraft,
  type FeedbackValidationErrors,
} from "./lib/feedback";
import { createId } from "./lib/id";
import {
  acceptedMarks,
  answerText,
  bestScoreForPaper,
  buildProcessingJob,
  computeAttemptScores,
  createMarkingErrorMark,
  createRemark,
  formatClock,
  formatPercent,
  isAnswerAttempted,
  isMarkingErrorMark,
  displayQuestionNumberForPaper,
  markAnswerWithAI,
  nowIso,
  processPaperWithAI,
  questionSupportIssue,
  processingStages,
  startAttempt,
  supportedTotalMarksForPaper,
  unsupportedMarksForPaper,
} from "./lib/paperEngine";
import { clearData, loadData, saveData } from "./lib/storage";
import type {
  AppData,
  PaperDraftInput,
  PastPaper,
  PastPaperAnswer,
  PastPaperAsset,
  PastPaperAttempt,
  PastPaperProcessingJob,
  PastPaperQuestion,
  PastPaperQuestionMark,
  PaperPageScreenshot,
  ProcessingStage,
  ProcessingDiagnostics,
  AISmokeTestResult,
} from "./types";

const emptyDraft: PaperDraftInput = {
  title: "",
  subject: supportedSubjects[0],
  topic: "",
  subtopic: "",
  year: "",
  series: "",
  paperCode: "",
};

type ThemeMode = "dark" | "system" | "dim" | "contrast";
type AccentColour = "elliots" | "blue" | "purple" | "amber" | "rose" | "cyan" | "indigo" | "peach" | "graphite" | "custom";
type DashboardDensity = "comfortable" | "compact";
type NotificationDuration = "normal" | "longer" | "reduced";
type MotionPreference = "system" | "reduce";
type FigurePreference = "show" | "collapse";
type NavPreference = "grid" | "list";
type LandingPreference = "overview" | "catalogue" | "last_paper";
type SidebarDefault = "expanded" | "collapsed";

type AppPreferences = {
  themeMode: ThemeMode;
  accentColour: AccentColour;
  dashboardDensity: DashboardDensity;
  showTechnicalModel: boolean;
  showAnalyticsPanel: boolean;
  showHeaderSystemInfo: boolean;
  showRecentUpdate: boolean;
  showHeroStatus: boolean;
  showQuestionLegend: boolean;
  showPaperSummary: boolean;
  showFocusProgress: boolean;
  showConfidenceSkip: boolean;
  showFloatingFeedback: boolean;
  devModeEnabled: boolean;
  sidebarDefault: SidebarDefault;
  autoSaveAnswers: boolean;
  focusModeDefault: boolean;
  timerBehaviour: "count_up" | "count_down";
  sourceFigures: FigurePreference;
  questionNavigation: NavPreference;
  notificationDuration: NotificationDuration;
  reduceMotion: MotionPreference;
  defaultLanding: LandingPreference;
  customAccent: string;
  customAccent2: string;
};

type ToastKind = "success" | "error" | "warning" | "info";

type ToastItem = {
  id: string;
  kind: ToastKind;
  message: string;
  durationMs: number;
};

type AppView = "landing" | "onboarding" | "app";

const PREFERENCES_STORAGE_KEY = "past-paper-worker:preferences:v1";
const SELECTED_SUBJECTS_STORAGE_KEY = "past-paper-worker:selected-subjects:v1.3.1";
const ONBOARDING_COMPLETE_STORAGE_KEY = "past-paper-worker:onboarding-completed:v1.3.1";
const ACTIVE_SUBJECT_STORAGE_KEY = "past-paper-worker:active-subject:v1.3.1";
const SIDEBAR_COLLAPSED_STORAGE_KEY = "past-paper-worker:sidebar-collapsed:v1.3.1";

const defaultPreferences: AppPreferences = {
  themeMode: "dark",
  accentColour: "elliots",
  dashboardDensity: "comfortable",
  showTechnicalModel: true,
  showAnalyticsPanel: true,
  showHeaderSystemInfo: true,
  showRecentUpdate: true,
  showHeroStatus: true,
  showQuestionLegend: true,
  showPaperSummary: true,
  showFocusProgress: true,
  showConfidenceSkip: true,
  showFloatingFeedback: true,
  devModeEnabled: false,
  sidebarDefault: "expanded",
  autoSaveAnswers: true,
  focusModeDefault: true,
  timerBehaviour: "count_down",
  sourceFigures: "show",
  questionNavigation: "grid",
  notificationDuration: "normal",
  reduceMotion: "system",
  defaultLanding: "overview",
  customAccent: "#0038c0",
  customAccent2: "#7800d0",
};

const accentOptions: Array<{ value: AccentColour; label: string }> = [
  { value: "elliots", label: "Elliots" },
  { value: "blue", label: "Blue" },
  { value: "purple", label: "Purple" },
  { value: "amber", label: "Amber" },
  { value: "rose", label: "Rose" },
  { value: "cyan", label: "Cyan" },
  { value: "indigo", label: "Indigo" },
  { value: "peach", label: "Peach" },
  { value: "graphite", label: "Graphite" },
  { value: "custom", label: "Custom" },
];

function isSupportedSubject(value: string): value is SupportedSubject {
  return supportedSubjects.includes(value as SupportedSubject);
}

function isSelectableSubject(value: string): value is SelectableSubject {
  return selectableSubjects.includes(value as SelectableSubject);
}

function readBooleanStorage(key: string, fallback = false) {
  try {
    const value = window.localStorage.getItem(key);
    if (value === null) return fallback;
    return value === "true";
  } catch {
    return fallback;
  }
}

function writeBooleanStorage(key: string, value: boolean) {
  try {
    window.localStorage.setItem(key, value ? "true" : "false");
  } catch {
    // Local settings are optional polish, not core paper storage.
  }
}

function normalizeSelectedSubjects(subjects: string[]): SelectableSubject[] {
  return [...new Set(subjects.filter((subject): subject is SelectableSubject => isSelectableSubject(subject)))];
}

function loadSelectedSubjects(data?: AppData): SelectableSubject[] {
  try {
    const raw = window.localStorage.getItem(SELECTED_SUBJECTS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        const selected = parsed.filter((subject): subject is SelectableSubject => typeof subject === "string" && isSelectableSubject(subject));
        if (selected.length) return [...new Set(selected)];
      }
    }
  } catch {
    // Fall back to papers below.
  }

  const inferred = data?.papers
    .map((paper) => paper.subject)
    .filter((subject): subject is SelectableSubject => isSelectableSubject(subject)) ?? [];
  return [...new Set(inferred)];
}

function saveSelectedSubjects(subjects: SelectableSubject[]) {
  try {
    window.localStorage.setItem(SELECTED_SUBJECTS_STORAGE_KEY, JSON.stringify(subjects));
  } catch {
    // Non-critical local preference.
  }
}

function loadActiveSubject(subjects: SelectableSubject[]) {
  try {
    const raw = window.localStorage.getItem(ACTIVE_SUBJECT_STORAGE_KEY);
    if (raw && subjects.includes(raw as SelectableSubject)) return raw as SelectableSubject;
  } catch {
    // Non-critical local preference.
  }
  const firstSupported = subjects.find(isSupportedSubject);
  return firstSupported ?? subjects[0] ?? null;
}

function saveActiveSubject(subject: string | null) {
  try {
    if (!subject) {
      window.localStorage.removeItem(ACTIVE_SUBJECT_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(ACTIVE_SUBJECT_STORAGE_KEY, subject);
  } catch {
    // Non-critical local preference.
  }
}

function validHexColour(value: unknown, fallback: string) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function loadPreferences(): AppPreferences {
  try {
    const raw = window.localStorage.getItem(PREFERENCES_STORAGE_KEY);
    if (!raw) return defaultPreferences;
    const parsed = JSON.parse(raw) as Partial<AppPreferences>;
    return {
      ...defaultPreferences,
      ...parsed,
      themeMode: ["dark", "system", "dim", "contrast"].includes(String(parsed.themeMode)) ? (parsed.themeMode as ThemeMode) : defaultPreferences.themeMode,
      accentColour: accentOptions.some((option) => option.value === parsed.accentColour) ? (parsed.accentColour as AccentColour) : defaultPreferences.accentColour,
      dashboardDensity: parsed.dashboardDensity === "compact" ? "compact" : "comfortable",
      showTechnicalModel: typeof parsed.showTechnicalModel === "boolean" ? parsed.showTechnicalModel : defaultPreferences.showTechnicalModel,
      showAnalyticsPanel: typeof parsed.showAnalyticsPanel === "boolean" ? parsed.showAnalyticsPanel : defaultPreferences.showAnalyticsPanel,
      showHeaderSystemInfo: typeof parsed.showHeaderSystemInfo === "boolean" ? parsed.showHeaderSystemInfo : defaultPreferences.showHeaderSystemInfo,
      showRecentUpdate: typeof parsed.showRecentUpdate === "boolean" ? parsed.showRecentUpdate : defaultPreferences.showRecentUpdate,
      showHeroStatus: typeof parsed.showHeroStatus === "boolean" ? parsed.showHeroStatus : defaultPreferences.showHeroStatus,
      showQuestionLegend: typeof parsed.showQuestionLegend === "boolean" ? parsed.showQuestionLegend : defaultPreferences.showQuestionLegend,
      showPaperSummary: typeof parsed.showPaperSummary === "boolean" ? parsed.showPaperSummary : defaultPreferences.showPaperSummary,
      showFocusProgress: typeof parsed.showFocusProgress === "boolean" ? parsed.showFocusProgress : defaultPreferences.showFocusProgress,
      showConfidenceSkip: typeof parsed.showConfidenceSkip === "boolean" ? parsed.showConfidenceSkip : defaultPreferences.showConfidenceSkip,
      showFloatingFeedback: typeof parsed.showFloatingFeedback === "boolean" ? parsed.showFloatingFeedback : defaultPreferences.showFloatingFeedback,
      devModeEnabled: typeof parsed.devModeEnabled === "boolean" ? parsed.devModeEnabled : defaultPreferences.devModeEnabled,
      sidebarDefault: parsed.sidebarDefault === "collapsed" ? "collapsed" : "expanded",
      autoSaveAnswers: typeof parsed.autoSaveAnswers === "boolean" ? parsed.autoSaveAnswers : defaultPreferences.autoSaveAnswers,
      focusModeDefault: typeof parsed.focusModeDefault === "boolean" ? parsed.focusModeDefault : defaultPreferences.focusModeDefault,
      timerBehaviour: parsed.timerBehaviour === "count_up" ? "count_up" : "count_down",
      notificationDuration: parsed.notificationDuration === "longer" || parsed.notificationDuration === "reduced" ? parsed.notificationDuration : "normal",
      reduceMotion: parsed.reduceMotion === "reduce" ? "reduce" : "system",
      sourceFigures: parsed.sourceFigures === "collapse" ? "collapse" : "show",
      questionNavigation: parsed.questionNavigation === "list" ? "list" : "grid",
      defaultLanding: parsed.defaultLanding === "catalogue" || parsed.defaultLanding === "last_paper" ? parsed.defaultLanding : "overview",
      customAccent: validHexColour(parsed.customAccent, defaultPreferences.customAccent),
      customAccent2: validHexColour(parsed.customAccent2, defaultPreferences.customAccent2),
    };
  } catch {
    return defaultPreferences;
  }
}

function savePreferences(preferences: AppPreferences) {
  try {
    window.localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Local-only preferences are best effort.
  }
}

function toastDuration(kind: ToastKind, preference: NotificationDuration) {
  const base = kind === "success" ? 4000 : kind === "info" ? 5000 : kind === "warning" ? 6000 : 7000;
  if (preference === "longer") return Math.round(base * 1.55);
  if (preference === "reduced") return Math.round(base * 0.62);
  return base;
}

function toNullable(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function toNullableNumber(value: string) {
  const trimmed = value.trim();
  return trimmed ? Number(trimmed) : null;
}

function displayMeta(paper: PastPaper) {
  return [paper.year, paper.series, paper.paperCode].filter(Boolean).join(" / ") || "Metadata pending";
}

function paperHasResolvedMetadata(paper: PastPaper) {
  return paper.processingStatus === "ready" || paper.totalMarks !== null || paper.durationMinutes !== null || paper.questions.length > 0;
}

function statusLabel(value: string) {
  const labels: Record<string, string> = {
    unprocessed: "Ready to process",
    processing: "Processing",
    ready: "Ready",
    failed: "Failed",
    in_progress: "In progress",
    submitted: "Submitted",
    marked: "Marked",
    attempted: "Attempted",
    saved: "Saved",
  };
  return labels[value] ?? value.replaceAll("_", " ");
}

function marksLabel(marks: number) {
  return `${marks} ${marks === 1 ? "mark" : "marks"}`;
}

function sourcePagesLabel(question: PastPaperQuestion) {
  const mediaPages = question.diagramMediaRefs.map((ref) => ref.pageNumber).filter((page): page is number => typeof page === "number");
  const pages = [...new Set([...(question.pageReferences ?? []), ...(question.imagePageReferences ?? []), ...mediaPages])].sort((a, b) => a - b);
  return pages.length ? pages.map((page) => `Page ${page}`).join(", ") : "No source page";
}

function questionSourcePageNumbers(question: PastPaperQuestion) {
  const mediaPages = relevantQuestionMediaRefs(question).map((ref) => ref.pageNumber).filter((page): page is number => typeof page === "number");
  const preferred = mediaPages.length ? mediaPages : question.pageReferences;
  return [...new Set(preferred ?? [])].sort((a, b) => a - b);
}

function relevantQuestionMediaRefs(question: PastPaperQuestion) {
  const promptMentionsFigure = /\b(figure|diagram|graph|map|source|image|photo|photograph|flowchart|table)\b/i.test(question.promptText);
  return question.diagramMediaRefs.filter((ref) => {
    const label = ref.label?.trim() ?? "";
    if (!label || label === "Media reference") return false;
    const kind = String(ref.kind ?? "").toLowerCase();
    const refMentionsFigure = /\b(figure|diagram|graph|map|source|image|photo|photograph|flowchart|table)\b/i.test(`${label} ${ref.description ?? ""} ${kind}`);
    return promptMentionsFigure && refMentionsFigure;
  });
}

function questionSourceScreenshots(paper: PastPaper, question: PastPaperQuestion): PaperPageScreenshot[] {
  const paperAsset = paper.assets.find((asset) => asset.kind === "paper");
  const mediaRefs = relevantQuestionMediaRefs(question);
  if (!paperAsset?.pageScreenshots?.length || !mediaRefs.length) return [];
  const pageNumbers = new Set(mediaRefs.map((ref) => ref.pageNumber).filter((page): page is number => typeof page === "number"));
  return paperAsset.pageScreenshots.filter((screenshot) => pageNumbers.has(screenshot.pageNumber) && screenshot.dataUrl);
}

function preferredAttemptTotal(paper: PastPaper, attempt: PastPaperAttempt) {
  return supportedTotalMarksForPaper(paper) || attempt.totalMarks;
}

function displayAttemptScores(paper: PastPaper, attempt: PastPaperAttempt) {
  return computeAttemptScores(attempt, paper);
}

function scoreSummary(score: number, total: number) {
  return `${score}/${total} (${formatPercent(score, total)})`;
}

function latestJob(paper: PastPaper, kind?: PastPaperProcessingJob["kind"]) {
  return [...paper.jobs].reverse().find((job) => !kind || job.kind === kind) ?? null;
}

function latestAcceptedMark(attempt: PastPaperAttempt | null, questionId: string) {
  if (!attempt) return null;
  return [...acceptedMarks(attempt, questionId)].sort((a, b) => b.reviewVersion - a.reviewVersion)[0] ?? null;
}

function displayQuestionLabel(paper: PastPaper, question: PastPaperQuestion) {
  return displayQuestionNumberForPaper(paper, question);
}

function scoreColor(awarded: number, maxMarks: number) {
  if (maxMarks <= 0) return "#a7b0bb";
  const percent = Math.max(0, Math.min(1, awarded / maxMarks));
  if (percent <= 0) return "#ff818f";
  if (percent < 0.25) return "#f59e42";
  if (percent < 0.5) return "#f6c453";
  if (percent < 0.75) return "#d9ee6f";
  if (percent < 1) return "#a8f08c";
  return "#80f6b4";
}

function scoreStyle(mark: PastPaperQuestionMark | null, maxMarks: number): React.CSSProperties | undefined {
  if (!mark) return undefined;
  if (isMarkingErrorMark(mark)) return { color: "#7dc7ff" };
  return { color: scoreColor(mark.awardedMarks, maxMarks) };
}

function predictedScoreStyle(answer: PastPaperAnswer | null | undefined, maxMarks: number): React.CSSProperties | undefined {
  if (!answer?.skippedWithConfidence) return undefined;
  return { color: scoreColor(answer.confidencePredictedMarks ?? 0, maxMarks) };
}

function reviewQuestionGroups(paper: PastPaper) {
  const groups = new Map<string, { question: PastPaperQuestion; index: number; label: string }[]>();
  paper.questions.forEach((question, index) => {
    const label = displayQuestionLabel(paper, question);
    const group = label.match(/^(\d+)/)?.[1] ?? "Other";
    const items = groups.get(group) ?? [];
    items.push({ question, index, label });
    groups.set(group, items);
  });
  return [...groups.entries()].map(([group, questions]) => ({ group, questions }));
}

function subjectPaperGroups(papers: PastPaper[]) {
  const groups = new Map<string, PastPaper[]>();
  papers.forEach((paper) => {
    const items = groups.get(paper.subject) ?? [];
    items.push(paper);
    groups.set(paper.subject, items);
  });
  return [...groups.entries()].map(([subject, items]) => ({
    subject,
    papers: [...items].sort((a, b) => (b.year ?? -1) - (a.year ?? -1) || a.title.localeCompare(b.title)),
  }));
}

function attemptsForPaper(data: AppData, paperId: string) {
  return data.attempts.filter((attempt) => attempt.paperId === paperId);
}

function paperStatusTone(paper: PastPaper, attempts: PastPaperAttempt[]) {
  if (attempts.some((attempt) => attempt.status === "marked")) return "marked";
  if (attempts.length) return "attempted";
  return paper.processingStatus;
}

function paperPrimaryActionLabel(paper: PastPaper, attempts: PastPaperAttempt[]) {
  if (paper.processingStatus === "unprocessed" || paper.processingStatus === "failed") return "Process now";
  if (paper.processingStatus === "processing") return "Processing";
  if (attempts.some((attempt) => attempt.status === "in_progress")) return "Continue";
  return "Start paper";
}

function paperProgressPercent(data: AppData, paper: PastPaper) {
  const attempts = attemptsForPaper(data, paper.id);
  const marked = attempts.find((attempt) => attempt.status === "marked");
  if (marked) {
    const total = preferredAttemptTotal(paper, marked);
    return total ? Math.round((displayAttemptScores(paper, marked).actualScore / total) * 100) : 0;
  }
  if (paper.processingStatus === "processing") return Math.max(6, Math.round(latestJob(paper, "processing")?.progressPercent ?? 12));
  if (paper.processingStatus === "ready") return 100;
  if (paper.questions.length) return Math.min(100, Math.max(12, Math.round((paper.questions.length / Math.max(1, paper.questions.length)) * 100)));
  return 0;
}

function paperBestScoreLabel(data: AppData, paper: PastPaper) {
  const best = bestScoreForPaper(data, paper.id);
  return best ?? "-";
}

function attemptReviewStats(paper: PastPaper, attempt: PastPaperAttempt | null) {
  if (!attempt) {
    return {
      answered: 0,
      blank: paper.questions.length,
      skipped: 0,
      unsupported: paper.questions.filter((question) => questionSupportIssue(question)).length,
      errors: 0,
      mistakes: 0,
    };
  }
  const answered = attempt.answers.filter(isAnswerAttempted).length;
  const skipped = attempt.answers.filter((answer) => answer.skipped).length;
  const unsupported = paper.questions.filter((question) => questionSupportIssue(question)).length;
  const errors = attempt.marks.filter(isMarkingErrorMark).length;
  const mistakes = paper.questions.filter((question) => {
    const mark = latestAcceptedMark(attempt, question.id);
    return mark && !isMarkingErrorMark(mark) && mark.awardedMarks < question.maxMarks;
  }).length;
  return {
    answered,
    skipped,
    unsupported,
    errors,
    mistakes,
    blank: Math.max(0, paper.questions.length - answered - skipped - unsupported),
  };
}

function markSchemeDataText(question: PastPaperQuestion | null) {
  if (!question?.markSchemeData) return "No aligned mark-scheme row is stored for this question.";
  const data = question.markSchemeData;
  const rows = Array.isArray(data.rows) ? data.rows : [];
  const rowText = rows
    .map((row, index) => {
      const value = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
      return [
        `Row ${index + 1}`,
        typeof value.markPoint === "string" ? `Mark point: ${value.markPoint}` : null,
        Array.isArray(value.accept) && value.accept.length ? `Also accept: ${value.accept.join("; ")}` : null,
        Array.isArray(value.doNotAccept) && value.doNotAccept.length ? `Do not accept: ${value.doNotAccept.join("; ")}` : null,
        Array.isArray(value.ignore) && value.ignore.length ? `Ignore: ${value.ignore.join("; ")}` : null,
        typeof value.guidance === "string" ? `Guidance: ${value.guidance}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
  const evidence = typeof data.evidence === "string" ? data.evidence : "";
  const points = Array.isArray(data.points) ? data.points.join("\n") : "";
  return [rowText, evidence ? `Evidence:\n${evidence}` : null, points && !rowText ? `Points:\n${points}` : null].filter(Boolean).join("\n\n") || JSON.stringify(data, null, 2);
}

function MarkSchemeDataPanel({ question, onCopy }: { question: PastPaperQuestion | null; onCopy: () => void }) {
  if (!question?.markSchemeData) {
    return (
      <div className="mark-scheme-row-panel mark-scheme-row-panel--structured">
        <p>No aligned mark-scheme row is stored for this question.</p>
      </div>
    );
  }
  const data = question.markSchemeData;
  const rows = Array.isArray(data.rows) ? data.rows : [];
  const evidence = typeof data.evidence === "string" ? data.evidence.trim() : "";
  const points = Array.isArray(data.points) ? data.points.filter((point): point is string => typeof point === "string" && point.trim().length > 0) : [];
  return (
    <div className="mark-scheme-row-panel mark-scheme-row-panel--structured">
      <div className="mark-scheme-row-panel__header">
        <div>
          <span className="eyebrow">Aligned mark scheme</span>
          <strong>{rows.length ? `${rows.length} source row${rows.length === 1 ? "" : "s"}` : "Source evidence"}</strong>
        </div>
        <button className="secondary-button" type="button" onClick={onCopy}>
          <Copy size={16} /> Copy row
        </button>
      </div>
      {rows.length ? (
        <div className="mark-scheme-structured-list">
          {rows.map((row, index) => {
            const value = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
            const accept = Array.isArray(value.accept) ? value.accept.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
            const reject = Array.isArray(value.doNotAccept) ? value.doNotAccept.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
            const ignore = Array.isArray(value.ignore) ? value.ignore.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
            const markPoint = typeof value.markPoint === "string" ? value.markPoint.trim() : "";
            const guidance = typeof value.guidance === "string" ? value.guidance.trim() : "";
            return (
              <article className="mark-scheme-structured-row" key={`${index}-${markPoint.slice(0, 16)}`}>
                <span className="eyebrow">Row {index + 1}</span>
                {markPoint ? (
                  <section>
                    <strong>Mark point</strong>
                    <p>{markPoint}</p>
                  </section>
                ) : null}
                {accept.length ? (
                  <section>
                    <strong>Accept</strong>
                    <div className="chip-wrap">
                      {accept.map((item) => (
                        <span className="static-chip" key={item}>
                          {item}
                        </span>
                      ))}
                    </div>
                  </section>
                ) : null}
                {reject.length ? (
                  <section>
                    <strong>Reject</strong>
                    <div className="chip-wrap">
                      {reject.map((item) => (
                        <span className="static-chip static-chip--danger" key={item}>
                          {item}
                        </span>
                      ))}
                    </div>
                  </section>
                ) : null}
                {ignore.length ? (
                  <section>
                    <strong>Ignore</strong>
                    <p>{ignore.join("; ")}</p>
                  </section>
                ) : null}
                {guidance ? (
                  <section>
                    <strong>Guidance</strong>
                    <p>{guidance}</p>
                  </section>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : points.length ? (
        <div className="chip-wrap">
          {points.map((point) => (
            <span className="static-chip" key={point}>
              {point}
            </span>
          ))}
        </div>
      ) : null}
      {evidence ? (
        <details className="raw-evidence-details">
          <summary>Raw evidence</summary>
          <p>{evidence}</p>
        </details>
      ) : null}
    </div>
  );
}

function textLengthForAsset(asset: PastPaperAsset) {
  return asset.pageTexts?.reduce((sum, page) => sum + page.charCount, 0) ?? asset.textContent?.length ?? 0;
}

function latestAIRequest(diagnostics?: ProcessingDiagnostics | null) {
  return diagnostics?.aiRequests.at(-1) ?? null;
}

function diagnosticBundle(paper: PastPaper, attempts: PastPaperAttempt[] = []) {
  return {
    exportedAt: new Date().toISOString(),
    paper: {
      id: paper.id,
      title: paper.title,
      subject: paper.subject,
      processingStatus: paper.processingStatus,
      processingError: paper.processingError,
      totalMarks: paper.totalMarks,
      durationMinutes: paper.durationMinutes,
    },
    processingDiagnostics: paper.processingDiagnostics ?? null,
    jobs: paper.jobs.map((job) => ({
      id: job.id,
      kind: job.kind,
      status: job.status,
      attemptId: job.attemptId,
      remarkId: job.remarkId,
      progressPercent: job.progressPercent,
      currentStage: job.currentStage,
      errorMessage: job.errorMessage,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      diagnostics: job.diagnostics ?? null,
    })),
    questions: paper.questions.map((question) => ({
      id: question.id,
      questionNumber: question.questionNumber,
      maxMarks: question.maxMarks,
      responseType: question.responseType,
      optionsCount: question.options.length,
      sourcePages: questionSourcePageNumbers(question),
      mediaRefs: question.diagramMediaRefs,
      hasMarkSchemeData: Boolean(question.markSchemeData),
      markSchemeRef: question.markSchemeRef,
      markSchemeDataPreview: question.markSchemeData ? JSON.stringify(question.markSchemeData).slice(0, 2400) : null,
      supportIssue: questionSupportIssue(question),
      extractionWarnings: question.extractionWarnings ?? [],
    })),
    attempts: attempts
      .filter((attempt) => attempt.paperId === paper.id)
      .map((attempt) => ({
        id: attempt.id,
        status: attempt.status,
        startedAt: attempt.startedAt,
        submittedAt: attempt.submittedAt,
        completedAt: attempt.completedAt,
        actualScore: attempt.actualScore,
        confidenceAdjustedScore: attempt.confidenceAdjustedScore,
        totalMarks: preferredAttemptTotal(paper, attempt),
        answeredCount: attempt.answers.filter(isAnswerAttempted).length,
        skippedCount: attempt.answers.filter((answer) => answer.skipped).length,
        unansweredCount: attempt.answers.filter((answer) => !answer.skipped && !isAnswerAttempted(answer)).length,
        answers: attempt.answers.map((answer) => ({
          questionId: answer.questionId,
          attempted: isAnswerAttempted(answer),
          skipped: answer.skipped,
          hasText: Boolean(answer.responseText?.trim()),
          hasNumeric: answer.numericResponse !== null,
          selectedOptionsCount: answer.selectedOptions.length,
        })),
        marks: attempt.marks.map((mark) => ({
          questionId: mark.questionId,
          source: mark.source,
          awardedMarks: mark.awardedMarks,
          maxMarks: mark.maxMarks,
          accepted: mark.accepted,
          rationale: mark.rationale,
          markSchemeEvidence: mark.markSchemeEvidence,
        })),
      })),
    assets: paper.assets.map((asset) => ({
      id: asset.id,
      kind: asset.kind,
      fileName: asset.fileName,
      mimeType: asset.mimeType,
      size: asset.size,
      pageCount: asset.pageCount ?? null,
      textLength: textLengthForAsset(asset),
      pageTextLengths: (asset.pageTexts ?? []).map((page) => ({ pageNumber: page.pageNumber, charCount: page.charCount })),
      extractionDiagnostics: asset.extractionDiagnostics ?? null,
      screenshotMetadata: (asset.pageScreenshots ?? []).map((screenshot) => ({
        pageNumber: screenshot.pageNumber,
        width: screenshot.width,
        height: screenshot.height,
        byteSize: screenshot.byteSize,
        thumbnailByteSize: screenshot.thumbnailByteSize,
        mimeType: screenshot.mimeType,
      })),
      screenshotThumbnails: (asset.pageScreenshots ?? []).map((screenshot) => ({
        pageNumber: screenshot.pageNumber,
        thumbnailDataUrl: screenshot.thumbnailDataUrl,
      })),
    })),
  };
}

function downloadDiagnosticBundle(paper: PastPaper, attempts: PastPaperAttempt[] = []) {
  const blob = new Blob([JSON.stringify(diagnosticBundle(paper, attempts), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${paper.title.replace(/[^a-z0-9]+/gi, "-").replace(/(^-|-$)/g, "").toLowerCase() || "paper"}-diagnostics.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function SectionFrame({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="section-frame">
      <div className="section-frame__header">
        <div>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {actions ? <div className="button-row">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

function TypewriterText({ phrases, reduceMotion }: { phrases: string[]; reduceMotion: boolean }) {
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [visibleCount, setVisibleCount] = useState(phrases[0]?.length ?? 0);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (reduceMotion || !phrases.length) {
      setVisibleCount(phrases[0]?.length ?? 0);
      return;
    }
    const phrase = phrases[phraseIndex] ?? "";
    const atFullPhrase = !deleting && visibleCount >= phrase.length;
    const atEmptyPhrase = deleting && visibleCount <= 0;
    const delay = atFullPhrase ? 5200 : atEmptyPhrase ? 420 : deleting ? 46 : 82;
    const timer = window.setTimeout(() => {
      if (atFullPhrase) {
        setDeleting(true);
        return;
      }
      if (atEmptyPhrase) {
        setDeleting(false);
        setPhraseIndex((index) => (index + 1) % phrases.length);
        return;
      }
      setVisibleCount((count) => count + (deleting ? -1 : 1));
    }, delay);
    return () => window.clearTimeout(timer);
  }, [deleting, phraseIndex, phrases, reduceMotion, visibleCount]);

  const phrase = phrases[phraseIndex] ?? "";
  return (
    <span className="typewriter" aria-hidden="true">
      {reduceMotion ? phrases[0] : phrase.slice(0, visibleCount)}
      <span className="typewriter__caret" />
    </span>
  );
}

function LandingPage({ reduceMotion, onEnter, onUpload, onFeedback }: { reduceMotion: boolean; onEnter: () => void; onUpload: () => void; onFeedback: () => void }) {
  const phrases = [
    "Upload a paper. Get marks back.",
    "Answer questions online.",
    "See where marks were lost.",
    "Built for GCSE revision.",
    "Checked against the source.",
    "Your papers stay local.",
    "Developed by Rayaan Omair.",
  ];
  const reveal = reduceMotion ? {} : { initial: { opacity: 0, y: 18 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: "-80px" }, transition: { duration: 0.42 } };

  function scrollToWorkflow() {
    document.getElementById("workflow")?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  }

  return (
    <main className="landing-page">
      <nav className="landing-nav" aria-label="Landing navigation">
        <AppLogo size={32} />
        <div className="button-row">
          <button className="secondary-button" onClick={onEnter}>Enter app</button>
          <a className="secondary-button" href="https://github.com/v11exe/past-paper-worker" target="_blank" rel="noreferrer">
            <Github size={16} /> GitHub
          </a>
          <button className="secondary-button" onClick={onFeedback}>
            <MessageSquare size={16} /> Feedback
          </button>
        </div>
      </nav>

      <section className="landing-hero">
        <motion.div className="landing-hero__copy" {...reveal}>
          <span className="pixel-label">Developed by Rayaan Omair</span>
          <h1>Past papers, marked in minutes.</h1>
          <p className="landing-hero__typewriter">
            <TypewriterText phrases={phrases} reduceMotion={reduceMotion} />
            <span className="sr-only">{phrases.join(" ")}</span>
          </p>
          <p>Upload a question paper and mark scheme. Answer questions online, then get examiner-style feedback against the source.</p>
          <div className="button-row">
            <button className="primary-button" onClick={onEnter}>
              <Play size={16} /> Start practising
            </button>
            <button className="secondary-button" onClick={onUpload}>
              <UploadCloud size={16} /> Upload a paper
            </button>
            <button className="secondary-button" onClick={scrollToWorkflow}>See how it works</button>
          </div>
        </motion.div>

        <motion.div className="landing-preview os-window" {...reveal}>
          <div className="os-window__bar">
            <span />
            <span />
            <span />
          </div>
          <div className="landing-preview__body">
            <div className="landing-preview__paper">
              <span className="eyebrow">Question 1</span>
              <strong>Which structure controls the activities of the cell?</strong>
              {["A. nucleus", "B. ribosome", "C. cell wall", "D. cytoplasm"].map((option) => (
                <span key={option} className="landing-preview__choice">{option}</span>
              ))}
            </div>
            <div className="landing-preview__mark">
              <span className="eyebrow">Marked</span>
              <strong>1/1</strong>
              <p>Correct. The nucleus controls cell activities.</p>
            </div>
          </div>
        </motion.div>
      </section>

      <motion.section className="quick-strip" {...reveal} aria-label="What Past Paper Worker does">
        {["Upload paper", "Extract questions", "Answer online", "Mark answers", "Review feedback", "Keep progress locally"].map((item) => (
          <button key={item} className="quick-strip__item" onClick={item === "Upload paper" ? onUpload : undefined}>{item}</button>
        ))}
      </motion.section>

      <motion.section id="workflow" className="landing-section landing-section--steps" {...reveal}>
        <div className="landing-section__header">
          <span className="eyebrow">Workflow</span>
          <h2>From upload to review.</h2>
        </div>
        <div className="workflow-grid">
          {[
            ["1", "Upload your paper", "Add the question paper and mark scheme."],
            ["2", "Answer questions online", "Work through one question at a time."],
            ["3", "Review your marks", "See your score, feedback, and missed points."],
          ].map(([step, title, copy]) => (
            <article className="workflow-card os-window" key={step}>
              <div className="os-window__bar"><span /><span /><span /></div>
              <span className="workflow-card__step">{step}</span>
              <strong>{title}</strong>
              <p>{copy}</p>
            </article>
          ))}
        </div>
      </motion.section>

      <motion.section className="landing-section" {...reveal}>
        <div className="feature-grid">
          {[
            ["Source-checked marking", "Feedback is based on the uploaded mark scheme."],
            ["Focus mode", "Answer one question at a time without dashboard clutter."],
            ["Local storage", "Papers and attempts stay on this device."],
            ["Supported GCSE subjects", "Built around the subjects you actually study."],
            ["Retry and review", "Repeat papers and compare marked attempts."],
            ["Bug reports with diagnostics", "Send useful details when something breaks."],
          ].map(([title, copy]) => (
            <article className="feature-card" key={title}>
              <strong>{title}</strong>
              <p>{copy}</p>
            </article>
          ))}
        </div>
      </motion.section>

      <motion.section className="landing-section" {...reveal}>
        <div className="landing-section__header">
          <span className="eyebrow">Supported subjects</span>
          <h2>Supported GCSE science and computer science workspaces.</h2>
        </div>
        <div className="subject-chip-grid">
          {subjectMetaList.map((subject) => (
            <span className="subject-preview-chip" key={subject.id} style={{ "--subject-accent": subject.accent } as React.CSSProperties}>
              <subject.Icon size={16} /> {subject.shortLabel}
            </span>
          ))}
        </div>
      </motion.section>

      <motion.section className="landing-trust os-window" {...reveal}>
        <div className="os-window__bar"><span /><span /><span /></div>
        <div>
          <ShieldCheck size={22} />
          <h2>Your papers stay local.</h2>
          <p>Papers and attempts are stored on this device. AI requests go through the secure Worker proxy, so API keys stay server-side.</p>
        </div>
        <div>
          <Code2 size={22} />
          <h2>Built from real revision workflow.</h2>
          <p>Past Paper Worker is designed around uploading papers, practising them, and seeing where marks were lost, not around generic AI chat.</p>
        </div>
      </motion.section>

      <footer className="landing-footer">
        <strong>Past Paper Worker</strong>
        <span>Developed by Rayaan Omair</span>
        <span>Logo credit: Elliot Neilsen</span>
        <span>Version {appMeta.version}</span>
        <button className="chip-button" onClick={onFeedback}>Feedback</button>
        <a className="chip-button" href="https://github.com/v11exe/past-paper-worker" target="_blank" rel="noreferrer">GitHub</a>
      </footer>
    </main>
  );
}

function SubjectOnboardingV131({ selectedSubjects, onSave }: { selectedSubjects: SelectableSubject[]; onSave: (subjects: SelectableSubject[]) => void }) {
  const [draft, setDraft] = useState<SelectableSubject[]>(selectedSubjects);
  const [showUnsupported, setShowUnsupported] = useState(false);

  useEffect(() => {
    setDraft(selectedSubjects);
  }, [selectedSubjects]);

  function toggleSubject(subject: SelectableSubject) {
    setDraft((current) => (current.includes(subject) ? current.filter((item) => item !== subject) : [...current, subject]));
  }

  return (
    <main className="onboarding-page">
      <section className="onboarding-panel os-window">
        <div className="os-window__bar"><span /><span /><span /></div>
        <div className="onboarding-panel__header">
          <AppLogo size={44} />
          <div>
            <span className="eyebrow">Setup</span>
            <h1>What subjects are you studying?</h1>
            <p>Save the subjects you study. Upload and marking support is currently available for AQA Biology, Chemistry, Physics, and OCR Computer Science.</p>
          </div>
        </div>

        <div className="landing-section__header onboarding-section-heading">
          <span className="eyebrow">Supported now</span>
          <h2>Ready for upload and marking</h2>
        </div>
        <div className="subject-picker-grid">
          {subjectMetaList.map((subject) => {
            const active = draft.includes(subject.label);
            return (
              <button
                key={subject.id}
                className={active ? "subject-picker-chip subject-picker-chip--active" : "subject-picker-chip"}
                style={{ "--subject-accent": subject.accent } as React.CSSProperties}
                onClick={() => toggleSubject(subject.label)}
                aria-pressed={active}
              >
                <subject.Icon size={18} />
                <span>{subject.shortLabel}</span>
                <small>{subject.examBoard} · {subject.specCode ?? subject.level}</small>
              </button>
            );
          })}
        </div>

        <div className="selected-subjects-bar">
          <span>{draft.length ? `${draft.length} selected` : "No subjects selected"}</span>
          <div className="selected-subjects-bar__chips">
            {draft.map((subject) => (
              <span className="static-chip" key={subject}>{subjectMetaForLabel(subject)?.shortLabel ?? subject}</span>
            ))}
          </div>
        </div>

        <button className="unsupported-toggle" onClick={() => setShowUnsupported((value) => !value)} aria-expanded={showUnsupported}>
          <ChevronDown size={16} className={showUnsupported ? "question-disclosure__icon question-disclosure__icon--open" : "question-disclosure__icon"} />
          Unsupported subjects
        </button>
        <AnimatePresence initial={false}>
          {showUnsupported ? (
            <motion.div
              className="unsupported-subject-grid"
              initial={{ height: 0, opacity: 0, clipPath: "inset(0 0 100% 0)" }}
              animate={{ height: "auto", opacity: 1, clipPath: "inset(0 0 0 0)" }}
              exit={{ height: 0, opacity: 0, clipPath: "inset(0 0 100% 0)" }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="unsupported-callout">
                <strong>Not supported yet</strong>
                <p>These subjects can be saved, but upload support is not available for them yet.</p>
              </div>
              {unsupportedSubjects.map((subject) => {
                const meta = subjectMetaForLabel(subject);
                const active = draft.includes(subject);
                if (!meta) return null;
                return (
                  <button
                    key={subject}
                    className={active ? "subject-picker-chip subject-picker-chip--unsupported subject-picker-chip--active" : "subject-picker-chip subject-picker-chip--unsupported"}
                    style={{ "--subject-accent": meta.accent } as React.CSSProperties}
                    onClick={() => toggleSubject(subject)}
                    aria-pressed={active}
                  >
                    <meta.Icon size={18} />
                    <span>{meta.shortLabel}</span>
                    <small>{active ? "Selected · Not supported yet" : "Not added · Not supported yet"}</small>
                  </button>
                );
              })}
            </motion.div>
          ) : null}
        </AnimatePresence>

        <div className="button-row onboarding-actions">
          <button className="primary-button" disabled={!draft.length} onClick={() => onSave(draft)}>
            <Check size={16} /> Save subjects
          </button>
        </div>
      </section>
    </main>
  );
}

function PaperWindowCard({
  paper,
  attempts,
  onOpen,
  onStart,
  onProcess,
  onDelete,
}: {
  paper: PastPaper;
  attempts: PastPaperAttempt[];
  onOpen: () => void;
  onStart: () => void;
  onProcess: () => void;
  onDelete: () => void;
}) {
  const tone = paperStatusTone(paper, attempts);
  const bestScore = paperBestScoreLabel({ papers: [paper], attempts }, paper);
  const lastMarked = attempts.find((attempt) => attempt.status === "marked");
  const lastScore = lastMarked ? formatPercent(displayAttemptScores(paper, lastMarked).actualScore, preferredAttemptTotal(paper, lastMarked)) : "No marked attempt";
  const metadataReady = paperHasResolvedMetadata(paper);
  return (
    <article className="paper-window-card os-window">
      <div className="os-window__bar"><span /><span /><span /></div>
      <button className="paper-window-card__main" onClick={onOpen}>
        <div className="paper-card__chips">
          <span className={`status-chip status-chip--${tone}`}>{statusLabel(tone)}</span>
          {paper.year ? <span className="static-chip">{paper.year}</span> : null}
          {paper.series ? <span className="static-chip">{paper.series}</span> : null}
        </div>
        <strong>{paper.title}</strong>
        <span>{displayMeta(paper)}</span>
      </button>
      <div className="paper-card__metrics">
        {metadataReady ? (
          <>
            <span>{paper.questions.length} questions</span>
            <span>{paper.totalMarks ?? "-"} marks</span>
            <span>{paper.durationMinutes ? `${paper.durationMinutes} min` : "-"}</span>
            <span>{attempts.length} attempts</span>
            <span>Last {lastScore}</span>
            <span>Best {bestScore}</span>
          </>
        ) : (
          <>
            <span>Metadata pending</span>
            <span>{attempts.length} attempts</span>
            <span>{paper.hasMarkScheme ? "Mark scheme ready" : "No mark scheme"}</span>
            <span>{statusLabel(paper.processingStatus)}</span>
          </>
        )}
      </div>
      {!metadataReady ? <p className="paper-card__hint">Process the paper to extract questions, marks and timing.</p> : null}
      {paper.processingStatus === "processing" ? <ProcessingPanel paper={paper} job={latestJob(paper, "processing")} variant="compact" /> : null}
      {paper.processingError ? <p className="processing-error">{paper.processingError}</p> : null}
      <div className="paper-card__actions">
        <button className={paper.processingStatus === "ready" ? "primary-button paper-card__primary-action" : "secondary-button paper-card__primary-action"} onClick={paper.processingStatus === "ready" ? onStart : onProcess} disabled={paper.processingStatus === "processing"}>
          {paper.processingStatus === "ready" ? <Play size={16} /> : <ScanLine size={16} />}
          {paper.processingStatus === "ready" ? "Start paper" : "Process now"}
        </button>
        <button className="icon-button" onClick={onOpen} aria-label={`Open ${paper.title}`}>
          <Eye size={16} />
        </button>
        <button className="icon-button danger-button" onClick={onDelete} aria-label={`Delete ${paper.title}`}>
          <Trash2 size={16} />
        </button>
      </div>
    </article>
  );
}

function SubjectDashboard({
  activeSubject,
  papers,
  attempts,
  onUpload,
  onOpenPaper,
  onStartPaper,
  onProcessPaper,
  onDeletePaper,
}: {
  activeSubject: SupportedSubject;
  papers: PastPaper[];
  attempts: PastPaperAttempt[];
  onUpload: () => void;
  onOpenPaper: (paper: PastPaper) => void;
  onStartPaper: (paper: PastPaper) => void;
  onProcessPaper: (paper: PastPaper) => void;
  onDeletePaper: (paper: PastPaper) => void;
}) {
  const meta = subjectMetaForLabel(activeSubject) as Extract<NonNullable<ReturnType<typeof subjectMetaForLabel>>, { supported: true }> | null;
  const supportedMeta = meta;
  const activeProcessing = papers.filter((paper) => paper.processingStatus === "processing");
  return (
    <div className="subject-dashboard">
      <header className="subject-dashboard__header">
        <div>
          <span className="eyebrow">Your subject</span>
          <h1>{supportedMeta?.shortLabel ?? activeSubject}</h1>
          <p>{meta ? `${meta.examBoard} · ${meta.level}${meta.specCode ? ` · ${meta.specCode}` : ""}` : activeSubject}</p>
        </div>
        <div className="button-row">
          {meta ? (
            <a className="secondary-button" href={meta.specUrl} target="_blank" rel="noreferrer">
              Specification <ExternalLink size={16} />
            </a>
          ) : null}
          <button className="primary-button" onClick={onUpload}>
            <UploadCloud size={16} /> Upload paper
          </button>
        </div>
      </header>

      {activeProcessing.length ? (
        <section className="subject-dashboard__queue">
          {activeProcessing.map((paper) => (
            <ProcessingPanel key={paper.id} paper={paper} job={latestJob(paper, "processing")} variant="compact" />
          ))}
        </section>
      ) : null}

      <section className="upload-card os-window">
        <div className="os-window__bar"><span /><span /><span /></div>
        <button className="upload-card__button" onClick={onUpload}>
          <span className="upload-card__plus"><Plus size={30} /></span>
          <strong>Upload paper</strong>
          <p>Add a question paper and mark scheme for {meta?.shortLabel ?? activeSubject}.</p>
        </button>
      </section>

      <section className="subject-dashboard__papers">
        <div className="section-frame__header">
          <div>
            <span className="eyebrow">Existing papers</span>
            <h2>{papers.length ? `${papers.length} paper${papers.length === 1 ? "" : "s"}` : "No papers yet."}</h2>
            {!papers.length ? <p>Upload a paper for this subject to begin.</p> : null}
          </div>
        </div>
        {papers.length ? (
          <div className="paper-window-grid">
            {papers.map((paper) => {
              const paperAttempts = attempts.filter((attempt) => attempt.paperId === paper.id);
              return (
                <PaperWindowCard
                  key={paper.id}
                  paper={paper}
                  attempts={paperAttempts}
                  onOpen={() => onOpenPaper(paper)}
                  onStart={() => onStartPaper(paper)}
                  onProcess={() => onProcessPaper(paper)}
                  onDelete={() => onDeletePaper(paper)}
                />
              );
            })}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function UnsupportedSubjectDashboard({
  activeSubject,
  papers,
  onEditSubjects,
}: {
  activeSubject: SelectableSubject | null;
  papers: PastPaper[];
  onEditSubjects: () => void;
}) {
  const meta = activeSubject ? subjectMetaForLabel(activeSubject) : null;
  const legacyPapers = activeSubject ? papers.filter((paper) => paper.subject === activeSubject) : [];

  return (
    <div className="subject-dashboard subject-dashboard--unsupported">
      <header className="subject-dashboard__header">
        <div>
          <span className="eyebrow">Unsupported subject</span>
          <h1>{meta?.shortLabel ?? "Not supported yet"}</h1>
          <p>{activeSubject ?? "Choose a subject to continue."}</p>
        </div>
        <div className="button-row">
          <button className="secondary-button" onClick={onEditSubjects}>
            <Plus size={16} /> Edit subjects
          </button>
        </div>
      </header>

      <section className="section-frame unsupported-dashboard-panel">
        <div className="section-frame__header">
          <div>
            <span className="eyebrow">Availability</span>
            <h2>Upload support is not available for this subject yet.</h2>
            <p>Supported now: AQA Biology, Chemistry, Physics, and OCR Computer Science.</p>
          </div>
        </div>
        <div className="feature-grid unsupported-dashboard-panel__grid">
          <article className="feature-card">
            <strong>Not supported yet</strong>
            <p>This subject can stay in your saved list, but the normal upload, processing, marking, and review flow is disabled for now.</p>
          </article>
          <article className="feature-card">
            <strong>Switch to a supported subject</strong>
            <p>Pick Biology, Chemistry, Physics, or Computer Science from the main rail to upload and practise papers.</p>
          </article>
          <article className="feature-card">
            <strong>Legacy papers</strong>
            <p>{legacyPapers.length ? `${legacyPapers.length} existing paper${legacyPapers.length === 1 ? "" : "s"} are stored for this subject, but v1.3.1 does not treat it as supported.` : "No papers stored for this subject yet."}</p>
          </article>
        </div>
      </section>
    </div>
  );
}

function SubjectSidebarV131({
  collapsed,
  selectedSubjects,
  activeSubject,
  onToggleCollapsed,
  onSelectSubject,
  onToggleUnsupportedSubject,
  onHome,
  onAddSubject,
  onUpload,
  onSettings,
  onVersion,
  onCredits,
}: {
  collapsed: boolean;
  selectedSubjects: SelectableSubject[];
  activeSubject: SelectableSubject | null;
  onToggleCollapsed: () => void;
  onSelectSubject: (subject: SelectableSubject) => void;
  onToggleUnsupportedSubject: (subject: SelectableSubject) => void;
  onHome: () => void;
  onAddSubject: () => void;
  onUpload: () => void;
  onSettings: () => void;
  onVersion: () => void;
  onCredits: () => void;
}) {
  const [showUnsupported, setShowUnsupported] = useState(false);
  const supportedSelected = selectedSubjects.filter(isSupportedSubject);
  const unsupportedSelected = selectedSubjects.filter((subject) => !isSupportedSubject(subject));
  const uploadEnabled = Boolean(activeSubject && isSupportedSubject(activeSubject));

  return (
    <aside className={collapsed ? "subject-sidebar subject-sidebar--collapsed" : "subject-sidebar"}>
      <div className="subject-sidebar__brand">
        <div className="subject-sidebar__brand-control">
          <button className="icon-button" onClick={onToggleCollapsed} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
            {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          </button>
          <button className="subject-sidebar__home-button" onClick={onHome} title="Home">
            <AppLogo size={32} showText={!collapsed} />
          </button>
        </div>
        {!collapsed ? (
          <button className="subject-sidebar__home-copy" onClick={onHome} title="Home">
            <strong>Past Paper Worker</strong>
            <span>Marked GCSE practice</span>
          </button>
        ) : null}
      </div>

      <div className="subject-sidebar__section subject-sidebar__section--grow">
        {!collapsed ? <span className="eyebrow">YOUR SUBJECTS</span> : null}
        <div className="subject-sidebar__list">
          {supportedSelected.map((subject) => {
            const meta = subjectMetaForLabel(subject);
            const Icon = meta?.Icon ?? FileText;
            return (
              <button
                key={subject}
                className={subject === activeSubject ? "subject-nav-item subject-nav-item--active" : "subject-nav-item"}
                onClick={() => onSelectSubject(subject)}
                title={meta?.shortLabel ?? subject}
                style={{ "--subject-accent": meta?.accent ?? "var(--accent)" } as React.CSSProperties}
              >
                <Icon size={18} />
                {!collapsed ? <span>{meta?.shortLabel ?? subject}</span> : null}
              </button>
            );
          })}
        </div>

        <button className="subject-nav-item subject-nav-item--utility" onClick={onAddSubject} title="Add Subject">
          <Plus size={18} />
          {!collapsed ? <span>Add Subject</span> : null}
        </button>

        <button className="subject-nav-item subject-nav-item--utility" onClick={() => setShowUnsupported((value) => !value)} aria-expanded={showUnsupported} title="Unsupported subjects">
          <ChevronDown size={18} className={showUnsupported ? "question-disclosure__icon question-disclosure__icon--open" : "question-disclosure__icon"} />
          {!collapsed ? <span>Unsupported subjects</span> : null}
        </button>

        <AnimatePresence initial={false}>
          {showUnsupported && !collapsed ? (
            <motion.div
              className="sidebar-unsupported-list"
              initial={{ height: 0, opacity: 0, clipPath: "inset(0 0 100% 0)" }}
              animate={{ height: "auto", opacity: 1, clipPath: "inset(0 0 0 0)" }}
              exit={{ height: 0, opacity: 0, clipPath: "inset(0 0 100% 0)" }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            >
              {unsupportedSubjects.map((subject) => {
                const meta = subjectMetaForLabel(subject);
                const selected = unsupportedSelected.includes(subject);
                const active = activeSubject === subject;
                if (!meta) return null;
                return (
                  <button
                    key={subject}
                    className={active ? "unsupported-nav-row unsupported-nav-row--active" : "unsupported-nav-row"}
                    style={{ "--subject-accent": meta.accent } as React.CSSProperties}
                    onClick={() => (selected ? onSelectSubject(subject) : onToggleUnsupportedSubject(subject))}
                  >
                    <div className="unsupported-nav-row__main">
                      <meta.Icon size={16} />
                      <span>{meta.shortLabel}</span>
                    </div>
                    <div className="unsupported-nav-row__status">
                      <small>{active ? "selected" : selected ? "added" : "not added"}</small>
                      <span className="static-chip">unsupported</span>
                    </div>
                  </button>
                );
              })}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      <div className="subject-sidebar__section subject-sidebar__section--bottom">
        <button className="primary-button primary-button--wide subject-sidebar__upload" onClick={onUpload} title={uploadEnabled ? "Upload paper" : "Upload support is not available for this subject yet"} disabled={!uploadEnabled}>
          <UploadCloud size={16} /> {!collapsed ? "Upload paper" : null}
        </button>
        <div className="subject-sidebar__utility">
          <button className="subject-nav-item subject-nav-item--utility" onClick={onSettings} title="Settings">
            <Settings2 size={18} /> {!collapsed ? <span>Settings</span> : null}
          </button>
          <button className="subject-nav-item subject-nav-item--utility" onClick={onVersion} title={`${appMeta.version} ${currentVersionEntry.title}`}>
            <Sparkles size={18} /> {!collapsed ? <span>{appMeta.version} {currentVersionEntry.title} -&gt;</span> : null}
          </button>
          <button className="subject-nav-item subject-nav-item--utility" onClick={onCredits} title="Credits">
            <Info size={18} /> {!collapsed ? <span>Credits</span> : null}
          </button>
        </div>
      </div>
    </aside>
  );
}

function VersionHistoryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <AnimatePresence>
      {open ? (
        <motion.div className="paper-modal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="paper-modal__panel version-modal__panel" initial={{ y: 18, scale: 0.98 }} animate={{ y: 0, scale: 1 }} exit={{ y: 18, scale: 0.98 }}>
            <div className="section-frame__header">
              <div>
                <span className="eyebrow">Version</span>
                <h2>Version history</h2>
              </div>
              <button className="icon-button" onClick={onClose} aria-label="Close version history">
                <X size={16} />
              </button>
            </div>
            <div className="version-timeline">
              {versionHistory.map((entry) => (
                <article className="version-entry" key={entry.version}>
                  <span className="static-chip">{entry.version}</span>
                  <div>
                    <h3>{entry.title}</h3>
                    <p>{entry.date}</p>
                    <ul>
                      {entry.changes.map((change) => (
                        <li key={change}>{change}</li>
                      ))}
                    </ul>
                  </div>
                </article>
              ))}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function CreditsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <AnimatePresence>
      {open ? (
        <motion.div className="paper-modal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="paper-modal__panel paper-modal__panel--mini" initial={{ y: 18, scale: 0.98 }} animate={{ y: 0, scale: 1 }} exit={{ y: 18, scale: 0.98 }}>
            <div className="section-frame__header">
              <div>
                <span className="eyebrow">Credits</span>
                <h2>Past Paper Worker</h2>
              </div>
              <button className="icon-button" onClick={onClose} aria-label="Close credits">
                <X size={16} />
              </button>
            </div>
            <div className="credits-panel">
              <p><strong>Developed by Rayaan Omair.</strong></p>
              <p><strong>Logo credit: Elliot Neilsen.</strong></p>
              <div className="chip-wrap">
                {["React", "Vite", "Cloudflare Workers", "Gemini via secure Worker proxy", "pdf.js", "lucide-react", "framer-motion"].map((item) => (
                  <span className="static-chip" key={item}>{item}</span>
                ))}
              </div>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function UnsupportedQuestionPanel({ issue, marks, onReport }: { issue: { reason: string; reported: boolean }; marks: number; onReport?: () => void }) {
  return (
    <div className="unsupported-question-state" role="note">
      <div>
        <span className="eyebrow">Unsupported question type</span>
        <strong>Unsupported question type</strong>
        <p>This question needs a table, diagram, matching grid, or drawing tool that is not supported yet.</p>
        <p>This question will not be included in your marked total.</p>
      </div>
      <p className="muted-copy">{issue.reason}</p>
      {onReport ? (
        <button className="secondary-button" onClick={onReport} disabled={issue.reported}>
          <AlertCircle size={16} /> {issue.reported ? "Reported" : "Report inaccurate classification"}
        </button>
      ) : null}
      <span className="static-chip static-chip--danger">-{marks} marks</span>
    </div>
  );
}

function InlineStatus({ pending, error, success }: { pending?: boolean; error?: string | null; success?: string | null }) {
  if (pending) {
    return (
      <div className="inline-status" role="status">
        <ScanLine size={16} className="spin" />
        <span>Working...</span>
      </div>
    );
  }
  if (error) {
    return (
      <div className="inline-status inline-status--error" role="alert">
        <AlertCircle size={16} />
        <span>{error}</span>
      </div>
    );
  }
  if (success) {
    return (
      <div className="inline-status inline-status--success" role="status">
        <Check size={16} />
        <span>{success}</span>
      </div>
    );
  }
  return null;
}

function toastIcon(kind: ToastKind) {
  if (kind === "success") return <Check size={17} />;
  if (kind === "error") return <AlertCircle size={17} />;
  if (kind === "warning") return <Info size={17} />;
  return <Sparkles size={17} />;
}

function ToastStack({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: string) => void }) {
  return (
    <div className="toast-stack" aria-live="polite" aria-relevant="additions removals">
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <ToastNotice key={toast.id} toast={toast} onDismiss={onDismiss} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function ToastNotice({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: string) => void }) {
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const timer = window.setTimeout(() => onDismiss(toast.id), toast.durationMs);
    return () => window.clearTimeout(timer);
  }, [onDismiss, paused, toast.durationMs, toast.id]);

  return (
    <motion.div
      className={`toast-notice toast-notice--${toast.kind}${paused ? " toast-notice--paused" : ""}`}
      initial={{ opacity: 0, y: -14, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -12, scale: 0.98 }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      role={toast.kind === "error" ? "alert" : "status"}
      style={{ "--toast-duration": `${toast.durationMs}ms` } as React.CSSProperties}
    >
      <div className="toast-notice__icon">{toastIcon(toast.kind)}</div>
      <div className="toast-notice__body">
        <strong>{toast.kind === "success" ? "Done" : toast.kind === "error" ? "Needs attention" : toast.kind === "warning" ? "Check this" : "Update"}</strong>
        <span>{toast.message}</span>
      </div>
      <button className="icon-button" type="button" aria-label="Dismiss notification" onClick={() => onDismiss(toast.id)}>
        <X size={15} />
      </button>
      <span className="toast-notice__progress" />
    </motion.div>
  );
}

const stageProgressRanges: Record<ProcessingStage, [number, number]> = {
  uploading: [0, 10],
  extracting: [10, 22],
  "building page inventory": [22, 38],
  "identifying questions": [38, 52],
  "extracting question details": [52, 78],
  "aligning mark scheme": [78, 90],
  finalising: [90, 100],
  "marking answers": [8, 96],
  "remarking question": [8, 96],
};

function processingStatusMessages(paper: PastPaper, job: PastPaperProcessingJob | null, diagnostics: ProcessingDiagnostics | null, visualPercent: number) {
  const stage = job?.currentStage ?? diagnostics?.currentStage ?? "uploading";
  const pageCount = Math.max(1, diagnostics?.paperPageCount ?? paper.assets.find((asset) => asset.kind === "paper")?.pageCount ?? 1);
  const currentPage = Math.max(1, Math.min(pageCount, Math.ceil((visualPercent / 100) * pageCount)));
  const latestPrompt = diagnostics?.promptStats.at(-1);
  const latestRequest = latestAIRequest(diagnostics);
  const questionCount = paper.questions.length || latestPrompt?.pageNumbers?.length || pageCount;
  const currentQuestion = Math.max(1, Math.min(questionCount, Math.ceil((visualPercent / 100) * questionCount)));

  const byStage: Record<ProcessingStage, string[]> = {
    uploading: ["Preparing files for extraction", "Checking document metadata"],
    extracting: [`Reading page ${currentPage} of ${pageCount}`, "Separating paper text from mark scheme text"],
    "building page inventory": [`Scanning page ${currentPage} of ${pageCount}`, "Building a compact page inventory", "Checking figures, tables, and source pages"],
    "identifying questions": [`Finding question boundaries on page ${currentPage}`, "Looking for subquestions and mark allocations", "Mapping question ranges to source pages"],
    "extracting question details": [`Reading question ${currentQuestion}`, latestPrompt?.pageNumbers?.length ? `Extracting pages ${latestPrompt.pageNumbers.join(", ")}` : "Extracting question wording", "Checking options, marks, and source figures"],
    "aligning mark scheme": ["Reading mark scheme rows", "Matching answers to question numbers", "Checking accept and do-not-accept guidance"],
    finalising: ["Running source-grounding checks", "Checking extracted marks against paper metadata", "Preparing the paper dashboard"],
    "marking answers": [`Marking answered question ${currentQuestion}`, "Applying aligned mark scheme rows"],
    "remarking question": ["Rechecking the selected answer", "Comparing against the stored mark scheme row"],
  };

  return [
    ...(byStage[stage] ?? ["Working through the paper"]),
    latestRequest?.status === "running" ? `Waiting for ${latestRequest.label}` : null,
    latestRequest?.status === "success" ? `Completed ${latestRequest.label}` : null,
  ].filter((message): message is string => Boolean(message));
}

function ProcessingPanel({ paper, job, variant = "full" }: { paper: PastPaper; job: PastPaperProcessingJob | null; variant?: "full" | "compact" }) {
  const activeIndex = processingStages.findIndex((stage) => job?.currentStage === stage);
  const percent = job?.progressPercent ?? (paper.processingStatus === "ready" ? 100 : 0);
  const diagnostics = job?.diagnostics ?? paper.processingDiagnostics ?? null;
  const latestRequest = latestAIRequest(diagnostics);
  const errorMessage = job?.errorMessage ?? paper.processingError ?? null;
  const paperTextChars = paper.assets.find((asset) => asset.kind === "paper") ? textLengthForAsset(paper.assets.find((asset) => asset.kind === "paper")!) : 0;
  const [visualPercent, setVisualPercent] = useState(percent);
  const [messageIndex, setMessageIndex] = useState(0);
  const stage = job?.currentStage ?? diagnostics?.currentStage ?? "uploading";
  const stageRange = useMemo(() => stageProgressRanges[stage] ?? ([percent, Math.min(99, percent + 8)] as [number, number]), [percent, stage]);
  const isRunning = job?.status === "running" || paper.processingStatus === "processing";
  const messages = useMemo(() => processingStatusMessages(paper, job, diagnostics, visualPercent), [paper, job, diagnostics, visualPercent]);
  const activeMessage = messages[messageIndex % Math.max(messages.length, 1)] ?? "Working through the paper";
  const compact = variant === "compact";

  useEffect(() => {
    setVisualPercent((value) => Math.max(value, percent));
  }, [percent]);

  useEffect(() => {
    if (!isRunning) {
      setVisualPercent(percent);
      return;
    }
    const timer = window.setInterval(() => {
      setVisualPercent((value) => {
        const floor = Math.max(value, percent, stageRange[0]);
        const cap = Math.max(stageRange[0], stageRange[1] - 0.8);
        if (floor >= cap) return floor;
        return Math.min(cap, floor + 0.35);
      });
    }, 240);
    return () => window.clearInterval(timer);
  }, [isRunning, percent, stageRange]);

  useEffect(() => {
    const timer = window.setInterval(() => setMessageIndex((value) => value + 1), 1450);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className={`paper-processing-panel paper-processing-panel--${variant}`}>
      <div className="paper-processing-panel__body">
        <div className="loading-stage__header">
          <div>
            <span className="eyebrow">Processing</span>
            <strong>{paper.title}</strong>
          </div>
          <motion.div className="processing-live-status" role="status" aria-live="polite" layout transition={{ layout: { duration: 0.24, ease: "easeOut" } }}>
            <Loader2 size={18} className="processing-spinner" />
            <AnimatePresence mode="wait">
              <motion.span key={activeMessage} layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.24, ease: "easeOut" }}>
                {activeMessage}
              </motion.span>
            </AnimatePresence>
          </motion.div>
        </div>
        <div className="loading-stage__bar">
          <motion.span animate={{ width: `${Math.max(percent, visualPercent)}%` }} transition={{ duration: 0.45, ease: "easeOut" }} />
        </div>
        {compact ? (
          <div className="processing-compact-meta">
            <span>{stage}</span>
            <span>{Math.round(Math.max(percent, visualPercent))}%</span>
            {diagnostics ? <span>{diagnostics.paperPageCount} pages</span> : null}
          </div>
        ) : (
          <div className="loading-stage__steps">
            {processingStages.map((stage, index) => (
              <div key={stage} className={index <= Math.max(activeIndex, 0) ? "loading-step loading-step--active" : "loading-step"}>
                <span>{index + 1}</span>
                <small>{stage}</small>
              </div>
            ))}
          </div>
        )}
        {diagnostics && !compact ? (
          <div className="diagnostic-grid">
            <span>Pages {diagnostics.paperPageCount}</span>
            <span>Text {paperTextChars.toLocaleString()} chars</span>
            <span>Screenshots {diagnostics.screenshotStats.filter((item) => item.assetKind === "paper").length}</span>
            <span>Prompt {diagnostics.promptStats.at(-1)?.charCount.toLocaleString() ?? 0} chars</span>
            <span>Model {latestRequest?.model ?? DEFAULT_AI_MODEL}</span>
            <span>Last {diagnostics.lastSuccessfulStage ?? "none"}</span>
          </div>
        ) : null}
        {diagnostics && !compact ? (
          <details className="diagnostics-details">
            <summary>Diagnostics details</summary>
            <div className="diagnostics-details__grid">
              <span>Stage timings: {diagnostics.stageTimings.map((timing) => `${timing.stage} ${timing.elapsedMs ?? 0}ms`).join(" / ") || "none"}</span>
              <span>Page text: {diagnostics.pageTextStats.map((page) => `${page.assetKind} p${page.pageNumber} ${page.charCount}`).join(" / ") || "none"}</span>
              <span>
                Screenshots:{" "}
                {diagnostics.screenshotStats.map((shot) => `${shot.assetKind} p${shot.pageNumber} ${shot.width}x${shot.height} ${shot.byteSize}b`).join(" / ") || "none"}
              </span>
              <span>Requests: {diagnostics.aiRequests.map((request) => `${request.label} ${request.status} ${request.startedAt} ${request.endedAt ?? ""}`).join(" / ") || "none"}</span>
              <span>Schema paths: {diagnostics.schemaErrors.flatMap((item) => item.paths).join(", ") || "none"}</span>
              <span>Integrity: {diagnostics.integrityFailures?.join(" / ") || "none"}</span>
            </div>
          </details>
        ) : null}
        {job?.status === "failed" || paper.processingStatus === "failed" ? (
          <div className="processing-error">
            {(errorMessage ?? "Processing failed").split("\n").map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        ) : null}
        {!compact ? (
          <div className="button-row">
            <button className="secondary-button" onClick={() => downloadDiagnosticBundle(paper)} disabled={!diagnostics && !paper.assets.some((asset) => asset.extractionDiagnostics)}>
              <Download size={16} /> Export diagnostics
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function UploadModal({
  open,
  pending,
  initialSubject,
  onClose,
  onSubmit,
}: {
  open: boolean;
  pending: boolean;
  initialSubject?: string;
  onClose: () => void;
  onSubmit: (draft: PaperDraftInput, paperFile: File, markSchemeFile: File | null, processNow: boolean) => void;
}) {
  const [draft, setDraft] = useState(emptyDraft);
  const [paperFile, setPaperFile] = useState<File | null>(null);
  const [markSchemeFile, setMarkSchemeFile] = useState<File | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft({ ...emptyDraft, subject: initialSubject && isSupportedSubject(initialSubject) ? initialSubject : emptyDraft.subject });
    setPaperFile(null);
    setMarkSchemeFile(null);
  }, [initialSubject, open]);

  const submit = (processNow: boolean) => {
    if (!paperFile) return;
    onClose();
    onSubmit(draft, paperFile, markSchemeFile, processNow);
  };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div className="paper-modal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="paper-modal__panel" initial={{ y: 18, scale: 0.98 }} animate={{ y: 0, scale: 1 }} exit={{ y: 18, scale: 0.98 }}>
            <div className="section-frame__header">
              <div>
                <span className="eyebrow">Upload</span>
                <h2>New past paper</h2>
              </div>
              <button className="icon-button" onClick={onClose} aria-label="Close upload">
                <X size={16} />
              </button>
            </div>

            <div className="form-grid form-grid--two">
              <label className="field">
                <span>Title</span>
                <input value={draft.title} onChange={(event) => setDraft((state) => ({ ...state, title: event.target.value }))} placeholder="OCR J277 Paper 1" />
              </label>
              <label className="field">
                <span>Subject</span>
                <select value={draft.subject} onChange={(event) => setDraft((state) => ({ ...state, subject: event.target.value }))}>
                  {supportedSubjects.map((subject) => (
                    <option key={subject}>{subject}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Topic</span>
                <input value={draft.topic} onChange={(event) => setDraft((state) => ({ ...state, topic: event.target.value }))} placeholder="Optional" />
              </label>
              <label className="field">
                <span>Subtopic</span>
                <input value={draft.subtopic} onChange={(event) => setDraft((state) => ({ ...state, subtopic: event.target.value }))} placeholder="Optional" />
              </label>
              <label className="field">
                <span>Year</span>
                <input value={draft.year} onChange={(event) => setDraft((state) => ({ ...state, year: event.target.value }))} inputMode="numeric" placeholder="Optional" />
              </label>
              <label className="field">
                <span>Series</span>
                <input value={draft.series} onChange={(event) => setDraft((state) => ({ ...state, series: event.target.value }))} placeholder="June" />
              </label>
              <label className="field">
                <span>Paper code</span>
                <input value={draft.paperCode} onChange={(event) => setDraft((state) => ({ ...state, paperCode: event.target.value }))} />
              </label>
              <label className="field">
                <span>Question paper</span>
                <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={(event) => setPaperFile(event.target.files?.[0] ?? null)} />
              </label>
              <label className="field">
                <span>Mark scheme</span>
                <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={(event) => setMarkSchemeFile(event.target.files?.[0] ?? null)} />
              </label>
            </div>

            <div className="button-row">
              <button className="secondary-button" onClick={() => submit(false)} disabled={!paperFile || pending}>
                <Save size={16} /> Save only
              </button>
              <button className="primary-button" onClick={() => submit(true)} disabled={!paperFile || pending}>
                <ScanLine size={16} /> Process now
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function MetadataModal({
  open,
  draft,
  onChange,
  onClose,
  onSave,
}: {
  open: boolean;
  draft: PaperDraftInput;
  onChange: (draft: PaperDraftInput) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <AnimatePresence>
      {open ? (
        <motion.div className="paper-modal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="paper-modal__panel" initial={{ y: 18, scale: 0.98 }} animate={{ y: 0, scale: 1 }} exit={{ y: 18, scale: 0.98 }}>
            <div className="section-frame__header">
              <div>
                <span className="eyebrow">Paper settings</span>
                <h2>Edit metadata</h2>
              </div>
              <button className="icon-button" onClick={onClose} aria-label="Close metadata editor">
                <X size={16} />
              </button>
            </div>

            <div className="form-grid form-grid--two">
              <label className="field">
                <span>Title</span>
                <input value={draft.title} onChange={(event) => onChange({ ...draft, title: event.target.value })} />
              </label>
              <label className="field">
                <span>Subject</span>
                <select value={draft.subject} onChange={(event) => onChange({ ...draft, subject: event.target.value })}>
                  {supportedSubjects.map((subject) => (
                    <option key={subject}>{subject}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Topic</span>
                <input value={draft.topic} onChange={(event) => onChange({ ...draft, topic: event.target.value })} />
              </label>
              <label className="field">
                <span>Subtopic</span>
                <input value={draft.subtopic} onChange={(event) => onChange({ ...draft, subtopic: event.target.value })} />
              </label>
              <label className="field">
                <span>Year</span>
                <input value={draft.year} onChange={(event) => onChange({ ...draft, year: event.target.value })} inputMode="numeric" />
              </label>
              <label className="field">
                <span>Series</span>
                <input value={draft.series} onChange={(event) => onChange({ ...draft, series: event.target.value })} />
              </label>
              <label className="field">
                <span>Paper code</span>
                <input value={draft.paperCode} onChange={(event) => onChange({ ...draft, paperCode: event.target.value })} />
              </label>
            </div>

            <div className="button-row">
              <button className="secondary-button" onClick={onClose}>
                <X size={16} /> Cancel
              </button>
              <button className="primary-button" onClick={onSave}>
                <Save size={16} /> Save metadata
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function FeedbackModal({
  open,
  draft,
  attachments,
  errors,
  pending,
  submitEnabled,
  serverError,
  onChange,
  onBlur,
  onAddFiles,
  onRemoveAttachment,
  onClose,
  onSubmit,
}: {
  open: boolean;
  draft: FeedbackDraft;
  attachments: FeedbackAttachment[];
  errors: FeedbackValidationErrors;
  pending: boolean;
  submitEnabled: boolean;
  serverError: string | null;
  onChange: (patch: Partial<FeedbackDraft>) => void;
  onBlur: (field: keyof FeedbackDraft) => void;
  onAddFiles: (files: FileList | null) => void;
  onRemoveAttachment: (attachmentId: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <AnimatePresence>
      {open ? (
        <motion.div className="paper-modal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="paper-modal__panel feedback-modal__panel" initial={{ y: 18, scale: 0.98 }} animate={{ y: 0, scale: 1 }} exit={{ y: 18, scale: 0.98 }}>
            <div className="section-frame__header">
              <div>
                <span className="eyebrow">Feedback</span>
                <h2>Send feedback</h2>
                <p>Share bugs, tweaks, and ideas without leaving the app.</p>
              </div>
              <button className="icon-button" onClick={onClose} aria-label="Close feedback form">
                <X size={16} />
              </button>
            </div>

            <div className="form-grid form-grid--two feedback-form-grid">
              <label className={errors.type ? "field field--invalid" : "field"}>
                <span>Feedback type</span>
                <select aria-label="Feedback type" value={draft.type} onChange={(event) => onChange({ type: event.target.value as FeedbackDraft["type"] })} onBlur={() => onBlur("type")}>
                  {FEEDBACK_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {errors.type ? <small className="field__error">{errors.type}</small> : null}
              </label>

              <label className={errors.email ? "field field--invalid" : "field"}>
                <span>Email</span>
                <input
                  type="email"
                  aria-label="Email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={draft.email}
                  onChange={(event) => onChange({ email: event.target.value })}
                  onBlur={() => onBlur("email")}
                />
                {errors.email ? <small className="field__error">{errors.email}</small> : null}
              </label>

              <label className={errors.title ? "field field--invalid feedback-form-grid__full" : "field feedback-form-grid__full"}>
                <span>Title</span>
                <input aria-label="Title" value={draft.title} onChange={(event) => onChange({ title: event.target.value })} onBlur={() => onBlur("title")} maxLength={120} />
                {errors.title ? <small className="field__error">{errors.title}</small> : null}
              </label>

              <label className={errors.description ? "field field--invalid feedback-form-grid__full" : "field feedback-form-grid__full"}>
                <span>Description</span>
                <textarea aria-label="Description" value={draft.description} onChange={(event) => onChange({ description: event.target.value })} onBlur={() => onBlur("description")} maxLength={4000} />
                {errors.description ? <small className="field__error">{errors.description}</small> : null}
              </label>

              {draft.type === "bug_report" ? (
                <div className={errors.attachments ? "field field--invalid feedback-form-grid__full" : "field feedback-form-grid__full"}>
                  <span>Attach paper files, if relevant</span>
                  <p className="muted-copy feedback-attachments__hint">
                    Optional. PDF, PNG, JPG, JSON diagnostics, TXT, or LOG files. Up to 3 files, 8MB each, 25MB total before upload.
                  </p>
                  <input
                    aria-label="Bug report attachments"
                    className="feedback-file-input"
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg,.json,.txt,.log,application/pdf,image/png,image/jpeg,application/json,text/plain"
                    multiple
                    onChange={(event) => {
                      onAddFiles(event.target.files);
                      event.currentTarget.value = "";
                    }}
                  />
                  {attachments.length ? (
                    <div className="feedback-attachment-list">
                      {attachments.map((attachment) => (
                        <div key={attachment.id} className="feedback-attachment-row">
                          <div>
                            <strong>{attachment.filename}</strong>
                            <span>
                              {attachment.contentType} / {formatFileSize(attachment.sizeBytes)}
                            </span>
                          </div>
                          <button className="icon-button" type="button" aria-label={`Remove ${attachment.filename}`} onClick={() => onRemoveAttachment(attachment.id)}>
                            <Trash2 size={16} />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {errors.attachments ? <small className="field__error">{errors.attachments}</small> : null}
                </div>
              ) : null}

              <label className="feedback-honeypot" aria-hidden="true" tabIndex={-1}>
                <span>Leave blank</span>
                <input aria-label="Leave blank" value={draft.website} onChange={(event) => onChange({ website: event.target.value })} onBlur={() => onBlur("website")} autoComplete="off" />
              </label>
            </div>

            {serverError ? (
              <div className="processing-error">
                <p>{serverError}</p>
              </div>
            ) : null}

            <div className="button-row">
              <button className="secondary-button" onClick={onClose} disabled={pending}>
                <X size={16} /> Cancel
              </button>
              <button className="primary-button" onClick={onSubmit} disabled={!submitEnabled}>
                {pending ? <Loader2 size={16} className="processing-spinner" /> : <MessageSquare size={16} />}
                {pending ? "Sending..." : "Send feedback"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function DashboardStatusPanels({
  aiModel,
  setAIModel,
  smokeTest,
  analytics,
  onClearLocalData,
  preferences,
}: {
  aiModel: string;
  setAIModel: (value: string) => void;
  smokeTest: AISmokeTestResult | null;
  analytics: { completed: number; averagePercent: number | null; overtime: number; ready: boolean };
  onClearLocalData: () => void;
  preferences: AppPreferences;
}) {
  return (
    <>
      <div className="inspector-panel glass-chrome">
        <span className="eyebrow">System</span>
        <div className="metric-row">
          <span>AI provider</span>
          <strong>Gemini</strong>
        </div>
        {preferences.showTechnicalModel ? (
          <>
            <div className="metric-row">
              <span>Model</span>
              <strong>{aiModel}</strong>
            </div>
            <label className="field compact-field">
              <span>Model switch</span>
              <select aria-label="Model switch" value={aiModel} onChange={(event) => setAIModel(event.target.value)}>
                {AI_MODEL_CHOICES.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : null}
        <div className="metric-row">
          <span>API key</span>
          <strong>Server-side only</strong>
        </div>
        <div className="metric-row">
          <span>Data</span>
          <strong>Local only</strong>
        </div>
        <div className="metric-row">
          <span>Version</span>
          <strong>{appMeta.version}</strong>
        </div>
        <p className="muted-copy">This device stores papers and attempts locally. AI calls go through the secure Worker proxy, so API keys stay server-side.</p>
        {smokeTest ? (
          <div className="smoke-summary">
            <span className="eyebrow">Last smoke test</span>
            <div className="metric-row">
              <span>Proxy</span>
              <strong>{smokeTest.proxyCheck.success ? "ok" : "failed"}</strong>
            </div>
            <div className="metric-row">
              <span>Text call</span>
              <strong>{smokeTest.textCall.success ? "ok" : "failed"}</strong>
            </div>
            <div className="metric-row">
              <span>Extraction</span>
              <strong>{smokeTest.extractionCall.success ? "ok" : "failed"}</strong>
            </div>
            <div className="metric-row">
              <span>Marking</span>
              <strong>{smokeTest.markingCall.success ? "ok" : "failed"}</strong>
            </div>
            <div className="metric-row">
              <span>Diagnostics redaction</span>
              <strong>{smokeTest.diagnosticsRedactionCheck.redacted === null ? "unknown" : smokeTest.diagnosticsRedactionCheck.redacted ? "ok" : "failed"}</strong>
            </div>
          </div>
        ) : null}
      </div>
      {preferences.showAnalyticsPanel ? (
      <div className="inspector-panel glass-chrome">
        <span className="eyebrow">Analytics</span>
        {analytics.ready ? (
          <div className="chart-frame">
            <BarChart3 size={18} />
            <div className="metric-row">
              <span>Marked attempts</span>
              <strong>{analytics.completed}</strong>
            </div>
            <div className="metric-row">
              <span>Average</span>
              <strong>{analytics.averagePercent?.toFixed(1)}%</strong>
            </div>
            <p>Scores use the adjusted total after unsupported questions are removed.</p>
          </div>
        ) : (
          <div className="analytics-placeholder">
            <BarChart3 size={20} />
            <strong>Analytics is being worked on</strong>
            <p>More useful trends will appear here once there are enough marked attempts to compare.</p>
          </div>
        )}
        <button className="secondary-button danger-button primary-button--wide" onClick={onClearLocalData}>
          Clear local data
        </button>
      </div>
      ) : null}
    </>
  );
}

function DashboardStatusModal({
  open,
  aiModel,
  setAIModel,
  smokeTest,
  analytics,
  onClearLocalData,
  preferences,
  onClose,
}: {
  open: boolean;
  aiModel: string;
  setAIModel: (value: string) => void;
  smokeTest: AISmokeTestResult | null;
  analytics: { completed: number; averagePercent: number | null; overtime: number; ready: boolean };
  onClearLocalData: () => void;
  preferences: AppPreferences;
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      {open ? (
        <motion.div className="paper-modal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="paper-modal__panel paper-modal__panel--mini status-modal__panel" initial={{ y: 18, scale: 0.98 }} animate={{ y: 0, scale: 1 }} exit={{ y: 18, scale: 0.98 }}>
            <div className="section-frame__header">
              <div>
                <span className="eyebrow">Status</span>
                <h2>System info</h2>
                <p>Model, proxy, and analytics details for this device.</p>
              </div>
              <button className="icon-button" onClick={onClose} aria-label="Close system info">
                <X size={16} />
              </button>
            </div>
            <div className="status-modal__content">
              <DashboardStatusPanels aiModel={aiModel} setAIModel={setAIModel} smokeTest={smokeTest} analytics={analytics} onClearLocalData={onClearLocalData} preferences={preferences} />
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function PreferenceSelect<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <label className="field compact-field">
      <span>{label}</span>
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value as T)}>
        {options.map((option) => (
          <option value={option.value} key={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function PreferenceToggle({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="preference-toggle">
      <input type="checkbox" aria-label={label} checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="preference-toggle__control" />
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
    </label>
  );
}

function SettingsModal({
  open,
  preferences,
  selectedSubjects,
  data,
  aiModel,
  setAIModel,
  smokeTest,
  smokeBusy,
  onChange,
  onReset,
  onEditSubjects,
  onOpenFeedback,
  onOpenVersion,
  onOpenCredits,
  onRunSmokeTest,
  onExportData,
  onImportData,
  onClearLocalData,
  onClose,
}: {
  open: boolean;
  preferences: AppPreferences;
  selectedSubjects: SelectableSubject[];
  data: AppData;
  aiModel: string;
  setAIModel: (value: string) => void;
  smokeTest: AISmokeTestResult | null;
  smokeBusy: boolean;
  onChange: (patch: Partial<AppPreferences>) => void;
  onReset: () => void;
  onEditSubjects: () => void;
  onOpenFeedback: (type?: FeedbackDraft["type"]) => void;
  onOpenVersion: () => void;
  onOpenCredits: () => void;
  onRunSmokeTest: () => void;
  onExportData: () => void;
  onImportData: (file: File | null) => void;
  onClearLocalData: () => void;
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      {open ? (
        <motion.div className="paper-modal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="paper-modal__panel settings-modal__panel" initial={{ y: 18, scale: 0.98 }} animate={{ y: 0, scale: 1 }} exit={{ y: 18, scale: 0.98 }}>
            <div className="section-frame__header settings-modal__header">
              <div>
                <span className="eyebrow">Settings</span>
                <h2>Workspace settings</h2>
                <p>Subjects, practice defaults, storage, feedback, version, credits, and Dev mode.</p>
              </div>
              <button className="icon-button" onClick={onClose} aria-label="Close settings">
                <X size={16} />
              </button>
            </div>

            <div className="settings-modal__grid">
              <section className="settings-section">
                <div>
                  <span className="eyebrow">Subjects</span>
                  <h3>Your subjects</h3>
                </div>
                <div className="subject-chip-grid subject-chip-grid--settings">
                  {selectedSubjects.map((subject) => {
                    const meta = subjectMetaForLabel(subject);
                    if (!meta) return null;
                    return meta.supported ? (
                      <a className="subject-preview-chip" key={subject} href={meta.specUrl} target="_blank" rel="noreferrer" style={{ "--subject-accent": meta.accent } as React.CSSProperties}>
                        <meta.Icon size={16} />
                        {meta.shortLabel}
                        <ExternalLink size={13} />
                      </a>
                    ) : (
                      <span className="subject-preview-chip" key={subject} style={{ "--subject-accent": meta.accent } as React.CSSProperties}>
                        <meta.Icon size={16} />
                        {meta.shortLabel}
                        <small>Not supported yet</small>
                      </span>
                    );
                  })}
                </div>
                <div className="button-row">
                  <button className="secondary-button" onClick={onEditSubjects}>
                    <Plus size={16} /> Add subject
                  </button>
                </div>
              </section>

              <section className="settings-section">
                <div>
                  <span className="eyebrow">Appearance</span>
                  <h3>Theme and layout</h3>
                </div>
                <div className="preference-grid">
                  <PreferenceSelect
                    label="Theme"
                    value={preferences.themeMode === "system" ? "system" : "dark"}
                    options={[
                      { value: "dark", label: "Dark" },
                      { value: "system", label: "System" },
                    ]}
                    onChange={(themeMode) => onChange({ themeMode })}
                  />
                  <PreferenceSelect label="Accent scheme" value={preferences.accentColour} options={accentOptions} onChange={(accentColour) => onChange({ accentColour })} />
                  <PreferenceSelect
                    label="Sidebar default"
                    value={preferences.sidebarDefault}
                    options={[
                      { value: "expanded", label: "Expanded" },
                      { value: "collapsed", label: "Collapsed" },
                    ]}
                    onChange={(sidebarDefault) => onChange({ sidebarDefault })}
                  />
                  <PreferenceSelect
                    label="Reduced motion"
                    value={preferences.reduceMotion}
                    options={[
                      { value: "system", label: "Follow system" },
                      { value: "reduce", label: "Always reduce" },
                    ]}
                    onChange={(reduceMotion) => onChange({ reduceMotion })}
                  />
                </div>
                <div className="colour-picker-panel">
                  <div>
                    <strong>Custom gradient</strong>
                    <p>Choose "Custom" above, then pick both ends of the app accent gradient.</p>
                  </div>
                  <label>
                    <span>Start</span>
                    <input type="color" aria-label="Custom accent start" value={preferences.customAccent} onChange={(event) => onChange({ accentColour: "custom", customAccent: event.target.value })} />
                  </label>
                  <label>
                    <span>End</span>
                    <input type="color" aria-label="Custom accent end" value={preferences.customAccent2} onChange={(event) => onChange({ accentColour: "custom", customAccent2: event.target.value })} />
                  </label>
                  <div className="colour-picker-panel__preview" style={{ background: `linear-gradient(135deg, ${preferences.customAccent}, ${preferences.customAccent2})` }} />
                </div>
              </section>

              <section className="settings-section">
                <div>
                  <span className="eyebrow">Practice</span>
                  <h3>Answering defaults</h3>
                </div>
                <div className="preference-grid">
                  <PreferenceSelect
                    label="Focus mode default"
                    value={preferences.focusModeDefault ? "show" : "hide"}
                    options={[
                      { value: "show", label: "On" },
                      { value: "hide", label: "Off" },
                    ]}
                    onChange={(value) => onChange({ focusModeDefault: value === "show" })}
                  />
                  <PreferenceSelect
                    label="Timer behaviour"
                    value={preferences.timerBehaviour}
                    options={[
                      { value: "count_down", label: "Count down" },
                      { value: "count_up", label: "Count up" },
                    ]}
                    onChange={(timerBehaviour) => onChange({ timerBehaviour })}
                  />
                  <PreferenceSelect
                    label="Source figures"
                    value={preferences.sourceFigures}
                    options={[
                      { value: "show", label: "Show by default" },
                      { value: "collapse", label: "Collapse by default" },
                    ]}
                    onChange={(sourceFigures) => onChange({ sourceFigures })}
                  />
                  <PreferenceSelect
                    label="Question navigation"
                    value={preferences.questionNavigation}
                    options={[
                      { value: "grid", label: "Grid" },
                      { value: "list", label: "Compact list" },
                    ]}
                    onChange={(questionNavigation) => onChange({ questionNavigation })}
                  />
                </div>
                <div className="preference-toggle-grid">
                  <PreferenceToggle label="Auto-save answers" description="Keep answer edits saved in the current attempt." checked={preferences.autoSaveAnswers} onChange={(autoSaveAnswers) => onChange({ autoSaveAnswers })} />
                  <PreferenceToggle label="Focus progress card" description="Show answered/skipped counts and question dots while answering." checked={preferences.showFocusProgress} onChange={(showFocusProgress) => onChange({ showFocusProgress })} />
                  <PreferenceToggle label="Skip with confidence panel" description="Show the confidence skip shortcut below supported questions." checked={preferences.showConfidenceSkip} onChange={(showConfidenceSkip) => onChange({ showConfidenceSkip })} />
                </div>
              </section>

              <section className="settings-section">
                <div>
                  <span className="eyebrow">Storage</span>
                  <h3>Local-only data</h3>
                  <p>{data.papers.length} paper{data.papers.length === 1 ? "" : "s"} and {data.attempts.length} attempt{data.attempts.length === 1 ? "" : "s"} stored on this device.</p>
                </div>
                <div className="button-row">
                  <button className="secondary-button" onClick={onExportData}>
                    <Download size={16} /> Export all data
                  </button>
                  <label className="secondary-button import-backup-button">
                    <UploadCloud size={16} /> Import backup
                    <input type="file" accept="application/json,.json" onChange={(event) => onImportData(event.target.files?.[0] ?? null)} />
                  </label>
                  <button className="secondary-button danger-button" onClick={onClearLocalData}>
                    <Trash2 size={16} /> Clear local data
                  </button>
                </div>
              </section>

              <section className="settings-section">
                <div>
                  <span className="eyebrow">Feedback</span>
                  <h3>Report or suggest</h3>
                  <p>Diagnostics unavailable.</p>
                </div>
                <div className="button-row">
                  <button className="secondary-button" onClick={() => onOpenFeedback("bug_report")}>
                    <MessageSquare size={16} /> Report a bug
                  </button>
                  <button className="secondary-button" onClick={() => onOpenFeedback("feature_request")}>
                    <Sparkles size={16} /> Suggest a feature
                  </button>
                </div>
              </section>

              <section className="settings-section">
                <div>
                  <span className="eyebrow">Version</span>
                  <h3>{appMeta.version} · {currentVersionEntry.title}</h3>
                  <p>{currentVersionEntry.date}</p>
                </div>
                <button className="secondary-button" onClick={onOpenVersion}>
                  <Sparkles size={16} /> Open changelog
                </button>
              </section>

              <section className="settings-section">
                <div>
                  <span className="eyebrow">Credits</span>
                  <h3>People and providers</h3>
                  <p>Developed by Rayaan Omair. Logo credit: Elliot Neilsen.</p>
                </div>
                <button className="secondary-button" onClick={onOpenCredits}>
                  <Info size={16} /> Open credits
                </button>
              </section>

              <section className="settings-section settings-section--dev">
                <div>
                  <span className="eyebrow">Dev mode</span>
                  <h3>Debug tools</h3>
                </div>
                <PreferenceToggle label="Enable Dev mode" description="Show provider checks, model switch, commit hash, and raw diagnostics." checked={preferences.devModeEnabled} onChange={(devModeEnabled) => onChange({ devModeEnabled })} />
                {preferences.devModeEnabled ? (
                  <div className="dev-mode-panel">
                    <div className="preference-grid">
                      <label className="field compact-field">
                        <span>Model switch</span>
                        <select aria-label="Model switch" value={aiModel} onChange={(event) => setAIModel(event.target.value)}>
                          {AI_MODEL_CHOICES.map((model) => (
                            <option key={model} value={model}>{model}</option>
                          ))}
                        </select>
                      </label>
                      <div className="diagnostic-grid">
                        <span>Provider Gemini</span>
                        <span>API keys server-side</span>
                        <span>Commit {appMeta.commitHash ?? "unavailable"}</span>
                        <span>{data.papers.length} local papers</span>
                      </div>
                    </div>
                    <div className="button-row">
                      <button className="secondary-button" onClick={onRunSmokeTest} disabled={smokeBusy}>
                        <FlaskConical size={16} /> Smoke test
                      </button>
                      <button className="secondary-button" onClick={onExportData}>
                        <Download size={16} /> Diagnostics export
                      </button>
                    </div>
                    {smokeTest ? <p className="muted-copy">Last smoke test: proxy {smokeTest.proxyCheck.success ? "ok" : "failed"}, text {smokeTest.textCall.success ? "ok" : "failed"}.</p> : null}
                  </div>
                ) : null}
              </section>
            </div>

            <div className="button-row">
              <button className="secondary-button" onClick={onReset}>
                <RotateCcw size={16} /> Reset defaults
              </button>
              <button className="primary-button" onClick={onClose}>
                <Check size={16} /> Done
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function ConfidenceSkipModal({
  open,
  question,
  value,
  onChange,
  onClose,
  onConfirm,
}: {
  open: boolean;
  question: PastPaperQuestion | null;
  value: number | "";
  onChange: (value: number | "") => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <AnimatePresence>
      {open && question ? (
        <motion.div className="paper-modal paper-modal--mini" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="paper-modal__panel paper-modal__panel--mini" initial={{ y: 18, scale: 0.98 }} animate={{ y: 0, scale: 1 }} exit={{ y: 18, scale: 0.98 }}>
            <div className="section-frame__header">
              <div>
                <span className="eyebrow">Skip with confidence</span>
                <h2>Predicted marks</h2>
                <p>This question is out of {marksLabel(question.maxMarks)}.</p>
              </div>
              <button className="icon-button" onClick={onClose} aria-label="Close confidence skip">
                <X size={16} />
              </button>
            </div>
            <label className="field">
              <span>Your predicted marks</span>
              <input
                autoFocus
                type="number"
                min={0}
                max={question.maxMarks}
                value={value}
                onChange={(event) => onChange(event.target.value === "" ? "" : Math.max(0, Math.min(question.maxMarks, Number(event.target.value))))}
              />
            </label>
            <div className="button-row">
              <button className="secondary-button" onClick={onClose}>
                <X size={16} /> Cancel
              </button>
              <button className="primary-button" onClick={onConfirm}>
                <SkipForward size={16} /> Skip question
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function QuestionSourceImages({ paper, question, defaultCollapsed = false }: { paper: PastPaper; question: PastPaperQuestion; defaultCollapsed?: boolean }) {
  const screenshots = questionSourceScreenshots(paper, question);
  const mediaRefs = relevantQuestionMediaRefs(question);
  if (!screenshots.length && !mediaRefs.length) return null;

  const content = (
    <>
      <div className="question-source-media__header">
        <span className="eyebrow">Source figures</span>
        {screenshots.length ? <span>{screenshots.map((shot) => `Page ${shot.pageNumber}`).join(", ")}</span> : null}
      </div>
      {screenshots.length ? (
        <div className="question-source-media__strip">
          {screenshots.map((shot) => (
            <figure key={`${shot.pageNumber}-${shot.width}-${shot.height}`} className="source-page-shot">
              <img src={shot.dataUrl} alt={`Source page ${shot.pageNumber} for question ${question.questionNumber}`} />
              <figcaption>Page {shot.pageNumber}</figcaption>
            </figure>
          ))}
        </div>
      ) : null}
      {mediaRefs.length ? (
        <div className="chip-wrap">
          {mediaRefs.map((ref) => (
            <span key={ref.id} className="static-chip">
              {ref.label}
              {ref.pageNumber ? `, page ${ref.pageNumber}` : ""}
            </span>
          ))}
        </div>
      ) : null}
    </>
  );

  return defaultCollapsed ? (
    <details className="question-source-media" aria-label="Source figures and page images">
      <summary>
        <span>Source figures</span>
        <small>{screenshots.length ? screenshots.map((shot) => `Page ${shot.pageNumber}`).join(", ") : `${mediaRefs.length} refs`}</small>
      </summary>
      {content}
    </details>
  ) : (
    <div className="question-source-media" aria-label="Source figures and page images">
      {content}
    </div>
  );
}

function basicCleanPrompt(promptText: string) {
  return cleanChoiceGlyphs(promptText)
    .replace(/\s*(?:[[(]\s*\d+\s*(?:marks?)?\s*[\])]|\[\s*\d+\s*])/gi, "")
    .replace(/^\s*(?:question\s*)?\d+\s*(?:[.)/-]\s*)?/i, "")
    .replace(/^\s*(?:\([a-z]\)|[a-z][.)])\s*/i, "")
    .replace(/^\s*(?:\([ivx]+\)|[ivx]+[.)])\s*/i, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([?.!,;:])/g, "$1")
    .trim();
}

function cleanVisiblePrompt(promptText: string) {
  const cleaned = basicCleanPrompt(promptText);
  const extracted = extractInlineOptions(cleaned);
  return extracted.options.length ? extracted.promptText : cleaned;
}

function AnswerInput({ question, answer, onChange }: { question: PastPaperQuestion; answer: PastPaperAnswer; onChange: (patch: Partial<PastPaperAnswer>) => void }) {
  if (answer.skipped) return null;

  if (question.responseType === "numeric") {
    return (
      <input
        aria-label="Numeric answer"
        placeholder="Numeric answer"
        value={answer.numericResponse ?? ""}
        onChange={(event) => onChange({ numericResponse: event.target.value === "" ? null : Number(event.target.value), skipped: false, skippedWithConfidence: false, confidencePredictedMarks: null })}
      />
    );
  }

  if (question.responseType === "single_choice" || question.responseType === "multi_select") {
    const extracted = extractInlineOptions(question.promptText);
    const options = (question.options.length ? question.options : extracted.options).map(cleanChoiceGlyphs).filter(Boolean);
    if (options.length < 2) {
      return <UnsupportedQuestionPanel issue={{ reason: "This choice question did not extract into a clean option list.", reported: false }} marks={question.maxMarks} />;
    }

    return (
      <div className="choice-list choice-list--compact">
        {options.map((option) => {
          const checked = answer.selectedOptions.includes(option);
          return (
            <label key={option} className="choice-row">
              <input
                type={question.responseType === "single_choice" ? "radio" : "checkbox"}
                name={`question-${question.id}`}
                checked={checked}
                onChange={() => {
                  const selectedOptions =
                    question.responseType === "single_choice"
                      ? [option]
                      : checked
                        ? answer.selectedOptions.filter((item) => item !== option)
                        : [...answer.selectedOptions, option];
                  onChange({ selectedOptions, skipped: false, skippedWithConfidence: false, confidencePredictedMarks: null });
                }}
              />
              <span>{option}</span>
            </label>
          );
        })}
      </div>
    );
  }

  return (
    <textarea
      aria-label="Written answer"
      placeholder={question.responseType === "short_text" ? "Short answer" : "Long-form answer"}
      value={answer.responseText ?? ""}
      onChange={(event) => onChange({ responseText: event.target.value, skipped: false, skippedWithConfidence: false, confidencePredictedMarks: null })}
    />
  );
}

export function App() {
  const [data, setData] = useState<AppData>(() => loadData());
  const [selectedPaperId, setSelectedPaperId] = useState<string | null>(null);
  const [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(null);
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(0);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [editingMetadata, setEditingMetadata] = useState(false);
  const [metadataDraft, setMetadataDraft] = useState<PaperDraftInput>(emptyDraft);
  const [suggestions, setSuggestions] = useState<string | null>(null);
  const [aiModel, setAIModel] = useState(DEFAULT_AI_MODEL);
  const [smokeTest, setSmokeTest] = useState<AISmokeTestResult | null>(null);
  const [smokeBusy, setSmokeBusy] = useState(false);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [fullscreenSupported, setFullscreenSupported] = useState(false);
  const cancelledProcessingJobs = useRef(new Set<string>());
  const [confidenceSkipOpen, setConfidenceSkipOpen] = useState(false);
  const [confidenceDraft, setConfidenceDraft] = useState<number | "">("");
  const [questionsExpanded, setQuestionsExpanded] = useState(false);
  const [markSchemeDetailsOpen, setMarkSchemeDetailsOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackDraft, setFeedbackDraft] = useState<FeedbackDraft>(() => emptyFeedbackDraft());
  const [feedbackAttachments, setFeedbackAttachments] = useState<FeedbackAttachment[]>([]);
  const [feedbackTouched, setFeedbackTouched] = useState<Partial<Record<keyof FeedbackDraft, boolean>>>({});
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [systemInfoOpen, setSystemInfoOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [creditsOpen, setCreditsOpen] = useState(false);
  const [preferences, setPreferences] = useState<AppPreferences>(() => loadPreferences());
  const [selectedSubjects, setSelectedSubjects] = useState<SelectableSubject[]>(() => loadSelectedSubjects(data));
  const [currentView, setCurrentView] = useState<AppView>("landing");
  const [onboardingComplete, setOnboardingComplete] = useState(() => readBooleanStorage(ONBOARDING_COMPLETE_STORAGE_KEY, data.papers.length > 0));
  const [activeSubject, setActiveSubject] = useState<SelectableSubject | null>(() => loadActiveSubject(loadSelectedSubjects(data)));
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => readBooleanStorage(SIDEBAR_COLLAPSED_STORAGE_KEY, defaultPreferences.sidebarDefault === "collapsed"));
  const [postOnboardingAction, setPostOnboardingAction] = useState<"upload" | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => saveData(data), [data]);
  useEffect(() => savePreferences(preferences), [preferences]);
  useEffect(() => saveSelectedSubjects(selectedSubjects), [selectedSubjects]);
  useEffect(() => writeBooleanStorage(ONBOARDING_COMPLETE_STORAGE_KEY, onboardingComplete), [onboardingComplete]);
  useEffect(() => writeBooleanStorage(SIDEBAR_COLLAPSED_STORAGE_KEY, sidebarCollapsed), [sidebarCollapsed]);
  useEffect(() => saveActiveSubject(activeSubject), [activeSubject]);

  const pushToast = useCallback(
    (kind: ToastKind, message: string) => {
      const trimmed = message.trim();
      if (!trimmed) return;
      setToasts((current) => [
        ...current.slice(-3),
        {
          id: createId("toast"),
          kind,
          message: trimmed,
          durationMs: toastDuration(kind, preferences.notificationDuration),
        },
      ]);
    },
    [preferences.notificationDuration],
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  function patchPreferences(patch: Partial<AppPreferences>) {
    setPreferences((current) => ({ ...current, ...patch }));
  }

  function resetPreferences() {
    setPreferences(defaultPreferences);
    setStatus("Settings reset to defaults.");
  }

  function enterApp(nextAction: "upload" | null = null) {
    const supportedSelections = normalizeSelectedSubjects(selectedSubjects).filter(isSupportedSubject);
    if (!selectedSubjects.length) {
      setPostOnboardingAction(nextAction);
      setCurrentView("onboarding");
      return;
    }
    setCurrentView("app");
    if (nextAction === "upload" && supportedSelections.length) {
      setActiveSubject((current) => (current && isSupportedSubject(current) ? current : supportedSelections[0] ?? null));
      setUploadOpen(true);
    } else if (nextAction === "upload") {
      setStatus("Upload support is only available for AQA Biology, Chemistry, Physics, and OCR Computer Science.");
    }
  }

  function saveOnboardingSubjects(subjects: SelectableSubject[]) {
    const uniqueSubjects = normalizeSelectedSubjects(subjects);
    const firstSupported = uniqueSubjects.find(isSupportedSubject) ?? null;
    setSelectedSubjects(uniqueSubjects);
    setOnboardingComplete(true);
    setActiveSubject(firstSupported ?? uniqueSubjects[0] ?? null);
    setStatus("Subjects saved.");
    setCurrentView("app");
    if (postOnboardingAction === "upload") {
      if (firstSupported) {
        setUploadOpen(true);
      } else {
        setStatus("Upload support is only available for AQA Biology, Chemistry, Physics, and OCR Computer Science.");
      }
      setPostOnboardingAction(null);
    }
  }

  function openSubjectOnboarding() {
    setSettingsOpen(false);
    setCurrentView("onboarding");
  }

  function openSubjectUpload(subject: SupportedSubject) {
    setCurrentView("app");
    setActiveSubject(subject);
    setUploadOpen(true);
  }

  useEffect(() => {
    if (!status) return;
    pushToast("success", status);
    setStatus(null);
  }, [pushToast, status]);

  useEffect(() => {
    if (!error) return;
    pushToast("error", error);
    setError(null);
  }, [error, pushToast]);

  useEffect(() => {
    if (selectedPaperId && !data.papers.some((paper) => paper.id === selectedPaperId)) setSelectedPaperId(null);
  }, [data.papers, selectedPaperId]);

  useEffect(() => {
    if (activeSubject && selectedSubjects.includes(activeSubject)) return;
    setActiveSubject(loadActiveSubject(selectedSubjects));
  }, [activeSubject, selectedSubjects]);

  useEffect(() => {
    const interval = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    setFullscreenSupported(Boolean(document.documentElement.requestFullscreen));
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) setIsFocusMode(false);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const selectedPaper = data.papers.find((paper) => paper.id === selectedPaperId) ?? null;
  const selectedAttempt = data.attempts.find((attempt) => attempt.id === selectedAttemptId && (!selectedPaper || attempt.paperId === selectedPaper.id)) ?? null;
  const activeQuestion = selectedPaper?.questions[activeQuestionIndex] ?? null;
  const activeAnswer = selectedAttempt?.answers.find((answer) => answer.questionId === activeQuestion?.id) ?? null;
  const activeSupportIssue = activeQuestion ? questionSupportIssue(activeQuestion) : null;
  const reviewQuestion = selectedPaper?.questions[reviewIndex] ?? null;
  const reviewAnswer = selectedAttempt?.answers.find((answer) => answer.questionId === reviewQuestion?.id) ?? null;
  const reviewSupportIssue = reviewQuestion ? questionSupportIssue(reviewQuestion) : null;
  const reviewMark = reviewQuestion ? latestAcceptedMark(selectedAttempt, reviewQuestion.id) : null;
  const displayScores = selectedPaper && selectedAttempt ? displayAttemptScores(selectedPaper, selectedAttempt) : selectedAttempt;

  useEffect(() => {
    if (!selectedPaper?.questions.length) {
      setReviewIndex(0);
      return;
    }
    setReviewIndex((value) => Math.min(value, selectedPaper.questions.length - 1));
  }, [selectedPaper?.id, selectedPaper?.questions.length, selectedAttemptId]);

  useEffect(() => {
    setQuestionsExpanded(false);
  }, [selectedPaper?.id]);

  useEffect(() => {
    setMarkSchemeDetailsOpen(false);
  }, [reviewQuestion?.id, selectedAttemptId]);

  useEffect(() => {
    if (!feedbackOpen) return;
    saveFeedbackDraft(feedbackDraft);
  }, [feedbackDraft, feedbackOpen]);

  const analytics = useMemo(() => {
    const markedAttempts = data.attempts.filter((attempt) => attempt.status === "marked");
    const completed = markedAttempts.length;
    const scoredAttempts = markedAttempts
      .map((attempt) => {
        const paper = data.papers.find((item) => item.id === attempt.paperId);
        if (!paper) return null;
        const scores = displayAttemptScores(paper, attempt);
        const total = preferredAttemptTotal(paper, attempt);
        return total > 0 ? (scores.actualScore / total) * 100 : null;
      })
      .filter((value): value is number => typeof value === "number");
    const averagePercent = scoredAttempts.length ? scoredAttempts.reduce((sum, value) => sum + value, 0) / scoredAttempts.length : null;
    const overtime = data.attempts.reduce((sum, attempt) => sum + attempt.overtimeSeconds, 0);
    return { completed, averagePercent, overtime, ready: scoredAttempts.length >= 2 };
  }, [data.attempts, data.papers]);

  useEffect(() => {
    if (!selectedPaper) return;
    setMetadataDraft({
      title: selectedPaper.title,
      subject: selectedPaper.subject,
      topic: selectedPaper.topic ?? "",
      subtopic: selectedPaper.subtopic ?? "",
      year: selectedPaper.year ? String(selectedPaper.year) : "",
      series: selectedPaper.series ?? "",
      paperCode: selectedPaper.paperCode ?? "",
    });
  }, [selectedPaper]);

  async function openFeedback(type?: FeedbackDraft["type"]) {
    setSystemInfoOpen(false);
    setSettingsOpen(false);
    let diagnosticAttachments: FeedbackAttachment[] = [];
    if (type === "bug_report" && selectedPaper) {
      const diagnosticJson = JSON.stringify(diagnosticBundle(selectedPaper, data.attempts), null, 2);
      const file = new File([diagnosticJson], `${selectedPaper.title.replace(/[^a-z0-9]+/gi, "-").replace(/(^-|-$)/g, "").toLowerCase() || "paper"}-diagnostics.json`, {
        type: "application/json",
      });
      diagnosticAttachments = await filesToFeedbackAttachments([file]);
      setStatus("Diagnostics attached.");
    } else if (type === "bug_report") {
      setStatus("Diagnostics unavailable.");
    }
    const attachmentMeta = diagnosticAttachments.map(({ id, filename, contentType, sizeBytes, encodedSizeEstimate }) => ({
      id,
      filename,
      contentType,
      sizeBytes,
      encodedSizeEstimate,
    }));
    const draft = { ...loadFeedbackDraft(), ...(type ? { type } : {}), attachments: attachmentMeta };
    setFeedbackDraft(draft);
    setFeedbackAttachments(diagnosticAttachments);
    setFeedbackTouched({});
    setFeedbackError(null);
    setFeedbackOpen(true);
  }

  function closeFeedback() {
    setFeedbackOpen(false);
    setFeedbackError(null);
  }

  function patchFeedbackDraft(patch: Partial<FeedbackDraft>) {
    setFeedbackDraft((current) => {
      const next = { ...current, ...patch };
      if (patch.type && patch.type !== "bug_report") {
        setFeedbackAttachments([]);
        next.attachments = [];
      }
      return next;
    });
    setFeedbackError(null);
  }

  function touchFeedbackField(field: keyof FeedbackDraft) {
    setFeedbackTouched((current) => ({ ...current, [field]: true }));
  }

  async function submitFeedbackForm() {
    const draftErrors = validateFeedbackDraft(feedbackDraft);
    if (!feedbackDraftIsValid(draftErrors)) {
      setFeedbackTouched({
        type: true,
        email: true,
        title: true,
        description: true,
        website: true,
      });
      return;
    }

    setFeedbackSubmitting(true);
    setFeedbackError(null);
    try {
      await submitFeedback(feedbackDraft, feedbackAttachments, { path: feedbackContextPath(), appVersion: appMeta.version });
      clearFeedbackDraft();
      setFeedbackDraft(emptyFeedbackDraft());
      setFeedbackAttachments([]);
      setFeedbackTouched({});
      setFeedbackOpen(false);
      setStatus("Feedback sent. Thank you.");
      setError(null);
    } catch (reason) {
      setFeedbackError(reason instanceof Error ? reason.message : "Feedback could not be sent. Please try again.");
    } finally {
      setFeedbackSubmitting(false);
    }
  }

  async function addFeedbackFiles(files: FileList | null) {
    if (!files?.length) return;
    setFeedbackError(null);
    const attachments = await filesToFeedbackAttachments(files);
    const merged = [...feedbackAttachments];
    for (const attachment of attachments) {
      if (!merged.some((item) => item.id === attachment.id)) merged.push(attachment);
    }
    const nextMeta = merged.map(({ id, filename, contentType, sizeBytes, encodedSizeEstimate }) => ({
      id,
      filename,
      contentType,
      sizeBytes,
      encodedSizeEstimate,
    }));
    setFeedbackAttachments(merged);
    setFeedbackDraft((draft) => ({ ...draft, attachments: nextMeta }));
    setFeedbackTouched((touches) => ({ ...touches, attachments: true }));
  }

  function removeFeedbackAttachment(attachmentId: string) {
    const next = feedbackAttachments.filter((attachment) => attachment.id !== attachmentId);
    const nextMeta = next.map(({ id, filename, contentType, sizeBytes, encodedSizeEstimate }) => ({
      id,
      filename,
      contentType,
      sizeBytes,
      encodedSizeEstimate,
    }));
    setFeedbackAttachments(next);
    setFeedbackDraft((draft) => ({ ...draft, attachments: nextMeta }));
    setFeedbackTouched((touches) => ({ ...touches, attachments: true }));
    setFeedbackError(null);
  }

  function patchPaper(paperId: string, updater: (paper: PastPaper) => PastPaper) {
    setData((current) => ({ ...current, papers: current.papers.map((paper) => (paper.id === paperId ? updater(paper) : paper)) }));
  }

  function patchAttempt(attemptId: string, updater: (attempt: PastPaperAttempt) => PastPaperAttempt) {
    setData((current) => ({ ...current, attempts: current.attempts.map((attempt) => (attempt.id === attemptId ? updater(attempt) : attempt)) }));
  }

  function updateJob(paperId: string, jobId: string, patch: Partial<PastPaperProcessingJob>) {
    patchPaper(paperId, (paper) => ({
      ...paper,
      jobs: paper.jobs.map((job) => (job.id === jobId ? { ...job, ...patch, updatedAt: nowIso() } : job)),
      processingDiagnostics: patch.diagnostics ?? paper.processingDiagnostics ?? null,
      updatedAt: nowIso(),
    }));
  }

  async function runProcessing(paper: PastPaper) {
    if (!isSupportedSubject(paper.subject)) {
      setError("Processing is only available for AQA Biology, Chemistry, Physics, and OCR Computer Science.");
      return;
    }
    try {
      await ensureAIReadyForUserAction();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Gemini AI is unavailable");
      return;
    }
    const job = buildProcessingJob(paper.id);
    let latestDiagnostics: ProcessingDiagnostics | null = null;
    cancelledProcessingJobs.current.delete(job.id);
    patchPaper(paper.id, (current) => ({
      ...current,
      processingStatus: "processing",
      processingError: null,
      jobs: [...current.jobs, { ...job, status: "running" }],
      updatedAt: nowIso(),
    }));

    try {
      const processed = await processPaperWithAI(
        paper,
        (update) => {
          if (cancelledProcessingJobs.current.has(job.id)) return;
          latestDiagnostics = update.diagnostics;
          updateJob(paper.id, job.id, { currentStage: update.stage, progressPercent: update.percent, status: "running", diagnostics: update.diagnostics });
        },
        { model: aiModel, fallbackModels: FALLBACK_AI_MODELS.filter((model) => model !== aiModel) },
      );
      if (cancelledProcessingJobs.current.has(job.id)) return;
      patchPaper(paper.id, (current) => ({
        ...current,
        ...processed,
        jobs: current.jobs.map((item) =>
          item.id === job.id ? { ...item, status: "completed", progressPercent: 100, currentStage: "finalising", diagnostics: processed.processingDiagnostics ?? latestDiagnostics, updatedAt: nowIso() } : item,
        ),
      }));
      setStatus("Paper processed into structured questions.");
      setError(null);
    } catch (reason) {
      if (cancelledProcessingJobs.current.has(job.id)) return;
      const message = reason instanceof Error ? reason.message : "Processing failed";
      patchPaper(paper.id, (current) => ({
        ...current,
        processingStatus: "failed",
        processingError: message,
        processingDiagnostics: latestDiagnostics ?? current.processingDiagnostics ?? null,
        jobs: current.jobs.map((item) =>
          item.id === job.id ? { ...item, status: "failed", errorMessage: message, diagnostics: latestDiagnostics ?? item.diagnostics ?? null, updatedAt: nowIso() } : item,
        ),
      }));
      setError(message);
    }
  }

  function cancelProcessing(paper: PastPaper) {
    const now = nowIso();
    const runningJobs = paper.jobs.filter((job) => job.kind === "processing" && (job.status === "running" || job.status === "queued"));
    runningJobs.forEach((job) => cancelledProcessingJobs.current.add(job.id));
    patchPaper(paper.id, (current) => ({
      ...current,
      processingStatus: "failed",
      processingError: "Processing cancelled. You can restart it now.",
      jobs: current.jobs.map((job) =>
        job.kind === "processing" && (job.status === "running" || job.status === "queued")
          ? { ...job, status: "cancelled", errorMessage: "Processing cancelled by user.", updatedAt: now }
          : job,
      ),
      updatedAt: now,
    }));
    setStatus("Processing cancelled. You can restart it now.");
    setError(null);
  }

  async function createAsset(file: File, paperId: string, kind: PastPaperAsset["kind"]): Promise<PastPaperAsset> {
    const extracted = await extractFileAssetContent(file);
    return {
      id: createId("asset"),
      paperId,
      kind,
      fileName: file.name,
      mimeType: file.type,
      size: file.size,
      textContent: extracted.textContent,
      pageCount: extracted.pageCount,
      pageTexts: extracted.pageTexts,
      pageScreenshots: extracted.pageScreenshots,
      extractionDiagnostics: extracted.extractionDiagnostics,
      objectUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
      createdAt: nowIso(),
    };
  }

  async function handleUpload(draft: PaperDraftInput, paperFile: File, markSchemeFile: File | null, processNow: boolean) {
    setBusy(true);
    setError(null);
    try {
      if (!isSupportedSubject(draft.subject)) {
        throw new Error("Upload support is only available for AQA Biology, Chemistry, Physics, and OCR Computer Science.");
      }
      const paperId = createId("paper");
      const paperAsset = await createAsset(paperFile, paperId, "paper");
      const markSchemeAsset = markSchemeFile ? await createAsset(markSchemeFile, paperId, "mark_scheme") : null;
      const createdAt = nowIso();
      const paper: PastPaper = {
        id: paperId,
        title: draft.title.trim() || paperFile.name.replace(/\.[^.]+$/, ""),
        subject: draft.subject,
        topic: toNullable(draft.topic),
        subtopic: toNullable(draft.subtopic),
        year: toNullableNumber(draft.year),
        series: toNullable(draft.series),
        paperCode: toNullable(draft.paperCode),
        totalMarks: null,
        durationMinutes: null,
        hasMarkScheme: Boolean(markSchemeAsset),
        processingStatus: "unprocessed",
        processingError: null,
        processingDiagnostics: null,
        assets: [paperAsset, ...(markSchemeAsset ? [markSchemeAsset] : [])],
        questions: [],
        jobs: [],
        createdAt,
        updatedAt: createdAt,
      };
      setData((current) => ({ ...current, papers: [paper, ...current.papers] }));
      const uploadedSubject = paper.subject as SupportedSubject;
      setSelectedSubjects((current) => (current.includes(uploadedSubject) ? current : [...current, uploadedSubject]));
      setOnboardingComplete(true);
      setActiveSubject(uploadedSubject);
      setCurrentView("app");
      setSelectedPaperId(paper.id);
      setUploadOpen(false);
      setStatus(processNow ? "Paper saved and queued for processing." : "Paper saved.");
      if (processNow) void runProcessing(paper);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  function saveMetadata() {
    if (!selectedPaper) return;
    patchPaper(selectedPaper.id, (paper) => ({
      ...paper,
      title: metadataDraft.title.trim() || paper.title,
      subject: metadataDraft.subject,
      topic: toNullable(metadataDraft.topic),
      subtopic: toNullable(metadataDraft.subtopic),
      year: toNullableNumber(metadataDraft.year),
      series: toNullable(metadataDraft.series),
      paperCode: toNullable(metadataDraft.paperCode),
      updatedAt: nowIso(),
    }));
    setEditingMetadata(false);
    setStatus("Metadata saved.");
  }

  function deletePaper(paperId: string) {
    setData((current) => ({
      papers: current.papers.filter((paper) => paper.id !== paperId),
      attempts: current.attempts.filter((attempt) => attempt.paperId !== paperId),
    }));
    if (selectedPaperId === paperId) setSelectedPaperId(null);
    setSelectedAttemptId(null);
    setStatus("Paper deleted.");
  }

  function deleteAttempt(attemptId: string) {
    setData((current) => ({ ...current, attempts: current.attempts.filter((attempt) => attempt.id !== attemptId) }));
    if (selectedAttemptId === attemptId) setSelectedAttemptId(null);
    setStatus("Attempt deleted.");
  }

  function cancelAttempt() {
    if (!selectedAttempt || selectedAttempt.status !== "in_progress") return;
    deleteAttempt(selectedAttempt.id);
    setActiveQuestionIndex(0);
    setReviewIndex(0);
    void exitFocusMode();
    setStatus("Attempt cancelled.");
  }

  function startAttemptLabel(paper: PastPaper) {
    const hasAttempts = data.attempts.some((attempt) => attempt.paperId === paper.id);
    if (!hasAttempts) return "Start paper";
    return "Retry paper";
  }

  async function enterFocusMode() {
    setIsFocusMode(true);
    if (document.fullscreenElement || !document.documentElement.requestFullscreen) return;
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      setStatus("Focus mode enabled without browser fullscreen.");
    }
  }

  async function exitFocusMode() {
    setIsFocusMode(false);
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch {
        // CSS focus mode has already been cleared.
      }
    }
  }

  function beginAttempt(paper: PastPaper) {
    if (!isSupportedSubject(paper.subject)) {
      setError("This subject is not supported for practice yet.");
      return;
    }
    if (paper.processingStatus !== "ready" || !paper.questions.length) {
      setError("Process the paper before starting an attempt.");
      return;
    }
    const attempt = startAttempt(paper);
    setData((current) => ({ ...current, attempts: [attempt, ...current.attempts] }));
    setSelectedPaperId(paper.id);
    setSelectedAttemptId(attempt.id);
    setActiveQuestionIndex(0);
    setReviewIndex(0);
    setStatus("Attempt started.");
    setError(null);
    if (preferences.focusModeDefault) void enterFocusMode();
  }

  const updateAnswer = useCallback((questionId: string, patch: Partial<PastPaperAnswer>) => {
    if (!selectedAttempt) return;
    patchAttempt(selectedAttempt.id, (attempt) => ({
      ...attempt,
      answers: attempt.answers.map((answer) => (answer.questionId === questionId ? { ...answer, ...patch, updatedAt: nowIso() } : answer)),
    }));
  }, [selectedAttempt]);

  const submitCurrentAnswer = useCallback((next = true) => {
    if (!activeQuestion || !activeAnswer) return;
    updateAnswer(activeQuestion.id, { skipped: activeAnswer.skipped, updatedAt: nowIso() });
    setStatus(`Answer saved for question ${activeQuestion.questionNumber}.`);
    if (next) setActiveQuestionIndex((value) => Math.min((selectedPaper?.questions.length ?? 1) - 1, value + 1));
  }, [activeAnswer, activeQuestion, selectedPaper?.questions.length, updateAnswer]);

  useEffect(() => {
    if (!selectedAttempt || selectedAttempt.status !== "in_progress") return;
    const onKeyDown = (event: KeyboardEvent) => {
      const isCommandEnter = (event.ctrlKey || event.metaKey) && event.key === "Enter";
      if (isCommandEnter) {
        event.preventDefault();
        submitCurrentAnswer(activeQuestionIndex < (selectedPaper?.questions.length ?? 1) - 1);
      }
      if (event.altKey && event.key === "ArrowLeft") {
        event.preventDefault();
        setActiveQuestionIndex((value) => Math.max(0, value - 1));
      }
      if (event.altKey && event.key === "ArrowRight") {
        event.preventDefault();
        setActiveQuestionIndex((value) => Math.min((selectedPaper?.questions.length ?? 1) - 1, value + 1));
      }
      if (event.key === "Escape" && isFocusMode) {
        event.preventDefault();
        void exitFocusMode();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeQuestionIndex, isFocusMode, selectedAttempt, selectedPaper?.questions.length, submitCurrentAnswer]);

  function skipQuestion(withConfidence: boolean, predictedOverride?: number) {
    if (!activeQuestion || !activeAnswer) return;
    const predicted = withConfidence ? Math.max(0, Math.min(activeQuestion.maxMarks, predictedOverride ?? activeAnswer.confidencePredictedMarks ?? 0)) : null;
    updateAnswer(activeQuestion.id, {
      responseText: null,
      numericResponse: null,
      selectedOptions: [],
      skipped: true,
      skippedWithConfidence: withConfidence,
      confidencePredictedMarks: predicted,
    });
    setStatus(withConfidence ? "Question skipped with confidence score." : "Question skipped.");
    setActiveQuestionIndex((value) => Math.min((selectedPaper?.questions.length ?? 1) - 1, value + 1));
  }

  function openConfidenceSkip() {
    if (!activeQuestion || !activeAnswer) return;
    setConfidenceDraft(activeAnswer.confidencePredictedMarks ?? "");
    setConfidenceSkipOpen(true);
  }

  function confirmConfidenceSkip() {
    if (!activeQuestion) return;
    setConfidenceSkipOpen(false);
    skipQuestion(true, confidenceDraft === "" ? 0 : confidenceDraft);
  }

  function unskipQuestion() {
    if (!activeQuestion || !activeAnswer) return;
    updateAnswer(activeQuestion.id, {
      skipped: false,
      skippedWithConfidence: false,
      confidencePredictedMarks: null,
    });
    setStatus("Question unskipped.");
  }

  function reportUnsupportedQuestion(question: PastPaperQuestion) {
    patchPaper(question.paperId, (paper) => ({
      ...paper,
      questions: paper.questions.map((item) =>
        item.id === question.id
          ? {
              ...item,
              originalContent: {
                ...item.originalContent,
                unsupportedReportedAt: nowIso(),
              },
              extractionWarnings: [...(item.extractionWarnings ?? []), "User reported this unsupported-format classification for review."],
            }
          : item,
      ),
      updatedAt: nowIso(),
    }));
    const label = selectedPaper ? displayQuestionLabel(selectedPaper, question) : question.questionNumber;
    setStatus(`Reported question ${label} for format review.`);
  }

  function submitAttempt() {
    if (!selectedAttempt || !selectedPaper) return;
    const elapsed = Math.max(0, Math.floor((Date.now() - new Date(selectedAttempt.startedAt).getTime()) / 1000));
    const limit = (selectedPaper.durationMinutes ?? 0) * 60;
    patchAttempt(selectedAttempt.id, (attempt) =>
      computeAttemptScores(
        {
          ...attempt,
          status: "submitted",
          submittedAt: nowIso(),
          durationSeconds: elapsed,
          overtimeSeconds: limit ? Math.max(0, elapsed - limit) : 0,
        },
        selectedPaper,
      ),
    );
    setStatus("Attempt submitted.");
    void exitFocusMode();
  }

  async function markAttempt() {
    if (!selectedAttempt || !selectedPaper) return;
    if (!selectedPaper.hasMarkScheme) {
      setError("A mark scheme is required before AI marking can run.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await ensureAIReadyForUserAction();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Gemini AI is unavailable");
      setBusy(false);
      return;
    }
    const job: PastPaperProcessingJob = {
      ...buildProcessingJob(selectedPaper.id),
      attemptId: selectedAttempt.id,
      kind: "marking",
      currentStage: "marking answers",
    };
    patchPaper(selectedPaper.id, (paper) => ({ ...paper, jobs: [...paper.jobs, { ...job, status: "running", progressPercent: 4 }] }));

    try {
      const marks: PastPaperQuestionMark[] = [];
      const answeredQuestions = selectedPaper.questions
        .map((question) => ({ question, answer: selectedAttempt.answers.find((item) => item.questionId === question.id) ?? null }))
        .filter((item) => !questionSupportIssue(item.question))
        .filter((item): item is { question: PastPaperQuestion; answer: PastPaperAnswer } => Boolean(item.answer && isAnswerAttempted(item.answer)));
      const failures: string[] = [];
      if (!answeredQuestions.length) throw new Error("No answered questions to mark. Skipped and unanswered questions are ignored.");
      for (const [index, { question, answer }] of answeredQuestions.entries()) {
        updateJob(selectedPaper.id, job.id, { progressPercent: 8 + Math.round((index / Math.max(answeredQuestions.length, 1)) * 82), currentStage: "marking answers" });
        try {
          const version = selectedAttempt.marks.filter((mark) => mark.questionId === question.id).length + 1;
          marks.push(await markAnswerWithAI(selectedPaper, question, answer, version, "ai", { model: aiModel, fallbackModels: FALLBACK_AI_MODELS.filter((model) => model !== aiModel) }));
        } catch (reason) {
          const message = reason instanceof Error ? reason.message : String(reason);
          failures.push(`Question ${question.questionNumber}: ${message}`);
          marks.push(createMarkingErrorMark(answer.id, question.id, question.maxMarks, message, "ai", selectedAttempt.marks.filter((mark) => mark.questionId === question.id).length + 1));
        }
      }
      if (!marks.length) {
        throw new Error(
          [
            "No answered questions had aligned mark-scheme data, so AI marking was not run.",
            failures.length ? `Marking diagnostics: ${failures.slice(0, 5).join(" / ")}` : "Marking diagnostics: no per-question error was returned.",
            "Export diagnostics for the paper to inspect mark-scheme alignment and answered-question state.",
          ].join("\n"),
        );
      }
      patchAttempt(selectedAttempt.id, (attempt) =>
        computeAttemptScores(
          {
            ...attempt,
            status: "marked",
            completedAt: nowIso(),
            marks: [...attempt.marks.map((mark) => (marks.some((newMark) => newMark.questionId === mark.questionId) ? { ...mark, accepted: false } : mark)), ...marks],
          },
          selectedPaper,
        ),
      );
      updateJob(selectedPaper.id, job.id, { status: "completed", progressPercent: 100 });
      const errorCount = marks.filter((mark) => isMarkingErrorMark(mark)).length;
      const scoredCount = marks.length - errorCount;
      setStatus(
        `Attempt marked with Gemini AI. ${scoredCount} answered question${scoredCount === 1 ? "" : "s"} scored${errorCount ? `, ${errorCount} flagged as mark-scheme errors` : ""}.`,
      );
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Marking failed";
      updateJob(selectedPaper.id, job.id, { status: "failed", errorMessage: message });
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  async function requestRemark(answer: PastPaperAnswer) {
    if (!selectedAttempt || !selectedPaper) return;
    const question = selectedPaper.questions.find((item) => item.id === answer.questionId);
    if (!question) return;
    setBusy(true);
    setError(null);
    try {
      await ensureAIReadyForUserAction();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Gemini AI is unavailable");
      setBusy(false);
      return;
    }
    const remark = createRemark(selectedAttempt.id, answer, null);
    patchAttempt(selectedAttempt.id, (attempt) => ({ ...attempt, remarks: [...attempt.remarks, { ...remark, status: "running" }] }));

    try {
      const version = selectedAttempt.marks.filter((mark) => mark.questionId === question.id).length + 1;
      const proposed = await markAnswerWithAI(selectedPaper, question, answer, version, "remark", { model: aiModel, fallbackModels: FALLBACK_AI_MODELS.filter((model) => model !== aiModel) });
      patchAttempt(selectedAttempt.id, (attempt) => ({
        ...attempt,
        marks: [...attempt.marks, proposed],
        remarks: attempt.remarks.map((item) => (item.id === remark.id ? { ...item, status: "completed", proposedMarkId: proposed.id } : item)),
      }));
      setStatus("Remark completed. Review it before accepting.");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Remark failed";
      patchAttempt(selectedAttempt.id, (attempt) => ({ ...attempt, remarks: attempt.remarks.map((item) => (item.id === remark.id ? { ...item, status: "failed", notes: message } : item)) }));
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  function acceptRemark(remarkId: string) {
    if (!selectedAttempt || !selectedPaper) return;
    const remark = selectedAttempt.remarks.find((item) => item.id === remarkId);
    if (!remark?.proposedMarkId) return;
    patchAttempt(selectedAttempt.id, (attempt) =>
      computeAttemptScores(
        {
          ...attempt,
          marks: attempt.marks.map((mark) =>
            mark.id === remark.proposedMarkId ? { ...mark, accepted: true } : mark.questionId === remark.questionId ? { ...mark, accepted: false } : mark,
          ),
          remarks: attempt.remarks.map((item) =>
            item.id === remarkId ? { ...item, acceptedMarkId: remark.proposedMarkId, acceptedAt: nowIso() } : item,
          ),
        },
        selectedPaper,
      ),
    );
  }

  async function askForSuggestions() {
    setBusy(true);
    setError(null);
    try {
      await ensureAIReadyForUserAction();
      const text = await aiChat("Give 3 helpful suggestions for a student using an AI past paper worker. Keep it concise.", {
        operation: "suggestions",
        model: aiModel,
        fallbackModels: FALLBACK_AI_MODELS.filter((model) => model !== aiModel),
        timeoutMs: 45_000,
        requestLabel: "AI suggestions",
      });
      setSuggestions(text);
      setStatus("AI suggestions loaded.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Suggestions failed");
    } finally {
      setBusy(false);
    }
  }

  async function runSmokeTest() {
    setSmokeBusy(true);
    setError(null);
    try {
      await ensureAIReadyForUserAction();
      const result = await runAISmokeTest(aiModel);
      setSmokeTest(result);
      if (selectedPaper) {
        patchPaper(selectedPaper.id, (paper) => {
          const diagnostics = paper.processingDiagnostics;
          if (!diagnostics) return paper;
          return {
            ...paper,
            processingDiagnostics: {
              ...diagnostics,
              updatedAt: nowIso(),
              smokeTests: [...diagnostics.smokeTests, result],
            },
          };
        });
      }
      setStatus("Gemini smoke test complete.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Gemini smoke test failed");
    } finally {
      setSmokeBusy(false);
    }
  }

  const elapsedSeconds = selectedAttempt ? Math.max(0, Math.floor((clockNow - new Date(selectedAttempt.startedAt).getTime()) / 1000)) : 0;
  const durationLimit = selectedPaper?.durationMinutes ? selectedPaper.durationMinutes * 60 : 0;
  const secondsRemaining = durationLimit ? durationLimit - elapsedSeconds : elapsedSeconds;
  const overtimeSeconds = durationLimit ? Math.max(0, elapsedSeconds - durationLimit) : 0;
  const markingJob = selectedPaper ? latestJob(selectedPaper, "marking") : null;
  const appMode =
    selectedAttempt?.status === "in_progress"
      ? "taking"
      : markingJob?.status === "running"
        ? "marking"
        : selectedAttempt?.status === "marked"
          ? "review"
          : selectedAttempt?.status === "submitted"
            ? "submitted"
            : selectedPaper?.processingStatus === "processing"
              ? "processing"
              : selectedPaper?.processingStatus === "ready"
                ? "ready"
                : data.papers.length
                  ? "catalogue"
                  : "empty";
  const feedbackErrors = useMemo(() => {
    const errors = validateFeedbackDraft(feedbackDraft);
    const visible: FeedbackValidationErrors = {};
    (Object.keys(errors) as Array<keyof FeedbackDraft>).forEach((key) => {
      if (feedbackTouched[key]) visible[key] = errors[key];
    });
    return visible;
  }, [feedbackDraft, feedbackTouched]);
  const feedbackCanSubmit = feedbackDraftIsValid(validateFeedbackDraft(feedbackDraft)) && !feedbackSubmitting;
  const showFeedbackButton =
    (appMode === "empty" || appMode === "catalogue" || appMode === "ready") &&
    preferences.showFloatingFeedback &&
    !uploadOpen &&
    !editingMetadata &&
    !confidenceSkipOpen &&
    !feedbackOpen &&
    !systemInfoOpen &&
    !settingsOpen &&
    !busy &&
    !smokeBusy;
  const activeAttemptStats = selectedPaper ? attemptReviewStats(selectedPaper, selectedAttempt) : null;
  const paperAttempts = selectedPaper ? attemptsForPaper(data, selectedPaper.id) : [];
  const answeredDuringAttempt = selectedAttempt?.answers.filter(isAnswerAttempted).length ?? 0;
  const skippedDuringAttempt = selectedAttempt?.answers.filter((answer) => answer.skipped).length ?? 0;
  const focusProgressPercent = selectedPaper?.questions.length ? Math.round(((activeQuestionIndex + 1) / selectedPaper.questions.length) * 100) : 0;
  const unsupportedSelectedSubjects = selectedSubjects.filter((subject) => !isSupportedSubject(subject));
  const supportedActiveSubject = activeSubject && isSupportedSubject(activeSubject) ? activeSubject : null;
  const canShowProductShell = appMode !== "taking" && appMode !== "processing" && appMode !== "marking" && appMode !== "review";
  const needsOnboarding = currentView === "onboarding" && canShowProductShell;
  const showLanding = currentView === "landing" && canShowProductShell;
  const activeSubjectPapers = activeSubject ? data.papers.filter((paper) => paper.subject === activeSubject) : [];
  const showLegacyDashboard = false;

  function feedbackContextPath() {
    const page = window.location.pathname || "/";
    if (selectedPaper && selectedAttempt?.status === "submitted") return `${page}#submitted/${selectedPaper.id}`;
    if (selectedPaper) return `${page}#paper/${selectedPaper.id}`;
    return `${page}#${appMode}`;
  }

  function clearLocalDashboardData() {
    if (!window.confirm("Clear all papers and attempts stored on this device?")) return;
    clearData();
    setData({ papers: [], attempts: [] });
    setSelectedSubjects([]);
    setActiveSubject(null);
    setOnboardingComplete(false);
    setSelectedPaperId(null);
    setSelectedAttemptId(null);
    setSystemInfoOpen(false);
    setSettingsOpen(false);
    setCurrentView("landing");
    setStatus("Local data cleared.");
  }

  function exportAllData() {
    const blob = new Blob([JSON.stringify({ exportedAt: nowIso(), appVersion: appMeta.version, data }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `past-paper-worker-${appMeta.version}-backup.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function importBackup(file: File | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as { data?: AppData; papers?: PastPaper[]; attempts?: PastPaperAttempt[] };
        const imported = parsed.data ?? { papers: parsed.papers ?? [], attempts: parsed.attempts ?? [] };
        if (!Array.isArray(imported.papers) || !Array.isArray(imported.attempts)) throw new Error("Invalid backup file.");
        setData({ papers: imported.papers, attempts: imported.attempts });
        const importedSubjects = loadSelectedSubjects({ papers: imported.papers, attempts: imported.attempts });
        setSelectedSubjects(importedSubjects);
        setActiveSubject(loadActiveSubject(importedSubjects));
        setOnboardingComplete(importedSubjects.length > 0);
        setStatus("Backup imported.");
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Backup could not be imported.");
      }
    };
    reader.onerror = () => setError("Backup could not be read.");
    reader.readAsText(file);
  }

  async function copyMarkSchemeRow(question: PastPaperQuestion | null) {
    const text = markSchemeDataText(question);
    try {
      await navigator.clipboard?.writeText(text);
      setStatus("Mark scheme row copied.");
    } catch {
      setError("Could not copy the mark scheme row.");
    }
  }

  const rootClassName = [
    "app-shell",
    appMode !== "taking" && appMode !== "processing" && appMode !== "marking" && appMode !== "review" ? "app-shell--subject-product" : "",
    `app-shell--${appMode}`,
    `app-shell--theme-${preferences.themeMode}`,
    `app-shell--accent-${preferences.accentColour}`,
    `app-shell--density-${preferences.dashboardDensity}`,
    preferences.reduceMotion === "reduce" ? "app-shell--reduce-motion" : "",
    preferences.questionNavigation === "list" ? "app-shell--nav-list" : "",
    isFocusMode ? "app-shell--focus" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const rootStyle =
    preferences.accentColour === "custom"
      ? ({
          "--accent": preferences.customAccent,
          "--accent-2": preferences.customAccent2,
        } as React.CSSProperties)
      : undefined;

  if (showLanding) {
    return (
      <div className={`product-root app-shell--theme-${preferences.themeMode} app-shell--accent-${preferences.accentColour}${preferences.reduceMotion === "reduce" ? " app-shell--reduce-motion" : ""}`} style={rootStyle}>
        <LandingPage reduceMotion={preferences.reduceMotion === "reduce"} onEnter={() => enterApp()} onUpload={() => enterApp("upload")} onFeedback={() => openFeedback()} />
        <FeedbackModal
          open={feedbackOpen}
          draft={feedbackDraft}
          attachments={feedbackAttachments}
          errors={feedbackErrors}
          pending={feedbackSubmitting}
          submitEnabled={feedbackCanSubmit}
          serverError={feedbackError}
          onChange={patchFeedbackDraft}
          onBlur={touchFeedbackField}
          onAddFiles={(files) => void addFeedbackFiles(files)}
          onRemoveAttachment={removeFeedbackAttachment}
          onClose={closeFeedback}
          onSubmit={() => void submitFeedbackForm()}
        />
        <ToastStack toasts={toasts} onDismiss={dismissToast} />
      </div>
    );
  }

  if (needsOnboarding) {
    return (
      <div className={`product-root app-shell--theme-${preferences.themeMode} app-shell--accent-${preferences.accentColour}${preferences.reduceMotion === "reduce" ? " app-shell--reduce-motion" : ""}`} style={rootStyle}>
        <SubjectOnboardingV131 selectedSubjects={selectedSubjects} onSave={saveOnboardingSubjects} />
        <FeedbackModal
          open={feedbackOpen}
          draft={feedbackDraft}
          attachments={feedbackAttachments}
          errors={feedbackErrors}
          pending={feedbackSubmitting}
          submitEnabled={feedbackCanSubmit}
          serverError={feedbackError}
          onChange={patchFeedbackDraft}
          onBlur={touchFeedbackField}
          onAddFiles={(files) => void addFeedbackFiles(files)}
          onRemoveAttachment={removeFeedbackAttachment}
          onClose={closeFeedback}
          onSubmit={() => void submitFeedbackForm()}
        />
        <ToastStack toasts={toasts} onDismiss={dismissToast} />
      </div>
    );
  }

  return (
    <div className={rootClassName} style={rootStyle}>
      {appMode !== "taking" && appMode !== "processing" && appMode !== "marking" && appMode !== "review" ? (
        <SubjectSidebarV131
          collapsed={sidebarCollapsed}
          selectedSubjects={selectedSubjects}
          activeSubject={activeSubject}
          onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
          onSelectSubject={(subject) => {
            setCurrentView("app");
            setActiveSubject(subject);
            setSelectedPaperId(null);
            setSelectedAttemptId(null);
          }}
          onToggleUnsupportedSubject={(subject) => {
            setCurrentView("app");
            setSelectedSubjects((current) => (current.includes(subject) ? current : [...current, subject]));
            setActiveSubject(subject);
            setSelectedPaperId(null);
            setSelectedAttemptId(null);
          }}
          onHome={() => setCurrentView("landing")}
          onAddSubject={openSubjectOnboarding}
          onUpload={() => {
            if (!supportedActiveSubject) {
              setError("Upload support is only available for AQA Biology, Chemistry, Physics, and OCR Computer Science.");
              return;
            }
            openSubjectUpload(supportedActiveSubject);
          }}
          onSettings={() => setSettingsOpen(true)}
          onVersion={() => setVersionHistoryOpen(true)}
          onCredits={() => setCreditsOpen(true)}
        />
      ) : null}

      <main className="shell-workspace">
        {appMode === "taking" && selectedPaper && activeQuestion ? (
          <header className="focus-topbar">
            <AppLogo size={32} />
            <div className="focus-topbar__title">
              <strong>{selectedPaper.title}</strong>
              <span>
                Question {displayQuestionLabel(selectedPaper, activeQuestion)} / {activeQuestionIndex + 1} of {selectedPaper.questions.length} / {marksLabel(activeQuestion.maxMarks)}
              </span>
            </div>
            <div className={overtimeSeconds ? "focus-timer focus-timer--overtime" : "focus-timer"}>
              <Clock3 size={16} /> {durationLimit && preferences.timerBehaviour === "count_down" ? formatClock(secondsRemaining) : formatClock(elapsedSeconds)}
            </div>
            <button className="secondary-button" onClick={submitAttempt}>
              <Check size={16} /> End attempt
            </button>
            <button className="secondary-button danger-button" onClick={cancelAttempt}>
              <Trash2 size={16} /> Cancel
            </button>
            <button className="secondary-button" onClick={() => void exitFocusMode()} title={fullscreenSupported ? "Exit browser fullscreen or CSS focus mode" : "Exit CSS focus mode"}>
              <X size={16} /> Exit focus
            </button>
          </header>
        ) : appMode === "catalogue" || appMode === "empty" ? null : (
          <header className="workspace-header glass-chrome">
            <div>
              <span className="eyebrow">{statusLabel(appMode)}</span>
              <h1>{selectedPaper?.title ?? "Paper workspace"}</h1>
            </div>
            <div className="button-row">
              <button className="secondary-button" onClick={() => setSettingsOpen(true)}>
                <Settings2 size={16} /> Settings
              </button>
            </div>
          </header>
        )}

        <InlineStatus pending={busy} error={error} success={status} />

        {appMode === "catalogue" || appMode === "empty" ? (
          <AnimatePresence mode="wait">
            {supportedActiveSubject ? (
              <motion.div
                key={supportedActiveSubject}
                initial={preferences.reduceMotion === "reduce" ? undefined : { opacity: 0, y: 12 }}
                animate={preferences.reduceMotion === "reduce" ? undefined : { opacity: 1, y: 0 }}
                exit={preferences.reduceMotion === "reduce" ? undefined : { opacity: 0, y: -10 }}
                transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
              >
                <SubjectDashboard
                  activeSubject={supportedActiveSubject}
                  papers={activeSubjectPapers}
                  attempts={data.attempts}
                  onUpload={() => openSubjectUpload(supportedActiveSubject)}
                  onOpenPaper={(paper) => {
                    setSelectedPaperId(paper.id);
                    setSelectedAttemptId(null);
                  }}
                  onStartPaper={beginAttempt}
                  onProcessPaper={(paper) => void runProcessing(paper)}
                  onDeletePaper={(paper) => deletePaper(paper.id)}
                />
              </motion.div>
            ) : (
              <motion.div
                key={activeSubject ?? unsupportedSelectedSubjects.join(",") ?? "unsupported"}
                initial={preferences.reduceMotion === "reduce" ? undefined : { opacity: 0, y: 12 }}
                animate={preferences.reduceMotion === "reduce" ? undefined : { opacity: 1, y: 0 }}
                exit={preferences.reduceMotion === "reduce" ? undefined : { opacity: 0, y: -10 }}
                transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
              >
                <UnsupportedSubjectDashboard activeSubject={activeSubject} papers={data.papers} onEditSubjects={openSubjectOnboarding} />
              </motion.div>
            )}
          </AnimatePresence>
        ) : null}

        {showLegacyDashboard && appMode === "catalogue" ? (
        <div className="stats-grid">
          <div className="stat-card">
            <span>Completed attempts</span>
            <strong>{analytics.completed}</strong>
          </div>
          <div className="stat-card">
            <span>Average score</span>
            <strong>{analytics.averagePercent === null ? "-" : `${analytics.averagePercent.toFixed(1)}%`}</strong>
          </div>
          <div className="stat-card">
            <span>Overtime</span>
            <strong>{formatClock(analytics.overtime)}</strong>
          </div>
        </div>
        ) : null}

        {showLegacyDashboard && suggestions && (appMode === "catalogue" || appMode === "ready" || appMode === "empty") ? (
          <SectionFrame title="AI Suggestions" subtitle="Generated through the Gemini proxy.">
            <p className="reading-copy">{suggestions}</p>
          </SectionFrame>
        ) : null}

        {showLegacyDashboard && appMode === "empty" ? (
          <div className="dashboard-overview">
            <section className="dashboard-hero glass-chrome">
              <div className="dashboard-hero__copy">
                <span className="eyebrow">Grounded GCSE practice</span>
                <h2>Turn past papers into marked practice.</h2>
                <p>Upload a question paper and mark scheme. The app extracts questions, lets you answer them in focus mode, then marks your work with source checks.</p>
                <div className="button-row">
                  <button className="primary-button" onClick={() => setUploadOpen(true)}>
                    <UploadCloud size={16} /> Upload paper
                  </button>
                  <button className="secondary-button" onClick={() => setSystemInfoOpen(true)}>
                    <Settings2 size={16} /> Customize
                  </button>
                </div>
              </div>
              {preferences.showHeroStatus ? (
              <div className="dashboard-hero__status">
                <div className="metric-row">
                  <span>AI provider</span>
                  <strong>Gemini</strong>
                </div>
                <div className="metric-row">
                  <span>Storage</span>
                  <strong>Local only</strong>
                </div>
                <div className="metric-row">
                  <span>Version</span>
                  <strong>{appMeta.version}</strong>
                </div>
              </div>
              ) : null}
            </section>

            <section className="starter-grid" aria-label="How it works">
              {[
                ["1", "Upload paper", "Add the question paper and mark scheme."],
                ["2", "Extract questions", "Build a structured practice session."],
                ["3", "Practise in focus mode", "Answer one question at a time."],
                ["4", "Mark and review", "Compare against source-checked rows."],
              ].map(([step, title, copy]) => (
                <article className="starter-card glass-chrome" key={step}>
                  <span>{step}</span>
                  <strong>{title}</strong>
                  <p>{copy}</p>
                </article>
              ))}
            </section>

            <div className="dashboard-lower-grid">
              <section className="quick-actions-card glass-chrome">
                <div className="section-frame__header">
                  <div>
                    <span className="eyebrow">Quick actions</span>
                    <h2>Start from here</h2>
                  </div>
                </div>
                <div className="quick-action-grid">
                  <button className="secondary-button" onClick={() => setUploadOpen(true)}>
                    <UploadCloud size={16} /> Add paper
                  </button>
                  <button className="secondary-button" onClick={() => void runSmokeTest()} disabled={smokeBusy}>
                    <FlaskConical size={16} /> Smoke test
                  </button>
                  <button className="secondary-button" onClick={askForSuggestions} disabled={busy}>
                    <BrainCircuit size={16} /> AI suggestions
                  </button>
                  <button className="secondary-button" onClick={() => openFeedback()}>
                    <MessageSquare size={16} /> Share feedback
                  </button>
                </div>
              </section>
              <section className="recent-activity-card glass-chrome">
                <span className="eyebrow">Recent activity</span>
                <h2>No papers yet</h2>
                <p>Once you upload a paper, recent processing, attempts, and marking updates will collect here.</p>
              </section>
            </div>
          </div>
        ) : null}

        {showLegacyDashboard && appMode === "catalogue" ? (
        <SectionFrame title="Paper Catalogue" subtitle="Grouped by subject and ordered by identified year. Open a paper for its dedicated dashboard.">
          <div className="subject-catalogue">
            {subjectPaperGroups(data.papers).map((group) => (
              <section className="subject-catalogue__row" key={group.subject}>
                <div className="subject-catalogue__header">
                  <span className="eyebrow">{group.subject}</span>
                  <strong>{group.papers.length} paper{group.papers.length === 1 ? "" : "s"}</strong>
                </div>
                <div className="paper-catalogue-strip">
                  {group.papers.map((paper) => {
                    const attempts = attemptsForPaper(data, paper.id);
                    const tone = paperStatusTone(paper, attempts);
                    const progress = paperProgressPercent(data, paper);
                    return (
              <article key={paper.id} className={paper.id === selectedPaperId ? "paper-card paper-card--active" : "paper-card"}>
                <button
                  className="paper-card__main"
                  onClick={() => {
                    setSelectedPaperId(paper.id);
                    setSelectedAttemptId(null);
                  }}
                >
                  <div className="paper-card__chips">
                    <span className="static-chip">{paper.subject}</span>
                    {paper.year ? <span className="static-chip">{paper.year}</span> : null}
                    {paper.series ? <span className="static-chip">{paper.series}</span> : null}
                    <span className={`status-chip status-chip--${tone}`}>{statusLabel(tone)}</span>
                  </div>
                  <strong>{paper.title}</strong>
                  <span>{displayMeta(paper)}</span>
                  <div className="paper-card__progress" aria-label={`Paper progress ${progress}%`}>
                    <span style={{ width: `${progress}%` }} />
                  </div>
                </button>
                <div className="paper-card__metrics">
                  <span>{paperHasResolvedMetadata(paper) ? `${paper.questions.length} questions` : "Metadata pending"}</span>
                  <span>{paperHasResolvedMetadata(paper) ? `${paper.totalMarks ?? "-"} marks` : "Ready to process"}</span>
                  <span>{paperHasResolvedMetadata(paper) ? (paper.durationMinutes ? `${paper.durationMinutes} min` : "-") : "Questions, marks and timing pending"}</span>
                  <span>{attempts.length} attempts</span>
                  <span>{paper.hasMarkScheme ? "Mark scheme" : "No mark scheme"}</span>
                  <span>Best {paperBestScoreLabel(data, paper)}</span>
                </div>
                {paper.processingStatus === "processing" ? <ProcessingPanel paper={paper} job={latestJob(paper, "processing")} variant="compact" /> : null}
                <div className="paper-card__actions">
                  <button
                    className={paper.processingStatus === "ready" ? "primary-button paper-card__primary-action" : "secondary-button paper-card__primary-action"}
                    onClick={() => (paper.processingStatus === "ready" ? beginAttempt(paper) : void runProcessing(paper))}
                    disabled={paper.processingStatus === "processing"}
                  >
                    {paper.processingStatus === "ready" ? <Play size={16} /> : <ScanLine size={16} />}
                    {paperPrimaryActionLabel(paper, attempts)}
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Open paper"
                    onClick={() => {
                      setSelectedPaperId(paper.id);
                      setSelectedAttemptId(null);
                    }}
                  >
                    <Eye size={16} />
                  </button>
                  <button className="icon-button" aria-label="Delete paper" onClick={() => deletePaper(paper.id)}>
                    <Trash2 size={16} />
                  </button>
                </div>
              </article>
                    );
                  })}
                </div>
              </section>
            ))}
            {!data.papers.length ? <p className="muted-copy">Upload a PDF or image past paper to begin.</p> : null}
          </div>
        </SectionFrame>
        ) : null}

        {selectedPaper && appMode === "processing" ? (
          <div className="mode-panel mode-panel--processing">
            <ProcessingPanel paper={selectedPaper} job={latestJob(selectedPaper, "processing")} />
            <div className="button-row mode-panel__actions">
              <button
                className="secondary-button"
                onClick={() => {
                  setSelectedPaperId(null);
                  setSelectedAttemptId(null);
                }}
              >
                <ChevronLeft size={16} /> Dashboard
              </button>
              <button className="secondary-button danger-button" onClick={() => cancelProcessing(selectedPaper)} disabled={selectedPaper.processingStatus !== "processing"}>
                <X size={16} /> Cancel processing
              </button>
              <button className="secondary-button" onClick={() => void runProcessing(selectedPaper)} disabled={selectedPaper.processingStatus === "processing"}>
                <RotateCcw size={16} /> Retry
              </button>
            </div>
          </div>
        ) : null}

        {selectedPaper && appMode !== "processing" ? (
          <div className={appMode === "taking" ? "workspace-grid workspace-grid--taking" : appMode === "review" ? "workspace-grid workspace-grid--review" : "workspace-grid workspace-grid--split"}>
            <SectionFrame
              title={selectedPaper.title}
              subtitle={
                paperHasResolvedMetadata(selectedPaper)
                  ? `${displayMeta(selectedPaper)} / ${selectedPaper.totalMarks ?? "-"} marks / ${selectedPaper.durationMinutes ? `${selectedPaper.durationMinutes} min` : "-"}`
                  : `${displayMeta(selectedPaper)} / Metadata pending / ${statusLabel(selectedPaper.processingStatus)}`
              }
              actions={
                <>
                  <button
                    className="secondary-button"
                    onClick={() => {
                      setSelectedPaperId(null);
                      setSelectedAttemptId(null);
                    }}
                  >
                    <ChevronLeft size={16} /> Dashboard
                  </button>
                  <button className="secondary-button" onClick={() => setEditingMetadata(true)}>
                    <Edit3 size={16} /> Edit metadata
                  </button>
                  <button className="secondary-button" onClick={() => void runProcessing(selectedPaper)} disabled={selectedPaper.processingStatus === "processing"}>
                    <ScanLine size={16} /> Process
                  </button>
                  <button className="primary-button" onClick={() => beginAttempt(selectedPaper)} disabled={selectedPaper.processingStatus !== "ready"}>
                    <Maximize2 size={16} /> {startAttemptLabel(selectedPaper)}
                  </button>
                  <button className="secondary-button danger-button" onClick={() => deletePaper(selectedPaper.id)}>
                    <Trash2 size={16} /> Delete paper
                  </button>
                </>
              }
            >
              {selectedPaper.processingStatus === "processing" || selectedPaper.processingStatus === "failed" ? <ProcessingPanel paper={selectedPaper} job={latestJob(selectedPaper, "processing")} /> : null}

              {!paperHasResolvedMetadata(selectedPaper) ? (
                <div className="unsupported-dashboard-panel">
                  <div className="unsupported-dashboard-panel__grid">
                    <div className="feature-card">
                      <span className="eyebrow">Metadata pending</span>
                      <strong>Ready to process</strong>
                      <p>Process the paper to extract questions, marks and timing before starting an attempt.</p>
                    </div>
                    <div className="feature-card">
                      <span className="eyebrow">Status</span>
                      <strong>{selectedPaper.hasMarkScheme ? "Question paper and mark scheme attached" : "Question paper attached"}</strong>
                      <p>{selectedPaper.hasMarkScheme ? "Marking will be available after extraction completes." : "Attach a mark scheme to unlock AI marking after extraction."}</p>
                    </div>
                  </div>
                </div>
              ) : null}

              {preferences.showPaperSummary ? (
              <div className="paper-summary-grid">
                <div className="paper-summary-tile">
                  <span>Questions</span>
                  <strong>{selectedPaper.questions.length || "-"}</strong>
                </div>
                <div className="paper-summary-tile">
                  <span>Total marks</span>
                  <strong>{selectedPaper.totalMarks ?? "-"}</strong>
                </div>
                <div className="paper-summary-tile">
                  <span>Duration</span>
                  <strong>{selectedPaper.durationMinutes ? `${selectedPaper.durationMinutes}m` : "-"}</strong>
                </div>
                <div className="paper-summary-tile">
                  <span>Attempts</span>
                  <strong>{paperAttempts.length}</strong>
                </div>
                <div className="paper-summary-tile">
                  <span>Best</span>
                  <strong>{paperBestScoreLabel(data, selectedPaper)}</strong>
                </div>
                <div className="paper-summary-tile paper-summary-tile--warning">
                  <span>Unsupported</span>
                  <strong>{unsupportedMarksForPaper(selectedPaper) || 0}</strong>
                </div>
              </div>
              ) : null}

              {!selectedAttempt ? (
                <div className="question-disclosure">
                  <button className="question-disclosure__toggle" onClick={() => setQuestionsExpanded((value) => !value)} aria-expanded={questionsExpanded}>
                    <span>{questionsExpanded ? "Hide questions" : "Show questions"}</span>
                    <small>{selectedPaper.questions.length} extracted</small>
                    <ChevronDown size={16} className={questionsExpanded ? "question-disclosure__icon question-disclosure__icon--open" : "question-disclosure__icon"} />
                  </button>
                  {preferences.showQuestionLegend ? (
                  <div className="question-legend" aria-label="Question state legend">
                    <span><i className="legend-dot legend-dot--blank" /> Blank</span>
                    <span><i className="legend-dot legend-dot--answered" /> Answered</span>
                    <span><i className="legend-dot legend-dot--marked" /> Marked</span>
                    <span><i className="legend-dot legend-dot--unsupported" /> Unsupported</span>
                  </div>
                  ) : null}
                  <AnimatePresence initial={false}>
                    {questionsExpanded ? (
                      <motion.div className="paper-question-overview" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
                        {reviewQuestionGroups(selectedPaper).map(({ group, questions }) => (
                          <div className="review-question-row" key={group}>
                            <span className="review-question-row__label">Q{group}</span>
                            <div className="review-question-row__items">
                              {questions.map(({ question, label }) => (
                                <div className="review-question-nav__button question-overview-tile" key={question.id} title={cleanVisiblePrompt(question.promptText)}>
                                  <span>{label}</span>
                                  <small>{marksLabel(question.maxMarks)}</small>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                  {!selectedPaper.questions.length ? <p className="muted-copy">No structured questions yet. Process the paper to extract them.</p> : null}
                </div>
              ) : null}

              {selectedAttempt && selectedAttempt.status === "in_progress" && activeQuestion && activeAnswer ? (
                <div className="paper-taking-stage">
                  <div className="paper-timer-strip">
                    <span>
                      <ListChecks size={16} /> {activeQuestionIndex + 1}/{selectedPaper.questions.length}
                    </span>
                    <span>{marksLabel(activeQuestion.maxMarks)}</span>
                    <span className={overtimeSeconds ? "paper-timer-strip__overtime" : ""}>
                      <Clock3 size={16} /> {durationLimit && preferences.timerBehaviour === "count_down" ? formatClock(secondsRemaining) : formatClock(elapsedSeconds)}
                    </span>
                  </div>
                  {preferences.showFocusProgress ? (
                  <div className="focus-progress-card">
                    <div className="focus-progress-card__bar" aria-label={`Attempt progress ${focusProgressPercent}%`}>
                      <span style={{ width: `${focusProgressPercent}%` }} />
                    </div>
                    <div className="focus-progress-card__stats">
                      <span>{answeredDuringAttempt} answered</span>
                      <span>{skippedDuringAttempt} skipped</span>
                      <span>{Math.max(0, selectedPaper.questions.length - answeredDuringAttempt - skippedDuringAttempt)} left</span>
                    </div>
                    <div className="focus-question-map" aria-label="Question progress map">
                      {selectedPaper.questions.map((question, index) => {
                        const answer = selectedAttempt.answers.find((item) => item.questionId === question.id);
                        const state = answer?.skipped ? "skipped" : answer && isAnswerAttempted(answer) ? "answered" : "blank";
                        return (
                          <button
                            key={question.id}
                            className={`focus-question-dot focus-question-dot--${state}${index === activeQuestionIndex ? " focus-question-dot--active" : ""}`}
                            aria-label={`Go to question ${displayQuestionLabel(selectedPaper, question)}`}
                            onClick={() => setActiveQuestionIndex(index)}
                          />
                        );
                      })}
                    </div>
                  </div>
                  ) : null}
                  <article className="question-card question-card--focused">
                    <div className="question-card__header">
                      <strong>Question {displayQuestionLabel(selectedPaper, activeQuestion)}</strong>
                      <span>{marksLabel(activeQuestion.maxMarks)}</span>
                    </div>
                    <div className="chip-wrap">
                      <span className="static-chip">{sourcePagesLabel(activeQuestion)}</span>
                      {activeQuestion.extractionWarnings?.length ? <span className="static-chip">Has extraction warnings</span> : null}
                    </div>
                    <QuestionSourceImages paper={selectedPaper} question={activeQuestion} defaultCollapsed={preferences.sourceFigures === "collapse"} />
                    <p className="question-prompt">{cleanVisiblePrompt(activeQuestion.promptText)}</p>
                    <div className={activeAnswer.skipped ? "answer-workspace answer-workspace--skipped" : "answer-workspace"}>
                      {activeSupportIssue ? (
                        <UnsupportedQuestionPanel issue={activeSupportIssue} marks={activeQuestion.maxMarks} onReport={() => reportUnsupportedQuestion(activeQuestion)} />
                      ) : (
                        <AnswerInput question={activeQuestion} answer={activeAnswer} onChange={(patch) => updateAnswer(activeQuestion.id, patch)} />
                      )}
                      {!activeSupportIssue && activeAnswer.skipped ? (
                        <div className="skipped-answer-state">
                          <div className="skipped-answer-state__icon">
                            <Check size={22} />
                          </div>
                          <div>
                            <span className="eyebrow">{activeAnswer.skippedWithConfidence ? "Skipped with confidence" : "Skipped"}</span>
                            <strong>
                              {activeAnswer.skippedWithConfidence
                                ? `You predicted ${activeAnswer.confidencePredictedMarks ?? 0}/${activeQuestion.maxMarks} ${activeQuestion.maxMarks === 1 ? "mark" : "marks"}`
                                : "This question is skipped"}
                            </strong>
                            <p>The answer field is locked while this question is skipped.</p>
                          </div>
                          <button className="secondary-button" onClick={unskipQuestion}>
                            <Edit3 size={16} /> Do question
                          </button>
                        </div>
                      ) : !activeSupportIssue && preferences.showConfidenceSkip ? (
                        <div className="paper-confidence-row">
                          <span>Not answering this one?</span>
                          <button className="secondary-button" onClick={openConfidenceSkip}>
                            <SkipForward size={16} /> Skip with confidence
                          </button>
                        </div>
                      ) : null}
                    </div>
                    <div className="button-row">
                      <button className="secondary-button" onClick={() => setActiveQuestionIndex((value) => Math.max(0, value - 1))} disabled={activeQuestionIndex === 0}>
                        <ChevronLeft size={16} /> Previous
                      </button>
                      <button className="secondary-button" onClick={() => skipQuestion(false)}>
                        <SkipForward size={16} /> Skip
                      </button>
                      <button
                        className="primary-button"
                        onClick={() => (activeQuestionIndex >= selectedPaper.questions.length - 1 ? submitAttempt() : activeSupportIssue ? setActiveQuestionIndex((value) => Math.min(selectedPaper.questions.length - 1, value + 1)) : submitCurrentAnswer(true))}
                      >
                        {activeQuestionIndex >= selectedPaper.questions.length - 1 ? <Check size={16} /> : <Save size={16} />}
                        {activeQuestionIndex >= selectedPaper.questions.length - 1 ? "Submit paper" : activeSupportIssue ? "Next" : "Save & Next"}
                      </button>
                      <button className="secondary-button" onClick={() => setActiveQuestionIndex((value) => Math.min(selectedPaper.questions.length - 1, value + 1))}>
                        Next <ChevronRight size={16} />
                      </button>
                    </div>
                  </article>
                </div>
              ) : null}

              {selectedAttempt && selectedAttempt.status === "submitted" ? (
                <div className="submitted-summary">
                  <div className="summary-strip">
                    <span>Answered {selectedAttempt.answers.filter(isAnswerAttempted).length}</span>
                    <span>Skipped {selectedAttempt.answers.filter((answer) => answer.skipped).length}</span>
                    <span>Unanswered {selectedAttempt.answers.filter((answer) => !answer.skipped && !isAnswerAttempted(answer)).length}</span>
                    <span>Confidence {scoreSummary(displayScores?.confidenceAdjustedScore ?? selectedAttempt.confidenceAdjustedScore, preferredAttemptTotal(selectedPaper, selectedAttempt))}</span>
                    {unsupportedMarksForPaper(selectedPaper) ? <span className="summary-strip__warning">Unsupported -{unsupportedMarksForPaper(selectedPaper)} marks</span> : null}
                  </div>
                  <div className="button-row">
                    {selectedPaper.hasMarkScheme ? (
                      <button className="primary-button" onClick={() => void markAttempt()} disabled={busy}>
                        <BrainCircuit size={16} /> AI mark answered
                      </button>
                    ) : (
                      <div className="processing-error">
                        <p>No aligned mark scheme. AI marking is disabled because marks will not be fabricated.</p>
                      </div>
                    )}
                    <button className="secondary-button" onClick={() => downloadDiagnosticBundle(selectedPaper, data.attempts)}>
                      <Download size={16} /> Export diagnostics
                    </button>
                  </div>
                </div>
              ) : null}

              {selectedAttempt && selectedAttempt.status === "marked" && reviewQuestion && reviewAnswer ? (
                <div className="marked-review-stage">
                  <div className="review-focus-header">
                    <div>
                      <span className="eyebrow">Marked review</span>
                      <h2>Review</h2>
                      <p>
                        {scoreSummary(displayScores?.actualScore ?? selectedAttempt.actualScore, preferredAttemptTotal(selectedPaper, selectedAttempt))} actual
                        {displayScores && displayScores.confidenceAdjustedScore !== displayScores.actualScore ? ` / ${scoreSummary(displayScores.confidenceAdjustedScore, preferredAttemptTotal(selectedPaper, selectedAttempt))} confidence` : ""}
                      </p>
                      {unsupportedMarksForPaper(selectedPaper) ? <p className="unsupported-total-note">{unsupportedMarksForPaper(selectedPaper)} marks deducted for unsupported questions.</p> : null}
                    </div>
                    <div className="button-row">
                      <button className="secondary-button" onClick={() => setSelectedAttemptId(null)}>
                        <ChevronLeft size={16} /> Back to paper
                      </button>
                      <button className="secondary-button" onClick={() => setReviewIndex((value) => Math.max(0, value - 1))} disabled={reviewIndex === 0}>
                        <ChevronLeft size={16} /> Previous
                      </button>
                      <button className="secondary-button" onClick={() => setReviewIndex((value) => Math.min(selectedPaper.questions.length - 1, value + 1))} disabled={reviewIndex >= selectedPaper.questions.length - 1}>
                        Next <ChevronRight size={16} />
                      </button>
                    </div>
                  </div>

                  {activeAttemptStats ? (
                    <div className="review-summary-grid">
                      <div className="review-summary-card">
                        <span>Actual score</span>
                        <strong>{scoreSummary(displayScores?.actualScore ?? selectedAttempt.actualScore, preferredAttemptTotal(selectedPaper, selectedAttempt))}</strong>
                      </div>
                      <div className="review-summary-card">
                        <span>Answered</span>
                        <strong>{activeAttemptStats.answered}</strong>
                      </div>
                      <div className="review-summary-card">
                        <span>Blank</span>
                        <strong>{activeAttemptStats.blank}</strong>
                      </div>
                      <div className="review-summary-card">
                        <span>Unsupported</span>
                        <strong>{activeAttemptStats.unsupported}</strong>
                      </div>
                      <div className="review-summary-card">
                        <span>Mistakes</span>
                        <strong>{activeAttemptStats.mistakes}</strong>
                      </div>
                    </div>
                  ) : null}
                  <div className="button-row review-smart-actions">
                    <button
                      className="secondary-button"
                      onClick={() => {
                        const nextMistake = selectedPaper.questions.findIndex((question) => {
                          const mark = latestAcceptedMark(selectedAttempt, question.id);
                          return mark && !isMarkingErrorMark(mark) && mark.awardedMarks < question.maxMarks;
                        });
                        if (nextMistake >= 0) setReviewIndex(nextMistake);
                      }}
                      disabled={!activeAttemptStats?.mistakes}
                    >
                      <Target size={16} /> Review next mistake
                    </button>
                    <button
                      className="secondary-button"
                      onClick={() => {
                        const nextBlank = selectedPaper.questions.findIndex((question) => {
                          const answer = selectedAttempt.answers.find((item) => item.questionId === question.id);
                          return !answer || (!answer.skipped && !isAnswerAttempted(answer));
                        });
                        if (nextBlank >= 0) setReviewIndex(nextBlank);
                      }}
                      disabled={!activeAttemptStats?.blank}
                    >
                      <ListChecks size={16} /> Next blank
                    </button>
                  </div>

                  <div className="review-question-nav" aria-label="Review question navigation">
                    {reviewQuestionGroups(selectedPaper).map(({ group, questions }) => (
                      <div className="review-question-row" key={group}>
                        <span className="review-question-row__label">Q{group}</span>
                        <div className="review-question-row__items">
                          {questions.map(({ question, index, label }) => {
                            const mark = latestAcceptedMark(selectedAttempt, question.id);
                            const answer = selectedAttempt.answers.find((item) => item.questionId === question.id);
                            const supportIssue = questionSupportIssue(question);
                            const attempted = Boolean(answer && isAnswerAttempted(answer));
                            const predicted = answer?.skippedWithConfidence ? answer.confidencePredictedMarks ?? 0 : null;
                            const markingError = isMarkingErrorMark(mark);
                            const buttonClass = [
                              "review-question-nav__button",
                              index === reviewIndex ? "review-question-nav__button--active" : "",
                              mark || predicted !== null ? "review-question-nav__button--marked" : "",
                              supportIssue ? "review-question-nav__button--unsupported" : "",
                              markingError ? "review-question-nav__button--error" : "",
                              !attempted && predicted === null ? "review-question-nav__button--unanswered" : "",
                            ]
                              .filter(Boolean)
                              .join(" ");
                            return (
                              <button key={question.id} className={buttonClass} onClick={() => setReviewIndex(index)} aria-label={`Review question ${label}`}>
                                <span>{label}</span>
                                <small style={mark ? scoreStyle(mark, question.maxMarks) : predictedScoreStyle(answer, question.maxMarks)}>
                                  {supportIssue ? `-${question.maxMarks}` : markingError ? "Error" : mark ? `${mark.awardedMarks}/${question.maxMarks}` : predicted !== null ? `Pred ${predicted}/${question.maxMarks}` : attempted ? "Unmarked" : "Blank"}
                                </small>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>

                  <article className="paper-review-card paper-review-card--focus">
                    <div className="question-card__header">
                      <strong>Question {displayQuestionLabel(selectedPaper, reviewQuestion)}</strong>
                      <span>{marksLabel(reviewQuestion.maxMarks)}</span>
                    </div>
                    <p className="question-prompt">{cleanVisiblePrompt(reviewQuestion.promptText)}</p>
                    <QuestionSourceImages paper={selectedPaper} question={reviewQuestion} defaultCollapsed={preferences.sourceFigures === "collapse"} />
                    <div className="paper-answer-box">
                      <span className="eyebrow">Your answer</span>
                      <p>{answerText(reviewAnswer, reviewQuestion)}</p>
                    </div>
                    <div className="paper-mark-box">
                      <div>
                        <span className="eyebrow">Marks</span>
                        <strong style={reviewMark ? scoreStyle(reviewMark, reviewQuestion.maxMarks) : predictedScoreStyle(reviewAnswer, reviewQuestion.maxMarks)}>
                          {reviewSupportIssue
                            ? "Deducted"
                            : reviewMark && isMarkingErrorMark(reviewMark)
                            ? "Error"
                            : reviewMark
                            ? `${reviewMark.awardedMarks}/${reviewQuestion.maxMarks}`
                            : reviewAnswer.skippedWithConfidence
                              ? `${reviewAnswer.confidencePredictedMarks ?? 0}/${reviewQuestion.maxMarks} predicted`
                              : "Unmarked"}
                        </strong>
                      </div>
                      <p>
                        {reviewSupportIssue
                          ? `Unsupported question format. ${marksLabel(reviewQuestion.maxMarks)} deducted from the attempt total.`
                          : reviewMark && isMarkingErrorMark(reviewMark)
                          ? reviewMark.rationale
                          : reviewMark?.rationale ??
                            (reviewAnswer.skippedWithConfidence
                            ? "Skipped with confidence. This predicted score is included in the confidence-adjusted total, not the actual mark."
                            : selectedPaper.hasMarkScheme
                              ? "Not marked yet."
                              : "No mark scheme attached, so marks are not fabricated.")}
                      </p>
                      {reviewMark?.missingPoints.length ? (
                        <div className="chip-wrap">
                          {reviewMark.missingPoints.map((point) => (
                            <span className="static-chip" key={point}>
                              {point}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      {reviewMark?.markSchemeEvidence ? <p className="muted-copy">{reviewMark.markSchemeEvidence}</p> : null}
                    </div>
                    <div className="button-row">
                      <button className="secondary-button" onClick={() => void requestRemark(reviewAnswer)} disabled={!reviewMark || busy}>
                        <RotateCcw size={16} /> Remark
                      </button>
                      <button className="secondary-button" onClick={() => downloadDiagnosticBundle(selectedPaper, data.attempts)}>
                        <Download size={16} /> Export diagnostics
                      </button>
                      {reviewQuestion.markSchemeData ? (
                        <button className="secondary-button" onClick={() => setMarkSchemeDetailsOpen((value) => !value)}>
                          <ListChecks size={16} /> {markSchemeDetailsOpen ? "Hide mark scheme row" : "Show mark scheme row"}
                        </button>
                      ) : null}
                    </div>
                    {markSchemeDetailsOpen ? <MarkSchemeDataPanel question={reviewQuestion} onCopy={() => void copyMarkSchemeRow(reviewQuestion)} /> : null}
                    {selectedAttempt.remarks.filter((remark) => remark.questionId === reviewQuestion.id).length ? (
                      <div className="paper-history-list">
                        {selectedAttempt.remarks
                          .filter((remark) => remark.questionId === reviewQuestion.id)
                          .map((remark) => {
                            const proposed = selectedAttempt.marks.find((mark) => mark.id === remark.proposedMarkId);
                            return (
                              <div className="remark-card" key={remark.id}>
                                <div>
                                  <strong>Remark {statusLabel(remark.status)}</strong>
                                  <p>{proposed ? `Proposed ${proposed.awardedMarks}/${reviewQuestion.maxMarks}` : remark.notes ?? "Pending"}</p>
                                </div>
                                {proposed && !remark.acceptedAt ? (
                                  <button className="chip-button" onClick={() => acceptRemark(remark.id)}>
                                    Accept
                                  </button>
                                ) : null}
                              </div>
                            );
                          })}
                      </div>
                    ) : null}
                  </article>
                </div>
              ) : null}
            </SectionFrame>

            {appMode !== "taking" && appMode !== "marking" && appMode !== "review" ? (
            <SectionFrame
              title="Attempts"
              subtitle={selectedAttempt && displayScores ? `${scoreSummary(displayScores.actualScore, preferredAttemptTotal(selectedPaper, selectedAttempt))} actual / ${scoreSummary(displayScores.confidenceAdjustedScore, preferredAttemptTotal(selectedPaper, selectedAttempt))} confidence-adjusted` : "Attempts and marking history appear here."}
              actions={null}
            >
              <div className="attempt-list">
                {data.attempts
                  .filter((attempt) => attempt.paperId === selectedPaper.id)
                  .map((attempt) => (
                    <div key={attempt.id} className={attempt.id === selectedAttemptId ? "attempt-row attempt-row--active" : "attempt-row"}>
                      <button className="attempt-row__select" onClick={() => setSelectedAttemptId(attempt.id)}>
                        <div>
                          <strong>{new Date(attempt.startedAt).toLocaleString()}</strong>
                      <span>{statusLabel(attempt.status)}</span>
                        </div>
                        <span>{formatPercent(displayAttemptScores(selectedPaper, attempt).actualScore, preferredAttemptTotal(selectedPaper, attempt))}</span>
                      </button>
                      <button className="icon-button danger-button" aria-label="Delete attempt" onClick={() => deleteAttempt(attempt.id)}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
              </div>
              {!paperAttempts.length ? (
                <div className="polished-empty-card">
                  <Target size={20} />
                  <strong>No attempts yet</strong>
                  <p>Start the paper to generate review data, confidence scores, and marking history.</p>
                  <button className="primary-button" onClick={() => beginAttempt(selectedPaper)} disabled={selectedPaper.processingStatus !== "ready"}>
                    <Play size={16} /> Start first attempt
                  </button>
                </div>
              ) : null}
            </SectionFrame>
            ) : null}
          </div>
        ) : null}
      </main>

      {preferences.devModeEnabled && !settingsOpen && (appMode === "catalogue" || appMode === "ready" || appMode === "empty") ? (
        <aside className="shell-inspector shell-inspector--dev">
          <DashboardStatusPanels aiModel={aiModel} setAIModel={setAIModel} smokeTest={smokeTest} analytics={analytics} onClearLocalData={clearLocalDashboardData} preferences={preferences} />
        </aside>
      ) : null}

      <UploadModal open={uploadOpen} pending={busy} initialSubject={activeSubject ?? undefined} onClose={() => setUploadOpen(false)} onSubmit={handleUpload} />
      <MetadataModal open={editingMetadata && Boolean(selectedPaper)} draft={metadataDraft} onChange={setMetadataDraft} onClose={() => setEditingMetadata(false)} onSave={saveMetadata} />
      <FeedbackModal
        open={feedbackOpen}
        draft={feedbackDraft}
        attachments={feedbackAttachments}
        errors={feedbackErrors}
        pending={feedbackSubmitting}
        submitEnabled={feedbackCanSubmit}
        serverError={feedbackError}
        onChange={patchFeedbackDraft}
        onBlur={touchFeedbackField}
        onAddFiles={(files) => void addFeedbackFiles(files)}
        onRemoveAttachment={removeFeedbackAttachment}
        onClose={closeFeedback}
        onSubmit={() => void submitFeedbackForm()}
      />
      <DashboardStatusModal
        open={systemInfoOpen}
        aiModel={aiModel}
        setAIModel={setAIModel}
        smokeTest={smokeTest}
        analytics={analytics}
        onClearLocalData={clearLocalDashboardData}
        preferences={preferences}
        onClose={() => setSystemInfoOpen(false)}
      />
      <SettingsModal
        open={settingsOpen}
        preferences={preferences}
        selectedSubjects={selectedSubjects}
        data={data}
        aiModel={aiModel}
        setAIModel={setAIModel}
        smokeTest={smokeTest}
        smokeBusy={smokeBusy}
        onChange={(patch) => {
          patchPreferences(patch);
          if (patch.sidebarDefault) setSidebarCollapsed(patch.sidebarDefault === "collapsed");
        }}
        onReset={resetPreferences}
        onEditSubjects={openSubjectOnboarding}
        onOpenFeedback={openFeedback}
        onOpenVersion={() => setVersionHistoryOpen(true)}
        onOpenCredits={() => setCreditsOpen(true)}
        onRunSmokeTest={() => void runSmokeTest()}
        onExportData={exportAllData}
        onImportData={importBackup}
        onClearLocalData={clearLocalDashboardData}
        onClose={() => setSettingsOpen(false)}
      />
      <VersionHistoryModal open={versionHistoryOpen} onClose={() => setVersionHistoryOpen(false)} />
      <CreditsModal open={creditsOpen} onClose={() => setCreditsOpen(false)} />
      <ConfidenceSkipModal
        open={confidenceSkipOpen}
        question={activeQuestion}
        value={confidenceDraft}
        onChange={setConfidenceDraft}
        onClose={() => setConfidenceSkipOpen(false)}
        onConfirm={confirmConfidenceSkip}
      />
      {showFeedbackButton ? (
        <button className="feedback-fab" type="button" aria-label="Send feedback" onClick={() => openFeedback()}>
          <MessageSquare size={20} />
        </button>
      ) : null}
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
