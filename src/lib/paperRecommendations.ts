import type { PaperRegistryEntry } from "../data/paperRegistry";

function recommendationLabel(entry: PaperRegistryEntry) {
  return `${entry.year} ${entry.series} Paper ${entry.paperNumber}`;
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
