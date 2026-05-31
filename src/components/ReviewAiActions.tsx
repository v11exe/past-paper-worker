type ReviewAiActionsProps = {
  limited: boolean;
  used: number;
  remaining: number;
  busyAction: "follow_up" | "explainer" | null;
  followUpText: string | null;
  error: string | null;
  onFollowUp: () => void;
  onDismissFollowUp: () => void;
};

export function ReviewAiActions({
  limited,
  used,
  remaining,
  busyAction,
  followUpText,
  error,
  onFollowUp,
  onDismissFollowUp,
}: ReviewAiActionsProps) {
  const limitTitle = `Daily review AI limit reached (${used}/3). Resets after midnight.`;

  return (
    <section className="review-ai-panel">
      <div className="review-ai-panel__header">
        <div>
          <span className="eyebrow">Review helper</span>
          <strong>Use AI to deepen this question review</strong>
        </div>
        {limited ? (
          <span className="static-chip static-chip--danger" title={limitTitle}>
            Review AI limit reached for today ({used}/3)
          </span>
        ) : (
          <span className="review-ai-panel__usage">{remaining}/3 review AI uses left today</span>
        )}
      </div>

      <div className="button-row review-ai-panel__actions">
        <button
          className="secondary-button"
          onClick={onFollowUp}
          disabled={limited || busyAction !== null}
          title={limited ? limitTitle : "Ask one follow-up question about this answer"}
        >
          {busyAction === "follow_up" ? "Writing follow-up..." : "Ask a follow-up"}
        </button>
      </div>

      <p className="review-ai-panel__hint">Use the <strong>?</strong> buttons in the mark-scheme rows to explain a specific point in plain English.</p>

      {error ? <p className="review-ai-panel__error">{error}</p> : null}

      {followUpText ? (
        <article className="review-ai-card">
          <div className="review-ai-card__header">
            <span className="eyebrow">Follow-up question</span>
            <button className="icon-button" type="button" aria-label="Close follow-up question" onClick={onDismissFollowUp}>
              x
            </button>
          </div>
          <p>{followUpText}</p>
        </article>
      ) : null}
    </section>
  );
}
