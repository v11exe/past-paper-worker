const { expect, test } = require("@playwright/test");

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.__AI_TEST_MOCK__ = {
      respond: async (request) => {
        if (request.operation === "smoke_ping") {
          return { ok: true, operation: request.operation, model: request.model, text: "{\"provider\":\"gemini\",\"keyConfigured\":true}" };
        }
        if (request.operation === "smoke_diagnostics") {
          return { ok: true, operation: request.operation, model: request.model, text: "{\"example\":\"[REDACTED_GOOGLE_API_KEY]\"}" };
        }
        if (request.operation === "smoke_text" || request.operation === "suggestions") {
          const text =
            request.operation === "smoke_text"
              ? "ok"
              : "1. Process the paper first. 2. Answer every question. 3. Review missing points after marking.";
          return { ok: true, operation: request.operation, model: request.model, text };
        }
        if (request.operation === "page_inventory") {
          return {
            ok: true,
            operation: request.operation,
            model: request.model,
            text: JSON.stringify({
              title: "Mock GCSE Paper",
              year: 2025,
              series: "June",
              paperCode: "MOCK-1",
              totalMarks: 2,
              durationMinutes: 1,
              pages: [{ pageNumber: 1, role: "questions", questionHints: ["1"], visualContent: ["Table 1"], textSummary: "One short question.", needsImage: true }],
            }),
          };
        }
        if (request.operation === "question_boundaries") {
          return {
            ok: true,
            operation: request.operation,
            model: request.model,
            text: JSON.stringify({
              questions: [
                {
                  questionNumber: "1",
                  parentQuestionNumber: null,
                  numberingPath: ["1"],
                  startPage: 1,
                  endPage: 1,
                  maxMarks: 2,
                  responseTypeHint: "short_text",
                  hasVisualContent: true,
                  mediaRefs: ["Table 1"],
                },
              ],
            }),
          };
        }
        if (request.operation === "question_extraction" || request.operation === "smoke_extraction") {
          return {
            ok: true,
            operation: request.operation,
            model: request.model,
            text: JSON.stringify({
              questions: [
                {
                  questionNumber: "1",
                  parentQuestionNumber: null,
                  numberingPath: ["1"],
                  promptText: "Describe what is shown in Table 1.",
                  maxMarks: 2,
                  responseType: "short_text",
                  originalFormat: "text",
                  convertedFormat: null,
                  originalContent: { evidenceSnippet: "Describe what is shown in Table 1.", imagePageReferences: [1], confidence: 92, extractionWarnings: [] },
                  convertedContent: {},
                  options: [],
                  pageReferences: [1],
                  mediaRefs: ["Table 1"],
                  markSchemeRef: null,
                  markSchemeData: null,
                },
              ],
            }),
          };
        }
        if (request.operation === "mark_scheme_alignment") {
          return {
            ok: true,
            operation: request.operation,
            model: request.model,
            text: JSON.stringify({
              alignments: [
                {
                  questionNumber: "1",
                  markSchemeRef: "1",
                  markSchemeData: { points: ["Describes the visible table", "Uses the table label accurately"] },
                },
              ],
            }),
          };
        }
        if (request.operation === "paper_mark" || request.operation === "smoke_marking") {
          return {
            ok: true,
            operation: request.operation,
            model: request.model,
            text: JSON.stringify({
              awardedMarks: 1,
              maxMarks: 2,
              rationale: "The answer identifies one valid marking point.",
              missingPoints: ["Add the second mark-scheme point."],
              markSchemeEvidence: "Award 1 mark for describing the visible table.",
              markSchemeReference: { point: "table" },
              confidence: 90,
            }),
          };
        }
        return { ok: false, operation: request.operation, model: request.model, error: { type: "provider", message: `Unexpected operation: ${request.operation}`, retryable: false } };
      },
    };
  });
});

test("upload, process, take, and AI mark a paper", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("main").getByRole("button", { name: "Upload paper" }).click();
  await page.getByLabel("Title").fill("Mock GCSE Paper");
  const tinyPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
    "base64",
  );
  await page.locator('input[type="file"]').nth(0).setInputFiles({
    name: "paper.png",
    mimeType: "image/png",
    buffer: tinyPng,
  });
  await page.locator('input[type="file"]').nth(1).setInputFiles({
    name: "mark-scheme.png",
    mimeType: "image/png",
    buffer: tinyPng,
  });
  await page.getByRole("button", { name: "Process and submit" }).click();

  await page.getByRole("button", { name: /Show questions/ }).click();
  await expect(page.getByText("Q1")).toBeVisible();
  await expect(page.getByText("1.1")).toBeVisible();
  await page.getByRole("button", { name: "AI suggestions" }).click();
  await expect(page.getByText("Process the paper first.")).toBeVisible();
  await page.getByRole("button", { name: "Smoke test" }).click();
  await expect(page.getByText("Last smoke test")).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: "test-results/past-paper-flow-ready.png", fullPage: true });

  await page.getByRole("button", { name: "Start paper" }).last().click();
  await expect(page.getByRole("button", { name: "Exit focus" })).toBeVisible();
  await expect(page.getByText("Paper Catalogue")).toHaveCount(0);
  await expect(page.getByText("System")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save & Next" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Submit paper" })).toBeVisible();
  await expect(page.getByText("Review")).toHaveCount(0);
  await page.getByLabel("Written answer").fill("It shows a labelled table.");
  await page.getByRole("button", { name: "Submit paper" }).click();
  await expect(page.getByText("Answered 1")).toBeVisible();
  await page.getByRole("button", { name: "AI mark" }).click();

  await expect(page.getByText("Attempt marked with Gemini AI.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Review" })).toBeVisible();
  await expect(page.locator(".paper-mark-box strong", { hasText: "1/2" })).toBeVisible();
  await expect(page.getByText("The answer identifies one valid marking point.")).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: "test-results/past-paper-flow-marked.png", fullPage: true });
});
