import { useEffect, useMemo, useState } from "react";

import type { GradeBoundary } from "../data/gradeBoundaries";
import { GRADE_BOUNDARY_KEYS } from "../lib/gradeBoundaryOverrides";
import type { GradeEstimate } from "../lib/gradeEstimate";

type GradeEstimateChipProps = {
  estimate: GradeEstimate | null;
  boundary: GradeBoundary | null;
  boundaryLabel: string | null;
  boundaryNote: string | null;
  subjectDataValue: string;
  onSaveOverride: (boundaries: GradeBoundary["boundaries"]) => void;
  onResetOverride: () => void;
};

function draftFromBoundary(boundary: GradeBoundary | null) {
  return GRADE_BOUNDARY_KEYS.reduce<Record<(typeof GRADE_BOUNDARY_KEYS)[number], string>>((draft, key) => {
    draft[key] = boundary ? String(boundary.boundaries[key]) : "";
    return draft;
  }, { "9": "", "8": "", "7": "", "6": "", "5": "", "4": "", "3": "", "2": "", "1": "" });
}

export function GradeEstimateChip({
  estimate,
  boundary,
  boundaryLabel,
  boundaryNote,
  subjectDataValue,
  onSaveOverride,
  onResetOverride,
}: GradeEstimateChipProps) {
  const [open, setOpen] = useState(false);
  const boundaryDraft = useMemo(() => draftFromBoundary(boundary), [boundary]);
  const [draft, setDraft] = useState(() => boundaryDraft);

  useEffect(() => {
    setDraft(boundaryDraft);
  }, [boundaryDraft, open]);

  const parsedDraft = useMemo(() => {
    const next = {} as GradeBoundary["boundaries"];
    for (const key of GRADE_BOUNDARY_KEYS) {
      const value = Number(draft[key]);
      if (!Number.isFinite(value) || value < 0) return null;
      next[key] = Math.trunc(value);
    }
    return next;
  }, [draft]);

  if (!estimate) {
    return <div className="grade-estimate-chip grade-estimate-chip--placeholder">Grade estimate available after 2 attempts</div>;
  }

  return (
    <div className="grade-estimate-chip-wrap" data-subject={subjectDataValue}>
      <button
        type="button"
        className="grade-estimate-chip"
        title={`${Math.round(estimate.percent * 100)}% average across marked attempts`}
        aria-expanded={open}
        aria-label={`Grade estimate: Grade ${estimate.grade}`}
        onClick={() => setOpen((value) => !value)}
      >
        <strong>Grade {estimate.grade}</strong>
        <span>{boundaryLabel ? `Estimated against ${boundaryLabel}` : "Estimated from marked attempts"}</span>
        <div className="grade-estimate-chip__progress" aria-hidden="true">
          <span style={{ width: `${Math.max(10, Math.round(estimate.progressToNext * 100))}%` }} />
        </div>
      </button>
      {open && boundary ? (
        <div className="grade-estimate-popover" role="dialog" aria-label="Grade estimate details">
          <div className="grade-estimate-popover__header">
            <div>
              <span className="eyebrow">Current boundary table</span>
              <strong>{boundaryLabel ?? "Grade estimate"}</strong>
            </div>
            <button className="icon-button" type="button" aria-label="Close grade estimate" onClick={() => setOpen(false)}>
              x
            </button>
          </div>
          <div className="grade-estimate-popover__rows">
            {GRADE_BOUNDARY_KEYS.map((key) => (
              <label className="grade-estimate-popover__row" key={key}>
                <span>{`Grade ${key} boundary`}</span>
                <input
                  inputMode="numeric"
                  value={draft[key]}
                  onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))}
                />
              </label>
            ))}
          </div>
          <p className="muted-copy">{boundaryNote ? `Default source: ${boundaryNote}. Save an override if you need a different tier.` : "Save an override if you need a different boundary table."}</p>
          <div className="button-row">
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                onResetOverride();
                setOpen(false);
              }}
            >
              Reset to defaults
            </button>
            <button
              className="primary-button"
              type="button"
              disabled={!parsedDraft}
              onClick={() => {
                if (!parsedDraft) return;
                onSaveOverride(parsedDraft);
                setOpen(false);
              }}
            >
              Save overrides
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
