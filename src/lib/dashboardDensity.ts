export type DashboardDensity = "comfortable" | "compact";

export function readDashboardDensity(value?: unknown): DashboardDensity {
  return value === "compact" ? "compact" : "comfortable";
}

export function applyDashboardDensity(density: DashboardDensity) {
  document.documentElement.dataset.density = density;
}
