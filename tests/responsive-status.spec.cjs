const { expect, test } = require("@playwright/test");

async function seedReadyPaper(page) {
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.localStorage.setItem(
      "past-paper-worker:data:v1",
      JSON.stringify({
        papers: [
          {
            id: "paper-1",
            title: "Responsive paper",
            subject: "OCR Computer Science",
            topic: null,
            subtopic: null,
            year: 2024,
            series: "June",
            paperCode: "J277/01",
            totalMarks: 1,
            durationMinutes: 90,
            hasMarkScheme: true,
            processingStatus: "ready",
            processingError: null,
            processingDiagnostics: null,
            assets: [],
            questions: [
              {
                id: "question-1",
                paperId: "paper-1",
                questionNumber: "1(a)",
                parentQuestionNumber: "1",
                numberingPath: ["1", "a"],
                promptText: "State one thing.",
                maxMarks: 1,
                responseType: "short_text",
                originalFormat: "short_text",
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
            ],
            jobs: [],
            createdAt: "2026-05-06T12:00:00.000Z",
            updatedAt: "2026-05-06T12:00:00.000Z",
          },
        ],
        attempts: [],
      }),
    );
  });
}

test("desktop keeps the right-side system panel visible", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto("/");

  await expect(page.locator(".shell-inspector")).toBeVisible();
  await expect(page.getByRole("button", { name: "System info" })).toBeHidden();
});

test("phone and iPad widths can still access system info", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.getByRole("button", { name: "System info" })).toBeVisible();
  await page.getByRole("button", { name: "System info" }).click();
  await expect(page.getByRole("heading", { name: "System info" })).toBeVisible();
  await page.screenshot({ path: "test-results/system-info-phone.png", fullPage: true });

  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "System info" })).toBeVisible();
});

test("status access does not appear in the active exam flow", async ({ page }) => {
  await seedReadyPaper(page);
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.goto("/");

  await page.getByText("Responsive paper").first().click();
  await page.getByRole("button", { name: /start paper/i }).click();

  await expect(page.getByRole("button", { name: "System info" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send feedback" })).toHaveCount(0);
  await page.screenshot({ path: "test-results/system-info-hidden-taking.png", fullPage: true });
});
