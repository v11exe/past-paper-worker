import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("prompt templates", () => {
  it("do not contain copyable real exam-style example question text", () => {
    const source = readFileSync(resolve(process.cwd(), "src/ai/prompts.ts"), "utf8").toLowerCase();
    const bannedRegressionString = "secondary storage";

    expect(source).not.toContain(bannedRegressionString);
    expect(source).not.toContain("state one purpose");
    expect(source).not.toContain("network topology");
  });
});
