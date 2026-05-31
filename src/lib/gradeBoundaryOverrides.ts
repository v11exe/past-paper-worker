import type { GradeBoundary } from "../data/gradeBoundaries";
import { supportedSubjects, type SupportedSubject } from "../subjects";

export const GRADE_BOUNDARY_OVERRIDE_STORAGE_KEY = "past-paper-worker:grade-boundary-overrides:v1";
export const GRADE_BOUNDARY_KEYS = ["9", "8", "7", "6", "5", "4", "3", "2", "1"] as const;

type GradeBoundaries = GradeBoundary["boundaries"];

export type GradeBoundaryOverrideMap = Partial<Record<SupportedSubject, GradeBoundaries>>;

function isBoundaryNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function readBoundaries(value: unknown): GradeBoundaries | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const next = {} as GradeBoundaries;
  for (const key of GRADE_BOUNDARY_KEYS) {
    if (!isBoundaryNumber(record[key])) return null;
    next[key] = Math.trunc(record[key] as number);
  }
  return next;
}

function writeOverrides(overrides: GradeBoundaryOverrideMap) {
  window.localStorage.setItem(GRADE_BOUNDARY_OVERRIDE_STORAGE_KEY, JSON.stringify(overrides));
}

export function loadGradeBoundaryOverrides(): GradeBoundaryOverrideMap {
  try {
    const raw = window.localStorage.getItem(GRADE_BOUNDARY_OVERRIDE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return supportedSubjects.reduce<GradeBoundaryOverrideMap>((overrides, subject) => {
      const boundaries = readBoundaries(parsed[subject]);
      if (boundaries) overrides[subject] = boundaries;
      return overrides;
    }, {});
  } catch {
    return {};
  }
}

export function saveGradeBoundaryOverride(subject: SupportedSubject, boundaries: GradeBoundaries) {
  const overrides = loadGradeBoundaryOverrides();
  overrides[subject] = boundaries;
  writeOverrides(overrides);
  return overrides;
}

export function clearGradeBoundaryOverride(subject: SupportedSubject) {
  const overrides = loadGradeBoundaryOverrides();
  delete overrides[subject];
  writeOverrides(overrides);
  return overrides;
}

export function resolveGradeBoundary(boundary: GradeBoundary, overrides: GradeBoundaryOverrideMap) {
  const override = overrides[boundary.subject];
  return override ? { ...boundary, boundaries: override } : boundary;
}
