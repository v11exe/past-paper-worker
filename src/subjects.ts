export const supportedSubjects = [
  "AQA GCSE Biology",
  "AQA GCSE Chemistry",
  "AQA GCSE Physics",
  "Pearson Edexcel GCSE Mathematics",
  "Pearson Edexcel Level 2 Extended Mathematics Certificate",
  "OCR GCSE Geography A",
  "OCR GCSE Computer Science J277",
  "OCR Cambridge Nationals Creative iMedia J834",
  "AQA GCSE English Literature",
  "AQA GCSE English Language",
] as const;

export type SupportedSubject = (typeof supportedSubjects)[number];
