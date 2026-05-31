export function buildFollowUpPrompt(stem: string, points: string[], answer: string) {
  const trimmedStem = stem.replace(/\s+/g, " ").trim();
  const trimmedAnswer = answer.replace(/\s+/g, " ").trim();
  const summaryPoints = points.map((point) => point.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 4);
  return [
    "You are helping a GCSE student review one marked answer.",
    `Question: ${trimmedStem.slice(0, 320)}`,
    summaryPoints.length ? `Key mark-scheme points: ${summaryPoints.join("; ").slice(0, 220)}` : "Key mark-scheme points: None provided.",
    `Student answer: ${trimmedAnswer.slice(0, 220) || "No answer provided."}`,
    "Write one follow-up question that probes the same idea more deeply without repeating the original wording.",
    "Keep it to at most two sentences and do not include bullets, headings, or a model answer.",
  ].join("\n");
}

export function buildReviewExplainerPrompt(input: {
  stem: string;
  answer: string;
  awardedMarks: number;
  maxMarks: number;
  rationale: string;
  missingPoints: string[];
}) {
  const trimmedStem = input.stem.replace(/\s+/g, " ").trim();
  const trimmedAnswer = input.answer.replace(/\s+/g, " ").trim();
  const trimmedRationale = input.rationale.replace(/\s+/g, " ").trim();
  const missingPoints = input.missingPoints.map((point) => point.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 4);
  return [
    "Explain a GCSE marking decision in plain language for a student.",
    `Question: ${trimmedStem.slice(0, 320)}`,
    `Student answer: ${trimmedAnswer.slice(0, 220) || "No answer provided."}`,
    `Awarded marks: ${input.awardedMarks}/${input.maxMarks}`,
    `Marker rationale: ${trimmedRationale.slice(0, 240)}`,
    missingPoints.length ? `Missing points: ${missingPoints.join("; ").slice(0, 220)}` : "Missing points: None listed.",
    "Explain why this mark was awarded and give one concrete next-step improvement.",
    "Keep it under 120 words, encouraging, and avoid quoting the full mark scheme.",
  ].join("\n");
}
