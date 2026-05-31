import { ExternalLink, X } from "lucide-react";
import { useEffect, useState } from "react";

const PMT_PAST_PAPERS_URL = "https://www.physicsandmathstutor.com/past-papers/";

export function PaperRecommendationCard({ label }: { label: string | null }) {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setDismissed(false);
  }, [label]);

  if (!label || dismissed) return null;

  return (
    <section className="paper-recommendation-card">
      <div className="paper-recommendation-card__copy">
        <span className="eyebrow">Recommended next paper</span>
        <strong>{label}</strong>
        <p>Keep the momentum going with a fresh paper from the same subject.</p>
      </div>
      <div className="button-row paper-recommendation-card__actions">
        <a className="secondary-button" href={PMT_PAST_PAPERS_URL} target="_blank" rel="noreferrer">
          <ExternalLink size={16} /> Open on PMT
        </a>
        <button className="icon-button" type="button" aria-label="Dismiss recommendation" onClick={() => setDismissed(true)}>
          <X size={16} />
        </button>
      </div>
    </section>
  );
}
