import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { App } from "./App";
import { clearData, saveData } from "./lib/storage";
import type { AppData, PastPaper, PastPaperQuestion } from "./types";

function clearUiStorage() {
  [
    "past-paper-worker:feedback-draft:v1",
    "past-paper-worker:selected-subjects:v1.3",
    "past-paper-worker:onboarding-completed:v1.3",
    "past-paper-worker:app-entered:v1.3",
    "past-paper-worker:active-subject:v1.3",
    "past-paper-worker:sidebar-collapsed:v1.3",
  ].forEach((key) => window.localStorage.removeItem(key));
}

async function enterDashboard(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /start practising/i }));
  await user.click(await screen.findByRole("button", { name: /save subjects/i }));
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

    await user.click(screen.getByRole("button", { name: /save subjects/i }));
    expect(await screen.findByRole("heading", { name: "Biology" })).toBeInTheDocument();
  });

  it("collapses the sidebar, opens version history, and opens credits", async () => {
    const user = userEvent.setup();
    render(<App />);
    await enterDashboard(user);

    await user.click(screen.getByRole("button", { name: /collapse sidebar/i }));
    expect(screen.queryByText("Chemistry")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /v1.3 product redesign/i }));
    expect(await screen.findByRole("heading", { name: "Version history" })).toBeInTheDocument();
    expect(screen.getByText("Added the scrollable landing page.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close version history" }));

    await user.click(screen.getByRole("button", { name: /credits/i }));
    expect(await screen.findByText("Developed by Rayaan Omair.")).toBeInTheDocument();
    expect(screen.getByText("Logo credit: Elliot Neilsen.")).toBeInTheDocument();
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
    await user.click(screen.getByText("Question UI paper"));
    await user.click(await screen.findByRole("button", { name: /start paper/i }));

    expect((await screen.findAllByText("Unsupported question type")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("textbox", { name: "Written answer" })).not.toBeInTheDocument();
  });
});
