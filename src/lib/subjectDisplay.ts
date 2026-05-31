import { subjectMeta } from "../subjectMeta";
import { supportedSubjects, type SupportedSubject } from "../subjects";

export type SubjectNicknames = Record<SupportedSubject, string>;

export const emptySubjectNicknames: SubjectNicknames = {
  "AQA GCSE Biology": "",
  "AQA GCSE Chemistry": "",
  "AQA GCSE Physics": "",
  "OCR GCSE Computer Science J277": "",
};

const subjectDataValues: Record<SupportedSubject, string> = {
  "AQA GCSE Biology": "biology",
  "AQA GCSE Chemistry": "chemistry",
  "AQA GCSE Physics": "physics",
  "OCR GCSE Computer Science J277": "computer-science",
};

export function sanitizeSubjectNicknames(input: unknown): SubjectNicknames {
  const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};

  return supportedSubjects.reduce<SubjectNicknames>((nicknames, subject) => {
    nicknames[subject] = typeof raw[subject] === "string" ? raw[subject].trim().slice(0, 12) : "";
    return nicknames;
  }, { ...emptySubjectNicknames });
}

export function displaySubjectName(subject: SupportedSubject, nicknames: Partial<SubjectNicknames>) {
  return nicknames[subject]?.trim() || subjectMeta[subject].shortLabel;
}

export function subjectDataValue(subject: SupportedSubject) {
  return subjectDataValues[subject];
}
