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
    createdAt: "2026-05-06T12:00:00.000Z",
    updatedAt: "2026-05-06T12:00:00.000Z",
  };
}

function seedData(data: AppData) {
  saveData(data);
}

function clearUiStorage() {
  [
    "past-paper-worker:feedback-draft:v1",
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
    expect(screen.queryByRole("button", { name: /save subjects/i }) || screen.queryByRole("heading", { name: "Computer Science" })).toBeTruthy();
  });
  const saveButton = screen.queryByRole("button", { name: /save subjects/i });
  if (saveButton) {
    await user.click(await screen.findByRole("button", { name: /computer science/i }));
    await user.click(saveButton);
  }
}

describe("feedback flow", () => {
  beforeEach(() => {
    clearData();
    clearUiStorage();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    clearData();
    clearUiStorage();
    vi.restoreAllMocks();
  });

  it("shows the floating feedback button on dashboard pages and opens/closes the modal", async () => {
    const user = userEvent.setup();
    render(<App />);
    await enterDashboard(user);

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
    await enterDashboard(user);

    await user.click(screen.getAllByRole("button", { name: /upload paper/i })[0]);

    await waitFor(() => expect(screen.queryByRole("button", { name: "Send feedback" })).not.toBeInTheDocument());
  });

  it("keeps the submit button disabled until the form is valid and shows inline validation", async () => {
    const user = userEvent.setup();
    render(<App />);
    await enterDashboard(user);

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
    await enterDashboard(user);

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

  it("shows attachment controls only for bug reports and includes files in the payload", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }) as never,
    );

    render(<App />);
    await enterDashboard(user);

    await user.click(screen.getByRole("button", { name: "Send feedback" }));
    expect(screen.queryByLabelText("Bug report attachments")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Feedback type"), "bug_report");
    const attachmentInput = await screen.findByLabelText("Bug report attachments");
    const file = new File(['{"ok":true}'], "diagnostics.json", { type: "application/json" });
    await user.upload(attachmentInput, file);

    expect(await screen.findByText("diagnostics.json")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Email"), "student@example.com");
    await user.type(screen.getByLabelText("Title"), "Bug report with file");
    await user.type(screen.getByLabelText("Description"), "Please look at the attached diagnostics file.");
    await user.click(screen.getByRole("button", { name: "Send feedback" }));

    const payload = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(payload.type).toBe("bug_report");
    expect(payload.attachments).toEqual([
      expect.objectContaining({
        filename: "diagnostics.json",
        contentType: "application/json",
      }),
    ]);
  });

  it("rejects unsupported attachment types before submission", async () => {
    const user = userEvent.setup({ applyAccept: false });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<App />);
    await enterDashboard(user);

    await user.click(screen.getByRole("button", { name: "Send feedback" }));
    await user.selectOptions(screen.getByLabelText("Feedback type"), "bug_report");
    const attachmentInput = await screen.findByLabelText("Bug report attachments");
    const file = new File(["unsafe"], "payload.exe", { type: "application/octet-stream" });
    await user.upload(attachmentInput, file);

    expect(await screen.findByText("Only PDF, PNG, JPG, JSON, TXT, and LOG files are supported.")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("enforces the maximum attachment count in the UI", async () => {
    const user = userEvent.setup();
    render(<App />);
    await enterDashboard(user);

    await user.click(screen.getByRole("button", { name: "Send feedback" }));
    await user.selectOptions(screen.getByLabelText("Feedback type"), "bug_report");
    const attachmentInput = await screen.findByLabelText("Bug report attachments");
    const files = [
      new File(["a"], "one.txt", { type: "text/plain" }),
      new File(["b"], "two.txt", { type: "text/plain" }),
      new File(["c"], "three.txt", { type: "text/plain" }),
      new File(["d"], "four.txt", { type: "text/plain" }),
    ];
    await user.upload(attachmentInput, files);

    expect(await screen.findByText("Attach up to 3 files.")).toBeInTheDocument();
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
    await enterDashboard(user);

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
    await enterDashboard(user);

    const openPaperButton = screen.getAllByText("Test paper")[0].closest("button");
    expect(openPaperButton).not.toBeNull();
    await user.click(openPaperButton!);
    expect(await screen.findByRole("button", { name: /start paper/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send feedback" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /start paper/i }));

    expect(await screen.findByRole("button", { name: /end attempt/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send feedback" })).not.toBeInTheDocument();
  });

  it("keeps dev tools hidden until Dev mode is enabled and hides feedback during the active exam flow", async () => {
    const user = userEvent.setup();
    seedData({ papers: [buildReadyPaper()], attempts: [] });

    render(<App />);
    await enterDashboard(user);

    expect(screen.queryByRole("button", { name: /smoke test/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /settings/i }));
    expect(await screen.findByRole("heading", { name: "Workspace settings" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Model switch")).not.toBeInTheDocument();
    await user.click(screen.getByLabelText("Enable Dev mode"));
    const modelSwitch = await screen.findByLabelText("Model switch");
    expect(modelSwitch).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Claude Sonnet 4.6" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Gemini 2.5 Flash Lite" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Gemini 2.5 Flash" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /smoke test/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close settings" }));

    const openPaperButton = screen.getAllByText("Test paper")[0].closest("button");
    expect(openPaperButton).not.toBeNull();
    await user.click(openPaperButton!);
    await user.click(await screen.findByRole("button", { name: /start paper/i }));
    expect(await screen.findByRole("button", { name: /end attempt/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /system info/i })).not.toBeInTheDocument();
  });
});
