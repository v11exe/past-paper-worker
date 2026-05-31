import { expect, test } from "@playwright/test";

const UI_KEYS = {
  selectedSubjects: "past-paper-worker:selected-subjects:v1.3.5",
  onboardingComplete: "past-paper-worker:onboarding-completed:v1.3.5",
  activeSubject: "past-paper-worker:active-subject:v1.3.5",
  sidebarCollapsed: "past-paper-worker:sidebar-collapsed:v1.3.5",
  preferences: "past-paper-worker:preferences:v1",
  data: "past-paper-worker:data:v1",
};

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64",
);

function installAiMock(page) {
  return page.addInitScript(() => {
    window.__AI_TEST_MOCK__ = {
      respond: async (request) => {
        if (request.operation === "smoke_ping") {
          return { ok: true, operation: request.operation, model: request.model, text: "{\"provider\":\"gemini\",\"keyConfigured\":true}" };
        }
        if (request.operation === "smoke_diagnostics") {
          return { ok: true, operation: request.operation, model: request.model, text: "{\"example\":\"[REDACTED_GOOGLE_API_KEY]\"}" };
        }
        if (request.operation === "smoke_text" || request.operation === "suggestions") {
          const text = request.operation === "smoke_text" ? "ok" : "1. Process the paper first. 2. Answer every question. 3. Review missing points after marking.";
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
                  markSchemeData: {
                    questionNumber: "1",
                    matchedMarkSchemeQuestionNumber: "1",
                    exactSectionText: "1 Award 1 mark for describing the visible table. Award 1 mark for using the table label accurately.",
                    rows: [
                      {
                        marks: 1,
                        markPoint: "Describe the visible table.",
                        guidance: "Credit any clear description of what the table shows.",
                      },
                      {
                        marks: 1,
                        markPoint: "Use the table label accurately.",
                        accept: ["References Table 1 accurately."],
                      },
                    ],
                  },
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
}

function seedProductUi(page, subjects = ["AQA GCSE Biology"]) {
  return page.addInitScript(({ UI_KEYS, subjects }) => {
    window.localStorage.setItem(UI_KEYS.onboardingComplete, "true");
    window.localStorage.setItem(UI_KEYS.selectedSubjects, JSON.stringify(subjects));
    window.localStorage.setItem(UI_KEYS.activeSubject, subjects[0]);
    window.localStorage.setItem(UI_KEYS.preferences, JSON.stringify({ reduceMotion: "reduce" }));
  }, { UI_KEYS, subjects });
}

function buildQuestion(patch) {
  return {
    id: patch.id,
    paperId: "paper-choice",
    questionNumber: patch.questionNumber,
    parentQuestionNumber: null,
    numberingPath: [patch.questionNumber],
    promptText: patch.promptText,
    maxMarks: patch.maxMarks ?? 1,
    responseType: patch.responseType ?? "short_text",
    originalFormat: patch.originalFormat ?? "text",
    convertedFormat: null,
    originalContent: patch.originalContent ?? {},
    convertedContent: {},
    diagramMediaRefs: [],
    options: patch.options ?? [],
    pageReferences: [1],
    evidenceSnippet: null,
    imagePageReferences: [1],
    confidence: null,
    extractionWarnings: [],
    markSchemeRef: patch.markSchemeRef ?? null,
    markSchemeData: patch.markSchemeData ?? null,
    displayOrder: patch.displayOrder ?? 0,
  };
}

function seedChoiceAndUnsupportedPaper(page) {
  return page.addInitScript(({ UI_KEYS }) => {
    window.localStorage.clear();
    window.localStorage.setItem(UI_KEYS.onboardingComplete, "true");
    window.localStorage.setItem(UI_KEYS.selectedSubjects, JSON.stringify(["AQA GCSE Biology"]));
    window.localStorage.setItem(UI_KEYS.activeSubject, "AQA GCSE Biology");
    window.localStorage.setItem(UI_KEYS.preferences, JSON.stringify({ reduceMotion: "reduce" }));
    window.localStorage.setItem(
      UI_KEYS.data,
      JSON.stringify({
        papers: [
          {
            id: "paper-choice",
            title: "AQA choice and unsupported paper",
            subject: "AQA GCSE Biology",
            topic: null,
            subtopic: null,
            year: 2026,
            series: "June",
            paperCode: "8461/1",
            totalMarks: 3,
            durationMinutes: 45,
            hasMarkScheme: true,
            processingStatus: "ready",
            processingError: null,
            processingDiagnostics: null,
            assets: [],
            questions: [
              {
                id: "choice-1",
                paperId: "paper-choice",
                questionNumber: "1",
                parentQuestionNumber: null,
                numberingPath: ["1"],
                promptText: "Tick one box. \u2610 A nucleus \u2610 B ribosome \u2610 C cell wall \u2610 D cytoplasm",
                maxMarks: 1,
                responseType: "single_choice",
                originalFormat: "text",
                convertedFormat: null,
                originalContent: {},
                convertedContent: {},
                diagramMediaRefs: [],
                options: [],
                pageReferences: [1],
                evidenceSnippet: null,
                imagePageReferences: [1],
                confidence: null,
                extractionWarnings: [],
                markSchemeRef: null,
                markSchemeData: null,
                displayOrder: 0,
              },
              {
                id: "unsupported-2",
                paperId: "paper-choice",
                questionNumber: "2",
                parentQuestionNumber: null,
                numberingPath: ["2"],
                promptText: "Complete the table to show two advantages and two disadvantages.",
                maxMarks: 2,
                responseType: "short_text",
                originalFormat: "text",
                convertedFormat: null,
                originalContent: { unsupportedQuestionFormat: true, unsupportedReason: "Needs a table UI." },
                convertedContent: {},
                diagramMediaRefs: [],
                options: [],
                pageReferences: [1],
                evidenceSnippet: null,
                imagePageReferences: [1],
                confidence: null,
                extractionWarnings: [],
                markSchemeRef: null,
                markSchemeData: null,
                displayOrder: 1,
              },
            ],
            jobs: [],
            createdAt: "2026-05-15T12:00:00.000Z",
            updatedAt: "2026-05-15T12:00:00.000Z",
          },
        ],
        attempts: [],
      }),
    );
  }, { UI_KEYS });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ UI_KEYS }) => {
    Object.values(UI_KEYS).forEach((key) => window.localStorage.removeItem(key));
  }, { UI_KEYS });
  await installAiMock(page);
});

test("landing, onboarding, upload, process, take, and surface marking review issues", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: /past papers, marked in minutes/i })).toBeVisible();
  await page.screenshot({ path: "test-results/v1.3-landing-hero.png", fullPage: true });

  await page.locator("#workflow").scrollIntoViewIfNeeded();
  await expect(page.getByRole("heading", { name: /from upload to review/i })).toBeVisible();
  await page.screenshot({ path: "test-results/v1.3-landing-workflow.png", fullPage: true });

  await page.getByRole("button", { name: /start practising/i }).click();
  await expect(page.getByRole("heading", { name: /what subjects are you studying/i })).toBeVisible();
  await page.screenshot({ path: "test-results/v1.3-onboarding-subjects.png", fullPage: true });

  await page.getByRole("button", { name: /biology/i }).click();
  await page.getByRole("button", { name: /save subjects/i }).click();
  await expect(page.getByRole("heading", { name: "Biology" })).toBeVisible();
  await page.screenshot({ path: "test-results/v1.3-subject-dashboard-empty.png", fullPage: true });

  await page.locator(".subject-dashboard").getByRole("button", { name: /^Upload paper$/ }).first().click();
  await expect(page.getByRole("heading", { name: "New past paper" })).toBeVisible();
  await page.getByLabel("Title").fill("Mock GCSE Paper");
  await page.locator('input[type="file"]').nth(0).setInputFiles({ name: "paper.png", mimeType: "image/png", buffer: tinyPng });
  await page.locator('input[type="file"]').nth(1).setInputFiles({ name: "mark-scheme.png", mimeType: "image/png", buffer: tinyPng });
  await page.getByRole("button", { name: "Process now" }).click();

  await expect(page.getByRole("button", { name: /Show questions/ })).toBeVisible();
  await page.getByRole("button", { name: /Show questions/ }).click();
  await expect(page.getByText("Q1")).toBeVisible();
  await expect(page.getByText("2025 / June / MOCK-1 / 2 marks / 1 min")).toBeVisible();
  await page.screenshot({ path: "test-results/v1.3-processed-paper-preview.png", fullPage: true });

  await page.getByRole("button", { name: /Start paper/ }).last().click();
  await expect(page.getByRole("button", { name: "Exit focus" })).toBeVisible();
  await page.getByLabel("Written answer").fill("It shows a labelled table.");
  await page.screenshot({ path: "test-results/v1.3-taking-mode.png", fullPage: true });
  await page.getByRole("button", { name: "Save & Next" }).click();

  await expect(page.getByText("Submitted answers")).toBeVisible();
  await page.getByRole("button", { name: "Mark answered questions" }).click();
  await expect(page.getByText("Attempt marked with issues. 1 question need review.")).toBeVisible();
  await expect(page.getByText("Marked review")).toBeVisible();
  await expect(page.locator(".paper-mark-box strong", { hasText: "Issue" })).toBeVisible();
  await expect(page.getByText("Could not safely align this question with the mark scheme.")).toBeVisible();
  await page.screenshot({ path: "test-results/v1.3-marked-review.png", fullPage: true });
});

test("renders AQA choices and unsupported questions as dedicated controls", async ({ page }) => {
  await seedChoiceAndUnsupportedPaper(page);
  await page.goto("/");
  await page.getByRole("button", { name: /enter app/i }).click();

  await page.getByText("AQA choice and unsupported paper").click();
  await page.getByRole("button", { name: /Start paper/ }).last().click();

  await expect(page.getByRole("radio", { name: "A. nucleus" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "B. ribosome" })).toBeVisible();
  await expect(page.getByText("\u2610")).toHaveCount(0);
  await page.screenshot({ path: "test-results/v1.3-aqa-choice-controls.png", fullPage: true });

  await page.getByRole("radio", { name: "A. nucleus" }).check();
  await page.getByRole("button", { name: "Save & Next" }).click();
  await expect(page.getByText("Submitted answers")).toBeVisible();
  await expect(page.getByText("Unsupported questions are excluded from the supported total.")).toBeVisible();
  await expect(page.getByText(/^1$/).first()).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Written answer" })).toHaveCount(0);
  await page.screenshot({ path: "test-results/v1.3-unsupported-question-panel.png", fullPage: true });
});

test("renders a read-only share snapshot from the public share route", async ({ page }) => {
  await page.route("**/api/share/Ab12Cd3", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        share: {
          subject: "AQA GCSE Biology",
          date: "2026-05-31",
          paperLabel: "Question UI paper · 2026 · June · 8461/1",
          totalMarks: 2,
          scoredMarks: 1,
          questions: [{ number: "1", marks: 2, scored: 1, status: "partial" }],
        },
      }),
    });
  });

  await page.goto("/share/Ab12Cd3");

  await expect(page.getByRole("heading", { name: /shared marked attempt/i })).toBeVisible();
  await expect(page.getByText(/read-only review snapshot/i)).toBeVisible();
  await expect(page.getByText("Partial")).toBeVisible();
  await page.screenshot({ path: "test-results/v1.3-share-view.png", fullPage: true });
});
