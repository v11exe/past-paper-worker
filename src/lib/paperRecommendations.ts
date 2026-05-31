import type { PaperRegistryEntry } from "../data/paperRegistry";
import type { PastPaper } from "../types";

function recommendationLabel(entry: PaperRegistryEntry) {
  return `${entry.year} ${entry.series} Paper ${entry.paperNumber}`;
}

function normalizeSeries(series: string | null | undefined) {
  if (!series) return null;
  if (/may\s*\/\s*june|june/i.test(series)) return "May/June";
  if (/oct\s*\/\s*nov|nov/i.test(series)) return "Oct/Nov";
  if (/jan/i.test(series)) return "Jan";
  return null;
}

function inferPaperNumber(paper: Pick<PastPaper, "title" | "paperCode">) {
  const titleMatch = /paper\s*([1-3])\b/i.exec(paper.title);
  if (titleMatch) return titleMatch[1];
  const codeMatch = /(?:\/|paper\s*)(0?[1-3])(?:\b|$)/i.exec(paper.paperCode ?? "");
  if (!codeMatch) return null;
  return String(Number(codeMatch[1]));
}

export function pickRecommendedPaper(input: {
  subject: PaperRegistryEntry["subject"];
  registry: PaperRegistryEntry[];
  uploadedOrAttemptedLabels: string[];
  lastAttemptedAtByLabel: Record<string, string>;
}) {
  const sameSubject = input.registry.filter((entry) => entry.subject === input.subject);
  const unseen = sameSubject.filter((entry) => !input.uploadedOrAttemptedLabels.includes(recommendationLabel(entry)));

  if (unseen.length) {
    return unseen[Math.floor(Math.random() * unseen.length)] ?? null;
  }

  return [...sameSubject].sort((left, right) => {
    const leftAttemptedAt = input.lastAttemptedAtByLabel[recommendationLabel(left)] ?? "";
    const rightAttemptedAt = input.lastAttemptedAtByLabel[recommendationLabel(right)] ?? "";
    return leftAttemptedAt.localeCompare(rightAttemptedAt);
  })[0] ?? null;
}

export function formatRecommendedPaperLabel(entry: PaperRegistryEntry) {
  return recommendationLabel(entry);
}

export function formatComparablePaperLabel(paper: Pick<PastPaper, "title" | "paperCode" | "year" | "series">) {
  const paperNumber = inferPaperNumber(paper);
  const series = normalizeSeries(paper.series);
  if (!paper.year || !series || !paperNumber) return null;
  return `${paper.year} ${series} Paper ${paperNumber}`;
}
