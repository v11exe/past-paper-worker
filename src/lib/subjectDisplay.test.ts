import { describe, expect, it } from "vitest";

import { displaySubjectName, sanitizeSubjectNicknames, subjectDataValue } from "./subjectDisplay";

describe("subjectDisplay", () => {
  it("uses a nickname when one exists", () => {
    expect(displaySubjectName("AQA GCSE Biology", { "AQA GCSE Biology": "Bio" })).toBe("Bio");
  });

  it("falls back to the subject metadata short label", () => {
    expect(displaySubjectName("AQA GCSE Chemistry", {})).toBe("Chemistry");
  });

  it("maps supported subjects to data-subject values", () => {
    expect(subjectDataValue("OCR GCSE Computer Science J277")).toBe("computer-science");
  });

  it("sanitizes unknown nickname payloads", () => {
    expect(sanitizeSubjectNicknames({ "AQA GCSE Physics": "Physics++" })["AQA GCSE Physics"]).toBe("Physics++");
    expect(sanitizeSubjectNicknames({ nope: "x" })["AQA GCSE Biology"]).toBe("");
  });
});
