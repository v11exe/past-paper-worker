import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { clearData, saveData } from "./lib/storage";
import type { AppData, PastPaper } from "./types";

function buildReadyPaper(): PastPaper {
  return {
    id: "paper-1",
    title: "Test paper",
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
  };
}

function seedData(data: AppData) {
  saveData(data);
}

describe("feedback flow", () => {
  beforeEach(() => {
    clearData();
    window.localStorage.removeItem("past-paper-worker:feedback-draft:v1");
    vi.restoreAllMocks();
  });

  afterEach(() => {
    clearData();
    window.localStorage.removeItem("past-paper-worker:feedback-draft:v1");
    vi.restoreAllMocks();
  });

  it("shows the floating feedback button on dashboard pages and opens/closes the modal", async () => {
    const user = userEvent.setup();
    render(<App />);

    const button = screen.getByRole("button", { name: "Send feedback" });
    expect(button).toBeInTheDocument();

    await user.click(button);
    expect(screen.getByRole("heading", { name: "Send feedback" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close feedback form" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Send feedback" })).not.toBeInTheDocument());
  });

  it("hides the feedback button when the upload modal is open", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getAllByRole("button", { name: /upload paper/i })[0]);

    await waitFor(() => expect(screen.queryByRole("button", { name: "Send feedback" })).not.toBeInTheDocument());
  });

  it("keeps the submit button disabled until the form is valid and shows inline validation", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Send feedback" }));

    const submit = screen.getByRole("button", { name: "Send feedback" });
    expect(submit).toBeDisabled();

    await user.click(screen.getByLabelText("Email"));
    await user.tab();
    await user.click(screen.getByLabelText("Title"));
    await user.tab();
    await user.click(screen.getByLabelText("Description"));
    await user.tab();

    expect(await screen.findByText("Enter your email.")).toBeInTheDocument();
    expect(screen.getByText("Enter a title.")).toBeInTheDocument();
    expect(screen.getByText("Enter a description.")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Email"), "student@example.com");
    await user.type(screen.getByLabelText("Title"), "Add a better timer");
    await user.type(screen.getByLabelText("Description"), "A compact timer on dashboard cards would be really helpful.");

    await waitFor(() => expect(submit).toBeEnabled());
  });

  it("submits valid feedback successfully and closes the modal", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }) as never,
    );

    render(<App />);

    await user.click(screen.getByRole("button", { name: "Send feedback" }));
    await user.type(screen.getByLabelText("Email"), "student@example.com");
    await user.type(screen.getByLabelText("Title"), "Feature request");
    await user.type(screen.getByLabelText("Description"), "Please add a small calculator helper for numeric questions.");
    await user.click(screen.getByRole("button", { name: "Send feedback" }));

    await waitFor(() => expect(screen.queryByRole("heading", { name: "Send feedback" })).not.toBeInTheDocument());
    expect(await screen.findByText("Feedback sent. Thank you.")).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/feedback",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
      }),
    );
  });

  it("keeps the user's input when feedback submission fails", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: "Feedback could not be sent. Please try again." }), {
        status: 502,
        headers: { "content-type": "application/json" },
      }) as never,
    );

    render(<App />);

    await user.click(screen.getByRole("button", { name: "Send feedback" }));
    await user.type(screen.getByLabelText("Email"), "student@example.com");
    await user.type(screen.getByLabelText("Title"), "Bug report");
    await user.type(screen.getByLabelText("Description"), "Question numbering slipped on the latest paper.");
    await user.click(screen.getByRole("button", { name: "Send feedback" }));

    expect(await screen.findByText("Feedback could not be sent. Please try again.")).toBeInTheDocument();
    expect(screen.getByDisplayValue("student@example.com")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Bug report")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Question numbering slipped on the latest paper.")).toBeInTheDocument();
  });

  it("hides the feedback button during the active exam flow", async () => {
    const user = userEvent.setup();
    seedData({ papers: [buildReadyPaper()], attempts: [] });

    render(<App />);

    const openPaperButton = screen.getAllByText("Test paper")[0].closest("button");
    expect(openPaperButton).not.toBeNull();
    await user.click(openPaperButton!);
    expect(await screen.findByRole("button", { name: /start paper/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send feedback" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /start paper/i }));

    expect(await screen.findByRole("button", { name: /end attempt/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send feedback" })).not.toBeInTheDocument();
  });
});
