import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { clearData, saveData } from "./lib/storage";
import type { AppData, PastPaper, PastPaperAttempt, PastPaperQuestion } from "./types";
import { currentVersionEntry } from "./versionHistory";

function clearUiStorage() {
  [
    "past-paper-worker:feedback-draft:v1",
    "past-paper-worker:selected-subjects:v1.4.0",
    "past-paper-worker:onboarding-completed:v1.4.0",
    "past-paper-worker:active-subject:v1.4.0",
    "past-paper-worker:sidebar-collapsed:v1.4.0",
    "past-paper-worker:selected-subjects:v1.3.5",
    "past-paper-worker:onboarding-completed:v1.3.5",
    "past-paper-worker:active-subject:v1.3.5",
    "past-paper-worker:sidebar-collapsed:v1.3.5",
    "past-paper-worker:selected-subjects:v1.3.4",
    "past-paper-worker:onboarding-completed:v1.3.4",
    "past-paper-worker:active-subject:v1.3.4",
    "past-paper-worker:sidebar-collapsed:v1.3.4",
  ].forEach((key) => window.localStorage.removeItem(key));
}

async function enterDashboard(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /start practising/i }));
  await waitFor(() => {
    expect(screen.queryByRole("button", { name: /save subjects/i }) || screen.queryByRole("heading", { name: "Biology" })).toBeTruthy();
  });
  const saveButton = screen.queryByRole("button", { name: /save subjects/i });
  if (saveButton) {
    await user.click(await screen.findByRole("button", { name: /biology/i }));
    await user.click(saveButton);
  }
}

function question(patch: Partial<PastPaperQuestion>): PastPaperQuestion {
  return {
    id: patch.id ?? "question-1",
    paperId: "paper-1",
    questionNumber: patch.questionNumber ?? "1",
    parentQuestionNumber: null,
    numberingPath: [patch.questionNumber ?? "1"],
    promptText: patch.promptText ?? "State one thing.",
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
    markSchemeRef: null,
    markSchemeData: null,
    displayOrder: patch.displayOrder ?? 0,
  };
}

function buildPaper(questions: PastPaperQuestion[]): PastPaper {
  return {
    id: "paper-1",
    title: "Question UI paper",
    subject: "AQA GCSE Biology",
    topic: null,
    subtopic: null,
    year: 2026,
    series: "June",
    paperCode: "8461/1",
    totalMarks: questions.reduce((sum, item) => sum + item.maxMarks, 0),
    durationMinutes: 60,
    hasMarkScheme: true,
    processingStatus: "ready",
    processingError: null,
    processingDiagnostics: null,
    assets: [],
    questions,
    jobs: [],
    createdAt: "2026-05-15T12:00:00.000Z",
    updatedAt: "2026-05-15T12:00:00.000Z",
  };
}

function seedData(data: AppData) {
  saveData(data);
}

function buildAttempt(paper: PastPaper, patch: Partial<PastPaperAttempt>): PastPaperAttempt {
  return {
    id: patch.id ?? "attempt-1",
    paperId: paper.id,
    status: patch.status ?? "submitted",
    startedAt: "2026-05-15T12:00:00.000Z",
    submittedAt: "2026-05-15T12:10:00.000Z",
    completedAt: patch.completedAt ?? null,
    durationSeconds: 600,
    overtimeSeconds: 0,
    actualScore: 0,
    confidenceAdjustedScore: 0,
    totalMarks: paper.totalMarks ?? 0,
    answers: patch.answers ?? [],
    marks: patch.marks ?? [],
    remarks: patch.remarks ?? [],
    markingIssues: patch.markingIssues ?? [],
  };
}

describe("v1.3 product shell", () => {
  beforeEach(() => {
    clearData();
    clearUiStorage();
  });

  afterEach(() => {
    clearData();
    clearUiStorage();
  });

  it("loads the landing page first, then saves onboarding subjects", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByRole("heading", { name: /past papers, marked in minutes/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /start practising/i }));
    expect(await screen.findByRole("heading", { name: /what subjects are you studying/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save subjects/i })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /biology/i }));
    await user.click(screen.getByRole("button", { name: /save subjects/i }));
    expect(await screen.findByRole("heading", { name: "Biology" })).toBeInTheDocument();
  });

  it("reuses v1.3.5 onboarding state after leaving the landing page", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("past-paper-worker:selected-subjects:v1.3.5", JSON.stringify(["AQA GCSE Biology"]));
    window.localStorage.setItem("past-paper-worker:onboarding-completed:v1.3.5", "true");
    render(<App />);

    expect(screen.getByRole("heading", { name: /past papers, marked in minutes/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Biology" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /start practising/i }));
    expect(await screen.findByRole("heading", { name: "Biology" })).toBeInTheDocument();
  });

  it("ignores v1.3.4 onboarding state and asks the user to save subjects again", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("past-paper-worker:selected-subjects:v1.3.4", JSON.stringify(["AQA GCSE Biology"]));
    window.localStorage.setItem("past-paper-worker:onboarding-completed:v1.3.4", "true");
    render(<App />);

    await user.click(screen.getByRole("button", { name: /start practising/i }));
    expect(await screen.findByRole("heading", { name: /what subjects are you studying/i })).toBeInTheDocument();
  });

  it("collapses the sidebar, opens version history, and opens credits", async () => {
    const user = userEvent.setup();
    render(<App />);
    await enterDashboard(user);

    await user.click(screen.getByRole("button", { name: /collapse sidebar/i }));
    expect(screen.queryByText("Chemistry")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: new RegExp(`${currentVersionEntry.version} ${currentVersionEntry.title}`, "i") }));
    expect(await screen.findByRole("heading", { name: "Version history" })).toBeInTheDocument();
    expect(screen.getByText("Added unsupported question dots in focus mode with red styling.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close version history" }));

    await user.click(screen.getByRole("button", { name: /credits/i }));
    expect(await screen.findByText("Rayaan Omair")).toBeInTheDocument();
    expect(screen.getByText("Elliot Neilsen")).toBeInTheDocument();
    expect(screen.getByText(/Anthropic Claude/i)).toBeInTheDocument();
  });

  it("keeps unsupported subjects out of the main rail and shows them in the unsupported dropdown", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: /start practising/i }));
    await user.click(await screen.findByRole("button", { name: /unsupported subjects/i }));
    await user.click((await screen.findAllByRole("button", { name: /maths/i }))[0]);
    await user.click(screen.getByRole("button", { name: /biology/i }));
    await user.click(screen.getByRole("button", { name: /save subjects/i }));

    expect(await screen.findByRole("heading", { name: "Biology" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Maths" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /unsupported subjects/i }));
    expect(await screen.findByText("Maths")).toBeInTheDocument();
    expect(screen.getByText("added")).toBeInTheDocument();
  });

  it("uses the running app version in the unsupported-subject legacy papers message", async () => {
    const user = userEvent.setup();
    const mathsSubject = "Pearson Edexcel GCSE Mathematics";
    seedData({
      papers: [
        {
          ...buildPaper([question({ id: "legacy-maths-question", promptText: "State one thing." })]),
          id: "legacy-maths-paper",
          title: "Legacy Maths Paper",
          subject: mathsSubject,
        },
      ],
      attempts: [],
    });
    window.localStorage.setItem("past-paper-worker:selected-subjects:v1.4.0", JSON.stringify(["AQA GCSE Biology", mathsSubject]));
    window.localStorage.setItem("past-paper-worker:onboarding-completed:v1.4.0", "true");
    window.localStorage.setItem("past-paper-worker:active-subject:v1.4.0", mathsSubject);

    render(<App />);
    await user.click(screen.getByRole("button", { name: /start practising/i }));
    await user.click(screen.getByRole("button", { name: /unsupported subjects/i }));
    await user.click((await screen.findAllByRole("button", { name: /maths/i }))[0]);

    expect(await screen.findByRole("heading", { name: /upload support is not available for this subject yet\./i })).toBeInTheDocument();
    expect(screen.queryByText(/v1\.4\.1 does not treat it as supported\./i)).not.toBeInTheDocument();
  });

  it("preselects the active subject in the upload modal", async () => {
    const user = userEvent.setup();
    render(<App />);
    await enterDashboard(user);

    await user.click(screen.getAllByRole("button", { name: /upload paper/i })[0]);

    expect(await screen.findByRole("heading", { name: "New past paper" })).toBeInTheDocument();
    expect(screen.getByLabelText("Subject")).toHaveValue("AQA GCSE Biology");
  });

  it("renders recovered AQA single-choice options as radio buttons without glyphs", async () => {
    const user = userEvent.setup();
    seedData({
      papers: [
        buildPaper([
          question({
            promptText: "Tick one box. \u2610 A nucleus \u2610 B ribosome \u2610 C cell wall \u2610 D cytoplasm",
            responseType: "single_choice",
            options: [],
          }),
        ]),
      ],
      attempts: [],
    });

    render(<App />);
    await enterDashboard(user);
    await user.click(screen.getByText("Question UI paper"));
    await user.click(await screen.findByRole("button", { name: /start paper/i }));

    expect(await screen.findByRole("radio", { name: "A. nucleus" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "B. ribosome" })).toBeInTheDocument();
    expect(screen.queryByText("\u2610")).not.toBeInTheDocument();
  });

  it("renders multi-select choices as checkboxes", async () => {
    const user = userEvent.setup();
    seedData({
      papers: [
        buildPaper([
          question({
            promptText: "Choose two answers. A diffusion B osmosis C respiration D photosynthesis",
            responseType: "multi_select",
            options: [],
          }),
        ]),
      ],
      attempts: [],
    });

    render(<App />);
    await enterDashboard(user);
    await user.click(screen.getByText("Question UI paper"));
    await user.click(await screen.findByRole("button", { name: /start paper/i }));

    expect(await screen.findByRole("checkbox", { name: "A. diffusion" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "B. osmosis" })).toBeInTheDocument();
  });

  it("renders unsupported questions as a panel instead of a textarea", async () => {
    const user = userEvent.setup();
    seedData({
      papers: [
        buildPaper([
          question({
            promptText: "Complete the table to show two advantages and two disadvantages.",
            responseType: "short_text",
            originalContent: { unsupportedQuestionFormat: true, unsupportedReason: "Needs a table UI." },
          }),
        ]),
      ],
      attempts: [],
    });

    render(<App />);
    await enterDashboard(user);
    await user.click(screen.getByText("Question UI paper"));
    await user.click(await screen.findByRole("button", { name: /start paper/i }));

    expect((await screen.findAllByText("Unsupported question type")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("textbox", { name: "Written answer" })).not.toBeInTheDocument();
  });

  it("keeps the product shell visible for submitted attempts", async () => {
    const user = userEvent.setup();
    const paper = buildPaper([question({ id: "q1", promptText: "State one thing." })]);
    seedData({
      papers: [paper],
      attempts: [
        buildAttempt(paper, {
          status: "submitted",
          answers: [{
            id: "answer-1",
            attemptId: "attempt-1",
            questionId: "q1",
            responseText: "A response",
            numericResponse: null,
            selectedOptions: [],
            skipped: false,
            skippedWithConfidence: false,
            confidencePredictedMarks: null,
            createdAt: "2026-05-15T12:01:00.000Z",
            updatedAt: "2026-05-15T12:01:00.000Z",
          }],
        }),
      ],
    });

    render(<App />);
    await enterDashboard(user);
    await user.click(screen.getByText("Question UI paper"));
    await user.click(screen.getByRole("button", { name: /submitted/i }));

    expect(await screen.findByText("Submitted answers")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /mark answered questions/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /settings/i })).toBeInTheDocument();
  });

  it("opens the admin inbox from settings and unlocks it with the entered code", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, entries: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }) as never,
    );

    render(<App />);
    await enterDashboard(user);

    await user.click(screen.getByRole("button", { name: /settings/i }));
    await user.click(screen.getByRole("button", { name: /open admin inbox/i }));

    expect(await screen.findByRole("heading", { name: "Feedback inbox" })).toBeInTheDocument();

    await user.type(screen.getByLabelText("Admin code"), "super-secret");
    await user.click(screen.getByRole("button", { name: /^unlock$/i }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/admin/feedback",
        expect.objectContaining({
          headers: { "x-admin-code": "super-secret" },
        }),
      );
    });
    expect(await screen.findByText("No feedback submissions yet.")).toBeInTheDocument();
  });

  it("keeps the admin code entry open when the unlock code is rejected", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: "Invalid admin code." }), {
        status: 403,
        headers: { "content-type": "application/json" },
      }) as never,
    );

    render(<App />);
    await enterDashboard(user);

    await user.click(screen.getByRole("button", { name: /settings/i }));
    await user.click(screen.getByRole("button", { name: /open admin inbox/i }));

    expect(await screen.findByRole("heading", { name: "Feedback inbox" })).toBeInTheDocument();

    await user.type(screen.getByLabelText("Admin code"), "wrong-code");
    await user.click(screen.getByRole("button", { name: /^unlock$/i }));

    expect(await screen.findByText("Invalid admin code.")).toBeInTheDocument();
    expect(screen.getByLabelText("Admin code")).toHaveValue("wrong-code");
    expect(screen.getByRole("button", { name: /^unlock$/i })).toBeEnabled();
    expect(screen.queryByText("No feedback submissions yet.")).not.toBeInTheDocument();
  });

  it("shows pending marking issues in the review shell instead of a zero mark", async () => {
    const user = userEvent.setup();
    const paper = buildPaper([question({ id: "q1", promptText: "State one thing." })]);
    seedData({
      papers: [paper],
      attempts: [
        buildAttempt(paper, {
          status: "marked",
          completedAt: "2026-05-15T12:11:00.000Z",
          answers: [{
            id: "answer-1",
            attemptId: "attempt-1",
            questionId: "q1",
            responseText: "A response",
            numericResponse: null,
            selectedOptions: [],
            skipped: false,
            skippedWithConfidence: false,
            confidencePredictedMarks: null,
            createdAt: "2026-05-15T12:01:00.000Z",
            updatedAt: "2026-05-15T12:01:00.000Z",
          }],
          markingIssues: [{
            questionId: "q1",
            type: "transient_provider_error",
            message: "AI provider quota limit reached. Retry in about 47 seconds.",
            retryAfterMs: 47000,
            createdAt: "2026-05-15T12:11:00.000Z",
          }],
        }),
      ],
    });

    render(<App />);
    await enterDashboard(user);
    await user.click(screen.getByText("Question UI paper"));
    await user.click(screen.getAllByRole("button", { name: /marked/i })[1]);

    expect(await screen.findByText("Marked review")).toBeInTheDocument();
    expect(screen.getByText(/ai provider quota limit reached/i)).toBeInTheDocument();
    expect(screen.getAllByText("Pending").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /retry this question/i })).toBeInTheDocument();
  });
});
