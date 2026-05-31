import type { SupportedSubject } from "../subjects";

export type GradeBoundary = {
  subject: SupportedSubject;
  year: number;
  series: string;
  totalMarks: number;
  boundaries: Record<"9" | "8" | "7" | "6" | "5" | "4" | "3" | "2" | "1", number>;
};

// Source values use the latest published June 2025 AQA and OCR boundary tables.
// AQA sciences publish separate foundation and higher thresholds, so the defaults below
// preserve the higher-tier thresholds for 9-4 and continue the lower range as a rough
// working estimate. Users can override these values in-app when they need a different tier.
export const gradeBoundaries: GradeBoundary[] = [
  {
    subject: "AQA GCSE Biology",
    year: 2025,
    series: "June 2025",
    totalMarks: 200,
    boundaries: { "9": 141, "8": 127, "7": 113, "6": 94, "5": 75, "4": 56, "3": 46, "2": 32, "1": 19 },
  },
  {
    subject: "AQA GCSE Chemistry",
    year: 2025,
    series: "June 2025",
    totalMarks: 200,
    boundaries: { "9": 150, "8": 132, "7": 115, "6": 90, "5": 66, "4": 42, "3": 30, "2": 27, "1": 24 },
  },
  {
    subject: "AQA GCSE Physics",
    year: 2025,
    series: "June 2025",
    totalMarks: 200,
    boundaries: { "9": 152, "8": 139, "7": 126, "6": 107, "5": 88, "4": 70, "3": 61, "2": 43, "1": 24 },
  },
  {
    subject: "OCR GCSE Computer Science J277",
    year: 2025,
    series: "June 2025",
    totalMarks: 160,
    boundaries: { "9": 141, "8": 132, "7": 123, "6": 108, "5": 93, "4": 78, "3": 58, "2": 39, "1": 20 },
  },
];
