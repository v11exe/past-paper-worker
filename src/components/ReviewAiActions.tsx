type ReviewAiActionsProps = {
  limited: boolean;
  used: number;
  remaining: number;
  busyAction: "follow_up" | "explainer" | null;
  canExplain: boolean;
  followUpText: string | null;
  explainerText: string | null;
  error: string | null;
  onFollowUp: () => void;
  onExplainMark: () => void;
};

export function ReviewAiActions({
  limited,
  used,
  remaining,
  busyAction,
  canExplain,
  followUpText,
  explainerText,
  error,
  onFollowUp,
  onExplainMark,
}: ReviewAiActionsProps) {
  return (
    <section className="review-ai-panel">
      <div className="review-ai-panel__header">
        <div>
          <span className="eyebrow">Review helper</span>
          <strong>Use AI to deepen this question review</strong>
        </div>
        {limited ? (
          <span className="static-chip static-chip--danger" title={`Daily AI limit reached (${used}/3). Resets tomorrow.`}>
            Follow-up limit reached for today ({used}/3)
          </span>
        ) : (
          <span className="review-ai-panel__usage">{remaining}/3 review AI uses left today</span>
        )}
      </div>

      <div className="button-row review-ai-panel__actions">
        <button className="secondary-button" onClick={onFollowUp} disabled={limited || busyAction !== null}>
          {busyAction === "follow_up" ? "Writing follow-up..." : "Ask a follow-up"}
        </button>
        <button className="secondary-button" onClick={onExplainMark} disabled={limited || busyAction !== null || !canExplain}>
          {busyAction === "explainer" ? "Explaining..." : "Explain this mark"}
        </button>
      </div>

      {error ? <p className="review-ai-panel__error">{error}</p> : null}

      {followUpText ? (
        <article className="review-ai-card">
          <span className="eyebrow">Follow-up question</span>
          <p>{followUpText}</p>
        </article>
      ) : null}

      {explainerText ? (
        <article className="review-ai-card">
          <span className="eyebrow">Mark explanation</span>
          <p>{explainerText}</p>
        </article>
      ) : null}
    </section>
  );
}
