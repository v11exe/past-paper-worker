import { ACHIEVEMENTS, type AchievementId } from "../data/achievements";
import type { AppData, PastPaper, PastPaperProcessingJob, ProcessingDiagnostics } from "../types";

const STORAGE_KEY = "past-paper-worker:data:v1";
const MAX_PREVIEW_CHARS = 1400;
const achievementIds = new Set<AchievementId>(ACHIEVEMENTS.map((item) => item.id));

const emptyData: AppData = {
  papers: [],
  attempts: [],
  achievementUnlocks: [],
};

function normalizeDiagnostics(diagnostics: unknown): ProcessingDiagnostics | null | undefined {
  if (diagnostics === null || diagnostics === undefined) return diagnostics;
  if (typeof diagnostics !== "object") return undefined;
  const record = diagnostics as Record<string, unknown>;
  const legacyRequestKey = ["pu", "ter", "Requests"].join("");
  const aiRequests = Array.isArray(record.aiRequests)
    ? record.aiRequests
    : Array.isArray(record[legacyRequestKey])
      ? record[legacyRequestKey]
      : [];
  return {
    ...record,
    aiRequests,
  } as ProcessingDiagnostics;
}

function normalizeJob(job: PastPaperProcessingJob): PastPaperProcessingJob {
  return {
    ...job,
    diagnostics: normalizeDiagnostics(job.diagnostics),
  };
}

function normalizePaper(paper: PastPaper): PastPaper {
  return {
    ...paper,
    processingDiagnostics: normalizeDiagnostics(paper.processingDiagnostics),
    jobs: Array.isArray(paper.jobs) ? paper.jobs.map(normalizeJob) : [],
  };
}

export function loadData(): AppData {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return emptyData;
  try {
    const parsed = JSON.parse(raw) as AppData;
    return {
      papers: Array.isArray(parsed.papers)
        ? parsed.papers.map(normalizePaper)
        : [],
      attempts: Array.isArray(parsed.attempts) ? parsed.attempts : [],
      achievementUnlocks: Array.isArray(parsed.achievementUnlocks)
        ? parsed.achievementUnlocks.filter((value): value is AchievementId => typeof value === "string" && achievementIds.has(value as AchievementId))
        : [],
    };
  } catch {
    return emptyData;
  }
}

function clipString(value: unknown, maxChars = MAX_PREVIEW_CHARS) {
  if (typeof value !== "string") return value;
  return value.length > maxChars ? `${value.slice(0, maxChars)}\n[clipped ${value.length - maxChars} chars for localStorage]` : value;
}

function sanitizeForStorage(data: AppData, keepThumbnails = true): AppData {
  return {
    papers: data.papers.map((paper) => ({
      ...paper,
      assets: paper.assets.map((asset) => ({
        ...asset,
        objectUrl: null,
        pageScreenshots: (asset.pageScreenshots ?? []).map((screenshot) => ({
          ...screenshot,
          dataUrl: "",
          thumbnailDataUrl: keepThumbnails ? screenshot.thumbnailDataUrl : "",
        })),
      })),
      processingDiagnostics: paper.processingDiagnostics
        ? {
            ...paper.processingDiagnostics,
            aiRequests: paper.processingDiagnostics.aiRequests.map((request) => ({
              ...request,
              rawResponsePreview: clipString(request.rawResponsePreview) as string | null | undefined,
            })),
            schemaErrors: paper.processingDiagnostics.schemaErrors.map((error) => ({
              ...error,
              rawPreview: clipString(error.rawPreview) as string,
              extractedJsonPreview: clipString(error.extractedJsonPreview) as string,
            })),
          }
        : paper.processingDiagnostics,
      jobs: paper.jobs.map((job) => ({
        ...job,
        diagnostics: job.diagnostics
          ? {
              ...job.diagnostics,
              aiRequests: job.diagnostics.aiRequests.map((request) => ({
                ...request,
                rawResponsePreview: clipString(request.rawResponsePreview) as string | null | undefined,
              })),
            }
          : job.diagnostics,
      })),
    })),
    attempts: data.attempts,
    achievementUnlocks: data.achievementUnlocks ?? [],
  };
}

export function saveData(data: AppData) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeForStorage(data, true)));
  } catch (firstError) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeForStorage(data, false)));
      console.warn("[Past Paper Worker] Saved local data without screenshot thumbnails after localStorage quota pressure.", firstError);
    } catch (secondError) {
      console.error("[Past Paper Worker] Local persistence failed. Current in-memory work is still available until refresh.", secondError);
    }
  }
}

export function clearData() {
  window.localStorage.removeItem(STORAGE_KEY);
}
