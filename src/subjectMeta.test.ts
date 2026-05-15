import { describe, expect, it } from "vitest";

import { subjectMeta, subjectMetaForLabel, subjectMetaList, unsupportedSubjectMeta } from "./subjectMeta";
import { supportedSubjects, unsupportedSubjects } from "./subjects";

describe("subject metadata", () => {
  it("matches every supported subject exactly once", () => {
    expect(subjectMetaList.map((subject) => subject.label)).toEqual([...supportedSubjects]);
    expect(Object.keys(subjectMeta)).toEqual([...supportedSubjects]);
  });

  it("includes display metadata and official specification links", () => {
    for (const subject of subjectMetaList) {
      expect(subject.shortLabel.length).toBeGreaterThan(2);
      expect(subject.supported).toBe(true);
      expect(subject.specUrl).toMatch(/^https:\/\//);
      expect(subject.accent).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("keeps only the four supported subjects in the main metadata list", () => {
    expect([...supportedSubjects]).toEqual([
      "AQA GCSE Biology",
      "AQA GCSE Chemistry",
      "AQA GCSE Physics",
      "OCR GCSE Computer Science J277",
    ]);
  });

  it("groups unsupported subjects separately and marks them unsupported", () => {
    expect(Object.keys(unsupportedSubjectMeta)).toEqual([...unsupportedSubjects]);
    for (const subject of unsupportedSubjects) {
      expect(subjectMetaForLabel(subject)?.supported).toBe(false);
    }
  });
});
