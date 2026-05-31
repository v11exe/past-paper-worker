import { useEffect, useMemo, useState } from "react";

import { AppLogo } from "./AppLogo";
import { attemptSharePayloadSchema, type AttemptSharePayload } from "../lib/sharePayload";

type ShareViewState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; share: AttemptSharePayload };

function statusLabel(status: AttemptSharePayload["questions"][number]["status"]) {
  switch (status) {
    case "correct":
      return "Correct";
    case "partial":
      return "Partial";
    case "mistake":
      return "Missed";
    case "blank":
      return "Blank";
    case "excluded":
      return "Excluded";
    case "pending":
      return "Pending";
    case "issue":
      return "Issue";
  }
}

function statusClass(status: AttemptSharePayload["questions"][number]["status"]) {
  return `share-question__status share-question__status--${status}`;
}

export function ShareView({ shareId }: { shareId: string }) {
  const [state, setState] = useState<ShareViewState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetch(`/api/share/${shareId}`, { headers: { accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(response.status === 404 ? "That share link could not be found." : "This shared attempt could not be loaded.");
        }
        const payload = (await response.json()) as { share?: unknown };
        const parsed = attemptSharePayloadSchema.safeParse(payload.share);
        if (!parsed.success) {
          throw new Error("This share link returned invalid data.");
        }
        if (!cancelled) setState({ status: "ready", share: parsed.data });
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setState({
          status: "error",
          message: reason instanceof Error ? reason.message : "This shared attempt could not be loaded.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [shareId]);

  const percentage = useMemo(() => {
    if (state.status !== "ready" || state.share.totalMarks <= 0) return "0%";
    return `${Math.round((state.share.scoredMarks / state.share.totalMarks) * 100)}%`;
  }, [state]);

  return (
    <div className="product-root app-shell--theme-dark app-shell--accent-elliots share-view-root">
      <main className="share-view">
        <section className="share-view__hero os-window">
          <div className="share-view__brand">
            <AppLogo size={44} />
            <div>
              <span className="eyebrow">Past Paper Worker</span>
              <h1>Shared marked attempt</h1>
            </div>
          </div>

          {state.status === "ready" ? (
            <>
              <p className="share-view__summary">
                {state.share.subject} • {state.share.paperLabel} • {state.share.date}
              </p>
              <div className="share-view__stats">
                <div className="review-summary-card">
                  <span>Score</span>
                  <strong>
                    {state.share.scoredMarks}/{state.share.totalMarks}
                  </strong>
                </div>
                <div className="review-summary-card">
                  <span>Percentage</span>
                  <strong>{percentage}</strong>
                </div>
                <div className="review-summary-card">
                  <span>Questions</span>
                  <strong>{state.share.questions.length}</strong>
                </div>
              </div>
            </>
          ) : state.status === "error" ? (
            <p className="share-view__message">{state.message}</p>
          ) : (
            <p className="share-view__message">Loading shared attempt...</p>
          )}
        </section>

        {state.status === "ready" ? (
          <section className="section-frame share-view__questions">
            <div className="section-frame__header">
              <div>
                <span className="eyebrow">Question breakdown</span>
                <h2>Read-only review snapshot</h2>
                <p>This view shares marks and question outcomes only. Answer text and mark-scheme text stay private.</p>
              </div>
            </div>
            <div className="share-question-list">
              {state.share.questions.map((question) => (
                <article className="share-question" key={question.number}>
                  <div>
                    <strong>Question {question.number}</strong>
                    <p>
                      {question.scored}/{question.marks} marks
                    </p>
                  </div>
                  <span className={statusClass(question.status)}>{statusLabel(question.status)}</span>
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
