import { describe, expect, it } from "vitest";

import { subjectMeta, subjectMetaList } from "./subjectMeta";
import { supportedSubjects } from "./subjects";

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
});
