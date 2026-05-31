import { afterEach, describe, expect, it } from "vitest";

import { applyDashboardDensity, readDashboardDensity } from "./dashboardDensity";

describe("dashboardDensity", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-density");
    window.localStorage.clear();
  });

  it("defaults to comfortable when the stored value is missing", () => {
    expect(readDashboardDensity()).toBe("comfortable");
  });

  it("mirrors the selected density to the html element", () => {
    applyDashboardDensity("compact");
    expect(document.documentElement.dataset.density).toBe("compact");
  });
});
