import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { App } from "./App";
import { clearData, saveData } from "./lib/storage";
import type { AppData, PastPaper, PastPaperAttempt, PastPaperQuestion } from "./types";

function clearUiStorage() {
  [
    "past-paper-worker:feedback-draft:v1",
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

  it("shows the landing page again on reload even when subjects are already saved", async () => {
    window.localStorage.setItem("past-paper-worker:selected-subjects:v1.3.4", JSON.stringify(["AQA GCSE Biology"]));
    window.localStorage.setItem("past-paper-worker:onboarding-completed:v1.3.4", "true");
    render(<App />);

    expect(screen.getByRole("heading", { name: /past papers, marked in minutes/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Biology" })).not.toBeInTheDocument();
  });

  it("collapses the sidebar, opens version history, and opens credits", async () => {
    const user = userEvent.setup();
    render(<App />);
    await enterDashboard(user);

    await user.click(screen.getByRole("button", { name: /collapse sidebar/i }));
    expect(screen.queryByText("Chemistry")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /v1.3.4 marking layout fix/i }));
    expect(await screen.findByRole("heading", { name: "Version history" })).toBeInTheDocument();
    expect(screen.getByText("Tightened supported-subject handling.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close version history" }));

    await user.click(screen.getByRole("button", { name: /credits/i }));
    expect(await screen.findByText("Developed by Rayaan Omair.")).toBeInTheDocument();
    expect(screen.getByText("Logo credit: Elliot Neilsen.")).toBeInTheDocument();
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
            message: "Gemini quota limit reached. Retry in about 47 seconds.",
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
    expect(screen.getByText(/gemini quota limit reached/i)).toBeInTheDocument();
    expect(screen.getAllByText("Pending").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /retry this question/i })).toBeInTheDocument();
  });
});
