import type { ChoiceExtractionQuality, ResponseType } from "../types";

const REAL_CHOICE_GLYPHS =
  /[\u2610\u2611\u2612\u2713\u2714\u2715\u2716\u2717\u25a1\u25a0\u25a2\u25a3\u25ef\u25cb\u25cf\u25c9\u2b1c\u2b1b\u2705\u274e\ud83d\udd32\ud83d\udd33\ud83d\uddf9]/gu;

const MOJIBAKE_CHOICE_GLYPHS =
  /(?:\u00e2\u02dc[\u0090\u0091\u0092]|\u00e2\u0153[\u0093\u0094\u0095\u0096\u0097\u0085]|\u00e2\u2013[\u00a1\u00a0\u00a2\u00a3]|\u00e2\u2014[\u00af\u2039\u008f\u2030]|\u00e2\u00ac[\u0153\u203a]|\u00f0\u0178[\u201d\u00b2][\u00b2\u00b3]|\u00e2\u009d\u017d|\u00f0\u0178\u2014\u00b9)/g;

const CHOICE_INSTRUCTION_PATTERN =
  /\b(?:tick|choose|select|shade|circle)\s+(?:the\s+)?(?:(?:one|two|three|four|\d+)\s+)?(?:correct\s+)?(?:answer|answers|box|boxes|lozenge|lozenges|option|options)\b\.?/gi;

const MULTI_SELECT_HINT_PATTERN =
  /\b(?:tick|choose|select|shade|circle)\s+(?:the\s+)?(?:two|three|four|2|3|4)\s+(?:correct\s+)?(?:answer|answers|box|boxes|lozenge|lozenges|option|options)\b|\bchoose\s+two\b|\btick\s+two\b|\bselect\s+two\b/i;

export type InlineChoiceExtraction = {
  promptText: string;
  options: string[];
};

export type ChoiceExtractionResult = InlineChoiceExtraction & {
  quality: ChoiceExtractionQuality;
  hasChoiceInstruction: boolean;
  hasChoiceGlyphs: boolean;
};

export function cleanChoiceGlyphs(text: string) {
  return text
    .replace(REAL_CHOICE_GLYPHS, " ")
    .replace(MOJIBAKE_CHOICE_GLYPHS, " ")
    .replace(/\b(?:checkbox|tickbox)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function hasChoiceInstruction(text: string) {
  CHOICE_INSTRUCTION_PATTERN.lastIndex = 0;
  return CHOICE_INSTRUCTION_PATTERN.test(text);
}

export function hasChoiceGlyphs(text: string) {
  REAL_CHOICE_GLYPHS.lastIndex = 0;
  MOJIBAKE_CHOICE_GLYPHS.lastIndex = 0;
  return REAL_CHOICE_GLYPHS.test(text) || MOJIBAKE_CHOICE_GLYPHS.test(text) || /\b(?:checkbox|tickbox|lozenge)\b/i.test(text);
}

function cleanPromptBeforeOptions(value: string, fallback: string) {
  const stripped = cleanChoiceGlyphs(value)
    .replace(CHOICE_INSTRUCTION_PATTERN, " ")
    .replace(/\s+/g, " ")
    .replace(/[,:;]\s*$/, "")
    .trim();
  return stripped || fallback;
}

function optionValue(value: string) {
  return cleanChoiceGlyphs(value)
    .replace(/^[.)\]:;-]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeOptionLabel(label: string, value: string) {
  const normalizedLabel = label.toUpperCase();
  const cleanedValue = optionValue(value);
  if (!cleanedValue) return null;
  return `${normalizedLabel}. ${cleanedValue}`;
}

function labelsAreSequential(options: string[]) {
  const labels = options.map((option) => option.slice(0, 1));
  const uniqueLabels = new Set(labels);
  if (options.length < 2 || uniqueLabels.size !== options.length) return false;
  return labels.every((label, index) => label.charCodeAt(0) === labels[0].charCodeAt(0) + index);
}

function buildExtraction(text: string, matches: RegExpMatchArray[], labelGroup: number, valueGroup: number, fallbackPrompt: string) {
  const options = matches
    .map((match) => normalizeOptionLabel(match[labelGroup] ?? "", match[valueGroup] ?? ""))
    .filter((item): item is string => Boolean(item));
  if (!labelsAreSequential(options)) return null;

  const firstMatchIndex = matches[0].index ?? -1;
  const promptSource = firstMatchIndex >= 0 ? text.slice(0, firstMatchIndex) : "";
  return {
    promptText: cleanPromptBeforeOptions(promptSource, fallbackPrompt),
    options,
  };
}

function lineSeparatedOptions(text: string, fallbackPrompt: string) {
  const lines = text.split("\n").map((line) => cleanChoiceGlyphs(line)).filter(Boolean);
  const matches: RegExpMatchArray[] = [];
  let firstOptionLine = -1;

  for (const [index, line] of lines.entries()) {
    const match = /^([A-H])(?:[.)\]:-]|\s{1,})(.+)$/i.exec(line);
    if (!match) continue;
    if (firstOptionLine < 0) firstOptionLine = index;
    matches.push(match);
  }

  if (matches.length < 2) return null;
  const options = matches.map((match) => normalizeOptionLabel(match[1] ?? "", match[2] ?? "")).filter((item): item is string => Boolean(item));
  if (!labelsAreSequential(options)) return null;
  const promptText = cleanPromptBeforeOptions(lines.slice(0, Math.max(0, firstOptionLine)).join(" "), fallbackPrompt);
  return { promptText, options };
}

export function extractInlineOptions(promptText: string, trustChoiceTypeHint = false): InlineChoiceExtraction {
  const result = extractChoiceStructure(promptText, trustChoiceTypeHint);
  return { promptText: result.promptText, options: result.options };
}

export function extractChoiceStructure(promptText: string, trustChoiceTypeHint = false): ChoiceExtractionResult {
  const cleaned = cleanChoiceGlyphs(promptText.replace(/\r/g, "\n"));
  const withLines = promptText.replace(/\r/g, "\n");
  const fallbackPrompt = MULTI_SELECT_HINT_PATTERN.test(cleaned) ? "Choose the correct answers." : "Choose the correct answer.";
  const choiceInstruction = hasChoiceInstruction(withLines);
  const choiceGlyphs = hasChoiceGlyphs(promptText);
  if (!cleaned) return { promptText, options: [], quality: "none", hasChoiceInstruction: choiceInstruction, hasChoiceGlyphs: choiceGlyphs };

  const lineExtraction = lineSeparatedOptions(withLines, fallbackPrompt);
  if (lineExtraction) {
    if (choiceInstruction || choiceGlyphs || trustChoiceTypeHint) {
      return { ...lineExtraction, quality: "deterministic", hasChoiceInstruction: choiceInstruction, hasChoiceGlyphs: choiceGlyphs };
    }
    return { promptText: cleanChoiceGlyphs(promptText), options: [], quality: "ambiguous", hasChoiceInstruction: choiceInstruction, hasChoiceGlyphs: choiceGlyphs };
  }

  const normalized = cleaned.replace(/[ \t]+/g, " ").trim();
  const labelledPattern = /(?:^|\s)(?:\(?([A-H])\)|([A-H])\.|([A-H])\s*[-:])\s+([\s\S]*?)(?=(?:\s+(?:\(?[A-H]\)|[A-H]\.|[A-H]\s*[-:])\s+)|$)/g;
  const labelledMatches = [...normalized.matchAll(labelledPattern)];
  if (labelledMatches.length >= 2) {
    const matches = labelledMatches.map((match) => {
      const copy = [...match] as RegExpMatchArray;
      copy[1] = match[1] ?? match[2] ?? match[3] ?? "";
      copy[2] = match[4] ?? "";
      copy.index = match.index;
      return copy;
    });
    const extraction = buildExtraction(normalized, matches, 1, 2, fallbackPrompt);
    if (extraction && (choiceInstruction || choiceGlyphs || trustChoiceTypeHint)) {
      return { ...extraction, quality: "deterministic", hasChoiceInstruction: choiceInstruction, hasChoiceGlyphs: choiceGlyphs };
    }
    if (extraction) {
      return { promptText: cleanChoiceGlyphs(promptText), options: [], quality: "ambiguous", hasChoiceInstruction: choiceInstruction, hasChoiceGlyphs: choiceGlyphs };
    }
  }

  const barePattern = /(?:^|\s)([A-D])\s+([\s\S]*?)(?=(?:\s+[A-D]\s+)|$)/g;
  const bareMatches = [...normalized.matchAll(barePattern)];
  if (bareMatches.length >= 3 && (choiceInstruction || trustChoiceTypeHint)) {
    const extraction = buildExtraction(normalized, bareMatches, 1, 2, fallbackPrompt);
    if (extraction) return { ...extraction, quality: "deterministic", hasChoiceInstruction: choiceInstruction, hasChoiceGlyphs: choiceGlyphs };
  }

  const letterRun = /(?:^|\s)((?:[A-H]\s+){1,}[A-H])$/i.exec(normalized);
  if (letterRun && (/\b(?:tick|choose|select|shade|circle)\b/i.test(normalized.slice(0, letterRun.index)) || trustChoiceTypeHint)) {
    const options = letterRun[1].split(/\s+/).map((label) => label.toUpperCase());
    if (labelsAreSequential(options.map((label) => `${label}. option`))) {
      const promptText = cleanChoiceGlyphs(normalized.slice(0, letterRun.index)).trim() || fallbackPrompt;
      return { promptText, options, quality: "deterministic", hasChoiceInstruction: choiceInstruction, hasChoiceGlyphs: choiceGlyphs };
    }
  }

  return {
    promptText: cleanChoiceGlyphs(promptText),
    options: [],
    quality: labelledMatches.length >= 2 || bareMatches.length >= 3 ? "ambiguous" : "none",
    hasChoiceInstruction: choiceInstruction,
    hasChoiceGlyphs: choiceGlyphs,
  };
}

export function inferChoiceResponseType(text: string, fallback: ResponseType = "single_choice"): ResponseType {
  if (MULTI_SELECT_HINT_PATTERN.test(text)) return "multi_select";
  if (fallback === "multi_select") return "multi_select";
  return "single_choice";
}
