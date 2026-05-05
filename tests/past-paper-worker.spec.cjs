const { expect, test } = require("@playwright/test");

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.__PUTER_TEST_MOCK__ = {
      ai: {
        chat: async (prompt) => {
          if (prompt.includes("Give 3 helpful suggestions")) {
            return "1. Process the paper first. 2. Answer every question. 3. Review missing points after marking.";
          }
          if (prompt.includes("Build a compact inventory")) {
            return JSON.stringify({
              title: "Mock GCSE Paper",
              year: 2025,
              series: "June",
              paperCode: "MOCK-1",
              totalMarks: 2,
              durationMinutes: 1,
              pages: [{ pageNumber: 1, role: "questions", questionHints: ["1"], visualContent: ["Table 1"], textSummary: "One short question.", needsImage: true }],
            });
          }
          if (prompt.includes("Identify the ordered question boundaries")) {
            return JSON.stringify({
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
            });
          }
          if (prompt.includes("Align mark-scheme content")) {
            return JSON.stringify({
              alignments: [
                {
                  questionNumber: "1",
                  markSchemeRef: "1",
                  markSchemeData: { points: ["Describes the visible table", "Uses the table label accurately"] },
                },
              ],
            });
          }
          if (prompt.includes("Mark this answer")) {
            return JSON.stringify({
              awardedMarks: 1,
              maxMarks: 2,
              rationale: "The answer identifies one valid marking point.",
              missingPoints: ["Add the second mark-scheme point."],
              markSchemeEvidence: "Award 1 mark for describing the visible table.",
              markSchemeReference: { point: "table" },
              confidence: 90,
            });
          }
          return JSON.stringify({
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
          });
        },
        listModels: async () => [{ id: "gpt-5.4-nano", aliases: [] }],
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

  await expect(page.getByText("Attempt marked with Puter AI.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Review" })).toBeVisible();
  await expect(page.locator(".paper-mark-box strong", { hasText: "1/2" })).toBeVisible();
  await expect(page.getByText("The answer identifies one valid marking point.")).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: "test-results/past-paper-flow-marked.png", fullPage: true });
});
