import { z } from "zod";
import {
  cleanChoiceGlyphs,
  extractInlineOptions as extractInlineChoiceOptions,
  hasChoiceGlyphs,
  inferChoiceResponseType,
} from "../lib/choiceParsing";
import type { ChoiceExtractionQuality, ResponseType } from "../types";

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
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => cleanChoiceGlyphs(item.trim()))
    .filter(Boolean);
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

function hasNegativeMarkingSignal(value: string) {
  const text = value.toLowerCase();
  return /\b(incorrect|wrong|does not follow|doesn't follow|final answer is incorrect|not correct|cannot be awarded|no marks?|no credit|fails to|did not provide|does not provide|insufficient|nothing relevant|no relevant|no matching|does not match|doesn't match|does not correspond|not one of|outside acceptable range)\b/.test(text);
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

const normalizedResponseTypes = new Set(["long_text", "short_text", "numeric", "single_choice", "multi_select", "unsupported"]);

function normalizeResponseType(value: unknown) {
  const raw = typeof value === "string" ? value.trim().toLowerCase().replace(/[\s-]+/g, "_") : "";
  if (normalizedResponseTypes.has(raw)) return raw;
  if (raw.includes("unsupported")) return "unsupported";
  if (raw.includes("calculation") || raw.includes("calculate") || raw.includes("math") || raw.includes("numeric")) return "numeric";
  if (raw.includes("multi_select") || raw.includes("multiple_answer") || raw.includes("checkbox") || raw.includes("check_box") || raw.includes("tick_boxes")) return "multi_select";
  if (raw.includes("single") || raw.includes("multiple_choice") || raw.includes("choice") || raw.includes("tick_box") || raw.includes("tick")) return "single_choice";
  if (raw.includes("multi")) return "multi_select";
  if (raw.includes("short")) return "short_text";
  return "long_text";
}

export const extractInlineOptions = extractInlineChoiceOptions;

function booleanFromUnknown(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return /^(?:true|yes|unsupported)$/i.test(value.trim());
  return false;
}

function normalizeChoiceExtractionQuality(value: unknown): ChoiceExtractionQuality {
  const raw = typeof value === "string" ? value.trim().toLowerCase().replace(/[\s-]+/g, "_") : "";
  if (raw === "deterministic" || raw === "claude_confirmed" || raw === "ambiguous") return raw;
  return "none";
}

function normalizeOriginalContent(value: unknown): Record<string, unknown> {
  const record = normalizeRecord(value);
  const unsupportedQuestionFormat =
    booleanFromUnknown(record.unsupportedQuestionFormat) ||
    booleanFromUnknown(record.unsupported) ||
    booleanFromUnknown(record.isUnsupported) ||
    booleanFromUnknown(record.requiresCustomUi);
  const unsupportedReason =
    nullableString(record.unsupportedReason) ??
    nullableString(record.unsupportedFormatReason) ??
    nullableString(record.reason);

  return {
    ...record,
    ...(unsupportedQuestionFormat ? { unsupportedQuestionFormat: true } : {}),
    ...(unsupportedReason ? { unsupportedReason } : {}),
    ...(record.choiceExtractionQuality ? { choiceExtractionQuality: normalizeChoiceExtractionQuality(record.choiceExtractionQuality) } : {}),
  };
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

function normalizeBbox(value: unknown) {
  if (!isPlainRecord(value)) return null;
  const x = numberOrFallback(value.x, Number.NaN);
  const y = numberOrFallback(value.y, Number.NaN);
  const width = numberOrFallback(value.width, Number.NaN);
  const height = numberOrFallback(value.height, Number.NaN);
  if (![x, y, width, height].every(Number.isFinite)) return null;
  const clamp = (input: number) => Math.max(0, Math.min(1, input));
  return {
    x: clamp(x),
    y: clamp(y),
    width: clamp(width),
    height: clamp(height),
  };
}

function normalizeTableData(value: unknown) {
  if (!isPlainRecord(value)) return null;
  const columns = normalizeStringArray(value.columns);
  const rows = Array.isArray(value.rows)
    ? value.rows.map((row) => (Array.isArray(row) ? row.map((cell) => textFromUnknown(cell)) : [])).filter((row) => row.length)
    : [];
  const notes = normalizeStringArray(value.notes);
  if (!columns.length && !rows.length) return null;
  return {
    columns,
    rows,
    ...(notes.length ? { notes } : {}),
  };
}

function normalizeDisplayBlock(value: unknown) {
  const record = normalizeRecord(value);
  const type = stringOrFallback(record.type, "paragraph");
  if (type === "ordered_steps" || type === "bullets") {
    return {
      type,
      items: normalizeStringArray(record.items),
    };
  }
  if (type === "equation") {
    const format = stringOrFallback(record.format, "plain");
    return {
      type,
      text: textFromUnknown(record.text),
      format: format === "chemistry" || format === "math" ? format : "plain",
    };
  }
  if (type === "inline" || type === "warning" || type === "paragraph") {
    return {
      type,
      text: textFromUnknown(record.text),
    };
  }
  return {
    type: "paragraph",
    text: textFromUnknown(record.text || value),
  };
}

function normalizeDisplayPlan(value: unknown) {
  if (!isPlainRecord(value)) return null;
  const blocks = Array.isArray(value.blocks) ? value.blocks.map(normalizeDisplayBlock).filter(Boolean) : [];
  if (!blocks.length) return null;
  return {
    blocks,
    notationWarnings: normalizeStringArray(value.notationWarnings),
    confidence: Math.max(0, Math.min(100, numberOrFallback(value.confidence, 70))),
  };
}

function normalizeAnswerPlan(value: unknown) {
  if (!isPlainRecord(value)) return null;
  const kind = stringOrFallback(value.kind, "plain_text");
  return {
    kind:
      kind === "numeric" || kind === "single_choice" || kind === "multi_select" || kind === "unsupported"
        ? kind
        : "plain_text",
    supported: booleanFromUnknown(value.supported ?? true),
    choiceExtractionQuality: normalizeChoiceExtractionQuality(value.choiceExtractionQuality),
    requiresVisual: booleanFromUnknown(value.requiresVisual),
    notes: normalizeStringArray(value.notes),
  };
}

function normalizeConvertedContent(value: unknown) {
  const record = normalizeRecord(value);
  const displayPlan = normalizeDisplayPlan(record.displayPlan);
  const answerPlan = normalizeAnswerPlan(record.answerPlan);
  return {
    ...record,
    ...(displayPlan ? { displayPlan } : {}),
    ...(answerPlan ? { answerPlan } : {}),
  };
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

export const paperVisualBoundingBoxOutputSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0).max(1),
  height: z.number().min(0).max(1),
});

export const paperVisualRegionOutputSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(["figure", "diagram", "graph", "table", "map", "source_extract", "image", "other"]),
  pageNumber: z.number().int().min(1),
  bbox: paperVisualBoundingBoxOutputSchema.nullable().default(null),
  confidence: z.number().min(0).max(100),
  title: z.string().nullable().default(null),
  caption: z.string().nullable().default(null),
  extractedText: z.string().nullable().default(null),
  tableData: z
    .object({
      columns: z.array(z.string()).default([]),
      rows: z.array(z.array(z.string())).default([]),
      notes: z.array(z.string()).default([]).optional(),
    })
    .nullable()
    .optional(),
  displayMode: z.enum(["rendered_table", "cropped_image", "full_page_fallback", "text_extract"]),
  cropDataUrl: z.string().nullable().optional(),
  source: z.enum(["claude_visual_inventory", "deterministic_text", "manual_report"]),
});

export const questionDisplayBlockOutputSchema = z.union([
  z.object({ type: z.literal("paragraph"), text: z.string() }),
  z.object({ type: z.literal("ordered_steps"), items: z.array(z.string()) }),
  z.object({ type: z.literal("bullets"), items: z.array(z.string()) }),
  z.object({ type: z.literal("equation"), text: z.string(), format: z.enum(["plain", "chemistry", "math"]) }),
  z.object({ type: z.literal("inline"), text: z.string() }),
  z.object({ type: z.literal("warning"), text: z.string() }),
]);

export const questionDisplayPlanOutputSchema = z.object({
  blocks: z.array(questionDisplayBlockOutputSchema).default([]),
  notationWarnings: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(100).default(70),
});

export const questionAnswerPlanOutputSchema = z.object({
  kind: z.enum(["plain_text", "numeric", "single_choice", "multi_select", "unsupported"]).default("plain_text"),
  supported: z.boolean().default(true),
  choiceExtractionQuality: z.enum(["none", "deterministic", "claude_confirmed", "ambiguous"]).default("none"),
  requiresVisual: z.boolean().default(false).optional(),
  notes: z.array(z.string()).default([]).optional(),
});

export const paperQuestionOutputSchema = z.object({
  questionNumber: z.string(),
  parentQuestionNumber: z.string().nullable(),
  numberingPath: z.array(z.string()),
  promptText: z.string(),
  maxMarks: z.number().int().min(0),
  responseType: z.enum(["long_text", "short_text", "numeric", "single_choice", "multi_select", "unsupported"]),
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
  visualRegions: z.array(paperVisualRegionOutputSchema).default([]).optional(),
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

export const visualInventoryOutputSchema = z.object({
  visualRegions: z.array(paperVisualRegionOutputSchema).default([]),
});

export const markSchemeAlignmentOutputSchema = z.object({
  alignments: z.array(
    z.object({
      questionNumber: z.string(),
      markSchemeRef: z.string().nullable(),
      markSchemeData: z.record(z.unknown()).nullable(),
      alignmentQuality: z.enum(["exact", "nearby", "broad_parent", "wrong_section", "missing"]).optional(),
      alignmentConfidence: z.number().min(0).max(100).optional(),
      matchedMarkSchemeQuestionNumber: z.string().nullable().optional(),
      matchedPageNumbers: z.array(z.number().int()).default([]).optional(),
      matchedEvidenceText: z.string().default("").optional(),
      alignmentWarnings: z.array(z.string()).default([]).optional(),
    }),
  ),
});

export const questionSupportValidationOutputSchema = z.object({
  questions: z.array(
    z.object({
      questionNumber: z.string(),
      supported: z.boolean(),
      responseType: z.enum(["short_text", "long_text", "numeric", "single_choice", "multi_select", "unsupported"]),
      reason: z.string(),
      displayPlan: questionDisplayPlanOutputSchema.optional(),
      answerPlan: questionAnswerPlanOutputSchema.optional(),
    }),
  ),
});

export const markSchemeRecoveryOutputSchema = z.object({
  status: z.enum(["found", "not_found", "ambiguous"]),
  questionNumber: z.string(),
  matchedMarkSchemeQuestionNumber: z.string().nullable().default(null),
  confidence: z.number().min(0).max(100).default(0),
  markSchemeRef: z.string().nullable().default(null),
  pageNumbers: z.array(z.number().int()).default([]),
  rows: z
    .array(
      z.object({
        markPoint: z.string(),
        accept: z.array(z.string()).default([]),
        doNotAccept: z.array(z.string()).default([]),
        ignore: z.array(z.string()).default([]),
        guidance: z.string().default(""),
        marks: z.number().int().min(0).default(1),
      }),
    )
    .default([]),
  evidence: z.string().default(""),
  whyThisMatches: z.string().default(""),
  whyRejectedPrevious: z.string().default(""),
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
export type VisualInventoryOutput = z.infer<typeof visualInventoryOutputSchema>;
export type MarkSchemeAlignmentOutput = z.infer<typeof markSchemeAlignmentOutputSchema>;
export type QuestionSupportValidationOutput = z.infer<typeof questionSupportValidationOutputSchema>;
export type MarkSchemeRecoveryOutput = z.infer<typeof markSchemeRecoveryOutputSchema>;
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
  if (!Array.isArray(value) && !isPlainRecord(value)) return null;
  const data = Array.isArray(value) ? { rows: value } : value;
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
    alignmentQuality:
      (() => {
        const raw = textFromUnknown(data.alignmentQuality).toLowerCase();
        return raw === "exact" || raw === "nearby" || raw === "broad_parent" || raw === "wrong_section" || raw === "missing" ? raw : undefined;
      })(),
    alignmentConfidence: Math.max(0, Math.min(100, numberOrFallback(data.alignmentConfidence, 0))),
    alignedQuestionNumber: textFromUnknown(data.alignedQuestionNumber || data.questionNumber),
    alignedParentQuestionNumber: nullableString(data.alignedParentQuestionNumber),
    matchedMarkSchemeQuestionNumber: nullableString(data.matchedMarkSchemeQuestionNumber),
    matchedPageNumbers: normalizeIntegerArray(data.matchedPageNumbers ?? data.pageNumbers),
    matchedEvidenceText: textFromUnknown(data.matchedEvidenceText || data.evidence),
    alignmentWarnings: normalizeStringArray(data.alignmentWarnings),
  };
}

function normalizeVisiblePromptText(promptText: string) {
  return cleanChoiceGlyphs(promptText)
    .replace(/\s*(?:[[(]\s*\d+\s*(?:marks?)?\s*[\])]|\[\s*\d+\s*])/gi, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([?.!,;:])/g, "$1")
    .trim();
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
        alignmentQuality: textFromUnknown(record.alignmentQuality) || undefined,
        alignmentConfidence: Math.max(0, Math.min(100, numberOrFallback(record.alignmentConfidence, 0))),
        matchedMarkSchemeQuestionNumber: nullableString(record.matchedMarkSchemeQuestionNumber),
        matchedPageNumbers: normalizeIntegerArray(record.matchedPageNumbers),
        matchedEvidenceText: textFromUnknown(record.matchedEvidenceText),
        alignmentWarnings: normalizeStringArray(record.alignmentWarnings),
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
  const negativeEvidence = [rationale, evidenceText ?? "", ...rawMissingPoints].some(hasNegativeMarkingSignal);
  const insufficiencySignal = /\b(?:insufficient|does not include|doesn't include|no relevant|no matching|no mark scheme|nothing relevant|cannot be awarded|not enough evidence)\b/i.test(
    [rationale, evidenceText ?? "", ...rawMissingPoints].join(" "),
  );
  const awardedMarks = negativeEvidence
    ? 0
    : insufficiencySignal
      ? 0
      : rawAwardedMarks === 0 && maxMarks > 0 && positiveEvidence && !missingPoints.length
        ? maxMarks
        : rawAwardedMarks;

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
    visualRegions: Array.isArray(input.visualRegions)
      ? input.visualRegions
          .map((region) => {
            const record = normalizeRecord(region);
            const bbox = normalizeBbox(record.bbox);
            const tableData = normalizeTableData(record.tableData);
            const kind = stringOrFallback(record.kind, "other");
            const displayMode = stringOrFallback(record.displayMode, tableData ? "rendered_table" : bbox ? "cropped_image" : "full_page_fallback");
            return {
              id: stringOrFallback(record.id, "visual-region"),
              label: stringOrFallback(record.label, "Visual region"),
              kind:
                kind === "figure" || kind === "diagram" || kind === "graph" || kind === "table" || kind === "map" || kind === "source_extract" || kind === "image"
                  ? kind
                  : "other",
              pageNumber: Math.max(1, numberOrFallback(record.pageNumber, 1)),
              bbox,
              confidence: Math.max(0, Math.min(100, numberOrFallback(record.confidence, 70))),
              title: nullableString(record.title),
              caption: nullableString(record.caption),
              extractedText: nullableString(record.extractedText),
              tableData,
              displayMode:
                displayMode === "rendered_table" || displayMode === "cropped_image" || displayMode === "text_extract" ? displayMode : "full_page_fallback",
              cropDataUrl: nullableString(record.cropDataUrl),
              source:
                stringOrFallback(record.source, "deterministic_text") === "claude_visual_inventory"
                  ? "claude_visual_inventory"
                  : stringOrFallback(record.source, "deterministic_text") === "manual_report"
                    ? "manual_report"
                    : "deterministic_text",
            };
          })
          .filter((region) => region.label)
      : [],
    questions: input.questions.map((question) => {
      if (!isPlainRecord(question)) return question;
      const questionNumber = normalizeQuestionNumberText(stringOrFallback(question.questionNumber, "question"));
      const originalResponseType = typeof question.responseType === "string" ? question.responseType.trim() : null;
      const baseResponseType = normalizeResponseType(question.responseType) as ResponseType;
      const originalContent = normalizeOriginalContent(question.originalContent);
      const convertedContent = normalizeConvertedContent(question.convertedContent);
      const normalizedOptions = normalizeStringArray(question.options);
      const rawPromptText = typeof question.promptText === "string" ? question.promptText : textFromUnknown(question.promptText);
      const cleanedPromptText = cleanChoiceGlyphs(rawPromptText);
      const choiceTypeHintPresent = ["multiple_choice", "single_choice", "multi_select", "tick_box"].includes((originalResponseType ?? "").toLowerCase().replace(/[\s-]+/g, "_"));
      const trustChoiceTypeHint =
        choiceTypeHintPresent &&
        (
          rawPromptText.includes("\n") ||
          hasChoiceGlyphs(rawPromptText) ||
          /(?:^|\s)(?:\(?[A-H]\)|[A-H][.)]|[A-H]\s*[-:])\s+\S/m.test(rawPromptText) ||
          /(?:^|\s)A\s+\S[\s\S]*\sB\s+\S[\s\S]*\sC\s+\S/i.test(rawPromptText)
        );
      const inlineOptions = extractInlineChoiceOptions(rawPromptText, trustChoiceTypeHint);
      const recoveredOptions = inlineOptions.options.length >= 2 ? inlineOptions.options : [];
      const responseType = (baseResponseType === "unsupported"
        ? "unsupported"
        : recoveredOptions.length && !["numeric", "short_text", "long_text", "unsupported"].includes(baseResponseType)
        ? inferChoiceResponseType(cleanedPromptText, baseResponseType)
        : recoveredOptions.length && (/\b(?:tick|choose|select|shade|circle)\b/i.test(cleanedPromptText) || /\?[^\n]*\bA\b[\s\S]*\bB\b/i.test(cleanedPromptText))
          ? inferChoiceResponseType(cleanedPromptText, baseResponseType)
          : baseResponseType) as ResponseType;
      const options = normalizedOptions.length ? normalizedOptions : recoveredOptions;
      const visibleMaxMarks = inferVisibleMaxMarks(cleanedPromptText, originalContent.evidenceSnippet);
      return {
        ...question,
        questionNumber,
        parentQuestionNumber: nullableString(question.parentQuestionNumber)
          ? normalizeQuestionNumberText(nullableString(question.parentQuestionNumber) ?? "")
          : question.parentQuestionNumber,
        numberingPath: normalizeStringArray(question.numberingPath).map(normalizeQuestionNumberText),
        promptText: options.length && recoveredOptions.length ? normalizeVisiblePromptText(inlineOptions.promptText) : normalizeVisiblePromptText(cleanedPromptText),
        maxMarks: visibleMaxMarks ?? numberOrFallback(question.maxMarks, 0),
        responseType,
        originalFormat: stringOrFallback(question.originalFormat, originalResponseType ?? "text"),
        convertedFormat:
          originalResponseType && originalResponseType.toLowerCase().replace(/[\s-]+/g, "_") !== responseType
            ? originalResponseType
            : nullableString(question.convertedFormat),
        originalContent: recoveredOptions.length
          ? {
              ...originalContent,
              inlineOptionsSource: rawPromptText,
              choiceExtractionQuality: normalizeChoiceExtractionQuality(originalContent.choiceExtractionQuality || "deterministic"),
              extractionWarnings: [...normalizeStringArray(originalContent.extractionWarnings), "Multiple-choice options were recovered from inline question text."],
            }
          : originalContent,
        convertedContent:
          originalResponseType && originalResponseType.toLowerCase().replace(/[\s-]+/g, "_") !== responseType
            ? { ...convertedContent, normalizedResponseTypeFrom: originalResponseType, normalizedResponseTypeTo: responseType }
            : convertedContent,
        options,
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
        markSchemeData: normalizeMarkSchemeData(question.markSchemeData),
      };
    }),
  };
}
