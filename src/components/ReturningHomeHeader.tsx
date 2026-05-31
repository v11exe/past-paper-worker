export function ReturningHomeHeader({
  activeSubjectLabel,
  attemptCount,
  paperCount,
  onContinue,
}: {
  activeSubjectLabel: string | null;
  attemptCount: number;
  paperCount: number;
  onContinue: () => void;
}) {
  return (
    <section className="returning-home-header">
      <div className="returning-home-header__copy">
        <span className="eyebrow">Resume revision</span>
        <strong>Welcome back</strong>
        <p>Pick up where you left off with your stored papers, marks, and review history.</p>
      </div>
      <div className="returning-home-header__actions">
        <div className="returning-home-header__meta">
          <span className="static-chip">{attemptCount} {attemptCount === 1 ? "attempt" : "attempts"}</span>
          <span className="static-chip">{paperCount} {paperCount === 1 ? "paper" : "papers"}</span>
        </div>
        <button className="primary-button" onClick={onContinue}>
          Continue with {activeSubjectLabel ?? "your subject"}
        </button>
      </div>
    </section>
  );
}
