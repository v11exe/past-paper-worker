const { expect, test } = require("@playwright/test");

const UI_KEYS = {
  selectedSubjects: "past-paper-worker:selected-subjects:v1.3.3",
  onboardingComplete: "past-paper-worker:onboarding-completed:v1.3.3",
  activeSubject: "past-paper-worker:active-subject:v1.3.3",
  sidebarCollapsed: "past-paper-worker:sidebar-collapsed:v1.3.3",
  preferences: "past-paper-worker:preferences:v1",
  data: "past-paper-worker:data:v1",
};

function installSmokeMock(page) {
  return page.addInitScript(() => {
    window.__AI_TEST_MOCK__ = {
      respond: async (request) => {
        if (request.operation === "smoke_ping") {
          return { ok: true, operation: request.operation, model: request.model, text: "{\"provider\":\"gemini\",\"keyConfigured\":true}" };
        }
        if (request.operation === "smoke_text") {
          return { ok: true, operation: request.operation, model: request.model, text: "ok" };
        }
        if (request.operation === "smoke_diagnostics") {
          return { ok: true, operation: request.operation, model: request.model, text: "{\"example\":\"[REDACTED_GOOGLE_API_KEY]\"}" };
        }
        return { ok: true, operation: request.operation, model: request.model, text: "{}" };
      },
    };
  });
}

function seedDashboard(page, { withPaper = false, collapsed = false } = {}) {
  return page.addInitScript(({ UI_KEYS, withPaper, collapsed }) => {
    window.localStorage.clear();
    window.localStorage.setItem(UI_KEYS.onboardingComplete, "true");
    window.localStorage.setItem(UI_KEYS.selectedSubjects, JSON.stringify(["AQA GCSE Biology", "OCR GCSE Computer Science J277"]));
    window.localStorage.setItem(UI_KEYS.activeSubject, withPaper ? "OCR GCSE Computer Science J277" : "AQA GCSE Biology");
    window.localStorage.setItem(UI_KEYS.sidebarCollapsed, collapsed ? "true" : "false");
    window.localStorage.setItem(UI_KEYS.preferences, JSON.stringify({ reduceMotion: "reduce" }));
    window.localStorage.setItem(
      UI_KEYS.data,
      JSON.stringify({
        papers: withPaper
          ? [
              {
                id: "paper-1",
                title: "Responsive paper",
                subject: "OCR GCSE Computer Science J277",
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
                createdAt: "2026-05-15T12:00:00.000Z",
                updatedAt: "2026-05-15T12:00:00.000Z",
              },
            ]
          : [],
        attempts: [],
      }),
    );
  }, { UI_KEYS, withPaper, collapsed });
}

test.beforeEach(async ({ page }) => {
  await installSmokeMock(page);
});

test("desktop hides Dev mode by default and reveals diagnostics from settings", async ({ page }) => {
  await seedDashboard(page);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto("/");
  await page.getByRole("button", { name: /enter app/i }).click();

  await expect(page.locator(".shell-inspector")).toHaveCount(0);
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Workspace settings" })).toBeVisible();
  await expect(page.getByLabel("Model switch")).toHaveCount(0);

  await page.getByLabel("Enable Dev mode").check();
  await expect(page.getByLabel("Model switch")).toBeVisible();
  await page.getByRole("button", { name: "Smoke test" }).click();
  await expect(page.getByText(/Last smoke test: proxy ok, text ok/i)).toBeVisible();
  await page.screenshot({ path: "test-results/v1.3-settings-dev-mode.png", fullPage: true });
});

test("collapsed sidebar remains usable on tablet width", async ({ page }) => {
  await seedDashboard(page, { collapsed: true });
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto("/");
  await page.getByRole("button", { name: /enter app/i }).click();

  await expect(page.getByRole("heading", { name: "Biology" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
  await expect(page.getByText("Chemistry")).toHaveCount(0);
  await page.screenshot({ path: "test-results/v1.3-collapsed-sidebar-tablet.png", fullPage: true });

  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await expect(page.getByText("Computer Science")).toBeVisible();
});

test("status and feedback controls stay out of the active exam flow", async ({ page }) => {
  await seedDashboard(page, { withPaper: true });
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.goto("/");
  await page.getByRole("button", { name: /enter app/i }).click();

  await page.getByText("Responsive paper").click();
  await page.getByRole("button", { name: /Start paper/ }).last().click();

  await expect(page.getByRole("button", { name: "Send feedback" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Settings" })).toHaveCount(0);
  await expect(page.locator(".shell-inspector")).toHaveCount(0);
  await page.screenshot({ path: "test-results/v1.3-active-exam-clean.png", fullPage: true });
});
