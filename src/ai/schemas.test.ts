import { describe, expect, it } from "vitest";
import { markSchemeAlignmentOutputSchema, normalizeMarkSchemeAlignmentOutput, normalizePaperMarkOutput, normalizeProcessedPaperOutput, paperMarkOutputSchema, processedPaperOutputSchema } from "./schemas";

const baseQuestion = {
  questionNumber: "1",
  parentQuestionNumber: null,
  numberingPath: ["1"],
  promptText: "Use Figure 1 to explain the network.",
  maxMarks: 2,
  responseType: "short_text",
  originalFormat: "text",
  convertedFormat: null,
  originalContent: {},
  convertedContent: {},
  options: [],
  pageReferences: [1],
  markSchemeRef: null,
  markSchemeData: null,
};

describe("normalizeProcessedPaperOutput", () => {
  it("converts string mediaRefs into schema-valid objects", () => {
    const normalized = normalizeProcessedPaperOutput({
      title: "Paper",
      year: 2025,
      series: "June",
      paperCode: "A1",
      totalMarks: 2,
      durationMinutes: 60,
      questions: [
        {
          ...baseQuestion,
          mediaRefs: ["Figure 1: network diagram"],
        },
      ],
    });

    const result = processedPaperOutputSchema.parse(normalized);

    expect(result.questions[0].mediaRefs[0]).toMatchObject({
      id: "media-1-1",
      kind: "diagram",
      label: "Figure 1: network diagram",
      description: "Figure 1: network diagram",
      sourceAssetId: null,
      pageNumber: null,
      metadata: { normalizedFrom: "string" },
    });
  });

  it("treats null mediaRefs as an empty array", () => {
    const normalized = normalizeProcessedPaperOutput({
      title: "Paper",
      year: null,
      series: null,
      paperCode: null,
      totalMarks: null,
      durationMinutes: null,
      questions: [
        {
          ...baseQuestion,
          mediaRefs: null,
        },
      ],
    });

    const result = processedPaperOutputSchema.parse(normalized);

    expect(result.questions[0].mediaRefs).toEqual([]);
  });

  it("fills missing mediaRef object keys without discarding the reference", () => {
    const normalized = normalizeProcessedPaperOutput({
      title: "Paper",
      year: null,
      series: null,
      paperCode: null,
      totalMarks: null,
      durationMinutes: null,
      questions: [
        {
          ...baseQuestion,
          mediaRefs: [{ label: "Table 2", pageNumber: "3" }],
        },
      ],
    });

    const result = processedPaperOutputSchema.parse(normalized);

    expect(result.questions[0].mediaRefs[0]).toMatchObject({
      id: "media-1-1",
      kind: "table",
      label: "Table 2",
      pageNumber: 3,
    });
  });

  it("does not treat malformed mark-scheme text as aligned marking data", () => {
    const normalized = normalizeProcessedPaperOutput({
      title: "Paper",
      year: null,
      series: null,
      paperCode: null,
      totalMarks: null,
      durationMinutes: null,
      questions: [
        {
          ...baseQuestion,
          mediaRefs: [],
          markSchemeData: "see mark scheme",
        },
      ],
    });

    const result = processedPaperOutputSchema.parse(normalized);

    expect(result.questions[0].markSchemeData).toBeNull();
  });

  it("normalizes unsupported AI response types into supported UI formats", () => {
    const normalized = normalizeProcessedPaperOutput({
      title: "Paper",
      year: null,
      series: null,
      paperCode: null,
      totalMarks: null,
      durationMinutes: null,
      questions: [
        {
          ...baseQuestion,
          responseType: "calculation",
          originalFormat: "text",
          mediaRefs: [],
        },
      ],
    });

    const result = processedPaperOutputSchema.parse(normalized);

    expect(result.questions[0].responseType).toBe("numeric");
    expect(result.questions[0].convertedFormat).toBe("calculation");
    expect(result.questions[0].convertedContent).toMatchObject({
      normalizedResponseTypeFrom: "calculation",
      normalizedResponseTypeTo: "numeric",
    });
  });

  it("recovers multiple-choice options embedded in promptText", () => {
    const normalized = normalizeProcessedPaperOutput({
      title: "Paper",
      year: null,
      series: null,
      paperCode: null,
      totalMarks: null,
      durationMinutes: null,
      questions: [
        {
          ...baseQuestion,
          promptText: "Which structure controls cell activities? A. nucleus B. ribosome C. cell wall D. cytoplasm",
          responseType: "multiple_choice",
          originalFormat: "multiple choice",
          mediaRefs: [],
        },
      ],
    });

    const result = processedPaperOutputSchema.parse(normalized);

    expect(result.questions[0].responseType).toBe("single_choice");
    expect(result.questions[0].promptText).toBe("Which structure controls cell activities?");
    expect(result.questions[0].options).toEqual(["A. nucleus", "B. ribosome", "C. cell wall", "D. cytoplasm"]);
  });

  it("uses visible mark allocations when boundary marks are too coarse", () => {
    const normalized = normalizeProcessedPaperOutput({
      title: "Paper",
      year: null,
      series: null,
      paperCode: null,
      totalMarks: null,
      durationMinutes: null,
      questions: [
        {
          ...baseQuestion,
          promptText: "Answer part (a). [4]\nAnswer part (b). [2]\nAnswer part (c). [1]",
          maxMarks: 4,
          mediaRefs: [],
        },
      ],
    });

    const result = processedPaperOutputSchema.parse(normalized);

    expect(result.questions[0].maxMarks).toBe(7);
  });

  it("normalizes copyright-symbol subpart labels into question c", () => {
    const normalized = normalizeProcessedPaperOutput({
      title: "Paper",
      year: null,
      series: null,
      paperCode: null,
      totalMarks: null,
      durationMinutes: null,
      questions: [
        {
          ...baseQuestion,
          questionNumber: "3©",
          numberingPath: ["3", "©"],
          mediaRefs: [],
        },
      ],
    });

    const result = processedPaperOutputSchema.parse(normalized);

    expect(result.questions[0].questionNumber).toBe("3(c)");
    expect(result.questions[0].numberingPath).toEqual(["3", "(c)"]);
  });

  it("recovers plain inline multiple-choice options without punctuation", () => {
    const normalized = normalizeProcessedPaperOutput({
      title: "Paper",
      year: null,
      series: null,
      paperCode: null,
      totalMarks: null,
      durationMinutes: null,
      questions: [
        {
          ...baseQuestion,
          promptText: "Which structure controls cell activities? A nucleus B ribosome C cell wall D cytoplasm",
          responseType: "single_choice",
          originalFormat: "multiple choice",
          mediaRefs: [],
        },
      ],
    });

    const result = processedPaperOutputSchema.parse(normalized);

    expect(result.questions[0].promptText).toBe("Which structure controls cell activities?");
    expect(result.questions[0].options).toEqual(["A. nucleus", "B. ribosome", "C. cell wall", "D. cytoplasm"]);
  });
});

describe("normalizeMarkSchemeAlignmentOutput", () => {
  it("normalizes examiner table rows with accept, reject, ignore, and guidance fields", () => {
    const normalized = normalizeMarkSchemeAlignmentOutput({
      matches: [
        {
          number: "02.1",
          reference: "page 4 row 02.1",
          rows: [
            {
              answer: "gene",
              alsoAccept: ["section of DNA"],
              reject: ["chromosome"],
              ignore: ["spelling if clear"],
              notes: "Award one mark for the named section.",
              marks: "1",
            },
          ],
        },
      ],
    });

    const parsed = markSchemeAlignmentOutputSchema.parse(normalized);

    expect(parsed.alignments[0].questionNumber).toBe("02.1");
    expect(parsed.alignments[0].markSchemeRef).toBe("page 4 row 02.1");
    expect(parsed.alignments[0].markSchemeData?.rows).toEqual([
      expect.objectContaining({
        markPoint: "gene",
        accept: ["section of DNA"],
        doNotAccept: ["chromosome"],
        ignore: ["spelling if clear"],
        guidance: "Award one mark for the named section.",
        marks: 1,
      }),
    ]);
  });
});

describe("normalizePaperMarkOutput", () => {
  it("coerces common AI marking shape drift into the required schema", () => {
    const normalized = normalizePaperMarkOutput({
      awardedMarks: "1",
      maxMarks: "2",
      missingPoints: "Add the named structure.",
      markSchemeEvidence: ["nucleus accepted", "ignore spelling"],
      markSchemeReference: "02.2",
      confidence: "82",
    });

    const result = paperMarkOutputSchema.parse(normalized);

    expect(result.awardedMarks).toBe(1);
    expect(result.maxMarks).toBe(2);
    expect(result.rationale).toContain("nucleus accepted");
    expect(result.missingPoints).toEqual(["Add the named structure."]);
    expect(result.markSchemeEvidence).toBe("nucleus accepted; ignore spelling");
    expect(result.markSchemeReference).toEqual({ reference: "02.2" });
    expect(result.confidence).toBe(82);
  });

  it("repairs contradictory zero-mark outputs when the model says the answer is correct", () => {
    const normalized = normalizePaperMarkOutput({
      awardedMarks: 0,
      maxMarks: 1,
      rationale: "Marked using the supplied mark scheme.",
      missingPoints: ["Correct identification of where chromosomes are found (e.g. nucleus) from the mark scheme"],
      markSchemeEvidence: null,
      markSchemeReference: "02.2",
    });

    const result = paperMarkOutputSchema.parse(normalized);

    expect(result.awardedMarks).toBe(1);
    expect(result.missingPoints).toEqual([]);
    expect(result.markSchemeEvidence).toContain("Correct identification");
  });

  it("zeros contradictory full-mark outputs when the model says the answer is incorrect", () => {
    const normalized = normalizePaperMarkOutput({
      awardedMarks: 2,
      maxMarks: 2,
      rationale: "The student's working is incorrect and the final answer is incorrect.",
      missingPoints: [],
      markSchemeEvidence: "answer 47",
      markSchemeReference: "01(c)",
    });

    const result = paperMarkOutputSchema.parse(normalized);

    expect(result.awardedMarks).toBe(0);
    expect(result.maxMarks).toBe(2);
  });
});
