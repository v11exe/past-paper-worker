import { zodToJsonSchema } from "zod-to-json-schema";
import type { AIProxyOperation } from "./contracts";
import {
  markSchemeAlignmentOutputSchema,
  pageInventoryOutputSchema,
  paperMarkOutputSchema,
  questionBoundaryOutputSchema,
  questionExtractionOutputSchema,
} from "./schemas";

function stripUnsupportedJsonSchemaBits(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => stripUnsupportedJsonSchemaBits(entry));
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(record)
      .filter(([key]) => !["$schema", "definitions", "default", "examples"].includes(key))
      .map(([key, entry]) => [key, stripUnsupportedJsonSchemaBits(entry)]),
  );
}

const unsupportedGeminiSchemaKeywords = ["$ref", "$defs", "definitions", "anyOf", "oneOf", "allOf", "nullable", "const"] as const;

export function assertGeminiSchemaCompatible(schema: unknown, path = "(root)") {
  if (Array.isArray(schema)) {
    schema.forEach((entry, index) => assertGeminiSchemaCompatible(entry, `${path}[${index}]`));
    return;
  }
  if (!schema || typeof schema !== "object") return;

  const record = schema as Record<string, unknown>;
  for (const keyword of unsupportedGeminiSchemaKeywords) {
    if (Object.prototype.hasOwnProperty.call(record, keyword)) {
      throw new Error(`Gemini response schema contains unsupported keyword ${keyword} at ${path}`);
    }
  }

  for (const [key, value] of Object.entries(record)) {
    assertGeminiSchemaCompatible(value, path === "(root)" ? key : `${path}.${key}`);
  }
}

function buildGeminiJsonSchema(schemaName: string, schema: Parameters<typeof zodToJsonSchema>[0]) {
  return stripUnsupportedJsonSchemaBits(
    zodToJsonSchema(schema, {
      name: schemaName,
      $refStrategy: "none",
      target: "jsonSchema7",
    }),
  );
}

const questionExtractionJsonSchema = buildGeminiJsonSchema("QuestionExtractionOutput", questionExtractionOutputSchema);
const paperMarkJsonSchema = buildGeminiJsonSchema("PaperMarkOutput", paperMarkOutputSchema);

export const geminiResponseJsonSchemas: Partial<Record<AIProxyOperation, unknown>> = {
  page_inventory: buildGeminiJsonSchema("PageInventoryOutput", pageInventoryOutputSchema),
  question_boundaries: buildGeminiJsonSchema("QuestionBoundaryOutput", questionBoundaryOutputSchema),
  question_extraction: questionExtractionJsonSchema,
  mark_scheme_alignment: buildGeminiJsonSchema("MarkSchemeAlignmentOutput", markSchemeAlignmentOutputSchema),
  paper_mark: paperMarkJsonSchema,
  smoke_extraction: questionExtractionJsonSchema,
  smoke_marking: paperMarkJsonSchema,
};
