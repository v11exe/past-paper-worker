import { z } from "zod";

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOrFallback(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeQuestionNumberText(value: string) {
  return value
    .replace(/©/g, "(c)")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, "")
    .replace(/^question/i, "")
    .replace(/^(\d+)([a-z])$/i, "$1($2)")
    .replace(/^(\d+)\(([a-z])\)([ivx]+)$/i, "$1($2)($3)")
    .replace(/^(\d+)([a-z])([ivx]+)$/i, "$1($2)($3)");
}

function nullableString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nullableInteger(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return Number(value);
  return null;
}

function normalizeRecord(value: unknown) {
  return isPlainRecord(value) ? value : {};
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
}

function textFromUnknown(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(textFromUnknown).filter(Boolean).join("; ");
  if (isPlainRecord(value)) return Object.values(value).map(textFromUnknown).filter(Boolean).join("; ");
  return "";
}

function numberOrFallback(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return fallback;
}

function inferVisibleMaxMarks(...values: unknown[]) {
  const text = values.map(textFromUnknown).filter(Boolean).join(" ");
  if (!text) return null;
  const explicit = [...text.matchAll(/(?:\[\s*(\d{1,2})\s*marks?\s*]|\(\s*(\d{1,2})\s*marks?\s*\))/gi)].map((match) => Number(match[1] ?? match[2]));
  const bareSquare = [...text.matchAll(/\[\s*(\d{1,2})\s*]/g)].map((match) => Number(match[1]));
  const marks = explicit.length ? explicit : bareSquare;
  const sensible = marks.filter((mark) => Number.isInteger(mark) && mark > 0 && mark <= 30);
  if (!sensible.length) return null;
  const total = sensible.reduce((sum, mark) => sum + mark, 0);
  return total > 0 && total <= 100 ? total : null;
}

function hasPositiveMarkingSignal(value: string) {
  const text = value.toLowerCase();
  if (/\b(not|no|incorrect|wrong|missing|insufficient|does not|did not)\b/.test(text)) return false;
  return /\b(correct|credit|award|allow|accept|matches|identified|identification|earns?|scores?|full marks?)\b/.test(text);
}

function isRealMissingPoint(value: string) {
  const text = value.toLowerCase();
  if (hasPositiveMarkingSignal(value)) return false;
  return /\b(missing|needs?|should|must|add|include|omits?|lacks?|not enough|insufficient)\b/.test(text);
}

function normalizeIntegerArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => nullableInteger(item))
    .filter((item): item is number => item !== null);
}

const supportedResponseTypes = new Set(["long_text", "short_text", "numeric", "single_choice", "multi_select"]);

function normalizeResponseType(value: unknown) {
  const raw = typeof value === "string" ? value.trim().toLowerCase().replace(/[\s-]+/g, "_") : "";
  if (supportedResponseTypes.has(raw)) return raw;
  if (raw.includes("calculation") || raw.includes("calculate") || raw.includes("math") || raw.includes("numeric")) return "numeric";
  if (raw.includes("multi_select") || raw.includes("multiple_answer") || raw.includes("checkbox") || raw.includes("check_box") || raw.includes("tick_boxes")) return "multi_select";
  if (raw.includes("single") || raw.includes("multiple_choice") || raw.includes("choice") || raw.includes("tick_box") || raw.includes("tick")) return "single_choice";
  if (raw.includes("multi")) return "multi_select";
  if (raw.includes("short")) return "short_text";
  return "long_text";
}

export function extractInlineOptions(promptText: string) {
  const normalized = promptText.replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();
  if (!normalized) return { promptText, options: [] as string[] };

  const patterns = [
    /(?:^|\s)(?:\(?([A-H])\)|([A-H])\.|([A-H])\s*[-:])\s+([\s\S]*?)(?=(?:\s+(?:\(?[A-H]\)|[A-H]\.|[A-H]\s*[-:])\s+)|$)/g,
    /(?:^|\n)\s*([A-H])\s+([^\n]+?)(?=(?:\n\s*[A-H]\s+)|$)/g,
    /(?:^|\s)([A-D])\s+([\s\S]*?)(?=(?:\s+[A-D]\s+)|$)/g,
  ];

  for (const pattern of patterns) {
    const matches = [...normalized.matchAll(pattern)];
    if (matches.length < 2) continue;

    const options = matches
      .map((match) => {
        const label = match[1] ?? match[2] ?? match[3] ?? "";
        const value = (match[4] ?? match[2] ?? "").trim().replace(/\s+/g, " ");
        return label && value ? `${label}. ${value}` : null;
      })
      .filter((item): item is string => Boolean(item));

    const labels = options.map((option) => option.slice(0, 1));
    const uniqueLabels = new Set(labels);
    if (options.length < 2 || uniqueLabels.size !== options.length) continue;
    if (!labels.every((label, index) => label.charCodeAt(0) === labels[0].charCodeAt(0) + index)) continue;

    const firstMatchIndex = matches[0].index ?? -1;
    const cleanedPrompt = firstMatchIndex > 20 ? normalized.slice(0, firstMatchIndex).trim().replace(/[,:;]\s*$/, "") : normalized;
    return {
      promptText: cleanedPrompt || normalized,
      options,
    };
  }

  return { promptText, options: [] as string[] };
}

function slugSegment(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "question";
}

function inferMediaKind(value: string) {
  const text = value.toLowerCase();
  if (text.includes("graph")) return "graph";
  if (text.includes("table")) return "table";
  if (text.includes("map")) return "map";
  if (text.includes("source")) return "source_extract";
  if (text.includes("figure") || text.includes("diagram")) return "diagram";
  return "media";
}

function normalizeMediaRef(value: unknown, index: number, questionNumber: string) {
  const fallbackId = `media-${slugSegment(questionNumber)}-${index + 1}`;

  if (typeof value === "string") {
    const label = value.trim();
    if (!label) return null;
    return {
      id: fallbackId,
      kind: inferMediaKind(label),
      label,
      description: label,
      sourceAssetId: null,
      pageNumber: null,
      metadata: { normalizedFrom: "string" },
    };
  }

  if (!isPlainRecord(value)) return null;

  const label = stringOrFallback(value.label, stringOrFallback(value.description, `Media reference ${index + 1}`));
  const kind = stringOrFallback(value.kind, inferMediaKind(label));

  return {
    id: stringOrFallback(value.id, fallbackId),
    kind,
    label,
    description: nullableString(value.description),
    sourceAssetId: nullableString(value.sourceAssetId),
    pageNumber: nullableInteger(value.pageNumber),
    metadata: normalizeRecord(value.metadata),
  };
}

function normalizeMediaRefs(value: unknown, questionNumber: string) {
  const refs = Array.isArray(value) ? value : value === null || value === undefined ? [] : [value];
  return refs.map((item, index) => normalizeMediaRef(item, index, questionNumber)).filter((item): item is NonNullable<typeof item> => item !== null);
}

export const paperMediaRefOutputSchema = z.object({
  id: z.string().default("media"),
  kind: z.string().default("media"),
  label: z.string().default("Media reference"),
  description: z.string().nullable().default(null),
  sourceAssetId: z.string().nullable().default(null),
  pageNumber: z.number().int().nullable().default(null),
  metadata: z.record(z.unknown()).default({}),
});

export const paperQuestionOutputSchema = z.object({
  questionNumber: z.string(),
  parentQuestionNumber: z.string().nullable(),
  numberingPath: z.array(z.string()),
  promptText: z.string(),
  maxMarks: z.number().int().min(0),
  responseType: z.enum(["long_text", "short_text", "numeric", "single_choice", "multi_select"]),
  originalFormat: z.string(),
  convertedFormat: z.string().nullable(),
  originalContent: z.record(z.unknown()).default({}),
  convertedContent: z.record(z.unknown()).default({}),
  options: z.array(z.string()).default([]),
  pageReferences: z.array(z.number().int()).default([]),
  mediaRefs: z.array(paperMediaRefOutputSchema).default([]),
  markSchemeRef: z.string().nullable(),
  markSchemeData: z.record(z.unknown()).nullable(),
  evidenceSnippet: z.string().nullable().optional(),
  imagePageReferences: z.array(z.number().int()).default([]).optional(),
  confidence: z.number().min(0).max(100).nullable().optional(),
  extractionWarnings: z.array(z.string()).default([]).optional(),
});

export const processedPaperOutputSchema = z.object({
  title: z.string(),
  year: z.number().int().nullable(),
  series: z.string().nullable(),
  paperCode: z.string().nullable(),
  totalMarks: z.number().int().nullable(),
  durationMinutes: z.number().int().nullable(),
  questions: z.array(paperQuestionOutputSchema),
});

export const pageInventoryOutputSchema = z.object({
  title: z.string().nullable().default(null),
  year: z.number().int().nullable().default(null),
  series: z.string().nullable().default(null),
  paperCode: z.string().nullable().default(null),
  totalMarks: z.number().int().nullable().default(null),
  durationMinutes: z.number().int().nullable().default(null),
  pages: z.array(
    z.object({
      pageNumber: z.number().int(),
      role: z.string().default("questions"),
      questionHints: z.array(z.string()).default([]),
      visualContent: z.array(z.string()).default([]),
      textSummary: z.string().default(""),
      needsImage: z.boolean().default(false),
    }),
  ),
});

export const questionBoundaryOutputSchema = z.object({
  questions: z.array(
    z.object({
      questionNumber: z.string(),
      parentQuestionNumber: z.string().nullable().default(null),
      numberingPath: z.array(z.string()).default([]),
      startPage: z.number().int(),
      endPage: z.number().int(),
      maxMarks: z.number().int().nullable().default(null),
      responseTypeHint: z.string().nullable().default(null),
      hasVisualContent: z.boolean().default(false),
      mediaRefs: z.array(paperMediaRefOutputSchema).default([]),
    }),
  ),
});

export const questionExtractionOutputSchema = z.object({
  questions: z.array(paperQuestionOutputSchema),
});

export const markSchemeAlignmentOutputSchema = z.object({
  alignments: z.array(
    z.object({
      questionNumber: z.string(),
      markSchemeRef: z.string().nullable(),
      markSchemeData: z.record(z.unknown()).nullable(),
    }),
  ),
});

export const paperMarkOutputSchema = z.object({
  awardedMarks: z.number().min(0),
  maxMarks: z.number().min(0),
  rationale: z.string(),
  missingPoints: z.array(z.string()),
  markSchemeEvidence: z.string().nullable(),
  markSchemeReference: z.record(z.unknown()).default({}),
  confidence: z.number().min(0).max(100).default(70),
});

export type ProcessedPaperOutput = z.infer<typeof processedPaperOutputSchema>;
export type PageInventoryOutput = z.infer<typeof pageInventoryOutputSchema>;
export type QuestionBoundaryOutput = z.infer<typeof questionBoundaryOutputSchema>;
export type QuestionExtractionOutput = z.infer<typeof questionExtractionOutputSchema>;
export type MarkSchemeAlignmentOutput = z.infer<typeof markSchemeAlignmentOutputSchema>;
export type PaperMarkOutput = z.infer<typeof paperMarkOutputSchema>;

function normalizeMarkSchemeRow(value: unknown) {
  const row = isPlainRecord(value) ? value : { markPoint: textFromUnknown(value) };
  const markPoint = textFromUnknown(row.markPoint) || textFromUnknown(row.answer) || textFromUnknown(row.point) || textFromUnknown(row.markingPoint);
  return {
    ...row,
    markPoint,
    accept: normalizeStringArray(row.accept).length ? normalizeStringArray(row.accept) : normalizeStringArray(row.alsoAccept),
    doNotAccept: normalizeStringArray(row.doNotAccept).length ? normalizeStringArray(row.doNotAccept) : normalizeStringArray(row.reject),
    ignore: normalizeStringArray(row.ignore),
    guidance: textFromUnknown(row.guidance) || textFromUnknown(row.notes) || textFromUnknown(row.examinerGuidance),
    marks: numberOrFallback(row.marks, 1),
  };
}

function normalizeMarkSchemeData(value: unknown) {
  if (value === null || value === undefined) return null;
  const data = Array.isArray(value) ? { rows: value } : isPlainRecord(value) ? value : { evidence: textFromUnknown(value), points: normalizeStringArray(value) };
  const rowsSource = Array.isArray(data.rows)
    ? data.rows
    : Array.isArray(data.markSchemeRows)
      ? data.markSchemeRows
      : Array.isArray(data.points) && data.points.length
        ? data.points
        : textFromUnknown(data.evidence || data.answer || data.markPoint)
          ? [data.evidence || data.answer || data.markPoint]
          : [];
  const rows = rowsSource.map(normalizeMarkSchemeRow).filter((row) => row.markPoint || row.guidance || row.accept.length || row.doNotAccept.length);
  return {
    ...data,
    source: textFromUnknown(data.source) || "visible_mark_scheme_row",
    questionNumber: textFromUnknown(data.questionNumber),
    maxMarks: numberOrFallback(data.maxMarks, rows.reduce((sum, row) => sum + numberOrFallback(row.marks, 1), 0) || 1),
    rows,
    points: normalizeStringArray(data.points).length ? normalizeStringArray(data.points) : rows.map((row) => row.markPoint).filter(Boolean),
    evidence: textFromUnknown(data.evidence) || rows.map((row) => row.markPoint).filter(Boolean).join("\n"),
  };
}

export function normalizeMarkSchemeAlignmentOutput(input: unknown): unknown {
  if (!isPlainRecord(input)) return input;
  const rawAlignments = Array.isArray(input.alignments)
    ? input.alignments
    : Array.isArray(input.questions)
      ? input.questions
      : Array.isArray(input.matches)
        ? input.matches
        : [];

  return {
    ...input,
    alignments: rawAlignments.map((item, index) => {
      const record = isPlainRecord(item) ? item : {};
      const questionNumber = stringOrFallback(record.questionNumber ?? record.question ?? record.number ?? record.ref, `question-${index + 1}`);
      const markSchemeData = normalizeMarkSchemeData(record.markSchemeData ?? record.markScheme ?? record.scheme ?? record.row ?? record.rows ?? record.answer);
      return {
        questionNumber,
        markSchemeRef: nullableString(record.markSchemeRef ?? record.reference ?? record.pageRef ?? record.ref),
        markSchemeData,
      };
    }),
  };
}

export function normalizePaperMarkOutput(input: unknown): unknown {
  if (!isPlainRecord(input)) return input;

  const rawAwardedMarks = numberOrFallback(input.awardedMarks, 0);
  const maxMarks = numberOrFallback(input.maxMarks, Math.max(0, rawAwardedMarks));
  const evidenceText = textFromUnknown(input.markSchemeEvidence) || null;
  const rationale = textFromUnknown(input.rationale) || textFromUnknown(input.reasoning) || textFromUnknown(input.feedback) || evidenceText || "Marked using the supplied mark scheme.";
  const rawMissingPoints = normalizeStringArray(input.missingPoints).length
    ? normalizeStringArray(input.missingPoints)
    : textFromUnknown(input.missingPoints)
      ? [textFromUnknown(input.missingPoints)]
      : [];
  const positiveMissingPoints = rawMissingPoints.filter(hasPositiveMarkingSignal);
  const missingPoints = rawMissingPoints.filter(isRealMissingPoint);
  const markSchemeReference = isPlainRecord(input.markSchemeReference)
    ? input.markSchemeReference
    : textFromUnknown(input.markSchemeReference)
      ? { reference: textFromUnknown(input.markSchemeReference) }
      : {};
  const positiveEvidence = [rationale, evidenceText ?? "", ...positiveMissingPoints].some(hasPositiveMarkingSignal);
  const insufficiencySignal = /\b(?:insufficient|does not include|doesn't include|no relevant|no matching|no mark scheme|nothing relevant|cannot be awarded|not enough evidence)\b/i.test(
    [rationale, evidenceText ?? "", ...rawMissingPoints].join(" "),
  );
  const awardedMarks = insufficiencySignal ? 0 : rawAwardedMarks === 0 && maxMarks > 0 && positiveEvidence && !missingPoints.length ? maxMarks : rawAwardedMarks;

  return {
    ...input,
    awardedMarks,
    maxMarks,
    rationale,
    missingPoints,
    markSchemeEvidence: [evidenceText, ...positiveMissingPoints].filter(Boolean).join("; ") || null,
    markSchemeReference,
    confidence: Math.max(0, Math.min(100, numberOrFallback(input.confidence, 70))),
  };
}

export function normalizeProcessedPaperOutput(input: unknown): unknown {
  if (!isPlainRecord(input)) return input;
  if (!Array.isArray(input.questions)) return input;

  return {
    ...input,
    questions: input.questions.map((question) => {
      if (!isPlainRecord(question)) return question;
      const questionNumber = normalizeQuestionNumberText(stringOrFallback(question.questionNumber, "question"));
      const originalResponseType = typeof question.responseType === "string" ? question.responseType.trim() : null;
      const responseType = normalizeResponseType(question.responseType);
      const originalContent = normalizeRecord(question.originalContent);
      const convertedContent = normalizeRecord(question.convertedContent);
      const normalizedOptions = normalizeStringArray(question.options);
      const visibleMaxMarks = inferVisibleMaxMarks(question.promptText, originalContent.evidenceSnippet);
      const inlineOptions =
        (responseType === "single_choice" || responseType === "multi_select") && !normalizedOptions.length && typeof question.promptText === "string"
          ? extractInlineOptions(question.promptText)
          : null;
      return {
        ...question,
        questionNumber,
        parentQuestionNumber: nullableString(question.parentQuestionNumber)
          ? normalizeQuestionNumberText(nullableString(question.parentQuestionNumber) ?? "")
          : question.parentQuestionNumber,
        numberingPath: normalizeStringArray(question.numberingPath).map(normalizeQuestionNumberText),
        promptText: inlineOptions?.promptText ?? question.promptText,
        maxMarks: visibleMaxMarks ?? numberOrFallback(question.maxMarks, 0),
        responseType,
        originalFormat: stringOrFallback(question.originalFormat, originalResponseType ?? "text"),
        convertedFormat:
          originalResponseType && originalResponseType.toLowerCase().replace(/[\s-]+/g, "_") !== responseType
            ? originalResponseType
            : nullableString(question.convertedFormat),
        originalContent: inlineOptions?.options.length
          ? { ...originalContent, inlineOptionsSource: question.promptText, extractionWarnings: [...normalizeStringArray(originalContent.extractionWarnings), "Multiple-choice options were recovered from inline question text."] }
          : originalContent,
        convertedContent:
          originalResponseType && originalResponseType.toLowerCase().replace(/[\s-]+/g, "_") !== responseType
            ? { ...convertedContent, normalizedResponseTypeFrom: originalResponseType, normalizedResponseTypeTo: responseType }
            : convertedContent,
        options: normalizedOptions.length ? normalizedOptions : inlineOptions?.options ?? [],
        pageReferences: normalizeIntegerArray(question.pageReferences),
        mediaRefs: normalizeMediaRefs(question.mediaRefs, questionNumber),
        evidenceSnippet:
          nullableString(question.evidenceSnippet) ??
          (isPlainRecord(originalContent) ? nullableString(originalContent.evidenceSnippet) : null),
        imagePageReferences:
          normalizeIntegerArray(question.imagePageReferences).length
            ? normalizeIntegerArray(question.imagePageReferences)
            : isPlainRecord(originalContent)
              ? normalizeIntegerArray(originalContent.imagePageReferences)
              : [],
        confidence:
          typeof question.confidence === "number"
            ? Math.max(0, Math.min(100, question.confidence))
            : isPlainRecord(originalContent) && typeof originalContent.confidence === "number"
              ? Math.max(0, Math.min(100, originalContent.confidence))
              : null,
        extractionWarnings:
          normalizeStringArray(question.extractionWarnings).length
            ? normalizeStringArray(question.extractionWarnings)
            : isPlainRecord(originalContent)
              ? normalizeStringArray(originalContent.extractionWarnings)
              : [],
        markSchemeData:
          question.markSchemeData === null || question.markSchemeData === undefined ? null : isPlainRecord(question.markSchemeData) ? question.markSchemeData : null,
      };
    }),
  };
}
