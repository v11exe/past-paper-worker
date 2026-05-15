export const supportedSubjects = [
  "AQA GCSE Biology",
  "AQA GCSE Chemistry",
  "AQA GCSE Physics",
  "OCR GCSE Computer Science J277",
] as const;

export type SupportedSubject = (typeof supportedSubjects)[number];

export const unsupportedSubjects = [
  "Pearson Edexcel GCSE Mathematics",
  "Pearson Edexcel Level 2 Extended Mathematics Certificate",
  "OCR GCSE Geography A",
  "OCR Cambridge Nationals Creative iMedia J834",
  "AQA GCSE English Literature",
  "AQA GCSE English Language",
  "History",
  "Religious Studies",
  "Combined Science",
  "Business Studies",
  "Psychology",
  "Sociology",
  "Film Studies",
  "Economics",
  "Food and Nutrition",
  "Citizenship Studies",
  "Design and Technology",
  "Physical Education",
  "A-Level subjects",
] as const;

export type UnsupportedSubject = (typeof unsupportedSubjects)[number];

export const selectableSubjects = [...supportedSubjects, ...unsupportedSubjects] as const;

export type SelectableSubject = (typeof selectableSubjects)[number];
