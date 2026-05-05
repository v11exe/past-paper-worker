export type PagePromptContext = {
  pageNumber: number;
  text: string;
  charCount: number;
  hasScreenshot: boolean;
};

export type QuestionBoundaryPromptContext = {
  questionNumber: string;
  parentQuestionNumber: string | null;
  numberingPath: string[];
  startPage: number;
  endPage: number;
  maxMarks: number | null;
  responseTypeHint: string | null;
  hasVisualContent: boolean;
};

const QUESTION_PLACEHOLDER = "__QUESTION_TEXT_FROM_SUPPLIED_PAPER_ONLY__";
const QUESTION_NUMBER_PLACEHOLDER = "__QUESTION_NUMBER__";

function clipped(text: string, maxChars: number) {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n[clipped ${text.length - maxChars} chars]`;
}

function pagesBlock(pages: PagePromptContext[], maxCharsPerPage: number) {
  return pages
    .map((page) =>
      [
        `Page ${page.pageNumber}`,
        `Extracted text chars: ${page.charCount}`,
        `Screenshot attached: ${page.hasScreenshot ? "yes" : "no"}`,
        clipped(page.text || "[no extractable text]", maxCharsPerPage),
      ].join("\n"),
    )
    .join("\n\n");
}

function imageMapBlock(pages: PagePromptContext[]) {
  const imagePages = pages.filter((page) => page.hasScreenshot);
  if (!imagePages.length) return "No page screenshots are attached.";
  return imagePages.map((page, index) => `Attached image ${index + 1} = page ${page.pageNumber}`).join("\n");
}

export function buildPaperProcessingPrompt(input: {
  title: string;
  subject: string;
  topicPath: string[];
  hasMarkScheme: boolean;
  paperText: string;
  markSchemeText: string | null;
}) {
  return [
    "You are processing an exam past paper into strict structured JSON for a paper-taking UI.",
    "Return JSON only. No markdown. No commentary.",
    `Title: ${input.title}`,
    `Subject: ${input.subject}`,
    input.topicPath.length ? `Topic path: ${input.topicPath.join(" > ")}` : "Topic path: not supplied",
    `Mark scheme attached: ${input.hasMarkScheme ? "yes" : "no"}`,
    "Tasks:",
    "1. Extract title metadata, total marks, and duration if present.",
    "2. Split the paper into ordered questions and preserve numbering hierarchy such as 1, 1.1, 1(a).",
    "3. Detect only named/referenced diagrams, graphs, maps, figures, photographs, flowcharts, or source extracts that are required to answer the question and attach mediaRefs to that question.",
    "mediaRefs must always be an array. Each item must be an object, never a string, with this exact shape: {\"id\":\"media-1-1\",\"kind\":\"diagram|graph|table|map|source_extract|media\",\"label\":\"Figure 1\",\"description\":\"short visible description or null\",\"sourceAssetId\":null,\"pageNumber\":1|null,\"metadata\":{}}.",
    "If a question explicitly refers to a required figure/diagram/graph/map/source that is present but not extractable from the provided text, include a mediaRef object describing the reference. Do not attach generic page screenshots, answer-line tables, tick-box tables, or layout-only content. If there is no required referenced media, use mediaRefs: [].",
    "4. Classify responseType as long_text, short_text, numeric, single_choice, or multi_select. Use long_text as fallback.",
    "5. Only convert simple formats: simple checkbox/radio, simple multi-checkbox, short answer, long answer, and calculations. If the source is a table/grid/matrix, row-by-row checkbox table, drawing, diagram-labelling, or matching table, set originalContent.unsupportedQuestionFormat true and explain originalContent.unsupportedReason instead of pretending it is a normal text box.",
    "6. If a mark scheme is attached, first infer the exam board/style from the paper and mark scheme text (for example OCR table rows or AQA Answers/Extra information columns), then align marking points to each question in markSchemeRef and markSchemeData.",
    "Never invent marks, choices, diagrams, or mark-scheme content when absent or unreadable.",
    "Required JSON shape with placeholder-neutral values. Match the field types exactly:",
    `{"title":"__TITLE_FROM_SUPPLIED_PAPER_ONLY__","year":null,"series":null,"paperCode":null,"totalMarks":null,"durationMinutes":null,"questions":[{"questionNumber":"${QUESTION_NUMBER_PLACEHOLDER}","parentQuestionNumber":null,"numberingPath":["${QUESTION_NUMBER_PLACEHOLDER}"],"promptText":"${QUESTION_PLACEHOLDER}","maxMarks":1,"responseType":"short_text","originalFormat":"text","convertedFormat":null,"originalContent":{"evidenceSnippet":"__VISIBLE_SOURCE_SNIPPET__","confidence":0,"extractionWarnings":[]},"convertedContent":{},"options":[],"pageReferences":[1],"mediaRefs":[{"id":"media-__QUESTION_NUMBER__-1","kind":"diagram","label":"__VISIBLE_MEDIA_LABEL__","description":"__VISIBLE_MEDIA_DESCRIPTION_OR_NULL__","sourceAssetId":null,"pageNumber":1,"metadata":{}}],"markSchemeRef":null,"markSchemeData":null}]}`,
    "The placeholder strings are not content. Never copy them into the output.",
    "If the question text is not visible/readable in supplied text or images, return no question for it. Do not infer or invent.",
    "Every promptText must be a direct transcription or faithful consolidation of visible question wording from the supplied paper, but do not include the leading question number/subpart label or trailing mark allocation such as [2], [2 marks], or (2 marks). Store those separately in questionNumber/numberingPath and maxMarks.",
    "Paper text:",
    input.paperText || "No extractable paper text was available. Use only supplied metadata and do not fabricate question details.",
    input.markSchemeText ? `Mark scheme text:\n${input.markSchemeText}` : "Mark scheme text: not supplied.",
  ].join("\n\n");
}

export function buildPageInventoryPrompt(input: {
  title: string;
  subject: string;
  topicPath: string[];
  pages: PagePromptContext[];
}) {
  return [
    "Build a compact inventory of an exam paper from page text and any attached page screenshots.",
    "Return JSON only. No markdown. No commentary.",
    `Title supplied by user: ${input.title}`,
    `Subject: ${input.subject}`,
    input.topicPath.length ? `Topic path: ${input.topicPath.join(" > ")}` : "Topic path: not supplied",
    "Output shape:",
    '{"title":null,"year":null,"series":null,"paperCode":null,"totalMarks":null,"durationMinutes":null,"pages":[{"pageNumber":1,"role":"cover|instructions|questions|blank|formula|data_sheet|mark_scheme|other","questionHints":["__VISIBLE_QUESTION_NUMBER__"],"visualContent":["__VISIBLE_MEDIA_KIND__"],"textSummary":"__SHORT_FACTUAL_SUMMARY_FROM_PAGE__","needsImage":false}]}',
    "The placeholder strings are not content. Never copy them into the output.",
    "Keep summaries short. Do not extract full questions here.",
    "Classify cover/instruction pages conservatively. Candidate details, examiner-use boxes, materials, instructions, and total-marks tables are not question text.",
    "Image-page map:",
    imageMapBlock(input.pages),
    "Pages:",
    pagesBlock(input.pages, 1200),
  ].join("\n\n");
}

export function buildQuestionBoundaryPrompt(input: {
  title: string;
  subject: string;
  inventoryJson: string;
  pages: PagePromptContext[];
}) {
  return [
    "Identify the ordered question boundaries in this exam paper.",
    "Return JSON only. No markdown. No commentary.",
    `Title: ${input.title}`,
    `Subject: ${input.subject}`,
    "Use page inventory plus clipped page text. Prefer page ranges over copying full question text.",
    "Return each visible question or subquestion that has its own answer space or mark allocation. Do not collapse a whole multi-page main question into one boundary when subparts such as 1.1, 1.2, 1(a), or (i) are visible.",
    "Set maxMarks from the visible mark allocation for that exact question/subquestion. If a boundary contains multiple visible mark allocations, split it into separate boundaries where possible.",
    "Output shape:",
    `{"questions":[{"questionNumber":"${QUESTION_NUMBER_PLACEHOLDER}","parentQuestionNumber":null,"numberingPath":["${QUESTION_NUMBER_PLACEHOLDER}"],"startPage":1,"endPage":1,"maxMarks":1,"responseTypeHint":"short_text","hasVisualContent":true,"mediaRefs":[{"id":"media-__QUESTION_NUMBER__-1","kind":"diagram","label":"__VISIBLE_MEDIA_LABEL__","description":"__VISIBLE_MEDIA_DESCRIPTION_OR_NULL__","sourceAssetId":null,"pageNumber":1,"metadata":{}}]}]}`,
    "The placeholder strings are not content. Never copy them into the output.",
    "Do not invent questions. If boundaries are uncertain, use the smallest page range that contains the visible question.",
    "If visible question numbers cannot be found, return an empty questions array.",
    "Image-page map:",
    imageMapBlock(input.pages),
    "Page inventory JSON:",
    clipped(input.inventoryJson, 8000),
    "Page text:",
    pagesBlock(input.pages, 1500),
  ].join("\n\n");
}

export function buildQuestionExtractionPrompt(input: {
  title: string;
  subject: string;
  boundaries: QuestionBoundaryPromptContext[];
  pages: PagePromptContext[];
}) {
  return [
    "Extract structured exam questions for only the supplied page range.",
    "Return JSON only. No markdown. No commentary.",
    `Title: ${input.title}`,
    `Subject: ${input.subject}`,
    "Attached images, when present, are screenshots of the exact pages being extracted. Use them for question wording, diagrams, tables, graphs, maps, source extracts, and layout that PDF text loses.",
    "Image-page map:",
    imageMapBlock(input.pages),
    "Output shape:",
    `{"questions":[{"questionNumber":"${QUESTION_NUMBER_PLACEHOLDER}","parentQuestionNumber":null,"numberingPath":["${QUESTION_NUMBER_PLACEHOLDER}"],"promptText":"${QUESTION_PLACEHOLDER}","maxMarks":1,"responseType":"short_text","originalFormat":"text","convertedFormat":null,"originalContent":{"evidenceSnippet":"__VISIBLE_SOURCE_SNIPPET__","imagePageReferences":[1],"confidence":0,"extractionWarnings":[]},"convertedContent":{},"options":[],"pageReferences":[1],"mediaRefs":[],"markSchemeRef":null,"markSchemeData":null}]}`,
    "The placeholder strings are not content. Never copy them into the output.",
    "Rules:",
    "1. Extract only questions whose start/end pages are listed below.",
    "2. Preserve numbering hierarchy such as 1, 1.1, 1(a).",
    "2a. When a page range belongs to a main question but contains subquestions numbered 1, 2, 3, treat them as subparts of that main question, not as new top-level paper questions.",
    "3. Attach mediaRefs only for required named/referenced figures, diagrams, graphs, maps, photographs, flowcharts, or source extracts. Do not attach generic page screenshots, answer-line tables, tick-box tables, or layout-only content.",
    "4. Leave markSchemeRef and markSchemeData null; mark schemes are aligned in a later stage.",
    "5. Never invent missing marks, options, diagrams, or text.",
    "6. If the question text is not visible/readable in supplied text or images, return no question for it. Do not infer or invent.",
    "7. Every promptText must be a direct transcription or faithful consolidation of visible question wording from the supplied paper, but remove leading question labels such as 1(c), (a), or ii and remove mark allocations such as [2], [2 marks], or (2 marks).",
    "8. Include originalContent.evidenceSnippet with a short visible source snippet where possible, originalContent.imagePageReferences for pages read from images, originalContent.confidence from 0-100, and originalContent.extractionWarnings for uncertainty.",
    "9. responseType must be exactly one of long_text, short_text, numeric, single_choice, multi_select. Do not output calculation, tick_box, equation, table, diagram, or any other value.",
    "10. Only reinterpret genuinely simple answer formats into supported UI types. If the item is a table/grid/matrix, row-by-row checkbox table, drawing, diagram-labelling, or matching table, keep the question text but set originalContent.unsupportedQuestionFormat true and originalContent.unsupportedReason.",
    "10. For single_choice or multi_select questions, extract every visible answer option into options as concise strings. Do not leave A/B/C/D options embedded only in promptText.",
    "11. If a question explicitly refers to a required figure, diagram, graph, map, photograph, flowchart, or source extract, add a mediaRef with the visible label and pageNumber even when exact cropping is not available. Do not add mediaRefs for ordinary answer tables, tick boxes, blank working spaces, or whole pages.",
    "12. Copy visible mark allocations into maxMarks for the specific extracted item. If promptText visibly contains several subpart mark allocations, either split the subparts or make maxMarks the sum of those visible allocations.",
    "Question boundaries:",
    JSON.stringify(input.boundaries),
    "Page text:",
    pagesBlock(input.pages, 3200),
  ].join("\n\n");
}

export function buildMarkSchemeAlignmentPrompt(input: {
  title: string;
  subject: string;
  questions: Array<{ questionNumber: string; promptText: string; maxMarks: number; pageReferences: number[] }>;
  markSchemePages: PagePromptContext[];
}) {
  return [
    "Align mark-scheme content to already extracted exam questions.",
    "Return JSON only. No markdown. No commentary.",
    `Title: ${input.title}`,
    `Subject: ${input.subject}`,
    "Output shape:",
    `{"alignments":[{"questionNumber":"${QUESTION_NUMBER_PLACEHOLDER}","markSchemeRef":"__VISIBLE_MARK_SCHEME_REFERENCE__","markSchemeData":{"source":"visible_mark_scheme_row","questionNumber":"${QUESTION_NUMBER_PLACEHOLDER}","maxMarks":1,"rows":[{"markPoint":"__VISIBLE_MARKING_POINT__","accept":["__ALSO_ACCEPT_VISIBLE_TEXT__"],"doNotAccept":["__DO_NOT_ACCEPT_VISIBLE_TEXT__"],"ignore":["__IGNORE_VISIBLE_TEXT__"],"guidance":"__EXAMINER_GUIDANCE_VISIBLE_TEXT__","marks":1}],"points":["__VISIBLE_MARKING_POINT__"],"evidence":"__FULL_VISIBLE_ROW_OR_SECTION__"}}]}`,
    "The placeholder strings are not content. Never copy them into the output.",
    "Use only supplied mark-scheme text. If a question has no readable mark-scheme content, return markSchemeRef:null and markSchemeData:null for that question.",
    "Interpret mark-scheme tables like an examiner: keep the exact row/section used, separate marking points, allow/also-accept alternatives, do-not-accept exclusions, ignore notes, and examiner guidance.",
    "First infer the exam board/style. OCR mark schemes often use Question / Answer / Mark / Guidance rows. AQA mark schemes often use Question / Answers / Extra information / Mark / AO rows. Preserve the row text from the correct exam-board structure.",
    "Align by question number, subquestion number, page references, wording, and mark totals. Do not align a row to the wrong question just because the number is nearby.",
    "If attached mark-scheme images are supplied, use only visible marking text from those images.",
    "Image-page map:",
    imageMapBlock(input.markSchemePages),
    "Questions:",
    clipped(JSON.stringify(input.questions), 10000),
    "Mark scheme text:",
    pagesBlock(input.markSchemePages, 3500),
  ].join("\n\n");
}

export function buildPaperMarkingPrompt(input: {
  subject: string;
  questionNumber: string;
  promptText: string;
  maxMarks: number;
  answerText: string;
  markSchemeText: string;
}) {
  return [
    "Mark this answer using only the supplied mark scheme content.",
    "Return JSON only. No markdown. No commentary.",
    `Subject: ${input.subject}`,
    `Question ${input.questionNumber} (${input.maxMarks} marks): ${input.promptText}`,
    `Student answer: ${input.answerText}`,
    `Aligned mark scheme content: ${input.markSchemeText}`,
    "The supplied mark scheme may include several rows from the same parent question. First identify the row/subpart that matches the exact question number and wording, then mark only against that relevant row or rows.",
    "Apply the mark scheme like a careful examiner. Award every mark the student earns using points and acceptable alternatives. Do not award marks for answers listed as do-not-accept. Ignore content listed as ignore unless it contradicts an otherwise correct answer.",
    "Use the markSchemeEvidence field to quote or summarise the exact mark-scheme row/section used. Put row/page/reference details in markSchemeReference.",
    "Return awardedMarks, maxMarks, a short rationale string, missingPoints as an array of strings, markSchemeEvidence as one string or null, markSchemeReference as an object, and confidence.",
    "Do not return markSchemeEvidence as an array. Do not return markSchemeReference as a string.",
    "If supplied mark-scheme content is insufficient, do not fabricate evidence.",
    "If the relevant row cannot be found in the supplied content, awardedMarks must be 0 and the rationale must say that the supplied mark-scheme content was insufficient. Never award marks while also saying the mark scheme shows nothing relevant.",
  ].join("\n\n");
}
