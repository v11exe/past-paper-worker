import type { SupportedSubject } from "../subjects";

export type PaperRegistryEntry = {
  subject: SupportedSubject;
  year: number;
  series: "May/June" | "Oct/Nov" | "Jan";
  paperNumber: 1 | 2 | 3;
  component: "Foundation" | "Higher" | "Tier Cross";
};

function buildSeriesRange(
  subject: SupportedSubject,
  years: number[],
  paperNumbers: Array<1 | 2>,
  component: PaperRegistryEntry["component"],
): PaperRegistryEntry[] {
  return years.flatMap((year) =>
    paperNumbers.map((paperNumber) => ({
      subject,
      year,
      series: "May/June" as const,
      paperNumber,
      component,
    })),
  );
}

const recentYears = [2021, 2022, 2023, 2024, 2025];

export const paperRegistry: PaperRegistryEntry[] = [
  ...buildSeriesRange("AQA GCSE Biology", recentYears, [1, 2], "Tier Cross"),
  ...buildSeriesRange("AQA GCSE Chemistry", recentYears, [1, 2], "Tier Cross"),
  ...buildSeriesRange("AQA GCSE Physics", recentYears, [1, 2], "Tier Cross"),
  ...buildSeriesRange("OCR GCSE Computer Science J277", recentYears, [1, 2], "Tier Cross"),
];
